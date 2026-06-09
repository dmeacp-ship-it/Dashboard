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

  var _MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function _parseDate(str) {
    if (!str) return null;
    var s = String(str).trim();
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\s,T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/); // M/D/YYYY h:mm
    if (m) return new Date(+m[3], +m[1] - 1, +m[2], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[\sT](\d{1,2}):(\d{2}))?/); // ISO
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
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
  var SUBS = [
    { v: 'all-orders',    ic: 'ph-list-bullets',          lb: 'All Orders' },
    { v: 'plant',         ic: 'ph-factory',               lb: 'Plant & Dispatch' },
    { v: 'party-summary', ic: 'ph-list-magnifying-glass', lb: 'Party Summary Report' }
  ];
  var VIEW_TITLE = {};
  SUBS.forEach(function (s) { VIEW_TITLE[s.v] = s.lb; });

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

  function injectNav() {
    var nav = document.querySelector('#sidebar nav');
    if (!nav || document.getElementById('fms-nav-root')) return;
    var sub = SUBS.map(function (s) {
      return '<div class="nav-item" data-page="fmsoms" data-fms="' + s.v + '" onclick="FMS.open(\'' + s.v + '\')">' +
        '<span class="nav-icon"><i class="ph ' + s.ic + '"></i></span><span class="nav-label">' + esc(s.lb) + '</span></div>';
    }).join('');
    var html = '<div id="fms-nav-root" class="nav-group-wrapper">' +
      '<div class="nav-group-btn" id="fms-group-btn" onclick="window.togglePopover(this, \'fms-submenu\', event)">' +
      '<span class="nav-group-icon"><i class="ph ph-stack-simple"></i></span><span class="nav-group-label">FMS — OMS</span>' +
      '<span class="nav-chevron"><i class="ph ph-caret-right"></i></span></div>' +
      '<div class="nav-submenu" id="fms-submenu">' + sub + '</div></div>';
    var dash = nav.querySelector('.nav-item[data-page="overview"]');
    if (dash) dash.insertAdjacentHTML('afterend', html);
    else nav.insertAdjacentHTML('beforeend', html);
  }

  function syncNav() {
    document.querySelectorAll('#fms-submenu .nav-item').forEach(function (el) {
      el.classList.toggle('active', el.dataset.fms === FMS.state.view);
    });
    var b = document.getElementById('fms-group-btn');
    if (b) b.classList.toggle('fms-on', SUBS.some(function (s) { return s.v === FMS.state.view; }));
    var pt = document.getElementById('page-title');
    if (pt) pt.textContent = VIEW_TITLE[FMS.state.view] || 'FMS — OMS';
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
    if (v === 'plant') {
      if (!_isAdmin()) return setC(empt('ph-lock', 'Restricted', 'Plant & Dispatch is available to Admins only.'));
      return viewPlantItems();
    }
    if (v === 'party-summary') return viewPartySummary();
    // default + 'all-orders' → KPI cards (from dashboard) merged with the All Orders table
    return viewOrders('all', 'All Orders', 'ph-list-bullets', true);
  }

  // Hide the Plant & Dispatch menu item for non-admins (called after login).
  FMS.applyRole = function () {
    var el = document.querySelector('#fms-submenu .nav-item[data-fms="plant"]');
    if (el) el.style.display = _isAdmin() ? '' : 'none';
  };

  /* ───────────────────────── DASHBOARD ───────────────────────── */
  function viewDash() {
    if (fresh('dash')) { renderDash(FMS.state.cache.dash); }
    else setC('<div style="padding:40px;text-align:center" class="muted"><i class="ph ph-spinner spin text-lg"></i><br>Loading dashboard…</div>');
    var my = ++FMS._req;
    Promise.all([api('getFmsDashboard'), api('getFmsOrders', { queue: 'all' })]).then(function (res) {
      if (my !== FMS._req || FMS.state.view !== 'dash') return;
      put('dash', res[0]); put('orders_all', res[1].orders);
      renderDash(res[0]);
    }).catch(function (e) { if (FMS.state.view === 'dash') setC(empt('ph-warning', 'Error Loading Dashboard', e.message)); });
  }

  function renderDash(d) {
    var cards =
      sc('ph-package', d.total, 'ca', 'Total') +
      sc('ph-clipboard-text', d.pendingCRR, 'cy', 'CRR Queue') +
      sc('ph-currency-circle-dollar', d.pendingAcc, 'co', 'Pend. Acc') +
      sc('ph-factory', d.pendingPlant, 'ct', 'Pend. Plant') +
      sc('ph-pause-circle', d.onHold, 'ck', 'On Hold') +
      sc('ph-check-circle', d.autoApproved, 'cg', 'Auto Appr') +
      sc('ph-check-circle', d.accApproved, 'cg', 'Acc Appr') +
      sc('ph-stack', d.stock, 'ct', 'Stock') +
      sc('ph-truck', d.dispatched, 'cd', 'Dispatched') +
      sc('ph-target', d.otifPct + '%', 'cg', 'OTIF Score') +
      sc('ph-x-circle', d.rejected, 'cr', 'Rejected');

    var pills = [
      ['all-orders', 'btn-primary', 'package', 'All Orders'],
      ['crr', 'btn-ghost', 'clipboard-text', 'CRR Queue'],
      ['acc', 'btn-ghost', 'currency-circle-dollar', 'Accounts Queue'],
      ['plant', 'btn-plant', 'factory', 'Plant & Dispatch'],
      ['hold', 'btn-hold', 'pause-circle', 'On Hold']
    ].map(function (b) { return '<button class="btn ' + b[1] + '" onclick="FMS.open(\'' + b[0] + '\')"><i class="ph ph-' + b[2] + '"></i> ' + b[3] + '</button>'; }).join('');

    setC('<div class="stats" style="margin-bottom:18px">' + cards + '</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px">' + pills + '</div>' +
      '<div class="card" style="margin-bottom:0">' +
      '<div class="tbl-top"><span class="tbl-ttl"><i class="ph ph-clock-counter-clockwise accent"></i> Recent Orders Ageing</span>' +
      '<button class="btn btn-ghost btn-sm" onclick="FMS.open(\'all-orders\')">View All</button></div>' +
      '<div class="tbl-wrap" style="max-height:calc(100vh - 380px)"><div id="fms-ageing" style="padding:34px;text-align:center" class="muted"><i class="ph ph-spinner spin text-lg"></i><br>Loading…</div></div></div>');

    // count-up animation
    requestAnimationFrame(function () {
      host().querySelectorAll('.stat-n').forEach(function (el) {
        var raw = el.textContent, pct = /%$/.test(raw), target = parseInt(raw, 10) || 0;
        if (!target) return; var cur = 0, step = Math.max(1, Math.floor(target / 22));
        (function tick() { cur = Math.min(cur + step, target); el.textContent = cur + (pct ? '%' : ''); if (cur < target) requestAnimationFrame(tick); })();
      });
    });

    var orders = FMS.state.cache.orders_all;
    if (orders) renderAgeing(orders);
    else api('getFmsOrders', { queue: 'all' }).then(function (r) { put('orders_all', r.orders); if (FMS.state.view === 'dash') renderAgeing(r.orders); });
  }

  function renderAgeing(orders) {
    var wrap = document.getElementById('fms-ageing'); if (!wrap) return;
    if (!orders.length) { wrap.innerHTML = empt('ph-package', 'No orders', 'Nothing to show.'); return; }
    var now = Date.now();
    var rows = orders.slice(0, 30).map(function (o) {
      var sTime = _parseDate(o.timestamp);
      var isDone = o.status === 'Fully Dispatched' || o.status === 'Rejected';
      var eTime = isDone && o.dispatchDate ? _parseDate(o.dispatchDate) : new Date(now);
      var ageStr = '—', cls = 'bdg';
      if (sTime && eTime) {
        var days = Math.floor((eTime.getTime() - sTime.getTime()) / 86400000);
        ageStr = days <= 0 ? 'Today' : days + ' Day' + (days > 1 ? 's' : '');
        cls = isDone ? 'b-full' : (days > 3 ? 'b-rej' : 'b-crr');
      }
      return '<tr class="clickable" onclick="FMS.viewOrder(\'' + esc(o.orderNo) + '\')">' +
        '<td class="fwb accent" style="padding:11px 16px">' + esc(o.orderNo) + '</td>' +
        '<td style="padding:11px 16px"><div class="fw5" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(o.customerName) + '">' + esc(o.customerName) + '</div><div class="muted text-xs">' + esc(o.branchName || '—') + '</div></td>' +
        '<td style="padding:11px 16px">' + tBadge(o.orderType || o.orderTypeForm) + '</td>' +
        '<td class="muted text-sm" style="padding:11px 16px">' + _fmtDate(o.timestamp, true) + '</td>' +
        '<td style="padding:11px 16px">' + sBadge(o.status) + '</td>' +
        '<td class="tc" style="padding:11px 16px"><span class="badge ' + cls + '">' + ageStr + '</span></td></tr>';
    }).join('');
    FMS.state.currentTableData = orders;
    wrap.innerHTML = '<table><thead><tr><th>Order No</th><th>Customer &amp; Branch</th><th>Type</th><th>Submitted</th><th>Status</th><th class="tc">Ageing</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  /* ───────────────────────── ORDERS TABLE ───────────────────────── */
  function dashStatsHtml(d) {
    return '<div class="stats" id="fms-stats" style="margin-bottom:16px">' +
      sc('ph-package', d.total, 'ca', 'Total') +
      sc('ph-clipboard-text', d.pendingCRR, 'cy', 'CRR Queue') +
      sc('ph-currency-circle-dollar', d.pendingAcc, 'co', 'Pend. Acc') +
      sc('ph-factory', d.pendingPlant, 'ct', 'Pend. Plant') +
      sc('ph-pause-circle', d.onHold, 'ck', 'On Hold') +
      sc('ph-check-circle', d.autoApproved, 'cg', 'Auto Appr') +
      sc('ph-check-circle', d.accApproved, 'cg', 'Acc Appr') +
      sc('ph-stack', d.stock, 'ct', 'Stock') +
      sc('ph-truck', d.dispatched, 'cd', 'Dispatched') +
      sc('ph-target', d.otifPct + '%', 'cg', 'OTIF Score') +
      sc('ph-x-circle', d.rejected, 'cr', 'Rejected') + '</div>';
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
      '<th style="white-space:nowrap">Order No</th>' +
      '<th style="min-width:170px">Dealer / Party</th>' +
      '<th style="white-space:nowrap">Order Ref</th>' +
      '<th style="min-width:150px">Customer Ref</th>' +
      '<th class="tr">Qty</th>' +
      '<th class="tr" style="white-space:nowrap">Disp. Qty</th>' +
      '<th style="min-width:140px">Approval Status</th>' +
      '<th style="white-space:nowrap">Acc. Action</th>' +
      '<th style="white-space:nowrap">Branch</th>' +
      '<th style="white-space:nowrap">HOD</th>' +
      '</tr></thead><tbody id="fms-otb"></tbody></table></div></div>');
    applyOrdView(orders);
    var w = document.getElementById('fms-ow');
    if (w) w.onscroll = function () { if (w.scrollTop + w.clientHeight >= w.scrollHeight - 120) moreRows(); };
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

  function ordRow(o) {
    var st = String(o.status || '').trim().toLowerCase();
    var disp = Number(o.dispatchedQty) || 0;
    var ref = o.orderRef
      ? '<span class="lnk accent" onclick="event.stopPropagation();FMS.viewOrder(\'' + esc(o.orderRef) + '\')">' + esc(o.orderRef) + '</span>'
      : '<span class="muted">—</span>';
    return '<tr class="clickable" data-s="' + esc(q(o.orderNo + o.seName + o.dealerName + o.branchName + o.orderRef + (o.hod || ''))) + '" data-stat="' + esc(st) + '" onclick="FMS.viewOrder(\'' + esc(o.orderNo) + '\')">' +
      '<td class="muted" style="white-space:nowrap;font-size:12px">' + _fmtDate(o.timestamp, false) + '</td>' +
      '<td style="white-space:nowrap">' + (o.seName ? '<span class="badge bdg" style="font-size:11px">' + esc(o.seName) + '</span>' : '<span class="muted">—</span>') + '</td>' +
      '<td style="white-space:nowrap"><strong class="accent" style="font-size:13px">' + esc(o.orderNo) + '</strong>' + (o.parentOrder ? '<div class="text-xs muted"><i class="ph ph-arrow-bend-down-right"></i> ' + esc(o.parentOrder) + '</div>' : '') + '</td>' +
      '<td style="max-width:210px"><div class="fw5" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px" title="' + esc(o.dealerName) + '">' + (esc(o.dealerName) || '<span class="muted">—</span>') + '</div></td>' +
      '<td style="white-space:nowrap;font-size:12px">' + ref + '</td>' +
      '<td style="max-width:190px">' + (o.custRef ? '<div class="fw5" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px" title="' + esc(o.custRef) + '">' + esc(o.custRef) + '</div>' : '<span class="muted">—</span>') + '</td>' +
      '<td class="tr fwb" style="font-size:13px">' + (o.quantityOrdered || '—') + '</td>' +
      '<td class="tr fwb" style="color:' + (disp > 0 ? 'var(--part)' : 'var(--muted)') + '">' + (disp > 0 ? disp : '—') + '</td>' +
      '<td>' + sBadge(o.status) + '</td>' +
      '<td class="muted" style="white-space:nowrap;font-size:12px">' + _fmtDate(o.accDate, false) + '</td>' +
      '<td style="white-space:nowrap">' + (o.branchName ? '<span class="badge bdg" style="font-size:11px">' + esc(o.branchName) + '</span>' : '<span class="muted">—</span>') + '</td>' +
      '<td style="white-space:nowrap">' + (o.hod ? '<span class="badge bdg" style="font-size:11px">' + esc(o.hod) + '</span>' : '<span class="muted">—</span>') + '</td></tr>';
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
      var matchS = !s || q(o.orderNo + o.customerName + o.seName + o.dealerName + o.branchName).indexOf(s) !== -1;
      var matchT = !stat || String(o.status || '').toLowerCase() === stat;
      return matchS && matchT;
    });
    var c = document.getElementById('fms-ocount'); if (c) c.textContent = '(' + filtered.length + ')';
    applyOrdView(filtered);
  }, 220);

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
    var d = _parseDate(date); if (!d) return '<span class="muted">—</span>';
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
    if (w) w.onscroll = function () { if (w.scrollTop + w.clientHeight >= w.scrollHeight - 120) plMore(); };
  }
  function plRow(it) {
    var ref = it.orderRef ? '<span class="lnk accent" onclick="event.stopPropagation();FMS.viewOrder(\'' + esc(it.orderRef) + '\')">' + esc(it.orderRef) + '</span>' : '<span class="muted">—</span>';
    return '<tr class="clickable" onclick="FMS.viewOrder(\'' + esc(it.orderNo) + '\')">' +
      '<td style="white-space:nowrap"><strong class="accent">' + esc(it.orderNo) + '</strong></td>' +
      '<td class="muted" style="white-space:nowrap;font-size:12px">' + _fmtDate(it.date, false) + '</td>' +
      '<td style="max-width:200px"><div class="fw5" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px" title="' + esc(it.customer) + '">' + (esc(it.customer) || '—') + '</div></td>' +
      '<td style="white-space:nowrap">' + (it.location ? '<span class="badge bdg" style="font-size:11px">' + esc(it.location) + '</span>' : '<span class="muted">—</span>') + '</td>' +
      '<td style="max-width:200px"><div class="fw5" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px" title="' + esc(it.code) + '">' + esc(it.code) + '</div></td>' +
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

  /* ───────────────────────── PARTY SUMMARY ───────────────────────── */
  function psBadge(type) {
    var st = { 'Customer Via Branch': ['rgba(99,102,241,0.14)', 'var(--accentH)', 'ph-git-branch'], 'Direct Customer to Factory': ['rgba(168,85,247,0.14)', 'var(--purple)', 'ph-factory'], 'Stock Order': ['rgba(20,184,166,0.14)', 'var(--teal)', 'ph-stack'] }[type] || ['var(--surface)', 'var(--muted)', 'ph-dot'];
    return '<span class="fms-bk" style="background:' + st[0] + ';color:' + st[1] + '"><i class="ph ' + st[2] + '" style="font-size:12px;margin-right:4px"></i>' + esc(type) + '</span>';
  }
  function viewPartySummary() {
    setC('<div style="padding:40px;text-align:center" class="muted"><i class="ph ph-spinner spin text-lg"></i><br>Building party summary…</div>');
    var my = ++FMS._req;
    api('getFmsPartySummary').then(function (res) {
      if (my !== FMS._req || FMS.state.view !== 'party-summary') return;
      var orders = res.orders || [];
      FMS.state.currentTableData = orders;
      if (!orders.length) { setC(empt('ph-list-magnifying-glass', 'No Pending Orders', 'All orders have been fully dispatched.')); return; }
      var remQty = orders.reduce(function (s, o) { return s + o.remainingQty; }, 0);
      var remSqFt = orders.reduce(function (s, o) { return s + o.remainingSqFt; }, 0);
      var byCVB = orders.filter(function (o) { return o.summaryType === 'Customer Via Branch'; }).length;
      var byDCF = orders.filter(function (o) { return o.summaryType === 'Direct Customer to Factory'; }).length;
      var bySO = orders.filter(function (o) { return o.summaryType === 'Stock Order'; }).length;
      var stats = '<div class="stats" style="margin-bottom:16px">' +
        sc('ph-list-bullets', orders.length, 'ca', 'Total Orders') +
        sc('ph-stack', remQty.toLocaleString('en-IN'), 'ct', 'Remaining Qty') +
        sc('ph-ruler', Math.round(remSqFt).toLocaleString('en-IN'), 'cp', 'Remaining SqFt') +
        sc('ph-git-branch', byCVB, 'ca', 'Via Branch') +
        sc('ph-factory', byDCF, 'cp', 'Direct') +
        sc('ph-stack', bySO, 'ct', 'Stock Orders') + '</div>';
      var rows = orders.map(function (o) {
        var pct = o.totalQty > 0 ? Math.round((o.remainingQty / o.totalQty) * 100) : 0;
        var pc = pct > 80 ? 'var(--red)' : pct > 40 ? 'var(--orange)' : 'var(--green)';
        var disp = o.totalQty - o.remainingQty;
        return '<tr class="ps-row clickable" data-s="' + esc(q(o.orderNo + o.orderRef + o.customerName + o.refParty + o.summaryType)) + '" data-type="' + esc(o.summaryType) + '" onclick="FMS.viewOrder(\'' + esc(o.orderNo) + '\')">' +
          '<td style="padding:10px 14px"><strong class="accent">' + esc(o.orderNo) + '</strong></td>' +
          '<td style="padding:10px 12px">' + (o.orderRef ? '<span class="lnk text-sm">' + esc(o.orderRef) + '</span>' : '<span class="muted text-xs">—</span>') + '</td>' +
          '<td class="muted" style="padding:10px 12px;white-space:nowrap;font-size:12px">' + _fmtDate(o.orderDate, false) + '</td>' +
          '<td style="padding:10px 12px;font-size:12px">' + (o.execName ? '<span class="fw6">' + esc(o.execName) + '</span>' : '<span class="muted text-xs">—</span>') + '</td>' +
          '<td style="padding:10px 14px;max-width:240px"><div class="fw6" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(o.customerName) + '">' + esc(o.customerName) + '</div></td>' +
          '<td style="padding:10px 14px;max-width:220px">' + (o.refParty ? '<div class="fw5 text-sm" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(o.refParty) + '">' + esc(o.refParty) + '</div>' : '<span class="muted text-xs">—</span>') + '</td>' +
          '<td style="padding:10px 12px">' + (o.location ? '<span class="badge bdg">' + esc(o.location) + '</span>' : '<span class="muted text-xs">—</span>') + '</td>' +
          '<td class="tr fwb" style="padding:10px 12px">' + o.totalQty.toLocaleString('en-IN') + '</td>' +
          '<td style="padding:10px 14px"><div style="display:flex;align-items:center;gap:10px"><div style="flex:1;min-width:80px"><div style="width:100%;height:5px;background:var(--border2);border-radius:3px;overflow:hidden;margin-bottom:3px"><div style="width:' + pct + '%;height:100%;background:' + pc + '"></div></div><div style="font-size:10px;color:var(--muted)">' + disp + ' disp.</div></div><span style="font-weight:800;font-size:15px;color:' + pc + ';min-width:42px;text-align:right">' + o.remainingQty.toLocaleString('en-IN') + '</span></div></td>' +
          '<td style="padding:10px 14px">' + psBadge(o.summaryType) + '</td>' +
          '<td class="muted" style="padding:10px 12px;white-space:nowrap;font-size:11px">' + _fmtDate(o.deliveryDate, false) + '</td></tr>';
      }).join('');
      setC(stats + '<div class="card" style="margin-bottom:0;display:flex;flex-direction:column">' +
        '<div class="tbl-top"><span class="tbl-ttl"><i class="ph ph-list-magnifying-glass accent"></i> Party Wise Summary <span class="muted fw5 text-sm" style="margin-left:6px">(' + orders.length + ')</span></span>' +
        '<div class="tbl-filters"><div class="sw"><i class="ph ph-magnifying-glass"></i><input id="srch-ps" class="tsearch" placeholder="Order, party, ref…" oninput="FMS.psFilter()"></div>' +
        '<select id="type-ps" class="filter-sel" onchange="FMS.psFilter()"><option value="">All Types</option><option value="Customer Via Branch">Customer Via Branch</option><option value="Direct Customer to Factory">Direct Customer to Factory</option><option value="Stock Order">Stock Order</option></select></div></div>' +
        '<div class="tbl-wrap" style="max-height:calc(100vh - 320px)"><table id="psTable"><thead><tr>' +
        '<th>Order No.</th><th>Ref Order</th><th class="tc">Order Date</th><th>Executive</th><th>Party Name</th><th>Ref Party</th><th>Location</th><th class="tr">Total Qty</th><th>Remaining</th><th>Order Type</th><th class="tc">Delivery</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div><div style="padding:10px 16px;border-top:1px solid var(--border);font-size:11px;color:var(--muted)">' + orders.length + ' orders · dispatched line items excluded</div></div>');
    }).catch(function (e) { setC(empt('ph-warning', 'Failed', e.message)); });
  }
  FMS.psFilter = function () {
    var s = q((document.getElementById('srch-ps') || {}).value || '');
    var type = (document.getElementById('type-ps') || {}).value || '';
    document.querySelectorAll('#psTable tbody tr.ps-row').forEach(function (tr) {
      var ms = !s || (tr.dataset.s || '').indexOf(s) !== -1, mt = !type || (tr.dataset.type || '') === type;
      tr.style.display = (ms && mt) ? '' : 'none';
    });
  };

  /* ───────────────────────── DISPATCH RECONCILE ───────────────────────── */
  function viewReconcile() {
    setC('<div style="padding:40px;text-align:center" class="muted"><i class="ph ph-spinner spin text-lg"></i><br>Auditing dispatch records…</div>');
    var my = ++FMS._req;
    api('getFmsReconcile').then(function (r) {
      if (my !== FMS._req || FMS.state.view !== 'dispatch-reconcile') return;
      FMS._rc = r; renderReconcile(r);
    }).catch(function (e) { setC(empt('ph-warning', 'Failed', e.message)); });
  }
  function renderReconcile(data) {
    var c1 = data.check1 || [], c2 = data.check2 || [], c3 = data.check3 || [];
    var total = c1.length + c2.length + c3.length;
    var stats = '<div class="stats" style="margin-bottom:18px">' +
      sc('ph-check-circle', c1.length === 0 ? '✓' : c1.length, c1.length === 0 ? 'cg' : 'cr', 'Unmarked DO Items') +
      sc('ph-scales', c2.length === 0 ? '✓' : c2.length, c2.length === 0 ? 'cg' : 'cy', 'Qty Mismatches') +
      sc('ph-warning-circle', c3.length === 0 ? '✓' : c3.length, c3.length === 0 ? 'cg' : 'co', 'Premature Dispatch') +
      sc('ph-list-checks', total, total === 0 ? 'cg' : 'cr', 'Total Issues') + '</div>';
    if (total === 0) {
      setC(stats + '<div class="card" style="padding:48px;text-align:center"><i class="ph ph-check-circle" style="font-size:52px;color:var(--green);display:block;margin-bottom:16px"></i><h3 style="font-weight:700;font-size:18px;margin-bottom:8px">All Clean</h3><p class="muted">No mismatches found between ORDER RESPONSES and DO PRODUCTS.</p></div>');
      return;
    }
    var tab = FMS._rcTab || 'check1'; FMS._rcTab = tab;
    function tb(id, label, count, color) {
      var on = tab === id;
      return '<button onclick="FMS.rcTab(\'' + id + '\')" style="padding:10px 20px;border:none;background:' + (on ? 'var(--card)' : 'transparent') + ';border-bottom:3px solid ' + (on ? color : 'transparent') + ';color:' + (on ? color : 'var(--muted)') + ';font-weight:' + (on ? '700' : '500') + ';font-size:13px;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:7px">' + esc(label) + (count > 0 ? '<span style="background:' + color + '22;color:' + color + ';padding:1px 7px;border-radius:100px;font-size:11px;font-weight:700">' + count + '</span>' : '') + '</button>';
    }
    var bar = '<div style="display:flex;margin-bottom:18px;border-bottom:2px solid var(--border)">' + tb('check1', 'Unmarked DO Items', c1.length, 'var(--red)') + tb('check2', 'Qty Mismatch', c2.length, 'var(--yellow)') + tb('check3', 'Premature Dispatch', c3.length, 'var(--orange)') + '</div>';
    var table = tab === 'check1' ? rc1(c1) : tab === 'check2' ? rc2(c2) : rc3(c3);
    setC(stats + bar + table);
  }
  FMS.rcTab = function (id) { FMS._rcTab = id; renderReconcile(FMS._rc || {}); };
  function rcEmpty(msg) { return '<div class="empty"><i class="ph ph-check-circle" style="color:var(--green)"></i><h3>No Issues</h3><p>' + esc(msg) + '</p></div>'; }
  function rc1(data) {
    if (!data.length) return rcEmpty('All Fully Dispatched orders have their DO items correctly marked.');
    var rows = data.map(function (o) { return '<tr class="clickable" onclick="FMS.viewOrder(\'' + esc(o.orderNo) + '\')"><td style="padding:9px 14px"><strong class="accent">' + esc(o.orderNo) + '</strong></td><td style="padding:9px 12px;font-size:12px">' + esc(o.customerName) + '</td><td style="padding:9px 10px"><span class="badge bdg">' + esc(o.branchName || '—') + '</span></td><td class="muted" style="padding:9px 10px;font-size:12px">' + _fmtDate(o.timestamp, false) + '</td><td class="tc" style="padding:9px 10px;font-weight:700;color:var(--red)">' + o.unmarkedItems + ' / ' + o.totalItems + '</td><td style="padding:9px 10px"><span class="badge b-rej"><i class="ph ph-warning-circle"></i> Needs Fix</span></td></tr>'; }).join('');
    return '<div class="card" style="margin-bottom:0"><div style="background:rgba(239,68,68,0.06);padding:10px 16px;font-size:12px;color:var(--sub);border-bottom:1px solid var(--border)"><i class="ph ph-info red"></i> Orders marked <strong>Fully Dispatched</strong> but with DO PRODUCTS rows not yet marked <strong>Dispatched</strong>.</div><div class="tbl-wrap" style="max-height:calc(100vh - 360px)"><table><thead><tr><th>Order No</th><th>Customer</th><th>Branch</th><th>Date</th><th class="tc">Unmarked / Total</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }
  function rc2(data) {
    if (!data.length) return rcEmpty('All order quantities match their DO item totals.');
    var rows = data.map(function (o) { var col = o.diff > 0 ? 'var(--orange)' : 'var(--red)'; return '<tr class="clickable" onclick="FMS.viewOrder(\'' + esc(o.orderNo) + '\')"><td style="padding:9px 14px"><strong class="accent">' + esc(o.orderNo) + '</strong></td><td style="padding:9px 12px;font-size:12px">' + esc(o.customerName) + '</td><td style="padding:9px 10px"><span class="badge bdg">' + esc(o.branchName || '—') + '</span></td><td style="padding:9px 10px">' + sBadge(o.status) + '</td><td class="tr fwb" style="padding:9px 10px">' + o.quantityOrdered + '</td><td class="tr" style="padding:9px 10px;color:var(--green);font-weight:700">' + (o.dispatchedQty || 0) + '</td><td class="tr fwb" style="padding:9px 10px">' + o.doTotal + '</td><td class="tr" style="padding:9px 10px;font-weight:800;color:' + col + '">' + (o.diff > 0 ? '+' : '') + o.diff + '</td></tr>'; }).join('');
    return '<div class="card" style="margin-bottom:0"><div style="background:rgba(234,179,8,0.06);padding:10px 16px;font-size:12px;color:var(--sub);border-bottom:1px solid var(--border)"><i class="ph ph-info" style="color:var(--yellow)"></i> Orders where <strong>Quantity Ordered</strong> ≠ sum of <strong>DO item quantities</strong>.</div><div class="tbl-wrap" style="max-height:calc(100vh - 360px)"><table><thead><tr><th>Order No</th><th>Customer</th><th>Branch</th><th>Status</th><th class="tr">Ordered</th><th class="tr">Dispatched</th><th class="tr">DO Total</th><th class="tr">Diff</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }
  function rc3(data) {
    if (!data.length) return rcEmpty('No DO items are marked Dispatched ahead of their order status.');
    var rows = data.map(function (o) { return '<tr class="clickable" onclick="FMS.viewOrder(\'' + esc(o.orderNo) + '\')"><td style="padding:9px 14px"><strong class="accent">' + esc(o.orderNo) + '</strong></td><td style="padding:9px 12px;font-size:12px">' + esc(o.customerName) + '</td><td style="padding:9px 10px"><span class="badge bdg">' + esc(o.branchName || '—') + '</span></td><td style="padding:9px 10px">' + sBadge(o.status) + '</td><td class="muted" style="padding:9px 10px;font-size:12px">' + _fmtDate(o.timestamp, false) + '</td><td class="tc" style="padding:9px 10px;font-weight:700;color:var(--orange)">' + o.markedCount + ' / ' + o.totalItems + '</td></tr>'; }).join('');
    return '<div class="card" style="margin-bottom:0"><div style="background:rgba(249,115,22,0.06);padding:10px 16px;font-size:12px;color:var(--sub);border-bottom:1px solid var(--border)"><i class="ph ph-info" style="color:var(--orange)"></i> DO items marked <strong>Dispatched</strong> while the order is not yet dispatched.</div><div class="tbl-wrap" style="max-height:calc(100vh - 360px)"><table><thead><tr><th>Order No</th><th>Customer</th><th>Branch</th><th>Status</th><th>Date</th><th class="tc">Marked / Total</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
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
        var d = _parseDate(doDate);
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
