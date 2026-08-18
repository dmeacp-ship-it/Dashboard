/* ============================================================
   FMS — OMS  integration  (faithful view-only port of the GAS app)

   Reproduces the Virgo ACP FMS views inside the Dashboard, reading
   LIVE from the FMS Google Sheet via /api. Additive + self-contained:
   injects its own sidebar group, a .fms-scope page host, and its own
   modal. Write actions (approve/dispatch/QC/etc.) are intentionally
   omitted — this is a read-only mirror.
============================================================ */
(function () {
  'use strict';
  if (window.FMS && window.FMS.__v2) return;

  /* ───────────────────────── helpers ───────────────────────── */
  var _ed = document.createElement('div');
  function esc(s) { if (s == null || s === '') return ''; _ed.textContent = String(s); return _ed.innerHTML; }
  function q(s) { return String(s || '').toLowerCase().replace(/\s+/g, ''); }
  function _num(v) { if (v == null || v === '') return 0; if (typeof v === 'number') return v; var n = parseFloat(String(v).replace(/[₹,\s]/g, '')); return isFinite(n) ? n : 0; }
  function inr(n) { return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function inrShort(n) { return Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
  function debounce(fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; }

  /**
   * Infinite-scroll handler for a scroll container: calls `more` when the
   * viewport nears the bottom.
   *
   * Reading scrollTop/clientHeight/scrollHeight forces a layout, so the check
   * is coalesced to one per frame and the listener registered as passive —
   * scroll fires far more often than the display can paint.
   */
  function onNearBottom(el, px, more) {
    if (!el) return;
    var frame = 0;
    // Replaces any previous handler, matching the `el.onscroll = fn` semantics
    // these call sites relied on — re-rendering a tab must not stack listeners.
    el.onscroll = null;
    if (el._nbHandler) el.removeEventListener('scroll', el._nbHandler);
    el._nbHandler = function () {
      if (frame) return;
      frame = requestAnimationFrame(function () {
        frame = 0;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - px) more();
      });
    };
    el.addEventListener('scroll', el._nbHandler, { passive: true });
  }

  var _MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /**
   * Parses a sheet date. Handles D/M/YYYY, M/D/YYYY and ISO.
   *
   * `preferPast` resolves the genuinely ambiguous case. The ORDER RESPONSES tab
   * contains MIXED formats — most rows are month-first ("4/10/2026" = 10 Apr),
   * but a subset (all PANCHKULA-BRANCH) are day-first ("12/6/2026" = 12 Jun).
   * When both parts are <= 12 there is no way to tell them apart from the string
   * alone. For fields that record something that ALREADY HAPPENED — order
   * timestamp, CRR/accounts/dispatch stamps, DO dates — a reading that lands in
   * the future is impossible, so we flip to the other interpretation.
   *
   * Left off (default false) for fields that are legitimately in the future,
   * above all DELIVERY REQUIRED ON. Never enable it for those.
   *
   * Without this, those rows parsed months ahead of today, which made
   * `Date.now() - ts` negative and rendered every one of them as "Just now" at
   * the top of the Live Activity Feed, burying all genuinely recent events.
   */
  function _parseDate(str, preferPast) {
    if (!str) return null;
    var s = String(str).trim();
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\s,T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/); // D/M/YYYY or M/D/YYYY
    if (m) {
      var p1 = +m[1], p2 = +m[2], y = +m[3], hh = +(m[4] || 0), mm = +(m[5] || 0), ss = +(m[6] || 0);
      var month = p1, day = p2;
      var ambiguous = false;
      if (p1 > 12) { day = p1; month = p2; }          // unambiguously day-first
      else if (p2 > 12) { month = p1; day = p2; }     // unambiguously month-first
      else { ambiguous = true; }                      // both <= 12: could be either
      var d1 = new Date(y, month - 1, day, hh, mm, ss);
      if (preferPast && ambiguous && d1.getTime() > Date.now()) {
        // month-first puts this in the future, which is impossible for a
        // recorded event — read it day-first instead.
        var swapped = new Date(y, day - 1, month, hh, mm, ss);
        if (!isNaN(swapped.getTime()) && swapped.getTime() <= Date.now()) return swapped;
      }
      return d1;
    }
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[\sT](\d{1,2}):(\d{2})(?::(\d{2}))?)?/); // ISO
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    var d = new Date(s); return isNaN(d.getTime()) ? null : d;
  }
  function _fmtDate(str, withTime) {
    if (!str) return '—';
    var d = _parseDate(str);
    if (!d || isNaN(d.getTime())) return String(str).split(' ')[0] || '—';
    var out = String(d.getDate()).padStart(2, '0') + ' ' + _MON[d.getMonth()] + ' ' + String(d.getFullYear()).slice(-2);
    if (withTime) {
      var hr = d.getHours(), mn = String(d.getMinutes()).padStart(2, '0'), ap = hr >= 12 ? 'PM' : 'AM';
      hr = hr % 12; if (hr === 0) hr = 12;
      out += ' ' + String(hr).padStart(2, '0') + ':' + mn + ' ' + ap;
    }
    return out;
  }

  // status / type colour maps (ported from AppCore.html)
  var STATUS_COLOR = { 'Pending CRR': 'var(--yellow)', 'Pending Accounts': 'var(--accentH)', 'Pending DO Generation': 'var(--purple)', 'Pending Plant': 'var(--teal)', 'Pending QC': 'var(--pink)', 'Ready For QC': 'var(--pink)', 'Auto Approved': 'var(--green)', 'Accounts Approved': 'var(--green)', 'Partially Dispatched': 'var(--part)', 'Fully Dispatched': '#2e7d32', 'Rejected': 'var(--red)', 'On Hold': 'var(--pink)', 'Processing...': 'var(--accentH)', 'In Transit': 'var(--orange)' };
  var STATUS_ICON = { 'Pending CRR': 'ph-clock', 'Pending Accounts': 'ph-hourglass', 'Pending DO Generation': 'ph-clipboard-text', 'Pending Plant': 'ph-factory', 'Pending QC': 'ph-magnifying-glass', 'Ready For QC': 'ph-magnifying-glass', 'Auto Approved': 'ph-check-circle', 'Accounts Approved': 'ph-check-circle', 'Partially Dispatched': 'ph-truck', 'Fully Dispatched': 'ph-check-fat', 'Rejected': 'ph-x-circle', 'On Hold': 'ph-pause-circle', 'Processing...': 'ph-spinner', 'In Transit': 'ph-package' };
  var STATUS_DISP = { 'Pending Accounts': 'Pend. Acc', 'Pending DO Generation': 'Pend. DO', 'Pending Plant': 'Pend. Plant', 'Pending QC': 'Pend. QC', 'Accounts Approved': 'Acc. Appr', 'Auto Approved': 'Auto Appr', 'Partially Dispatched': 'Part. Disp', 'Fully Dispatched': 'Fully Disp' };
  var TYPE_COLOR = { 'Cust. to Factory': 'var(--purple)', 'Branch Order': 'var(--orange)', 'Branch Stock order- Factory': 'var(--teal)' };
  var TYPE_ICON = { 'Cust. to Factory': 'ph-factory', 'Branch Order': 'ph-git-branch', 'Branch Stock order- Factory': 'ph-stack' };
  var PLANT_STATUS_CLASS = { 'Pending': 'pp-pending', 'In Production': 'pp-prod', 'Material Shortage': 'pp-shortage', 'Ready For QC': 'pp-prod', 'Ready for Dispatch': 'pp-ready' };

  function sBadge(s) { if (!s) return '<span class="muted">—</span>'; var key = Object.keys(STATUS_COLOR).find(function (k) { return s === k || s.indexOf(k) === 0; }) || ''; var color = STATUS_COLOR[key] || 'var(--yellow)', icon = STATUS_ICON[key] || 'ph-dot'; return '<span style="color:' + color + ';font-weight:600;font-size:12px;display:inline-flex;align-items:center;gap:5px;white-space:nowrap"><i class="ph ' + icon + '" style="font-size:13px"></i>' + esc(STATUS_DISP[s] || s) + '</span>'; }
  function tBadge(t) { if (!t) return '<span class="muted">—</span>'; return '<span style="color:' + (TYPE_COLOR[t] || 'var(--sub)') + ';font-weight:600;font-size:12px;display:inline-flex;align-items:center;gap:5px;white-space:nowrap"><i class="ph ' + (TYPE_ICON[t] || 'ph-package') + '" style="font-size:13px"></i>' + esc(t) + '</span>'; }
  function plantPill(st) { var s = String(st || 'Pending'); return '<span class="plant-pill ' + (PLANT_STATUS_CLASS[s] || 'pp-pending') + '"><i class="ph ph-factory text-xs"></i>' + esc(s) + '</span>'; }
  function sc(ic, num, col, lbl) { return '<div class="stat"><i class="ph ' + ic + ' stat-ic ' + col + '"></i><div class="stat-n ' + col + '">' + num + '</div><div class="stat-l">' + lbl + '</div></div>'; }
  function dr(k, v) { return '<div class="dr"><span class="dk">' + k + '</span><span class="dv">' + (v || '—') + '</span></div>'; }
  function empt(ic, h, p) { return '<div class="empty"><i class="ph ' + ic + '"></i><h3>' + esc(h) + '</h3><p>' + esc(p) + '</p></div>'; }

  function api(action, options) { return window.api(action, options ? { options: options } : {}); }

  /* ───────────────────────── modal ───────────────────────── */
  function ensureModal() {
    if (document.getElementById('fms-overlay')) return;
    var ov = document.createElement('div');
    ov.id = 'fms-overlay';
    ov.className = 'fms-scope';
    ov.onclick = function (e) { if (e.target === ov) closeModal(); };
    ov.innerHTML = '<div class="modal" id="fms-modal"><div class="modal-header" id="fms-mhead"></div><div class="modal-body" id="fms-mbody"></div><div class="modal-foot" id="fms-mfoot"></div></div>';
    document.body.appendChild(ov);
  }
  function modal(title, body, buttons, large) {
    ensureModal();
    document.getElementById('fms-modal').classList.toggle('large', !!large);
    var h = document.getElementById('fms-mhead');
    h.innerHTML = title ? ('<div class="modal-ttl">' + title + '</div>') : '';
    h.style.display = title ? 'block' : 'none';
    document.getElementById('fms-mbody').innerHTML = body;
    document.getElementById('fms-mfoot').innerHTML = (buttons || []).map(function (b) { return '<button class="btn ' + b.cls + '" onclick="' + b.fn + '">' + b.l + '</button>'; }).join('');
    document.getElementById('fms-overlay').classList.add('show');
  }
  function closeModal() { var ov = document.getElementById('fms-overlay'); if (ov) ov.classList.remove('show'); }
  function openFileModal(url, label) {
    if (!url) return;
    var isImg = /\.(jpg|jpeg|png|gif|webp)/i.test(url);
    var isDrive = /drive\.google\.com|docs\.google\.com/i.test(url);
    var body = isImg
      ? '<img src="' + esc(url) + '" style="max-width:100%;border-radius:8px;display:block;margin:0 auto">'
      : isDrive
        ? '<div class="tc" style="padding:48px 24px"><i class="ph ph-google-drive accent" style="font-size:56px;display:block;margin-bottom:16px"></i><p class="fw6 text-md" style="margin-bottom:8px">' + esc(label || 'File') + '</p><p class="text-sm muted" style="margin-bottom:24px">Stored on Google Drive.</p><a href="' + esc(url) + '" target="_blank" rel="noopener" class="btn btn-primary" style="text-decoration:none"><i class="ph ph-arrow-square-out"></i> Open in Google Drive</a></div>'
        : '<div style="border-radius:8px;overflow:hidden"><iframe src="' + esc(url) + '" style="width:100%;height:72vh;border:none;display:block"></iframe></div>';
    modal('<i class="ph ph-file-text accent"></i> ' + esc(label || 'File'), body,
      [{ l: '<i class="ph ph-arrow-square-out"></i> New Tab', cls: 'btn-ghost btn-sm', fn: "window.open('" + encodeURI(url) + "','_blank')" }, { l: 'Close', cls: 'btn-ghost', fn: 'FMS.closeModal()' }], true);
  }

  /* ───────────────────────── state ───────────────────────── */
  var FMS = {
    __v2: true,
    state: { view: 'all-orders', currentTableData: [], cache: {}, ts: {} },
    _ord: { full: [], view: [], cursor: 0, chunk: 40 },
    _req: 0,
    closeModal: closeModal, openFileModal: openFileModal
  };
  var TTL = 60000;
  function fresh(key) { return FMS.state.cache[key] && (Date.now() - (FMS.state.ts[key] || 0) < TTL); }
  function put(key, v) { FMS.state.cache[key] = v; FMS.state.ts[key] = Date.now(); }

  /* ───────────────────────── nav config ───────────────────────── */
  // Every FMS view lives under one sidebar group.
  // Top-level entry, sits beside the main Dashboard rather than in the group.
  var DASH_NAV = { v: 'dash', ic: 'ph-gauge', lb: 'FMS Dashboard' };
  var REPORTS = [
    { v: 'all-orders',        ic: 'ph-list-bullets',            lb: 'All Orders' },
    { v: 'order-lifecycle',   ic: 'ph-clock',                   lb: 'Order Lifecycle' },
    { v: 'month-wise',        ic: 'ph-calendar',                lb: 'Month-Wise Report' },
    { v: 'reference-orders',  ic: 'ph-link',                    lb: 'Reference Orders' },
    { v: 'plant',             ic: 'ph-factory',                 lb: 'Plant & Dispatch' },
    { v: 'dispatch-history',  ic: 'ph-clock-counter-clockwise', lb: 'Dispatch History' },
    { v: 'delivery-tracking', ic: 'ph-seal-check',              lb: 'Delivery Tracking' }
  ];
  // Queue views are reachable from the dashboard action pills, but are not
  // sidebar entries of their own.
  var QUEUES = {
    crr:  { lb: 'CRR Queue',       ic: 'ph-clipboard-text' },
    acc:  { lb: 'Accounts Queue',  ic: 'ph-currency-circle-dollar' },
    hold: { lb: 'On Hold Orders',  ic: 'ph-pause-circle' }
  };
  var VIEW_TITLE = {};
  REPORTS.concat([DASH_NAV]).forEach(function (s) { VIEW_TITLE[s.v] = s.lb; });
  Object.keys(QUEUES).forEach(function (k) { VIEW_TITLE[k] = QUEUES[k].lb; });

  // generic sheet-table views (server-paginated)
  var SHEET_VIEWS = {
    'dispatch-history': { tab: 'dispatch', icon: 'ph-clock-counter-clockwise', label: 'Dispatch History',
      cols: ['ORDER NUMBER', 'DISPATCH DATE', 'DISPATCH TYPE', 'DISPATCHED QTY', 'BILL URL', 'REMARKS', 'DISPATCHED BY'] },
    'sub-orders': { tab: 'suborders', icon: 'ph-git-fork', label: 'Sub Orders',
      cols: ['SUB-ORDER NO', 'PARENT ORDER NO', 'TARGET BRANCH NAME', 'CREATED ON', 'ITEMS NEEDED', 'QUANTITY', 'DELIVERY DATE', 'STATUS'] },
    'prod-plan': { tab: 'prodplan', icon: 'ph-factory', label: 'Production Plan',
      cols: ['PLAN ID', 'TIMESTAMP', 'ORDER NO', 'CUSTOMER', 'ITEM CODE', 'BATCH', 'PLANNED QTY', 'STATUS', 'QC PASSED', 'QC REJECTED', 'CREATED BY', 'UPDATED ON'] },
    'stock-master': { tab: 'stockmaster', icon: 'ph-stack', label: 'Stock Master',
      cols: ['LOCATION', 'ITEM CODE', 'BATCH', 'QTY ON HAND', 'QTY RESERVED', 'LAST UPDATED', 'UPDATED BY'] },
    'stock-ledger': { tab: 'stockledger', icon: 'ph-list-numbers', label: 'Stock Ledger',
      cols: ['TXN ID', 'TIMESTAMP', 'TXN TYPE', 'LOCATION', 'ITEM CODE', 'QTY IN', 'QTY OUT', 'REFERENCE', 'BALANCE AFTER', 'LOGGED BY'] },
    'customers': { tab: 'customers', icon: 'ph-address-book', label: 'Customer Master',
      cols: ['CUSTOMER CODE', 'DEALER / CUSTOMER NAME', 'MOBILE', 'STATE', 'PAYMENT TERM', 'CREDIT LIMIT (₹)', 'CURRENT OUTSTANDING (₹)', 'BELOW 45 DAYS (₹)', 'ABOVE 45 DAYS (₹)', '90+ DAYS (₹)', 'LAST UPDATED'] },
    'items': { tab: 'items', icon: 'ph-cube', label: 'Item Master',
      cols: ['GRADE / COLOUR CODE', 'BATCH', 'LENGTH (MM)', 'WIDTH (MM)', 'RATE (SQFT)', 'STATUS', 'WEIGHT (KG/SQM)'] }
  };

  /* ───────────────────────── host + nav ───────────────────────── */
  function host() { return document.getElementById('fms-host'); }
  function setC(html) { var h = host(); if (h) h.innerHTML = html; }

  function injectPage() {
    var content = document.getElementById('content');
    if (!content || document.getElementById('page-fmsoms')) return;
    content.insertAdjacentHTML('beforeend',
      '<section id="page-fmsoms" class="page fms-scope"><div id="fms-host"></div></section>');
  }

  function _navGroup(rootId, btnId, menuId, icon, label, items) {
    var sub = items.map(function (s) {
      return '<div class="nav-item" data-page="fmsoms" data-fms="' + s.v + '" onclick="FMS.open(\'' + s.v + '\')">' +
        '<span class="nav-icon"><i class="ph ' + s.ic + '"></i></span><span class="nav-label">' + esc(s.lb) + '</span></div>';
    }).join('');
    return '<div id="' + rootId + '" class="nav-group-wrapper">' +
      '<div class="nav-group-btn" id="' + btnId + '" onclick="window.togglePopover(this, \'' + menuId + '\', event)">' +
      '<span class="nav-group-icon"><i class="ph ' + icon + '"></i></span><span class="nav-group-label">' + esc(label) + '</span>' +
      '<span class="nav-chevron"><i class="ph ph-caret-right"></i></span></div>' +
      '<div class="nav-submenu" id="' + menuId + '">' + sub + '</div></div>';
  }

  function injectNav() {
    var nav = document.querySelector('#sidebar nav');
    if (!nav || document.getElementById('fms-nav-root')) return;
    var html =
      '<div class="nav-item" id="fms-dash-nav" data-page="fmsoms" data-fms="' + DASH_NAV.v + '" onclick="FMS.open(\'' + DASH_NAV.v + '\')">' +
      '<span class="nav-icon"><i class="ph ' + DASH_NAV.ic + '"></i></span><span class="nav-label">' + esc(DASH_NAV.lb) + '</span></div>' +
      _navGroup('fms-nav-root', 'fms-rep-btn', 'fms-rep-submenu', 'ph-chart-bar', 'Live FMS Reports', REPORTS);
    var dash = nav.querySelector('.nav-item[data-page="overview"]');
    if (dash) dash.insertAdjacentHTML('afterend', html);
    else nav.insertAdjacentHTML('beforeend', html);
  }

  function syncNav() {
    // The main router marks every [data-page="fmsoms"] item active, so narrow
    // it back down to whichever FMS view is actually showing.
    document.querySelectorAll('.nav-item[data-fms]').forEach(function (el) {
      el.classList.toggle('active', el.dataset.fms === FMS.state.view);
    });
    var rb = document.getElementById('fms-rep-btn');
    if (rb) rb.classList.toggle('fms-on', REPORTS.some(function (s) { return s.v === FMS.state.view; }));
    var pt = document.getElementById('page-title');
    if (pt) pt.textContent = VIEW_TITLE[FMS.state.view] || 'Live FMS Reports';
  }

  /* ───────────────────────── public nav ───────────────────────── */
  FMS.open = function (view) {
    if (!VIEW_TITLE[view]) view = 'dash';
    FMS.state.view = view;
    document.querySelectorAll('.nav-submenu.open').forEach(function (m) { m.classList.remove('open'); });
    document.querySelectorAll('.nav-group-btn.open').forEach(function (b) { b.classList.remove('open'); });
    if (typeof window.navigate === 'function') window.navigate('fmsoms');
    else FMS.load();
  };
  FMS.load = function () {
    injectPage();
    syncNav();
    if (FMS.applyRole) FMS.applyRole();
    render();
  };

  /* ───────────────────────── view dispatcher ───────────────────────── */
  function _isAdmin() {
    var role = (window.App && window.App.currentUser && window.App.currentUser.role) || '';
    return role === 'super_admin' || role === 'admin';
  }
  function render() {
    var v = FMS.state.view;
    if (v === 'dash') return viewDash();
    if (QUEUES[v]) return viewOrders(v, QUEUES[v].lb, QUEUES[v].ic, false);
    if (v === 'order-lifecycle') return viewLifecycle();
    if (v === 'month-wise') return viewMonthWise();
    if (v === 'reference-orders') return viewReferenceOrders();
    if (v === 'plant') {
      if (!_isAdmin()) return setC(empt('ph-lock', 'Restricted', 'Plant & Dispatch is available to Admins only.'));
      return viewPlantItems();
    }
    if (v === 'dispatch-history') return viewSheet('dispatch-history');
    if (v === 'delivery-tracking') return viewDelivery();
    // default + 'all-orders' → the table on its own; KPI cards live on Dashboard
    return viewOrders('all', 'All Orders', 'ph-list-bullets', false);
  }

  // Plant & Dispatch exposes factory-floor data — hide it for non-admins.
  FMS.applyRole = function () {
    var el = document.querySelector('#fms-rep-submenu .nav-item[data-fms="plant"]');
    if (el) el.style.display = _isAdmin() ? '' : 'none';
  };

  /* ───────────────────────── DASHBOARD ───────────────────────── */
  // KPI set mirrors the FMS admin dashboard: open pipeline broken down by
  // order type, rather than lifetime totals.
  function statCards(d) {
    return sc('ph-folder-open', d.open || 0, 'ca', 'Open Orders') +
      sc('ph-currency-circle-dollar', d.pendingAcc || 0, 'co', 'Pend. Accounts') +
      sc('ph-clipboard-text', d.pendingCRR || 0, 'cy', 'Pend. CRR') +
      sc('ph-pause-circle', d.onHold || 0, 'ck', 'On Hold') +
      sc('ph-buildings', d.branchOrderOpen || 0, 'co', 'Branch Ord.') +
      sc('ph-arrows-left-right', d.branchTransferOpen || 0, 'cr', 'Br. Transfer') +
      sc('ph-factory', d.factoryOpen || 0, 'ct', 'Open Factory') +
      sc('ph-git-branch', d.cvbOpen || 0, 'ca', 'Via Branch') +
      sc('ph-factory', d.directOpen || 0, 'cp', 'Direct Factory') +
      sc('ph-stack', d.stockOpen || 0, 'ct', 'Stock Ord.') +
      sc('ph-target', (d.otifPct || 0) + '%', 'cg', 'OTIF Score');
  }

  // Open-pipeline counts, derived from the same order list that feeds the
  // donut and leaderboard. Computing them here (rather than trusting the
  // server payload) keeps the cards and the chart from ever disagreeing.
  function deriveOpenStats(orders) {
    var s = { open: 0, branchOrderOpen: 0, branchTransferOpen: 0, factoryOpen: 0, cvbOpen: 0, directOpen: 0, stockOpen: 0 };
    (orders || []).forEach(function (o) {
      if (DASH_DONE.indexOf(String(o.status || '').trim().toLowerCase()) > -1) return;
      s.open++;
      var t = String(o.orderType || o.orderTypeForm || '').trim().toLowerCase();
      if (t.indexOf('stock') > -1) { s.stockOpen++; s.factoryOpen++; }
      else if (t.indexOf('factory') > -1) {
        s.factoryOpen++;
        if (String(o.customerName || '').toUpperCase().indexOf('VIRGO ACP INDUSTRIES') > -1) s.cvbOpen++;
        else s.directOpen++;
      } else if (t.indexOf('transfer') > -1) s.branchTransferOpen++;
      else s.branchOrderOpen++;
    });
    return s;
  }

  function viewDash() {
    if (fresh('dash')) { renderDash(FMS.state.cache.dash); }
    else setC('<div style="padding:40px;text-align:center" class="muted"><i class="ph ph-spinner spin text-lg"></i><br>Loading dashboard…</div>');
    var my = ++FMS._req;
    Promise.all([api('getFmsDashboard'), api('getFmsOrders', { queue: 'all' })]).then(function (res) {
      if (my !== FMS._req || FMS.state.view !== 'dash') return;
      var stats = Object.assign({}, res[0], deriveOpenStats(res[1].orders));
      put('dash', stats); put('orders_all', res[1].orders);
      renderDash(stats);
    }).catch(function (e) { if (FMS.state.view === 'dash') setC(empt('ph-warning', 'Error Loading Dashboard', e.message)); });
  }

  var DASH_DONE = ['fully dispatched', 'rejected', 'cancelled', 'received', 'closed (short)'];
  var DASH_TYPES = {
    'Branch Order':    '#f59e0b',
    'Stock Order':     '#14b8a6',
    'Factory Order':   '#a855f7',
    'Branch Transfer': '#ec4899'
  };
  // Bucket used by both the donut and the leaderboard bars.
  function dashBucket(o) {
    var t = String(o.orderType || o.orderTypeForm || '').trim().toLowerCase();
    if (t.indexOf('stock') > -1) return 'Stock Order';
    if (t.indexOf('factory') > -1) return 'Factory Order';
    if (t.indexOf('transfer') > -1) return 'Branch Transfer';
    return 'Branch Order';
  }
  function timeAgo(ts) {
    var diff = Date.now() - ts;
    // Defensive: a stamp ahead of "now" means the date could not be
    // disambiguated. Show the actual date rather than claiming it just happened.
    if (diff < 0) return _fmtDate(new Date(ts), false);
    if (diff < 60000) return 'Just now';
    var mins = Math.floor(diff / 60000); if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(diff / 3600000); if (hrs < 24) return hrs + 'h ago';
    var days = Math.floor(diff / 86400000);
    return days === 1 ? 'Yesterday' : days + 'd ago';
  }

  function renderDash(d) {
    var pills = [
      ['all-orders', 'btn-primary', 'package', 'All Orders'],
      ['crr', 'btn-ghost', 'clipboard-text', 'CRR Queue'],
      ['acc', 'btn-ghost', 'currency-circle-dollar', 'Accounts Queue'],
      ['hold', 'btn-hold', 'pause-circle', 'On Hold']
    ].map(function (b) { return '<button class="btn ' + b[1] + '" onclick="FMS.open(\'' + b[0] + '\')"><i class="ph ph-' + b[2] + '"></i> ' + b[3] + '</button>'; }).join('');

    setC('<div class="stats" style="margin-bottom:16px">' + statCards(d) + '</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">' + pills + '</div>' +
      '<div class="dash-grid" id="fms-dashgrid">' +
      '<div class="card" style="margin-bottom:0;padding:40px;text-align:center" class="muted"><i class="ph ph-spinner spin text-lg"></i><br>Loading analytics &amp; timeline…</div></div>');

    // count-up animation
    requestAnimationFrame(function () {
      host().querySelectorAll('.stat-n').forEach(function (el) {
        var raw = el.textContent, pct = /%$/.test(raw), target = parseInt(raw, 10) || 0;
        if (!target) return; var cur = 0, step = Math.max(1, Math.floor(target / 22));
        (function tick() { cur = Math.min(cur + step, target); el.textContent = cur + (pct ? '%' : ''); if (cur < target) requestAnimationFrame(tick); })();
      });
    });

    var orders = FMS.state.cache.orders_all;
    if (orders) renderDashGrid(orders);
    else api('getFmsOrders', { queue: 'all' }).then(function (r) { put('orders_all', r.orders); if (FMS.state.view === 'dash') renderDashGrid(r.orders); });
  }

  // Donut by order type + branch leaderboard + activity timeline, all derived
  // from the same order list.
  function renderDashGrid(orders) {
    var wrap = document.getElementById('fms-dashgrid'); if (!wrap) return;
    FMS.state.currentTableData = orders;
    if (!orders || !orders.length) {
      wrap.innerHTML = '<div class="card" style="grid-column:1/-1;padding:40px;text-align:center" class="muted"><i class="ph ph-package"></i><p>No orders found.</p></div>';
      return;
    }
    var active = orders.filter(function (o) { return DASH_DONE.indexOf(String(o.status || '').trim().toLowerCase()) === -1; });

    /* ── donut ── */
    var counts = {}; Object.keys(DASH_TYPES).forEach(function (k) { counts[k] = 0; });
    active.forEach(function (o) { counts[dashBucket(o)]++; });
    var total = active.length, R = 42, C = 2 * Math.PI * R;
    var segs = '', legend = '', cum = 0;
    Object.keys(DASH_TYPES).forEach(function (name) {
      var n = counts[name]; if (!n) return;
      var pct = n / total, len = pct * C, col = DASH_TYPES[name];
      segs += '<circle cx="60" cy="60" r="' + R + '" fill="transparent" stroke="' + col + '" stroke-width="10" ' +
        'stroke-dasharray="' + len.toFixed(2) + ' ' + C.toFixed(2) + '" stroke-dashoffset="' + (-(cum * C)).toFixed(2) + '" transform="rotate(-90 60 60)"/>';
      legend += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
        '<div style="display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + col + '"></span>' +
        '<span style="font-weight:500;color:var(--text)">' + esc(name) + '</span></div>' +
        '<span style="font-weight:700;color:var(--sub)">' + n + ' <span style="font-weight:400;color:var(--muted);font-size:10px">(' + Math.round(pct * 100) + '%)</span></span></div>';
      cum += pct;
    });
    if (!total) {
      segs = '<circle cx="60" cy="60" r="' + R + '" fill="transparent" stroke="var(--border2)" stroke-width="10"/>';
      legend = '<div class="muted tc" style="font-size:12px;padding:20px 0">No active orders in workflow.</div>';
    }

    /* ── leaderboard: active load per branch, split by order type ── */
    var byBranch = {};
    active.forEach(function (o) {
      var k = String(o.branchName || 'Unknown').trim() || 'Unknown';
      if (!byBranch[k]) byBranch[k] = { total: 0, factory: 0, stock: 0, transfer: 0 };
      byBranch[k].total++;
      var t = String(o.orderType || o.orderTypeForm || '').trim();
      if (t === 'Cust. to Factory') byBranch[k].factory++;
      else if (t === 'Branch Stock order- Factory') byBranch[k].stock++;
      else byBranch[k].transfer++;
    });
    var ranked = Object.keys(byBranch).map(function (k) { return [k, byBranch[k]]; })
      .sort(function (a, b) { return b[1].total - a[1].total; });
    var board;
    if (!ranked.length) board = '<div class="muted text-sm tc" style="padding:10px 0">No active branch load.</div>';
    else {
      var max = ranked[0][1].total;
      board = ranked.map(function (e) {
        var name = e[0], c = e[1];
        var seg = function (v, col, label) {
          return v > 0 ? '<div style="width:' + ((v / max) * 100) + '%;background:' + col + ';height:100%" title="' + label + ': ' + v + '"></div>' : '';
        };
        var key = function (v, col, label) {
          return v > 0 ? '<span><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + col + ';margin-right:4px"></span>' + label + ': <strong>' + v + '</strong></span>' : '';
        };
        return '<div style="margin-bottom:12px">' +
          '<div class="lbl-row"><span style="color:var(--text);text-overflow:ellipsis;overflow:hidden;white-space:nowrap;max-width:180px;font-weight:600">' + esc(name) + '</span>' +
          '<span style="font-weight:700;color:var(--accentH)">' + c.total + ' <span style="font-weight:400;color:var(--muted);font-size:11px">order' + (c.total > 1 ? 's' : '') + '</span></span></div>' +
          '<div class="lbl-progress-bg">' + seg(c.factory, '#a855f7', 'Factory') + seg(c.stock, '#14b8a6', 'Stock') + seg(c.transfer, '#f59e0b', 'Branch/Transfer') + '</div>' +
          '<div style="display:flex;gap:10px;font-size:10px;color:var(--muted);margin-top:4px;flex-wrap:wrap">' +
          key(c.factory, '#a855f7', 'Factory') + key(c.stock, '#14b8a6', 'Stock') + key(c.transfer, '#f59e0b', 'Branch') + '</div></div>';
      }).join('');
    }

    /* ── activity feed: one event per workflow stamp, newest first ── */
    var events = [];
    orders.forEach(function (o) {
      var base = { orderNo: o.orderNo, branch: o.branchName || '—', customer: o.customerName || 'Unknown' };
      var push = function (raw, title, desc, icon, color) {
        var d = _parseDate(raw, true); if (!d) return;
        events.push({ orderNo: base.orderNo, branch: base.branch, ts: d.getTime(), title: title, desc: desc, icon: icon, color: color });
      };
      push(o.timestamp, 'Order Submitted', 'submitted for ' + base.customer, 'ph-plus-circle', 'var(--accent)');
      push(o.crrDate, 'CRR Approved', 'approved & DO pending (by ' + (o.crrBy || 'CRR') + ')', 'ph-clipboard-text', '#f59e0b');
      if (o.accDate) {
        var hold = String(o.status || '').toLowerCase().indexOf('hold') > -1;
        push(o.accDate, hold ? 'Placed on Credit Hold' : 'Accounts Approved',
          hold ? 'on hold: ' + (o.finalRemarks || 'limit exceeded') : 'credit approved (by ' + (o.accBy || 'Accounts') + ')',
          hold ? 'ph-pause-circle' : 'ph-check-circle', hold ? '#ef4444' : 'var(--green)');
      }
      push(o.dispatchDate, o.status === 'Fully Dispatched' ? 'Fully Dispatched' : 'Partially Dispatched',
        'dispatched ' + o.dispatchedQty + ' sheets (Bill: ' + (o.dispatchBill || 'N/A') + ')', 'ph-truck', 'var(--teal)');
      push(o.rejectedDate, 'Order Rejected', 'rejected: ' + (o.finalRemarks || 'credit check failed'), 'ph-x-circle', '#ef4444');
    });
    events.sort(function (a, b) { return b.ts - a.ts; });
    var top = events.slice(0, 30);
    var timeline = !top.length
      ? '<div class="muted tc" style="padding:40px 0"><i class="ph ph-activity" style="font-size:32px;margin-bottom:8px"></i><p>No recent activity detected.</p></div>'
      : '<div class="tl-container">' + top.map(function (e) {
        return '<div class="tl-item clickable" onclick="FMS.viewOrder(\'' + esc(e.orderNo) + '\')">' +
          '<div class="tl-icon" style="border-color:' + e.color + ';color:' + e.color + '"><i class="ph-bold ' + e.icon + '"></i></div>' +
          '<div class="tl-content"><div class="tl-header">' +
          '<span class="tl-title">' + esc(e.title) + ' <span class="accent">#' + esc(e.orderNo) + '</span></span>' +
          '<span class="tl-time">' + timeAgo(e.ts) + '</span></div>' +
          '<div class="tl-desc">' + esc(e.desc) + ' <span class="muted" style="font-size:11px">(' + esc(e.branch) + ')</span></div>' +
          '</div></div>';
      }).join('') + '</div>';

    wrap.innerHTML =
      '<div class="card" style="margin-bottom:0;display:flex;flex-direction:column;gap:16px;padding:20px;overflow:hidden">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);padding-bottom:10px;flex-shrink:0">' +
      '<span class="tbl-ttl" style="font-size:15px;font-weight:700"><i class="ph ph-chart-pie-slice accent"></i> Order Analytics &amp; Leaderboard</span></div>' +
      '<div style="display:flex;align-items:center;gap:20px;justify-content:center;flex-shrink:0">' +
      '<div style="position:relative;width:110px;height:110px;flex-shrink:0">' +
      '<svg width="110" height="110" viewBox="0 0 120 120">' + segs + '</svg>' +
      '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none">' +
      '<span style="font-size:18px;font-weight:800;color:var(--text)">' + total + '</span>' +
      '<span style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:600">Active</span></div></div>' +
      '<div style="display:flex;flex-direction:column;gap:6px;font-size:12px;flex:1;min-width:140px">' + legend + '</div></div>' +
      '<div style="border-top:1px solid var(--border);padding-top:14px;flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden">' +
      '<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px;flex-shrink:0"><i class="ph ph-chart-bar accent"></i> Active Orders by Branch</div>' +
      '<div style="flex:1;min-height:0;max-height:300px;overflow-y:auto;padding-right:6px">' + board + '</div></div></div>' +

      '<div class="card" style="margin-bottom:0;padding:20px;display:flex;flex-direction:column;overflow:hidden">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);padding-bottom:10px;margin-bottom:12px;flex-shrink:0">' +
      '<span class="tbl-ttl" style="font-size:15px;font-weight:700"><i class="ph ph-activity accent"></i> Live Activity Feed</span>' +
      '<button class="btn btn-ghost btn-sm" onclick="FMS.open(\'all-orders\')">View All</button></div>' +
      '<div style="flex:1;min-height:0;max-height:460px;overflow-y:auto;padding-right:4px">' + timeline + '</div></div>';
  }

  /* ───────────────────────── ORDERS TABLE ───────────────────────── */
  function dashStatsHtml(d) {
    return '<div class="stats" id="fms-stats" style="margin-bottom:16px">' + statCards(d) + '</div>';
  }

  function viewOrders(queue, title, icon, withStats) {
    setC('<div style="padding:40px;text-align:center" class="muted"><i class="ph ph-spinner spin text-lg"></i><br>Loading orders…</div>');
    var my = ++FMS._req;
    var jobs = withStats ? [api('getFmsOrders', { queue: queue }), api('getFmsDashboard')] : [api('getFmsOrders', { queue: queue })];
    Promise.all(jobs).then(function (res) {
      if (my !== FMS._req) return;
      var orders = res[0].orders;
      // All Orders hides completed/cancelled orders and branch-transfer /
      // branch-stock-to-factory order types (those live elsewhere).
      if (queue === 'all') {
        var EXCL_TYPE = { 'Branch Transfer': 1, 'Branch Stock order- Factory': 1 };
        orders = orders.filter(function (o) {
          if (o.status === 'Fully Dispatched' || o.status === 'Cancelled') return false;
          if (EXCL_TYPE[o.orderType || o.orderTypeForm]) return false;
          return true;
        });
      }
      put('orders_' + queue, orders);
      paintOrders(orders, title, icon, withStats ? dashStatsHtml(res[1]) : '');
    }).catch(function (e) { setC(empt('ph-warning', 'Failed to load', e.message)); });
  }

  function paintOrders(orders, title, icon, statsHtml) {
    statsHtml = statsHtml || '';
    FMS.state.currentTableData = orders;
    FMS._ord.full = orders;
    var maxH = statsHtml ? 'calc(100vh - 330px)' : 'calc(100vh - 200px)';
    var flt =
      '<div class="sw"><i class="ph ph-magnifying-glass"></i><input type="text" id="fms-osrch" class="tsearch" placeholder="Search order, customer, branch…" oninput="FMS.filterOrders()"></div>' +
      '<select id="fms-ostat" class="filter-sel" onchange="FMS.filterOrders()">' +
      '<option value="">All Statuses</option><option value="pending accounts">Pending Accounts</option><option value="pending do generation">Pending DO Gen</option>' +
      '<option value="pending plant">Pending Plant</option><option value="auto approved">Auto Approved</option><option value="accounts approved">Acc Approved</option>' +
      '<option value="partially dispatched">Part. Dispatched</option><option value="fully dispatched">Fully Dispatched</option><option value="on hold">On Hold</option><option value="rejected">Rejected</option></select>';
    setC(statsHtml + '<div class="card" style="margin-bottom:0;display:flex;flex-direction:column">' +
      '<div class="tbl-top"><span class="tbl-ttl"><i class="ph ' + icon + ' accent"></i> ' + esc(title) + ' <span class="muted fw5 text-sm" id="fms-ocount" style="margin-left:6px">(' + orders.length + ')</span></span>' +
      '<div class="tbl-filters">' + flt + '</div></div>' +
      '<div class="tbl-wrap" id="fms-ow" style="max-height:' + maxH + '"><table id="fms-ot" class="fms-orders"><thead><tr>' +
      '<th style="white-space:nowrap">Date</th>' +
      '<th style="white-space:nowrap">Sales Exec</th>' +
      '<th style="white-space:nowrap">HOD</th>' +
      '<th style="white-space:nowrap">Order No</th>' +
      '<th style="min-width:170px">Dealer / Party</th>' +
      '<th style="white-space:nowrap">Order Ref</th>' +
      '<th style="min-width:150px">Customer Ref</th>' +
      '<th class="tr">Qty</th>' +
      '<th class="tr" style="white-space:nowrap">Disp. Qty</th>' +
      '<th style="min-width:140px">Approval Status</th>' +
      '<th style="white-space:nowrap">Branch</th>' +
      '</tr></thead><tbody id="fms-otb"></tbody></table></div></div>');
    applyOrdView(orders);
    var w = document.getElementById('fms-ow');
    onNearBottom(w, 120, moreRows);
    if (statsHtml) {
      requestAnimationFrame(function () {
        (host().querySelectorAll('#fms-stats .stat-n') || []).forEach(function (el) {
          var raw = el.textContent, pct = /%$/.test(raw), target = parseInt(raw, 10) || 0;
          if (!target) return; var cur = 0, step = Math.max(1, Math.floor(target / 22));
          (function tick() { cur = Math.min(cur + step, target); el.textContent = cur + (pct ? '%' : ''); if (cur < target) requestAnimationFrame(tick); })();
        });
      });
    }
  }

  // An FMS order carries no HOD; the server derives it (see _resolveHod in
  // fms.service.js). The tooltip states which source was used so a surprising
  // value can be traced rather than guessed at.
  var HOD_SRC = {
    fy:       'Matched on customer, from this financial year’s latest sale',
    snapshot: 'Matched on customer, from the customer master',
    exec:     'Matched on sales executive (weaker — no customer match found)',
    linked:   'Inherited from the linked branch order',
    branch:   'Internal branch-to-branch movement — no customer HOD applies'
  };
  function hodCell(o) {
    var h = o.hod ? String(o.hod).trim() : '';
    if (!h) return '<span class="muted" title="No HOD could be matched for this order">—</span>';
    var tip = HOD_SRC[o.hodSource] || '';
    if (o.hodSource === 'branch') {
      return '<span class="muted" style="font-size:11px;font-style:italic" title="' + esc(tip) + '">' + esc(h) + '</span>';
    }
    return '<span class="badge bdg" style="font-size:11px" title="' + esc(tip) + '">' + esc(h) + '</span>';
  }

  function ordRow(o) {
    var st = String(o.status || '').trim().toLowerCase();
    var disp = Number(o.dispatchedQty) || 0;
    var ref = o.orderRef
      ? '<span class="lnk accent" onclick="event.stopPropagation();FMS.viewOrder(\'' + esc(o.orderRef) + '\')">' + esc(o.orderRef) + '</span>'
      : '<span class="muted">—</span>';
    return '<tr class="clickable" data-s="' + esc(q(o.orderNo + o.seName + o.dealerName + o.branchName + o.orderRef + (o.hod || ''))) + '" data-stat="' + esc(st) + '" onclick="FMS.viewOrder(\'' + esc(o.orderNo) + '\')">' +
      '<td class="muted" style="white-space:nowrap;font-size:12px">' + _fmtDate(o.timestamp, false) + '</td>' +
      '<td style="white-space:nowrap">' + (o.seName ? '<span class="badge bdg" style="font-size:11px">' + esc(o.seName) + '</span>' : '<span class="muted">—</span>') + '</td>' +
      '<td style="white-space:nowrap">' + hodCell(o) + '</td>' +
      '<td style="white-space:nowrap"><strong class="accent" style="font-size:13px">' + esc(o.orderNo) + '</strong>' + (o.parentOrder ? '<div class="text-xs muted"><i class="ph ph-arrow-bend-down-right"></i> ' + esc(o.parentOrder) + '</div>' : '') + '</td>' +
      '<td style="max-width:210px"><div class="fw5" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px" title="' + esc(o.dealerName) + '">' + (esc(o.dealerName) || '<span class="muted">—</span>') + '</div></td>' +
      '<td style="white-space:nowrap;font-size:12px">' + ref + '</td>' +
      '<td style="max-width:190px">' + (o.custRef ? '<div class="fw5" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px" title="' + esc(o.custRef) + '">' + esc(o.custRef) + '</div>' : '<span class="muted">—</span>') + '</td>' +
      '<td class="tr fwb" style="font-size:13px">' + (o.quantityOrdered || '—') + '</td>' +
      '<td class="tr fwb" style="color:' + (disp > 0 ? 'var(--part)' : 'var(--muted)') + '">' + (disp > 0 ? disp : '—') + '</td>' +
      '<td>' + sBadge(o.status) + '</td>' +
      '<td style="white-space:nowrap">' + (o.branchName ? '<span class="badge bdg" style="font-size:11px">' + esc(o.branchName) + '</span>' : '<span class="muted">—</span>') + '</td>' +
      '</tr>';
  }

  function applyOrdView(list) {
    FMS._ord.view = list; FMS._ord.cursor = 0;
    var tb = document.getElementById('fms-otb'); if (!tb) return;
    tb.innerHTML = '';
    moreRows();
  }
  function moreRows() {
    var o = FMS._ord, tb = document.getElementById('fms-otb'); if (!tb) return;
    var chunk = o.view.slice(o.cursor, o.cursor + o.chunk);
    if (!chunk.length) return;
    tb.insertAdjacentHTML('beforeend', chunk.map(ordRow).join(''));
    o.cursor += chunk.length;
  }
  FMS.filterOrders = debounce(function () {
    var s = (document.getElementById('fms-osrch') || {}).value || '';
    s = q(s);
    var stat = (document.getElementById('fms-ostat') || {}).value || '';
    var filtered = FMS._ord.full.filter(function (o) {
      // o.hod is included so the HOD column is searchable like every other
      // visible column — the row's data-s attribute already carried it, but
      // this filter builds its own string and was missing it.
      var matchS = !s || q(o.orderNo + o.customerName + o.seName + o.dealerName + o.branchName + (o.hod || '')).indexOf(s) !== -1;
      var matchT = !stat || String(o.status || '').toLowerCase() === stat;
      return matchS && matchT;
    });
    var c = document.getElementById('fms-ocount'); if (c) c.textContent = '(' + filtered.length + ')';
    applyOrdView(filtered);
  }, 220);

  /* ───────────────────────── ORDER DETAIL ───────────────────────── */
  FMS.viewOrder = function (orderNo) {
    var o = (FMS.state.currentTableData || []).find(function (x) { return x.orderNo === orderNo; });
    modal('<i class="ph ph-package"></i> Order Profile — ' + esc(orderNo),
      '<div style="padding:30px;text-align:center" class="muted"><i class="ph ph-spinner spin text-lg"></i><br>Loading order…</div>',
      [{ l: 'Close', cls: 'btn-ghost', fn: 'FMS.closeModal()' }], true);
    api('getFmsOrderDetail', { orderNo: orderNo }).then(function (res) {
      renderOrderDetail(res.order || o, res.doItems || [], res.dispatch || [], res.subOrders || []);
    }).catch(function (e) {
      if (o) renderOrderDetail(o, [], [], []);
      else document.getElementById('fms-mbody').innerHTML = empt('ph-warning', 'Failed', e.message);
    });
  };

  function getVisualStatus(status, orderType, ts) {
    var s = String(status || '').trim();
    var isFactory = String(orderType || '').indexOf('Factory') !== -1, isStock = String(orderType || '').indexOf('Stock') !== -1;
    function mk(cls, rawIcon, label, dateStr) {
      var isComp = cls.indexOf('completed') !== -1, isRej = cls.indexOf('rejected') !== -1, isHold = cls.indexOf('hold') !== -1;
      var di = isComp ? '<i class="ph-fill ph-check-circle"></i>' : isRej ? '<i class="ph-fill ph-x-circle"></i>' : isHold ? '<i class="ph-fill ph-pause-circle"></i>' : rawIcon;
      var tsH = dateStr ? '<div class="step-time">' + esc(String(dateStr).split(' ').slice(0, 3).join(' ')) + '</div>' : '';
      return '<div class="status-step ' + cls + '"><div class="step-dot">' + di + '</div><div class="step-lbl">' + label + '</div>' + tsH + '</div>';
    }
    var steps = [mk('completed', '<i class="ph-fill ph-paper-plane-tilt"></i>', 'Submitted', _fmtDate(ts.timestamp, false))];
    if (isStock || isFactory) {
      var s2 = '', s3 = '', s4 = '', s5 = '', s6 = '';
      if (isFactory) {
        if (s === 'Pending Accounts') s2 = 'active'; else if (s === 'On Hold') s2 = 'hold active';
        else if (s === 'Rejected') { s2 = 'completed'; s3 = 'rejected'; }
        else if (s === 'Pending DO Generation') { s2 = 'completed'; s3 = 'active'; }
        else if (s === 'Pending Plant') { s2 = 'completed'; s3 = 'completed'; s4 = 'active'; }
        else if (s === 'Partially Dispatched') { s2 = 'completed'; s3 = 'completed'; s4 = 'completed'; s5 = 'completed'; s6 = 'active'; }
        else if (s === 'Fully Dispatched') { s2 = s3 = s4 = s5 = s6 = 'completed'; }
        else { s2 = 'completed'; s3 = 'completed'; s4 = 'completed'; s5 = 'completed'; }
        steps.push(mk(s2, '2', 'Accounts', _fmtDate(ts.approvedDate || ts.rejectedDate || ts.holdDate, false)));
      } else {
        if (s === 'Pending DO Generation') s3 = 'active';
        else if (s === 'Pending Plant') { s3 = 'completed'; s4 = 'active'; }
        else if (s === 'Partially Dispatched') { s3 = 'completed'; s4 = 'completed'; s5 = 'completed'; s6 = 'active'; }
        else if (s === 'Fully Dispatched') { s3 = s4 = s5 = s6 = 'completed'; }
        else { s3 = 'completed'; s4 = 'completed'; s5 = 'completed'; }
      }
      steps.push(mk(s3, '<i class="ph-fill ph-clipboard-text"></i>', 'DO Gen', _fmtDate(ts.crrDate, false)));
      steps.push(mk(s4, '<i class="ph-fill ph-factory"></i>', 'Plant', ''));
      steps.push(mk(s5, '<i class="ph-fill ph-magnifying-glass"></i>', 'QC', ''));
      steps.push(mk(s6, '<i class="ph-fill ph-truck"></i>', 'Dispatched', _fmtDate(ts.dispatchDate, false)));
    } else {
      var a2 = '', a3 = '', a4 = '';
      if (s === 'Processing...' || s === 'Pending Accounts') a2 = 'active';
      else if (s === 'On Hold') a2 = 'hold active';
      else if (s === 'Rejected') { a2 = 'completed'; a3 = 'rejected'; }
      else if (s === 'Auto Approved' || s === 'Accounts Approved') { a2 = 'completed'; a3 = 'completed'; }
      else if (s === 'Partially Dispatched') { a2 = 'completed'; a3 = 'completed'; a4 = 'active'; }
      else if (s === 'Fully Dispatched') { a2 = 'completed'; a3 = 'completed'; a4 = 'completed'; }
      else { a2 = 'completed'; a3 = 'completed'; }
      steps.push(mk(a2, '2', 'Accounts', _fmtDate(ts.crrDate, false)));
      steps.push(mk(a3, '<i class="ph-fill ph-check-circle"></i>', 'Approved', _fmtDate(ts.approvedDate || ts.rejectedDate || ts.holdDate, false)));
      steps.push(mk(a4, '<i class="ph-fill ph-truck"></i>', 'Dispatched', _fmtDate(ts.dispatchDate, false)));
    }
    return '<div class="status-tracker">' + steps.join('') + '</div>';
  }

  function renderOrderDetail(o, doItems, dispatch, subOrders) {
    if (!o) { document.getElementById('fms-mbody').innerHTML = empt('ph-warning', 'Not found', 'Order could not be loaded.'); return; }
    document.getElementById('fms-mhead').innerHTML =
      '<div class="modal-ttl"><i class="ph ph-package"></i> Order Profile — ' + esc(o.orderNo) + '</div>' +
      getVisualStatus(o.status, o.orderType, o);
    var remQty = (o.quantityOrdered || 0) - (o.dispatchedQty || 0);
    var doUrlMatch = String(o.finalRemarks || '').match(/\[DO_URL:(https?:\/\/[^\]]+)\]/);
    var doUrl = doUrlMatch ? doUrlMatch[1] : '';
    var finalClean = String(o.finalRemarks || '').replace(/\[DO_URL:[^\]]*\]\n?/g, '').trim();
    var detailHtml = o.orderDetail && String(o.orderDetail).indexOf('http') === 0
      ? '<span class="lnk" onclick="FMS.openFileModal(\'' + esc(o.orderDetail) + '\',\'Order Detail — ' + esc(o.orderNo) + '\')"><i class="ph ph-file-text text-md"></i> View Attached File</span>'
      : (esc(o.orderDetail) || '—');

    var showPlant = (String(o.orderType || '').indexOf('Factory') !== -1 || String(o.orderType || '').indexOf('Stock') !== -1) &&
      ['Pending Plant', 'Partially Dispatched', 'Fully Dispatched'].indexOf(o.status) !== -1;
    var plantSec = showPlant
      ? '<div class="profile-section" style="border-color:rgba(20,184,166,0.4)"><div class="profile-section-ttl teal"><i class="ph ph-factory"></i> Plant Production</div><div class="detail-grid">' + dr('Plant Status', plantPill(o.plantStatus || 'Pending')) + (o.plantRemarks ? '<div class="dr full"><span class="dk">Plant Remarks</span><span class="dv muted" style="white-space:pre-wrap">' + esc(o.plantRemarks) + '</span></div>' : '') + '</div></div>' : '';

    var itemsSec = doItems.length ? ('<div class="profile-section"><div class="profile-section-ttl"><i class="ph ph-rows"></i> DO Line Items (' + doItems.length + ')</div>' +
      '<div style="overflow-x:auto"><table style="font-size:12px"><thead><tr>' +
      '<th>Grade / Code</th><th>Batch</th><th class="tr">L×W</th><th class="tr">Qty</th><th class="tr">SqM</th><th class="tr">Amount</th><th>Prod</th><th>QC</th></tr></thead><tbody>' +
      doItems.map(function (it) {
        return '<tr><td class="fwb">' + esc(it.code) + '</td><td>' + (it.batch ? '<span class="badge bdg text-xs">' + esc(it.batch) + '</span>' : '—') + '</td>' +
          '<td class="tr muted text-sm">' + (it.length && it.width ? it.length + '×' + it.width : '—') + '</td>' +
          '<td class="tr fwb">' + (it.qty || '—') + '</td><td class="tr muted text-sm">' + (it.sqm ? it.sqm.toFixed(2) : '—') + '</td>' +
          '<td class="tr teal fw6">₹' + inrShort(it.amount) + '</td>' +
          '<td>' + (it.prodStatus ? '<span class="badge bdg text-xs">' + esc(it.prodStatus) + '</span>' : '—') + '</td>' +
          '<td>' + (it.qcStatus ? '<span class="badge bdg text-xs">' + esc(it.qcStatus) + '</span>' : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>') : '';

    var dispSec = '<div class="profile-section" style="background:var(--surface)"><div class="profile-section-ttl"><i class="ph ph-truck"></i> Dispatch History</div>' +
      (dispatch.length
        ? '<div style="overflow-x:auto"><table style="font-size:12px"><thead><tr><th>Date</th><th>Type</th><th class="tr">Qty</th><th>Remarks</th><th class="tc">Bill</th></tr></thead><tbody>' +
        dispatch.map(function (d) {
          var bl = d.billUrl ? '<a href="' + esc(d.billUrl) + '" target="_blank" rel="noopener" class="accent"><i class="ph ph-file-pdf text-lg"></i></a>' : '—';
          return '<tr><td class="nowrap">' + _fmtDate(d.dispatchDate, true) + '</td><td>' + sBadge(d.type === 'Full' ? 'Fully Dispatched' : 'Partially Dispatched') + '</td><td class="tr fwb part">' + esc(d.qty) + '</td><td class="break-word">' + esc(d.remarks) + '</td><td class="tc">' + bl + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : '<div class="muted text-sm tc" style="padding:10px">No dispatches logged yet.</div>') + '</div>';

    var subSec = '<div class="profile-section" style="background:var(--surface)"><div class="profile-section-ttl"><i class="ph ph-git-fork"></i> Sub-Orders / Pendency</div>' +
      (subOrders.length
        ? '<div style="overflow-x:auto"><table style="font-size:12px"><thead><tr><th>Sub-Order</th><th>Target Branch</th><th class="tc">Qty</th><th>Status</th><th>Requested</th></tr></thead><tbody>' +
        subOrders.map(function (d) {
          return '<tr><td class="fwb accent">' + esc(d.subOrderNo) + '</td><td><span class="badge bdg">' + esc(d.targetBranch) + '</span></td><td class="tc fwb">' + esc(d.quantity) + '</td><td>' + sBadge(d.status) + '</td><td class="muted text-sm">' + esc(d.createdOn) + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : '<div class="muted text-sm tc" style="padding:10px">No sub-orders requested.</div>') + '</div>';

    document.getElementById('fms-mbody').innerHTML =
      '<div class="profile-section"><div class="profile-section-ttl"><i class="ph ph-storefront"></i> Customer Details</div><div class="detail-grid">' +
      dr('Customer', esc(o.customerName)) + dr('Dealer / Party', esc(o.dealerName)) + dr('Contact Person', esc(o.partyPerson)) + dr('Mobile', esc(o.mobile)) + dr('Email', esc(o.email)) +
      '<div class="dr full"><span class="dk">Delivery Address</span><span class="dv">' + (esc(o.address) || '—') + '</span></div></div></div>' +
      '<div class="profile-section"><div class="profile-section-ttl"><i class="ph ph-info"></i> Order Specifications</div><div class="detail-grid">' +
      dr('Order Type', tBadge(o.orderType)) + dr('Delivery Date', _fmtDate(o.deliveryDate, false)) + dr('Sales Exec', esc(o.seName)) + dr('Created By', esc(o.createdBy)) + dr('Branch / Parent', esc(o.branchName || o.parentOrder)) +
      '<div class="dr full"><span class="dk">Order Detail / File</span><span class="dv">' + detailHtml + '</span></div>' +
      '<div class="dr full"><span class="dk">Remarks</span><span class="dv">' + (esc(o.remarks) || '—') + '</span></div>' +
      (doUrl ? '<div class="dr full"><span class="dk">Delivery Order PDF</span><span class="dv"><span class="lnk lnk-t" onclick="FMS.openFileModal(\'' + esc(doUrl) + '\',\'DO PDF — ' + esc(o.orderNo) + '\')"><i class="ph ph-file-pdf text-lg"></i> View DO PDF</span></span></div>' : '') +
      '</div></div>' +
      '<div class="profile-section" style="background:var(--bg)"><div class="profile-section-ttl"><i class="ph ph-currency-inr"></i> Financials &amp; Status</div><div class="detail-grid">' +
      dr('Est. Value', o.estValue ? '₹' + inr(o.estValue) : '—') + dr('Outstanding', '₹' + inr(o.outstanding)) + dr('Credit Limit', '₹' + inr(o.creditLimit)) + dr('Payment Term', esc(o.paymentTerm)) + dr('Freight', esc(o.freight)) +
      dr('Qty Ordered', '' + o.quantityOrdered) + dr('Qty Dispatched', '<span class="part fwb">' + o.dispatchedQty + '</span>') + dr('Qty Pending', '<span class="accent fwb">' + remQty + '</span>') +
      '<div class="dr full"><span class="dk">Final Remarks / Action Log</span><span class="dv muted" style="white-space:pre-wrap">' + (esc(finalClean) || '—') + '</span></div></div></div>' +
      plantSec + itemsSec + dispSec + subSec;

    document.getElementById('fms-mfoot').innerHTML = '<button class="btn btn-ghost" onclick="FMS.closeModal()">Close</button>';
  }

  /* ───────────────────────── REPORT SHARED BITS ───────────────────────── */
  // Segregated order type — same rules as the FMS app's getSegregatedOrderType.
  function segType(o) {
    var type = String(o.orderType || o.orderTypeForm || '').trim();
    if (type === 'Branch Transfer') return 'Branch Transfer';
    if (type === 'Branch Stock order- Factory') return 'Stock Order';
    var hasVirgo = String(o.customerName || '').toUpperCase().indexOf('VIRGO') > -1;
    var hasRef = String(o.orderRef || '').trim().length > 0;
    if (type === 'Cust. to Factory' || type === 'Direct Customer to Factory') return 'Direct Customer to Factory';
    if (type === 'Branch Order') return (hasVirgo && hasRef) ? 'Customer Via Branch' : 'Branch Order';
    if (hasVirgo && !hasRef) return 'Stock Order';
    if (hasVirgo && hasRef) return 'Customer Via Branch';
    return type || 'Branch Order';
  }
  var SEG_STYLE = {
    'Branch Order':               ['rgba(249,115,22,0.12)', 'var(--orange)',  'ph-git-commit'],
    'Customer Via Branch':        ['rgba(99,102,241,0.12)', 'var(--accentH)', 'ph-git-branch'],
    'Direct Customer to Factory': ['rgba(168,85,247,0.12)', 'var(--purple)',  'ph-factory'],
    'Stock Order':                ['rgba(20,184,166,0.12)', 'var(--teal)',    'ph-stack'],
    'Branch Transfer':            ['rgba(234,179,8,0.12)',  '#d97706',        'ph-arrows-left-right']
  };
  function segBadge(o) {
    var t = segType(o), s = SEG_STYLE[t] || ['var(--surface)', 'var(--muted)', 'ph-dot'];
    return '<span class="fms-bk" style="background:' + s[0] + ';color:' + s[1] + '"><i class="ph ' + s[2] + '" style="font-size:12px;margin-right:4px"></i>' + esc(t) + '</span>';
  }

  // Days from punch to dispatch; still-open orders age against today. Terminal
  // states with no dispatch date have no meaningful aging.
  function agingDays(o) {
    var start = _parseDate(o.timestamp, true);
    if (!start) return null;
    var end = _parseDate(o.dispatchDate, true);
    if (!end) {
      var st = String(o.status || '').toLowerCase();
      if (st === 'cancelled') end = _parseDate(o.holdDate, true);
      else if (st === 'rejected') end = _parseDate(o.rejectedDate, true);
      if (!end) {
        if (st === 'cancelled' || st === 'rejected' || st.indexOf('fully') > -1 || st.indexOf('closed') > -1) return null;
        end = new Date();
      }
    }
    return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
  }

  /* ───────────────────────── ORDER LIFECYCLE ───────────────────────── */
  var _lc = { full: [], view: [], cursor: 0, chunk: 60, search: '', status: '', type: '' };

  function lcRow(o) {
    var aging = agingDays(o), agingBadge = '<span class="muted">—</span>';
    if (aging !== null) {
      var c = aging > 15 ? 'var(--red)' : aging > 7 ? 'var(--orange)' : 'var(--green)';
      var active = (o.dispatchDate && o.dispatchDate !== '—') ? '' : ' (active)';
      agingBadge = '<span class="badge" style="background:' + c + '15;color:' + c + ';border:1px solid ' + c + '30;font-weight:700">' + aging + 'd' + active + '</span>';
    }
    return '<tr class="clickable" onclick="FMS.viewOrder(\'' + esc(o.orderNo) + '\')">' +
      '<td style="padding:9px 14px;white-space:nowrap"><strong class="accent">' + esc(o.orderNo) + '</strong></td>' +
      '<td style="padding:9px 12px;max-width:240px"><div class="fw6" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(o.customerName) + '">' + esc(o.customerName) + '</div></td>' +
      '<td style="padding:9px 12px">' + segBadge(o) + '</td>' +
      '<td class="muted" style="padding:9px 10px;white-space:nowrap;font-size:12px">' + _fmtDate(o.timestamp, true) + '</td>' +
      '<td class="muted" style="padding:9px 10px;white-space:nowrap;font-size:12px">' + _fmtDate(o.accDate, false) + '</td>' +
      '<td class="muted" style="padding:9px 10px;white-space:nowrap;font-size:12px">' + _fmtDate(o.doGenDate, true) + '</td>' +
      '<td class="muted" style="padding:9px 10px;white-space:nowrap;font-size:12px">' + _fmtDate(o.dispatchDate, true) + '</td>' +
      '<td class="tc" style="padding:9px 10px;white-space:nowrap">' + agingBadge + '</td>' +
      '<td style="padding:9px 12px">' + sBadge(o.status) + '</td></tr>';
  }
  function lcMore() {
    var tb = document.getElementById('fms-lctb'); if (!tb) return;
    var chunk = _lc.view.slice(_lc.cursor, _lc.cursor + _lc.chunk);
    if (!chunk.length) return;
    tb.insertAdjacentHTML('beforeend', chunk.map(lcRow).join(''));
    _lc.cursor += chunk.length;
  }
  function lcApply() {
    _lc.view = _lc.full.filter(function (o) {
      if (_lc.search && q(o.orderNo + o.customerName).indexOf(_lc.search) === -1) return false;
      if (_lc.status && String(o.status || '').toLowerCase().indexOf(_lc.status) === -1) return false;
      if (_lc.type && segType(o).toLowerCase() !== _lc.type) return false;
      return true;
    });
    _lc.cursor = 0;
    var tb = document.getElementById('fms-lctb'); if (tb) tb.innerHTML = '';
    lcMore();
    var c = document.getElementById('fms-lccount'); if (c) c.textContent = '(' + _lc.view.length + ')';
  }
  FMS.lcSearch = debounce(function (v) { _lc.search = q(v); lcApply(); }, 220);
  FMS.lcStatus = function (v) { _lc.status = String(v || '').toLowerCase(); lcApply(); };
  FMS.lcType = function (v) { _lc.type = String(v || '').toLowerCase(); lcApply(); };

  var LC_STATUSES = ['Pending Accounts', 'Pending DO Generation', 'Pending Plant', 'Auto Approved', 'Accounts Approved', 'Partially Dispatched', 'Fully Dispatched', 'On Hold', 'Rejected', 'Cancelled', 'In Transit'];
  var LC_TYPES = ['Branch Order', 'Customer Via Branch', 'Direct Customer to Factory', 'Stock Order', 'Branch Transfer'];

  function viewLifecycle() {
    setC('<div style="padding:40px;text-align:center" class="muted"><i class="ph ph-spinner spin text-lg"></i><br>Loading order lifecycle…</div>');
    var my = ++FMS._req;
    api('getFmsOrders', { queue: 'all' }).then(function (r) {
      if (my !== FMS._req || FMS.state.view !== 'order-lifecycle') return;
      var orders = r.orders || [];
      FMS.state.currentTableData = orders;
      if (!orders.length) { setC(empt('ph-package', 'No Orders', 'Nothing to show yet.')); return; }
      _lc.full = orders; _lc.search = ''; _lc.status = ''; _lc.type = '';
      var opts = function (list) { return list.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join(''); };
      setC('<div class="card" style="margin-bottom:0;display:flex;flex-direction:column">' +
        '<div class="tbl-top"><span class="tbl-ttl"><i class="ph ph-clock accent"></i> Order Workflow Lifecycle <span class="muted fw5 text-sm" id="fms-lccount" style="margin-left:6px">(' + orders.length + ')</span></span>' +
        '<div class="tbl-filters"><div class="sw"><i class="ph ph-magnifying-glass"></i><input class="tsearch" placeholder="Order no, customer…" oninput="FMS.lcSearch(this.value)"></div>' +
        '<select class="filter-sel" onchange="FMS.lcStatus(this.value)"><option value="">All Statuses</option>' + opts(LC_STATUSES) + '</select>' +
        '<select class="filter-sel" onchange="FMS.lcType(this.value)"><option value="">All Order Types</option>' + opts(LC_TYPES) + '</select></div></div>' +
        '<div class="tbl-wrap" id="fms-lcwrap" style="max-height:calc(100vh - 300px)"><table><thead><tr>' +
        '<th>Order No</th><th>Customer</th><th>Order Type</th><th>Punched On</th><th>Accounts Action</th><th>DO Generated</th><th>Dispatched On</th><th class="tc">Aging</th><th>Status</th>' +
        '</tr></thead><tbody id="fms-lctb"></tbody></table></div></div>');
      lcApply();
      var w = document.getElementById('fms-lcwrap');
      onNearBottom(w, 200, lcMore);
    }).catch(function (e) { setC(empt('ph-warning', 'Failed', e.message)); });
  }

  /* ───────────────────────── REFERENCE ORDERS ───────────────────────── */
  // Pairs a dispatched plant order with the branch order it references.
  var _RO_DEAD_PLANT = ['cancelled', 'closed (short)', 'rejected'];
  var _RO_DEAD_BRANCH = _RO_DEAD_PLANT.concat(['not found']);

  function refPairs(orders) {
    var byNo = {};
    orders.forEach(function (o) { byNo[String(o.orderNo).trim().toLowerCase()] = o; });
    var list = [];
    orders.forEach(function (plant) {
      var ref = String(plant.orderRef || '').trim();
      if (!ref || ref === 'N/A' || ref === '-') return;
      var branch = byNo[ref.toLowerCase()] || null;
      var ps = String(plant.status || '').trim().toLowerCase();
      var bs = branch ? String(branch.status || '').trim().toLowerCase() : '';
      if (_RO_DEAD_PLANT.indexOf(ps) > -1 || _RO_DEAD_BRANCH.indexOf(bs) > -1) return;
      // only pairs where the plant side has actually moved
      var dispatched = ps.indexOf('dispatch') > -1 || ps.indexOf('transit') > -1 || ps.indexOf('delivered') > -1 || _num(plant.dispatchedQty) > 0;
      if (!dispatched) return;
      list.push({
        branchOrderNo: branch ? branch.orderNo : ref,
        branchCustomer: branch ? branch.customerName : '—',
        branchStatus: branch ? branch.status : 'Not Found',
        branchQty: branch ? _num(branch.quantityOrdered) : 0,
        plantOrderNo: plant.orderNo,
        plantCustomer: plant.customerName || '—',
        plantStatus: plant.status,
        plantQty: _num(plant.quantityOrdered)
      });
    });
    return list;
  }
  function refBadge(status) {
    if (!status || status === 'Not Found') return '<span class="fms-bk" style="background:rgba(156,163,175,0.12);color:#9ca3af">Not Found</span>';
    return sBadge(status);
  }
  function viewReferenceOrders() {
    setC('<div style="padding:40px;text-align:center" class="muted"><i class="ph ph-spinner spin text-lg"></i><br>Linking reference orders…</div>');
    var my = ++FMS._req;
    api('getFmsOrders', { queue: 'all' }).then(function (r) {
      if (my !== FMS._req || FMS.state.view !== 'reference-orders') return;
      var orders = r.orders || [];
      FMS.state.currentTableData = orders;
      var data = refPairs(orders);
      if (!data.length) { setC(empt('ph-link', 'No Linked Pairs', 'No active reference order pairs found.')); return; }
      var rows = data.map(function (it) {
        return '<tr class="ref-row" data-s="' + esc(q(it.branchOrderNo + it.branchCustomer + it.branchStatus + it.plantOrderNo + it.plantCustomer + it.plantStatus)) + '">' +
          '<td style="padding:9px 14px;white-space:nowrap"><span class="lnk" onclick="FMS.viewOrder(\'' + esc(it.branchOrderNo) + '\')"><strong>' + esc(it.branchOrderNo) + '</strong></span></td>' +
          '<td style="padding:9px 12px;max-width:210px"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(it.branchCustomer) + '">' + esc(it.branchCustomer) + '</div></td>' +
          '<td style="padding:9px 10px">' + refBadge(it.branchStatus) + '</td>' +
          '<td class="tr fwb" style="padding:9px 10px">' + it.branchQty.toLocaleString('en-IN') + '</td>' +
          '<td class="tc muted" style="padding:9px 6px"><i class="ph ph-arrow-right"></i></td>' +
          '<td style="padding:9px 14px;white-space:nowrap"><span class="lnk" onclick="FMS.viewOrder(\'' + esc(it.plantOrderNo) + '\')"><strong>' + esc(it.plantOrderNo) + '</strong></span></td>' +
          '<td style="padding:9px 12px;max-width:210px"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(it.plantCustomer) + '">' + esc(it.plantCustomer) + '</div></td>' +
          '<td style="padding:9px 10px">' + refBadge(it.plantStatus) + '</td>' +
          '<td class="tr fwb" style="padding:9px 10px">' + it.plantQty.toLocaleString('en-IN') + '</td></tr>';
      }).join('');
      setC('<div class="card" style="margin-bottom:0;display:flex;flex-direction:column">' +
        '<div class="tbl-top"><span class="tbl-ttl"><i class="ph ph-link accent"></i> Reference Orders Status <span class="muted fw5 text-sm" id="fms-rocount" style="margin-left:6px">(' + data.length + ' linked pairs)</span></span>' +
        '<div class="tbl-filters"><div class="sw"><i class="ph ph-magnifying-glass"></i><input class="tsearch" placeholder="Order no, customer, status…" oninput="FMS.roSearch(this.value)"></div></div></div>' +
        '<div class="tbl-wrap" style="max-height:calc(100vh - 300px)"><table id="fms-rotbl"><thead><tr>' +
        '<th>Branch Order</th><th>Branch Customer</th><th>Branch Status</th><th class="tr">Branch Qty</th>' +
        '<th class="tc"><i class="ph ph-arrow-right"></i></th>' +
        '<th>Plant Order</th><th>Plant Customer</th><th>Plant Status</th><th class="tr">Plant Qty</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div></div>');
    }).catch(function (e) { setC(empt('ph-warning', 'Failed', e.message)); });
  }
  FMS.roSearch = debounce(function (val) {
    var s = q(val), n = 0;
    document.querySelectorAll('#fms-rotbl tbody tr.ref-row').forEach(function (tr) {
      var hit = !s || (tr.dataset.s || '').indexOf(s) !== -1;
      tr.style.display = hit ? '' : 'none'; if (hit) n++;
    });
    var c = document.getElementById('fms-rocount'); if (c) c.textContent = '(' + n + ' linked pairs)';
  }, 200);

  /* ───────────────────────── MONTH-WISE PLANT REPORT ───────────────────────── */
  var MW_BANDS = [
    { key: 'Received',   color: '#2563eb', bg: 'rgba(59,130,246,0.10)', badgeBg: '#3b82f6', badgeColor: '#ffffff' },
    { key: 'Dispatched', color: '#059669', bg: 'rgba(16,185,129,0.10)', badgeBg: '#10b981', badgeColor: '#ffffff' },
    { key: 'Pending',    color: '#ea580c', bg: 'rgba(249,115,22,0.10)', badgeBg: '#f97316', badgeColor: '#ffffff' }
  ];
  var MW_CAT_STYLE = {
    'Customer Via Branch':        ['ph-git-branch', '#6366f1'],
    'Direct Customer to Factory': ['ph-factory',    '#a855f7'],
    'Stock Order':                ['ph-stack',      '#14b8a6']
  };
  function mwNum(n) { return Math.round(Number(n) || 0).toLocaleString('en-IN'); }
  function mwCell(val, color, lft, dim) {
    var zero = !val || val === '0';
    var style = zero ? 'color:var(--muted);opacity:.45;font-weight:400' : 'color:' + color + ';font-weight:' + (dim ? '600' : '700');
    return '<td class="tc" style="padding:8px 10px;font-size:12.5px;' + (lft ? 'border-left:1px solid var(--border);' : '') + style + '">' + (zero ? '—' : val) + '</td>';
  }
  function mwPct(part, total, color, lft) {
    if (!total) return mwCell('', color, lft, true);
    return mwCell(((part / total) * 100).toFixed(1) + '%', color, lft, true);
  }
  // One band (Received / Dispatched / Pending) = orders, qty, sqft, share.
  function mwBand(counts, sqTotal, color, dim) {
    return mwCell(mwNum(counts[0]), color, true, dim) +
      mwCell(mwNum(counts[1]), color, false, dim) +
      mwCell(mwNum(counts[2]), color, false, dim) +
      mwPct(counts[2], sqTotal, color, false);
  }
  function mwCatRow(name, c, m) {
    var st = MW_CAT_STYLE[name] || ['ph-dot', 'var(--muted)'];
    return '<tr style="background:var(--card)">' +
      '<td style="padding:7px 16px 7px 30px;border-bottom:1px solid var(--border)"><i class="ph ' + st[0] + '" style="color:' + st[1] + ';font-size:14px;margin-right:7px"></i><span style="font-size:12.5px;color:var(--sub)">' + esc(name) + '</span></td>' +
      mwBand([c.rCount, c.rQty, c.rSq], m.ReceivedSqFt, MW_BANDS[0].color, true) +
      mwBand([c.dCount, c.dQty, c.dSq], m.DispatchedSqFt, MW_BANDS[1].color, true) +
      mwBand([c.pCount, c.pQty, c.pSq], m.PendingSqFt, MW_BANDS[2].color, true) + '</tr>';
  }
  function mwMonthRow(m) {
    var zc = { rCount: 0, rQty: 0, rSq: 0, dCount: 0, dQty: 0, dSq: 0, pCount: 0, pQty: 0, pSq: 0 };
    var html = '<tr style="background:rgba(99,102,241,0.06)">' +
      '<td class="fwb accent" style="padding:11px 16px;border-bottom:1px solid var(--border);font-size:13.5px">' + esc(m.month) + '</td>' +
      mwBand([m.ReceivedCount, m.ReceivedQty, m.ReceivedSqFt], m.ReceivedSqFt, MW_BANDS[0].color) +
      mwBand([m.DispatchedCount, m.DispatchedQty, m.DispatchedSqFt], m.DispatchedSqFt, MW_BANDS[1].color) +
      mwBand([m.PendingCount, m.PendingQty, m.PendingSqFt], m.PendingSqFt, MW_BANDS[2].color) + '</tr>';
    Object.keys(MW_CAT_STYLE).forEach(function (k) { html += mwCatRow(k, (m.cats && m.cats[k]) || zc, m); });
    return html;
  }
  function viewMonthWise() {
    setC('<div style="padding:40px;text-align:center" class="muted"><i class="ph ph-spinner spin text-lg"></i><br>Aggregating month-wise plant data…</div>');
    var my = ++FMS._req;
    api('getFmsMonthWise').then(function (r) {
      if (my !== FMS._req || FMS.state.view !== 'month-wise') return;
      var months = r.months || [];
      FMS.state.currentTableData = months;
      if (!months.length) { setC(empt('ph-calendar', 'No Data', 'No plant orders found.')); return; }

      var t = { rc: 0, rq: 0, rs: 0, dc: 0, dq: 0, ds: 0, pc: 0, pq: 0, ps: 0 };
      months.forEach(function (m) {
        t.rc += m.ReceivedCount; t.rq += m.ReceivedQty; t.rs += m.ReceivedSqFt;
        t.dc += m.DispatchedCount; t.dq += m.DispatchedQty; t.ds += m.DispatchedSqFt;
        t.pc += m.PendingCount; t.pq += m.PendingQty; t.ps += m.PendingSqFt;
      });

      var bandHead = MW_BANDS.map(function (b) {
        return '<th class="tc" colspan="4" style="border-left:1px solid var(--border);padding:8px 0">' +
          '<span style="display:inline-block;background:' + b.badgeBg + ';color:' + b.badgeColor + ';padding:4px 16px;border-radius:100px;font-size:11px;font-weight:800;letter-spacing:.6px;box-shadow:0 2px 4px rgba(0,0,0,0.15)">' + b.key.toUpperCase() + '</span></th>';
      }).join('');
      var subHead = MW_BANDS.map(function (b, idx) {
        return '<th class="tc" style="' + (idx > 0 ? 'border-left:1px solid var(--border);' : '') + 'font-size:10px;padding:6px 4px;color:var(--text-muted);font-weight:800">ORDERS</th>' +
          '<th class="tc" style="font-size:10px;padding:6px 4px;color:var(--text-muted);font-weight:800">QTY</th>' +
          '<th class="tc" style="font-size:10px;padding:6px 4px;color:var(--text-muted);font-weight:800">SQ FT</th>' +
          '<th class="tc" style="font-size:10px;padding:6px 4px;color:var(--text-muted);font-weight:800">%</th>';
      }).join('');
      function totCell(v, lft) {
        return '<th class="tc" style="' + (lft ? 'border-left:1px solid var(--border);' : '') + 'font-size:12px;color:var(--text-main);font-weight:800;padding:8px 6px">' + v + '</th>';
      }
      var totRow =
        totCell(mwNum(t.rc), true) + totCell(mwNum(t.rq)) + totCell(mwNum(t.rs)) + totCell(t.rs > 0 ? '100%' : '—') +
        totCell(mwNum(t.dc), true) + totCell(mwNum(t.dq)) + totCell(mwNum(t.ds)) + totCell(t.ds > 0 ? '100%' : '—') +
        totCell(mwNum(t.pc), true) + totCell(mwNum(t.pq)) + totCell(mwNum(t.ps)) + totCell(t.ps > 0 ? '100%' : '—');

      setC('<div class="card" style="margin-bottom:0;display:flex;flex-direction:column">' +
        '<div class="tbl-top"><span class="tbl-ttl"><i class="ph ph-calendar accent"></i> Month-Wise Plant Report <span class="muted fw5 text-sm" style="margin-left:6px">(' + months.length + ' months)</span></span></div>' +
        '<div class="tbl-wrap" style="max-height:calc(100vh - 300px)"><table id="fms-mwtbl"><thead>' +
        '<tr><th style="text-align:left;min-width:190px;color:var(--text-main)">MONTH / CATEGORY</th>' + bandHead + '</tr>' +
        '<tr><th></th>' + subHead + '</tr>' +
        '<tr><th style="text-align:left;font-weight:800;color:var(--text-main);padding:8px 12px;font-size:12px">TOTALS</th>' + totRow + '</tr>' +
        '</thead><tbody>' + months.map(mwMonthRow).join('') + '</tbody></table></div>' +
        '<div style="padding:9px 16px;border-top:1px solid var(--border);font-size:11px;color:var(--muted)">Factory-bound orders only · % is each row\'s share of that month\'s band total</div></div>');
    }).catch(function (e) { setC(empt('ph-warning', 'Failed', e.message)); });
  }

  /* ───────────────────────── PLANT & DISPATCH (item-wise) ───────────────────────── */
  var _pl = { full: [], view: [], cursor: 0, chunk: 50, status: 'all', loc: '', search: '' };
  var PL_PILLS = [['all', 'All Items'], ['instock', 'In-Stock'], ['inprod', 'In Production'], ['coilna', 'Coil N/A'], ['nostatus', 'No Status'], ['ready', 'Ready for Dispatch']];

  function _plBadge(it) {
    var p = it.prodStatus;
    if (!p) return '<span class="muted" style="font-size:11px">No Status</span>';
    var cls = p === 'In-Stock' ? 'b-full' : (p === 'Under Production' || p === 'Planning for Production') ? 'b-acc' : p === 'Coil N/A' ? 'b-rej' : p === 'Ready For QC' ? 'b-hold' : 'bdg';
    return '<span class="badge ' + cls + '" style="font-size:11px">' + esc(p) + '</span>';
  }
  function _plAging(date) {
    var d = _parseDate(date, true); if (!d) return '<span class="muted">—</span>';
    var days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
    var c = days <= 3 ? 'var(--green)' : days <= 7 ? 'var(--orange)' : 'var(--red)';
    return '<span style="font-weight:700;color:' + c + '">' + days + 'd</span>';
  }
  function _plMatch(it) {
    var s = _pl.status;
    if (s === 'instock' && it.prodStatus !== 'In-Stock') return false;
    if (s === 'inprod' && !(it.prodStatus === 'Under Production' || it.prodStatus === 'Planning for Production')) return false;
    if (s === 'coilna' && it.prodStatus !== 'Coil N/A') return false;
    if (s === 'nostatus' && it.prodStatus) return false;
    if (s === 'ready' && !(it.qcStatus === 'Ready for Dispatch' || it.prodStatus === 'Ready For QC')) return false;
    if (_pl.loc && it.location !== _pl.loc) return false;
    if (_pl.search && q(it.orderNo + it.customer + it.code + it.batch + it.orderRef + it.refCustomer).indexOf(_pl.search) === -1) return false;
    return true;
  }
  function viewPlantItems() {
    setC('<div style="padding:40px;text-align:center" class="muted"><i class="ph ph-spinner spin text-lg"></i><br>Loading plant register…</div>');
    var my = ++FMS._req;
    api('getFmsPlantItems').then(function (r) {
      if (my !== FMS._req || FMS.state.view !== 'plant') return;
      _pl.full = r.items || []; _pl.status = 'all'; _pl.loc = ''; _pl.search = '';
      paintPlant(_pl.full);
    }).catch(function (e) { setC(empt('ph-warning', 'Failed to load', e.message)); });
  }
  function paintPlant(items) {
    var sheets = 0, sqft = 0, wt = 0, inStock = 0, inProd = 0, noStatus = 0, coilNA = 0;
    items.forEach(function (x) {
      sheets += x.qty; sqft += x.sqft; wt += x.weight;
      if (x.prodStatus === 'In-Stock') inStock++;
      else if (x.prodStatus === 'Under Production' || x.prodStatus === 'Planning for Production') inProd++;
      else if (x.prodStatus === 'Coil N/A') coilNA++;
      else if (!x.prodStatus) noStatus++;
    });
    var stats = '<div class="stats" style="margin-bottom:16px">' +
      sc('ph-ruler', Math.round(sqft).toLocaleString('en-IN'), 'ca', 'Total Sqft') +
      sc('ph-stack', sheets.toLocaleString('en-IN'), 'cp', 'Total Sheets') +
      sc('ph-check-circle', inStock, 'cg', 'In-Stock') +
      sc('ph-gear', inProd, 'co', 'In Production') +
      sc('ph-question', noStatus, 'cd', 'No Status') +
      sc('ph-x-circle', coilNA, 'cr', 'Coil N/A') +
      sc('ph-scales', (wt / 1000).toFixed(0) + ' T', 'ct', 'Weight') + '</div>';
    var pills = PL_PILLS.map(function (p) {
      return '<button class="btn btn-sm ' + (_pl.status === p[0] ? 'btn-primary' : 'btn-ghost') + '" onclick="FMS.plFilter(\'' + p[0] + '\',this)">' + p[1] + '</button>';
    }).join('');
    var locs = Array.from(new Set(items.map(function (x) { return x.location; }).filter(Boolean))).sort();
    var locOpts = '<option value="">All Locations</option>' + locs.map(function (l) { return '<option value="' + esc(l) + '">' + esc(l) + '</option>'; }).join('');
    setC(stats +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">' + pills + '</div>' +
      '<div class="card" style="margin-bottom:0;display:flex;flex-direction:column">' +
      '<div class="tbl-top"><span class="tbl-ttl"><i class="ph ph-factory accent"></i> Plant &amp; Dispatch <span class="muted fw5 text-sm" id="fms-plcount" style="margin-left:6px">(' + items.length + ')</span></span>' +
      '<div class="tbl-filters"><div class="sw"><i class="ph ph-magnifying-glass"></i><input id="fms-plsrch" class="tsearch" placeholder="Order, party, item code…" oninput="FMS.plSearch(this.value)"></div>' +
      '<select id="fms-plloc" class="filter-sel" onchange="FMS.plLoc(this.value)">' + locOpts + '</select></div></div>' +
      '<div class="tbl-wrap" id="fms-plw" style="max-height:calc(100vh - 330px)"><table id="fms-plt" class="fms-orders"><thead><tr>' +
      '<th>Order No</th><th>Date</th><th style="min-width:160px">Customer</th><th>Location</th><th style="min-width:180px">Description</th><th>Batch</th>' +
      '<th class="tr">Len</th><th class="tr">Wid</th><th class="tr">Qty</th><th class="tr">Disp</th><th class="tr">Remaining</th><th class="tr">SqM</th><th class="tr">Wt.Kg</th>' +
      '<th style="min-width:120px">Status</th><th>Order Ref</th><th style="min-width:150px">Ref Customer</th><th>Item Remarks</th><th class="tr">Aging</th>' +
      '</tr></thead><tbody id="fms-pltb"></tbody></table></div></div>');
    plApplyView();
    var w = document.getElementById('fms-plw');
    onNearBottom(w, 120, plMore);
  }
  function plRow(it) {
    var ref = it.orderRef ? '<span class="lnk accent" onclick="event.stopPropagation();FMS.viewOrder(\'' + esc(it.orderRef) + '\')">' + esc(it.orderRef) + '</span>' : '<span class="muted">—</span>';
    return '<tr class="clickable" onclick="FMS.viewOrder(\'' + esc(it.orderNo) + '\')">' +
      '<td style="white-space:nowrap"><strong class="accent">' + esc(it.orderNo) + '</strong></td>' +
      '<td class="muted" style="white-space:nowrap;font-size:12px">' + _fmtDate(it.date, false) + '</td>' +
      '<td style="min-width:160px;max-width:300px;white-space:normal;line-height:1.4;vertical-align:middle"><div class="fw5" title="' + esc(it.customer) + '">' + (esc(it.customer) || '—') + '</div></td>' +
      '<td style="white-space:nowrap">' + (it.location ? '<span class="badge bdg" style="font-size:11px">' + esc(it.location) + '</span>' : '<span class="muted">—</span>') + '</td>' +
      '<td style="min-width:180px;max-width:350px;white-space:normal;line-height:1.4;vertical-align:middle"><div class="fw5" title="' + esc(it.code) + '">' + esc(it.code) + '</div></td>' +
      '<td>' + (it.batch ? esc(it.batch) : '<span class="muted">—</span>') + '</td>' +
      '<td class="tr muted">' + (it.length || '—') + '</td>' +
      '<td class="tr muted">' + (it.width || '—') + '</td>' +
      '<td class="tr fwb">' + it.qty + '</td>' +
      '<td class="tr">' + (it.dispatched > 0 ? it.dispatched : '<span class="muted">—</span>') + '</td>' +
      '<td class="tr fwb" style="color:var(--orange)">' + it.remaining + '</td>' +
      '<td class="tr muted">' + it.sqm.toFixed(3) + '</td>' +
      '<td class="tr muted">' + it.weight.toFixed(1) + '</td>' +
      '<td>' + _plBadge(it) + '</td>' +
      '<td style="white-space:nowrap;font-size:12px">' + ref + '</td>' +
      '<td style="max-width:180px"><div class="fw5" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px" title="' + esc(it.refCustomer) + '">' + (esc(it.refCustomer) || '<span class="muted">—</span>') + '</div></td>' +
      '<td class="muted" style="max-width:150px;font-size:11px"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px" title="' + esc(it.itemRemarks) + '">' + (esc(it.itemRemarks) || '—') + '</div></td>' +
      '<td class="tr">' + _plAging(it.date) + '</td></tr>';
  }
  function plApplyView() {
    _pl.view = _pl.full.filter(_plMatch); _pl.cursor = 0;
    var tb = document.getElementById('fms-pltb'); if (!tb) return;
    tb.innerHTML = ''; plMore();
    var c = document.getElementById('fms-plcount'); if (c) c.textContent = '(' + _pl.view.length + ')';
  }
  function plMore() {
    var tb = document.getElementById('fms-pltb'); if (!tb) return;
    var chunk = _pl.view.slice(_pl.cursor, _pl.cursor + _pl.chunk);
    if (!chunk.length) return;
    tb.insertAdjacentHTML('beforeend', chunk.map(plRow).join(''));
    _pl.cursor += chunk.length;
  }
  FMS.plFilter = function (s, btn) {
    _pl.status = s;
    if (btn && btn.parentNode) { btn.parentNode.querySelectorAll('button').forEach(function (x) { x.classList.remove('btn-primary'); x.classList.add('btn-ghost'); }); btn.classList.remove('btn-ghost'); btn.classList.add('btn-primary'); }
    plApplyView();
  };
  FMS.plSearch = debounce(function (v) { _pl.search = q(v); plApplyView(); }, 220);
  FMS.plLoc = function (v) { _pl.loc = v; plApplyView(); };

  /* ───────────────────────── DELIVERY TRACKING ───────────────────────── */
  var _dlv = { full: [], view: [], cursor: 0, chunk: 60, pill: 'pending', branch: '', search: '' };
  var DLV_PILLS = [
    ['pending',   'Awaiting',     'ph-hourglass',       'var(--yellow)'],
    ['partial',   'Partial',      'ph-truck',           'var(--accentH)'],
    ['delivered', 'Delivered',    'ph-seal-check',      'var(--green)'],
    ['overdue',   'Over 15 Days', 'ph-warning-circle',  'var(--red)'],
    ['',          'All',          'ph-stack',           'var(--sub)']
  ];
  function dlvBadge(r) {
    var s = r.bucket === 'delivered' ? ['b-full', 'Delivered']
      : r.bucket === 'partial' ? ['b-part', 'Partial']
        : [r.overdue ? 'b-rej' : 'b-crr', 'Awaiting'];
    return '<span class="badge ' + s[0] + '">' + s[1] + '</span>';
  }
  function dlvMatch(r) {
    if (_dlv.pill === 'overdue') { if (!r.overdue) return false; }
    else if (_dlv.pill && r.bucket !== _dlv.pill) return false;
    if (_dlv.branch && r.branch !== _dlv.branch) return false;
    if (_dlv.search && q(r.orderNo + r.customer + r.code + r.batch + r.branch).indexOf(_dlv.search) === -1) return false;
    return true;
  }
  function dlvRow(r) {
    var age = r.ageDays == null ? '<span class="muted">—</span>'
      : '<span style="font-weight:700;color:' + (r.overdue ? 'var(--red)' : r.ageDays > 7 ? 'var(--orange)' : 'var(--green)') + '">' + r.ageDays + 'd</span>';
    var pend = Math.max(0, r.dispatchQty - r.deliveredQty);
    return '<tr class="clickable" onclick="FMS.viewOrder(\'' + esc(r.orderNo) + '\')">' +
      '<td style="padding:9px 14px;white-space:nowrap"><strong class="accent">' + esc(r.orderNo) + '</strong></td>' +
      '<td style="padding:9px 12px;max-width:220px"><div class="fw6" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(r.customer) + '">' + esc(r.customer) + '</div>' +
      '<div class="muted text-xs">' + esc(r.branch) + '</div></td>' +
      '<td style="padding:9px 12px;max-width:200px"><div class="fw5 text-sm" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(r.code) + '">' + esc(r.code) + '</div>' +
      '<div class="muted text-xs">' + esc(r.size) + (r.batch ? ' · ' + esc(r.batch) : '') + '</div></td>' +
      '<td class="tr fwb" style="padding:9px 10px">' + r.dispatchQty.toLocaleString('en-IN') + '</td>' +
      '<td class="muted" style="padding:9px 10px;white-space:nowrap;font-size:12px">' + _fmtDate(r.dispatchDate, false) + '</td>' +
      '<td class="tc" style="padding:9px 10px;white-space:nowrap">' + age + '</td>' +
      '<td style="padding:9px 10px">' + dlvBadge(r) + '</td>' +
      '<td class="tr" style="padding:9px 10px;font-weight:700;color:' + (r.deliveredQty > 0 ? 'var(--green)' : 'var(--muted)') + '">' + r.deliveredQty.toLocaleString('en-IN') + '</td>' +
      '<td class="tr" style="padding:9px 10px;font-weight:700;color:' + (pend > 0 ? 'var(--orange)' : 'var(--muted)') + '">' + pend.toLocaleString('en-IN') + '</td>' +
      '<td class="muted" style="padding:9px 10px;white-space:nowrap;font-size:12px">' + (r.deliveredDate ? _fmtDate(r.deliveredDate, false) : '—') + '</td>' +
      '<td class="muted" style="padding:9px 12px;max-width:180px;font-size:12px"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(r.remarks) + '">' + (esc(r.remarks) || '—') + '</div></td></tr>';
  }
  function dlvMore() {
    var tb = document.getElementById('fms-dlvtb'); if (!tb) return;
    var chunk = _dlv.view.slice(_dlv.cursor, _dlv.cursor + _dlv.chunk);
    if (!chunk.length) return;
    tb.insertAdjacentHTML('beforeend', chunk.map(dlvRow).join(''));
    _dlv.cursor += chunk.length;
  }
  function dlvApply() {
    _dlv.view = _dlv.full.filter(dlvMatch);
    _dlv.cursor = 0;
    var tb = document.getElementById('fms-dlvtb'); if (tb) tb.innerHTML = '';
    dlvMore();
    var c = document.getElementById('fms-dlvcount'); if (c) c.textContent = '(' + _dlv.view.length + ')';
  }
  FMS.dlvPill = function (v, btn) {
    _dlv.pill = v;
    if (btn && btn.parentNode) { btn.parentNode.querySelectorAll('button').forEach(function (x) { x.classList.remove('btn-primary'); x.classList.add('btn-ghost'); }); btn.classList.remove('btn-ghost'); btn.classList.add('btn-primary'); }
    dlvApply();
  };
  FMS.dlvSearch = debounce(function (v) { _dlv.search = q(v); dlvApply(); }, 220);
  FMS.dlvBranch = function (v) { _dlv.branch = v; dlvApply(); };

  function viewDelivery() {
    setC('<div style="padding:40px;text-align:center" class="muted"><i class="ph ph-spinner spin text-lg"></i><br>Loading delivery queue…</div>');
    var my = ++FMS._req;
    api('getFmsDelivery').then(function (res) {
      if (my !== FMS._req || FMS.state.view !== 'delivery-tracking') return;
      var rows = res.rows || [], s = res.stats || {};
      if (!rows.length) { setC(empt('ph-seal-check', 'Nothing Dispatched', 'No dispatched items to track yet.')); return; }
      _dlv.full = rows; _dlv.cursor = 0; _dlv.pill = 'pending'; _dlv.branch = ''; _dlv.search = '';

      var stats = '<div class="stats" style="margin-bottom:16px">' +
        sc('ph-hourglass', s.pending || 0, 'cy', 'Awaiting Delivery') +
        sc('ph-truck', s.partial || 0, 'ca', 'Partially Delivered') +
        sc('ph-seal-check', s.delivered || 0, 'cg', 'Delivered') +
        sc('ph-stack', (s.pendingQty || 0).toLocaleString('en-IN'), 'cd', 'Qty In Transit') +
        sc('ph-check-square', (s.deliveredQty || 0).toLocaleString('en-IN'), 'cg', 'Qty Delivered') +
        sc('ph-warning-circle', s.overdue || 0, 'cr', 'Over 15 Days') + '</div>';

      var pills = DLV_PILLS.map(function (p) {
        return '<button class="btn ' + (_dlv.pill === p[0] ? 'btn-primary' : 'btn-ghost') + '" onclick="FMS.dlvPill(\'' + p[0] + '\',this)"><i class="ph ' + p[2] + '"></i> ' + p[1] + '</button>';
      }).join('');

      var branches = {}; rows.forEach(function (r) { if (r.branch) branches[r.branch] = 1; });
      var brOpts = '<option value="">All Branches</option>' + Object.keys(branches).sort().map(function (b) {
        return '<option value="' + esc(b) + '">' + esc(b) + '</option>';
      }).join('');

      setC(stats +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">' + pills + '</div>' +
        '<div class="card" style="margin-bottom:0;display:flex;flex-direction:column">' +
        '<div class="tbl-top"><span class="tbl-ttl"><i class="ph ph-seal-check accent"></i> Dispatched Items <span class="muted fw5 text-sm" id="fms-dlvcount" style="margin-left:6px">(0)</span></span>' +
        '<div class="tbl-filters"><div class="sw"><i class="ph ph-magnifying-glass"></i><input class="tsearch" placeholder="Order, party, item…" oninput="FMS.dlvSearch(this.value)"></div>' +
        '<select class="filter-sel" onchange="FMS.dlvBranch(this.value)">' + brOpts + '</select></div></div>' +
        '<div class="tbl-wrap" id="fms-dlvwrap" style="max-height:calc(100vh - 380px)"><table><thead><tr>' +
        '<th>Order No</th><th>Customer / Branch</th><th>Item</th><th class="tr">Disp. Qty</th><th>Dispatched</th>' +
        '<th class="tc">Age</th><th>Delivery</th><th class="tr">Dlv. Qty</th><th class="tr">Pending</th><th>Delivered On</th><th>Remarks</th>' +
        '</tr></thead><tbody id="fms-dlvtb"></tbody></table></div>' +
        '<div style="padding:9px 16px;border-top:1px solid var(--border);font-size:11px;color:var(--muted)">Item-wise across dispatched lines · fully delivered lines drop off after 180 days</div></div>');
      dlvApply();
      var w = document.getElementById('fms-dlvwrap');
      onNearBottom(w, 200, dlvMore);
    }).catch(function (e) { setC(empt('ph-warning', 'Failed', e.message)); });
  }

  FMS.filterSimple = debounce(function (val, tableId) {
    var s = q(val); var tb = document.getElementById(tableId); if (!tb) return;
    tb.querySelectorAll('tbody tr').forEach(function (tr) { tr.style.display = (!s || q(tr.textContent).indexOf(s) !== -1) ? '' : 'none'; });
  }, 200);

  /* ───────────────────────── DO AGING ───────────────────────── */
  var DAR_BK = {
    none: { label: 'No DO Yet', bg: 'rgba(161,161,170,0.14)', color: 'var(--muted)' },
    a: { label: '≤ 3 Days', bg: 'rgba(34,197,94,0.14)', color: 'var(--green)' },
    b: { label: '4–5 Days', bg: 'rgba(234,179,8,0.15)', color: 'var(--yellow)' },
    c: { label: '6–7 Days', bg: 'rgba(249,115,22,0.15)', color: 'var(--orange)' },
    d: { label: '7+ Days', bg: 'rgba(239,68,68,0.15)', color: 'var(--red)' }
  };
  function darBucket(days) { if (days == null) return 'none'; if (days <= 3) return 'a'; if (days <= 5) return 'b'; if (days <= 7) return 'c'; return 'd'; }
  function darPill(b) { var s = DAR_BK[b] || DAR_BK.none; return '<span class="fms-bk" style="background:' + s.bg + ';color:' + s.color + '">' + s.label + '</span>'; }

  function viewDOAging() {
    setC('<div style="padding:40px;text-align:center" class="muted"><i class="ph ph-spinner spin text-lg"></i><br>Loading DO aging…</div>');
    var my = ++FMS._req;
    api('getFmsOrders', { queue: 'all' }).then(function (r) {
      if (my !== FMS._req || FMS.state.view !== 'do-aging') return;
      var VALID = { 'Cust. to Factory': 1, 'Branch Stock order- Factory': 1 };
      var now = Date.now();
      var rows = r.orders.filter(function (o) { return VALID[o.orderType] && ['Rejected', 'Cancelled'].indexOf(o.status) === -1; }).map(function (o) {
        var doDate = o.crrDate || '';
        var d = _parseDate(doDate, true);
        var days = d ? Math.floor((now - d.getTime()) / 86400000) : null;
        return { o: o, doDate: doDate, days: days, bucket: darBucket(days) };
      }).sort(function (a, b) { return (b.days == null ? -1 : b.days) - (a.days == null ? -1 : a.days); });

      var cnt = { none: 0, a: 0, b: 0, c: 0, d: 0 }, done = 0;
      rows.forEach(function (x) { cnt[x.bucket]++; if (x.o.status === 'Fully Dispatched') done++; });

      FMS.state.currentTableData = r.orders;
      var stats = '<div class="stats" style="margin-bottom:16px">' +
        sc('ph-package', rows.length, 'ca', 'Total Orders') + sc('ph-check-circle', cnt.a, 'cg', '≤ 3 Days') +
        sc('ph-clock', cnt.b, 'cy', '4–5 Days') + sc('ph-warning', cnt.c, 'co', '6–7 Days') +
        sc('ph-fire', cnt.d, 'cr', '7+ Days') + sc('ph-check-fat', done, 'cg', 'Dispatched') +
        sc('ph-hourglass-medium', rows.length - done, 'cp', 'Pending') + '</div>';

      var body = rows.map(function (x) {
        var o = x.o, bs = DAR_BK[x.bucket];
        var pending = Math.max(0, (o.quantityOrdered || 0) - (o.dispatchedQty || 0));
        var age = x.days == null ? '<span class="muted text-xs">No DO</span>' : '<span style="font-size:16px;font-weight:800;color:' + bs.color + '">' + x.days + '</span><span class="muted" style="font-size:10px">d</span>';
        return '<tr class="clickable" onclick="FMS.viewOrder(\'' + esc(o.orderNo) + '\')">' +
          '<td style="padding:8px 12px"><strong class="accent">' + esc(o.orderNo) + '</strong></td>' +
          '<td style="padding:8px 12px;max-width:220px"><div class="fw5" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(o.customerName) + '">' + esc(o.customerName) + '</div></td>' +
          '<td style="padding:8px 10px"><span class="badge bdg">' + esc(o.branchName || '—') + '</span></td>' +
          '<td class="tc" style="padding:8px 10px">' + _fmtDate(o.timestamp, false) + '</td>' +
          '<td class="tc" style="padding:8px 10px">' + _fmtDate(o.crrDate, false) + '</td>' +
          '<td class="tc" style="padding:8px 10px">' + _fmtDate(o.dispatchDate, false) + '</td>' +
          '<td class="tc" style="padding:8px 10px">' + age + '</td>' +
          '<td class="tc" style="padding:8px 10px">' + darPill(x.bucket) + '</td>' +
          '<td class="tr fwb" style="padding:8px 10px">' + (o.quantityOrdered || '—') + '</td>' +
          '<td class="tr part" style="padding:8px 10px">' + (o.dispatchedQty || '—') + '</td>' +
          '<td class="tr" style="padding:8px 10px;color:var(--orange);font-weight:700">' + (pending || '—') + '</td>' +
          '<td style="padding:8px 12px">' + sBadge(o.status) + '</td></tr>';
      }).join('');

      setC(stats + '<div class="card" style="margin-bottom:0;display:flex;flex-direction:column">' +
        '<div class="tbl-top"><span class="tbl-ttl"><i class="ph ph-clock-countdown accent"></i> DO Aging — Party Wise <span class="muted fw5 text-sm" style="margin-left:6px">(' + rows.length + ')</span></span>' +
        '<div class="sw"><i class="ph ph-magnifying-glass"></i><input class="tsearch" placeholder="Order, party, branch…" oninput="FMS.filterSimple(this.value,\'fms-dar\')"></div></div>' +
        '<div class="tbl-wrap" style="max-height:calc(100vh - 280px)"><table id="fms-dar"><thead><tr>' +
        '<th>Order No.</th><th>Party</th><th>Branch</th><th class="tc">Punched</th><th class="tc">DO Gen.</th><th class="tc">Dispatched</th><th class="tc">Age</th><th class="tc">Bucket</th><th class="tr">Ordered</th><th class="tr">Disp.</th><th class="tr">Pending</th><th>Status</th>' +
        '</tr></thead><tbody>' + body + '</tbody></table></div></div>');
    }).catch(function (e) { setC(empt('ph-warning', 'Failed', e.message)); });
  }

  /* ───────────────────────── GENERIC SHEET TABLES ───────────────────────── */
  var STATUS_HEADS = ['STATUS', 'PROD STATUS', 'QC STATUS', 'TXN TYPE', 'DISPATCH TYPE'];
  function isStatusCol(h) { return STATUS_HEADS.indexOf(String(h).trim().toUpperCase()) !== -1; }
  function isCurrencyCol(h) { return String(h).indexOf('₹') !== -1; }
  function isNumCol(h) { var H = String(h).toUpperCase(); if (H === 'MOBILE' || H.indexOf('CODE') !== -1 || H.indexOf(' ID') !== -1 || H.indexOf('NO') === H.length - 2) return false; return /QTY|QUANTITY|\(MM\)|\(SQM\)|RATE|BALANCE|WEIGHT|DAYS|LIMIT|OUTSTANDING|PASSED|REJECTED|PLANNED/.test(H); }
  function isUrlCol(h) { return String(h).toUpperCase().indexOf('URL') !== -1; }
  function genBadge(v) {
    var s = String(v || '').toLowerCase();
    if (/reject|cancel|coil n\/a|shortage|fail/.test(s)) return 'b-rej';
    if (/hold/.test(s)) return 'b-hold';
    if (/pending|planning|await/.test(s)) return 'b-crr';
    if (/transfer|partial/.test(s)) return 'b-part';
    if (/production|transit|progress/.test(s)) return 'b-acc';
    if (/factory/.test(s)) return 'b-fac';
    if (/stock/.test(s)) return 'b-stock';
    if (/approved|fulfilled|passed|in-?stock|ready|dispatched|complete|active|received|accepted|^full$|^yes$/.test(s)) return 'b-full';
    return 'bdg';
  }
  var _SHEET = { page: 1, search: '', tab: null };
  function viewSheet(viewKey) {
    var def = SHEET_VIEWS[viewKey];
    _SHEET = { page: 1, search: '', tab: def.tab, viewKey: viewKey };
    paintSheet(def, true);
  }
  function paintSheet(def, full) {
    if (full) setC('<div style="padding:40px;text-align:center" class="muted"><i class="ph ph-spinner spin text-lg"></i><br>Loading ' + esc(def.label) + '…</div>');
    var my = ++FMS._req;
    api('getFmsTable', { tab: def.tab, search: _SHEET.search, page: _SHEET.page, pageSize: 50 }).then(function (res) {
      if (my !== FMS._req || SHEET_VIEWS[FMS.state.view] !== def) return;
      renderSheet(def, res);
    }).catch(function (e) { setC(empt('ph-warning', 'Failed to load', e.message)); });
  }
  function renderSheet(def, res) {
    var headers = res.headers || [];
    var view = [];
    def.cols.forEach(function (name) { for (var i = 0; i < headers.length; i++) { if (String(headers[i]).trim().toUpperCase() === name.toUpperCase()) { view.push({ name: headers[i], idx: i }); break; } } });
    if (!view.length) for (var c = 0; c < Math.min(headers.length, 10); c++) view.push({ name: headers[c], idx: c });

    var th = '<th class="tr" style="width:48px">#</th>' + view.map(function (col) { return '<th class="' + (isNumCol(col.name) || isCurrencyCol(col.name) ? 'tr' : '') + '">' + esc(col.name) + '</th>'; }).join('');
    var base = (res.page - 1) * res.pageSize;
    var body = (res.rows || []).map(function (row, ri) {
      return '<tr><td class="tr muted">' + (base + ri + 1) + '</td>' + view.map(function (col, ci) { return '<td class="' + (isNumCol(col.name) || isCurrencyCol(col.name) ? 'tr' : '') + '">' + sheetCell(row[col.idx], col.name, ci) + '</td>'; }).join('') + '</tr>';
    }).join('');
    if (!body) body = '<tr><td colspan="' + (view.length + 1) + '"><div class="empty"><i class="ph ph-tray"></i><h3>No rows</h3><p>' + (_SHEET.search ? 'No matches.' : 'This tab has no data.') + '</p></div></td></tr>';

    var pg = '';
    if (res.pages > 1) {
      pg = '<div class="fms-pg"><span class="fms-pg-info">Showing ' + (base + 1) + '–' + Math.min(res.page * res.pageSize, res.total) + ' of ' + res.total.toLocaleString('en-IN') + '</span>' +
        '<span class="fms-pg-btns">' +
        '<button class="btn btn-sm btn-ghost" ' + (res.page <= 1 ? 'disabled' : '') + ' onclick="FMS.sheetPage(' + (res.page - 1) + ')"><i class="ph ph-caret-left"></i></button>' +
        '<span class="fms-pg-num">' + res.page + ' / ' + res.pages + '</span>' +
        '<button class="btn btn-sm btn-ghost" ' + (res.page >= res.pages ? 'disabled' : '') + ' onclick="FMS.sheetPage(' + (res.page + 1) + ')"><i class="ph ph-caret-right"></i></button></span></div>';
    }

    setC('<div class="card" style="margin-bottom:0;display:flex;flex-direction:column">' +
      '<div class="tbl-top"><span class="tbl-ttl"><i class="ph ' + def.icon + ' accent"></i> ' + esc(def.label) + ' <span class="muted fw5 text-sm" style="margin-left:6px">(' + (res.grandTotal || 0).toLocaleString('en-IN') + ')</span></span>' +
      '<div class="sw"><i class="ph ph-magnifying-glass"></i><input type="text" id="fms-shsrch" class="tsearch" value="' + esc(_SHEET.search) + '" placeholder="Search…" oninput="FMS.sheetSearch(this.value)"></div></div>' +
      '<div class="tbl-wrap" style="max-height:calc(100vh - 200px)"><table><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody></table></div>' + pg + '</div>');
    var si = document.getElementById('fms-shsrch'); if (si && _SHEET.search) { si.focus(); si.setSelectionRange(si.value.length, si.value.length); }
  }
  function sheetCell(val, header, ci) {
    var v = val == null ? '' : String(val);
    if (v.trim() === '') return '<span class="muted">—</span>';
    if (isStatusCol(header)) return '<span class="badge ' + genBadge(v) + '">' + esc(v) + '</span>';
    if (isUrlCol(header) || /^https?:\/\//i.test(v)) return '<a class="lnk lnk-t" href="' + esc(v) + '" target="_blank" rel="noopener"><i class="ph ph-link"></i> Open</a>';
    if (isCurrencyCol(header)) { var n = _num(v); return '₹' + inrShort(n); }
    if (isNumCol(header)) { var n2 = _num(v); return n2.toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
    if (v.length > 46) return '<span class="break-word" title="' + esc(v) + '">' + esc(v) + '</span>';
    return ci === 0 ? '<strong>' + esc(v) + '</strong>' : esc(v);
  }
  FMS.sheetPage = function (p) { _SHEET.page = p; paintSheet(SHEET_VIEWS[_SHEET.viewKey], false); };
  FMS.sheetSearch = debounce(function (val) { _SHEET.search = val; _SHEET.page = 1; paintSheet(SHEET_VIEWS[_SHEET.viewKey], false); }, 320);

  /* ───────────────────────── wire-in ───────────────────────── */
  function init() {
    injectPage();
    injectNav();
    ensureModal();
    if (!window.__fmsLoadWrapped && typeof window.loadPage === 'function') {
      var orig = window.loadPage;
      window.loadPage = function (id) {
        if (id === 'fmsoms') { try { FMS.load(); } catch (e) { console.error('[FMS]', e); } return; }
        return orig.apply(this, arguments);
      };
      window.__fmsLoadWrapped = true;
    }
  }

  window.FMS = FMS;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
