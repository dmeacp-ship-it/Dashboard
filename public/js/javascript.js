// ===========================================================
// JAVASCRIPT — Front-end Logic (Part 1/3)
// Core Config, Utilities, AI Copilot, & Initialization
// ===========================================================

window.App = {
  currentPage: 'overview',
  filters:     { fy: 'All', quarter: 'All', month: 'All', state: 'All', zone: 'All', hod: 'All', _v: 1 },
  charts:      {},
  filterOptions: {},
  currentUser: null,
  data: {
    outstanding: [],
    overview: null 
  },
  lastTableData: {}, 
  currentTableAI: null
};

window.custSort        = 'sqm';
window.inactiveDays    = 90;
window.rfmSegFilter    = 'All';
window.prodSort        = 'sqm';
window.skuBrandFilter  = 'All';
window.skuTypeFilter   = 'All';
window.hodView         = 'quarter';

window.custSaleView    = 'quarter';
window.custSalePage    = 1;
window.skuTypeSaleView = 'quarter';
window.skuTypeSalePage = 1;

window.targetView = 'month';
window.targetPage = 1;
window.hodTargetView = 'month';
window.hodTargetPage = 1;

window.searchQueries   = { hodqoq: '', custqoq: '', skutypeqoq: '', outstanding: '', targets: '', hodtargets: '', customers: '', inactive: '', declining: '', losthv: '', rfm: '', brand: '', prodtype: '', topsku: '' };
window.outstandingPage = 1;

window.copilotHistory = [];
window.tableAIHistory = {};

window.MN = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
window._kpiTooltips = [];
window._appReady    = false;

window.theme = function() { return document.documentElement.getAttribute('data-theme') || 'dark'; };
window.tc = function() { return window.theme() === 'light' ? '#374151' : '#d1d5db'; };
window.gc = function() { return window.theme() === 'light' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'; };
window.ttBg = function() { return window.theme() === 'light' ? 'rgba(255,255,255,0.98)' : 'rgba(17,24,39,0.98)'; };
window.ttTitle = function() { return window.theme() === 'light' ? '#111827' : '#f9fafb'; };
window.ttBorder = function() { return window.theme() === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'; };
window.doughnutBorder = function() { return window.theme() === 'light' ? '#ffffff' : '#1f2937'; };

window.applyTheme = function(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('acp-theme', t);
  const icon = document.getElementById('theme-icon-modal');
  if (icon) icon.className = t === 'dark' ? 'ph ph-sun' : 'ph ph-moon';
  const hIcon = document.getElementById('header-theme-icon');
  if (hIcon) hIcon.className = t === 'dark' ? 'ph ph-sun-dim' : 'ph ph-moon';
  if (window._appReady && window.loadPage) window.loadPage(window.App.currentPage, 1, true); 
};

window.toggleTheme = function(event) { 
  const targetTheme = window.theme() === 'dark' ? 'light' : 'dark';
  
  if (!document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.applyTheme(targetTheme);
    return;
  }
  
  let x = window.innerWidth - 40;
  let y = 30;
  if (event && event.clientX !== undefined) {
    x = event.clientX;
    y = event.clientY;
  }
  
  document.documentElement.style.setProperty('--x', `${x}px`);
  document.documentElement.style.setProperty('--y', `${y}px`);
  
  document.startViewTransition(function() {
    window.applyTheme(targetTheme);
  });
};

window.initTheme = function() {
  const saved = localStorage.getItem('acp-theme') || 'dark';
  window.applyTheme(saved);
};

window.toggleFilters = function() {
  const panel = document.getElementById('filter-panel');
  if (panel) panel.classList.toggle('hidden');
};

window._searchT = null;
window.handleSearch = function(pageId) {
  clearTimeout(window._searchT);
  window._searchT = setTimeout(function() {
    const input = document.getElementById('search-' + pageId);
    if (input) {
      window.searchQueries[pageId] = input.value.trim();
      if (pageId === 'outstanding') window.outstandingPage = 1;
      if (pageId === 'custqoq')     window.custSalePage    = 1;
      if (pageId === 'skutypeqoq')  window.skuTypeSalePage = 1;
      if (pageId === 'targets')     window.targetPage      = 1;
      if (pageId === 'hodtargets')  window.hodTargetPage   = 1;
      
      if (pageId === 'outstanding' && window._renderOutstandingTable) window._renderOutstandingTable();
      else if (pageId === 'targets' && window.loadTargets) window.loadTargets(1);
      else if (pageId === 'hodtargets' && window.loadHodTargets) window.loadHodTargets(1);
      else if (pageId === 'custqoq' && window.loadCustSale) window.loadCustSale(1);
      else if (pageId === 'skutypeqoq' && window.loadSkuTypeSale) window.loadSkuTypeSale(1);
      else if (pageId === 'customers' && window.loadTopCustomers) window.loadTopCustomers(1);
      else if (pageId === 'rfm' && window.loadRFM) window.loadRFM(1);
      else if (pageId === 'declining' && window.loadDeclining) window.loadDeclining(1);
      else if (pageId === 'inactive' && window.loadInactive) window.loadInactive(1);
      else if (pageId === 'losthv' && window.loadLostHV) window.loadLostHV(1);
      else if ((pageId === 'hodqoq' || pageId === 'brand' || pageId === 'prodtype') && window.loadPage) window.loadPage(pageId); 
      else if (window.loadPage) window.loadPage(pageId, 1); 
    }
  }, 350);
};

window.api = function(action, extra) {
  extra = extra || {};
  var payload = Object.assign({
    action: action,
    filters: window.App.filters,
    token: localStorage.getItem('acp_token') || ''
  }, extra);
  return fetch('/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(function(resp) {
    return resp.text().then(function(txt) {
      var r;
      try { r = txt ? JSON.parse(txt) : {}; }
      catch(e) { throw new Error('Parse error: ' + e.message); }
      // session expired / not signed in → bounce to login (except for the
      // login/profile probes themselves)
      if (resp.status === 401 || (r.error && String(r.error).indexOf('AUTH_REQUIRED') === 0)) {
        if (action !== 'login' && action !== 'getProfile' && window._forceLogin) window._forceLogin();
        throw new Error(r.error || 'Session expired. Please sign in.');
      }
      if (r.ok) return r.data;
      throw new Error(r.error || ('Server error on action: ' + action));
    });
  });
};

/* ── Auth gate ─────────────────────────────────────────────── */
window._forceLogin = function() {
  localStorage.removeItem('acp_token');
  window.App.currentUser = null;
  window._appReady = false;
  var ls = document.getElementById('login-screen');
  if (ls) ls.style.display = 'flex';
  var app = document.getElementById('app');
  if (app) app.style.visibility = 'hidden';
};
window._afterLogin = function() {
  var ls = document.getElementById('login-screen');
  if (ls) ls.style.display = 'none';
  var app = document.getElementById('app');
  if (app) app.style.visibility = 'visible';
  if (window._applyRoleUI) window._applyRoleUI();
  if (window._bootDashboard) window._bootDashboard();
};
window.doLogin = function() {
  var u = (document.getElementById('login-username') || {}).value || '';
  var p = (document.getElementById('login-password') || {}).value || '';
  u = u.trim();
  var btn = document.getElementById('login-btn');
  var err = document.getElementById('login-err');
  if (err) err.style.display = 'none';
  if (!u || !p) { if (err) { err.textContent = 'Enter your username and password.'; err.style.display = 'block'; } return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
  window.api('login', { username: u, password: p })
    .then(function(data) {
      localStorage.setItem('acp_token', data.token);
      window.App.currentUser = data.profile;
      window._afterLogin();
    })
    .catch(function(e) {
      if (err) { err.textContent = e.message || 'Login failed.'; err.style.display = 'block'; }
    })
    .finally(function() { if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; } });
};
window.doLogout = function() {
  window.api('logout').catch(function(){});
  window._forceLogin();
  window.toast && window.toast('Signed out.', 'success', 2500);
};
window._applyRoleUI = function() {
  var role = (window.App.currentUser && window.App.currentUser.role) || '';
  var isAdmin = (role === 'super_admin' || role === 'admin');
  
  var settingsNav = document.querySelector('.nav-item[data-page="settings"]');
  if (settingsNav) settingsNav.style.display = ''; // Settings visible to all users
  
  var usersTab = document.querySelector('.settings-tab[data-tab="tab-users"]');
  if (usersTab) usersTab.style.display = (role === 'super_admin') ? '' : 'none';
  
  ['tab-sheets', 'tab-connections', 'tab-sync', 'tab-roles'].forEach(function(t) {
    var el = document.querySelector('.settings-tab[data-tab="' + t + '"]');
    if (el) el.style.display = isAdmin ? '' : 'none';
  });
  
  // If not admin, default settings tab to Account Profile
  var sheetsTab = document.querySelector('.settings-tab[data-tab="tab-sheets"]');
  if (!isAdmin && sheetsTab && sheetsTab.classList.contains('active')) {
    window.switchSettingsTab('tab-account');
  }
  
  var nameEl = document.getElementById('sidebar-user-name');
  if (nameEl && window.App.currentUser) nameEl.textContent = window.App.currentUser.full_name || window.App.currentUser.username || '';
  var roleEl = document.getElementById('sidebar-user-role');
  if (roleEl) roleEl.textContent = ({ super_admin: 'Super Admin', admin: 'Admin', hod: 'HOD', zonal_head: 'Zonal Head' }[role] || role);
  if (window.FMS && window.FMS.applyRole) window.FMS.applyRole();
};
window._initAuth = function() {
  var token = localStorage.getItem('acp_token');
  if (!token) { window._forceLogin(); return; }
  window.api('getProfile').then(function(p) {
    if (p && p.role) {
      window.App.currentUser = p;
      window._afterLogin();
    } else { window._forceLogin(); }
  }).catch(function() { window._forceLogin(); });
};

window.toast = function(msg, type, dur) {
  const icons = { success: 'ph-check-circle', error: 'ph-warning-circle', info: 'ph-info' };
  const w = document.getElementById('toast-wrap');
  if (!w) return;
  const t = document.createElement('div');
  t.className = 'toast ' + (type || 'info');
  const duration = dur || 4000;
  t.innerHTML = '<i class="ph ' + (icons[type || 'info']) + '"></i><span>' + msg + '</span><div class="toast-progress" style="animation-duration: ' + duration + 'ms"></div>';
  w.appendChild(t);
  setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, duration);
};

window.loading = function(show, block, isProgress) {
  const el      = document.getElementById('header-loader');
  const bar     = document.getElementById('header-loader-bar');
  const txt     = document.getElementById('poll-status-text');
  const blockEl = document.getElementById('loading-block');
  
  if (show) {
    if (el) el.classList.add('show');
    if (bar) {
      if (isProgress) { bar.classList.remove('indeterminate'); bar.style.width = '0%'; }
      else            { bar.classList.add('indeterminate'); bar.style.width = ''; }
    }
    if (block && blockEl) blockEl.classList.add('show');
    window._showChartSkeletons();
  } else {
    if (el)      el.classList.remove('show');
    if (blockEl) blockEl.classList.remove('show');
    if (txt)     { txt.classList.remove('show'); txt.textContent = ''; }
    setTimeout(function() { if (bar) bar.style.width = '0%'; }, 350);
    window._hideChartSkeletons();
  }
};

window._showChartSkeletons = function() {
  document.querySelectorAll('.chart-wrap-tall').forEach(el => el.classList.add('is-loading'));
};

window._hideChartSkeletons = function() {
  document.querySelectorAll('.chart-wrap-tall').forEach(el => el.classList.remove('is-loading'));
};

window.setBlockProgress = function(pct, label) {
  const p     = Math.min(100, Math.round(pct));
  const fill  = document.getElementById('block-progress-fill');
  const lbl   = document.getElementById('block-progress-label');
  const pctEl = document.getElementById('loader-pct-text');
  if (fill)  fill.style.width  = p + '%';
  if (lbl)   lbl.textContent   = label || '';
  if (pctEl) pctEl.textContent = p + '%';
};

window.setHeaderProgress = function(pct, msg) {
  const bar = document.getElementById('header-loader-bar');
  const txt = document.getElementById('poll-status-text');
  if (bar) { bar.classList.remove('indeterminate'); bar.style.width = Math.min(100, pct) + '%'; }
  if (txt) { txt.classList.add('show'); txt.textContent = msg || ''; }
};

window._tt = null;
window.initTooltip = function() { window._tt = document.getElementById('row-tooltip'); };

window.showRowTooltip = function(e, title, html) {
  if (!window._tt) return;
  document.getElementById('tt-title').innerHTML = title;
  document.getElementById('tt-body').innerHTML  = html;
  window._tt.classList.add('show');
  window.posTooltip(e);
};

window.hideRowTooltip = function() { if (window._tt) window._tt.classList.remove('show'); };

window.posTooltip = function(e) {
  if (!window._tt) return;
  let x = e.clientX + 14, y = e.clientY - 10;
  const w = window._tt.offsetWidth || 280, h = window._tt.offsetHeight || 80;
  if (x + w > window.innerWidth  - 10) x = window.innerWidth  - w - 10;
  if (y + h > window.innerHeight - 10) y = window.innerHeight - h - 10;
  if (x < 10) x = 10; if (y < 10) y = 10;
  window._tt.style.left = x + 'px'; window._tt.style.top = y + 'px';
};

document.addEventListener('mousemove', function(e) {
  if (window._tt && window._tt.classList.contains('show')) window.posTooltip(e);
});

window.getSortKey = function(r) {
  if (r['_SK'] && /^\d{4}-\d{2}/.test(r['_SK'])) return r['_SK'];
  const sk = String(r['SORT KEY'] || '').trim();
  if (/^\d{4}-\d{2}/.test(sk)) return sk.slice(0, 7);
  return '';
};

window.getAxisLabel = function(r) {
  if (r['_LABEL']) return r['_LABEL'];
  const sk = window.getSortKey(r);
  if (sk.length >= 7) {
    const mo = parseInt(sk.slice(5, 7), 10) - 1;
    if (mo >= 0 && mo < 12) return window.MN[mo] + ' ' + sk.slice(2, 4);
  }
  return sk || '';
};

window._normFyStr = function(v) {
  if (!v) return v;
  const s = String(v).trim();
  const m = s.match(/(\d{2})[-\s_]+(\d{2})/);
  return m ? 'FY ' + m[1] + '-' + m[2] : s;
};

window.getRowFY = function(r) {
  const sk = window.getSortKey(r);
  if (sk && sk.length >= 7) {
    const yr = parseInt(sk.slice(0, 4), 10);
    const mo = parseInt(sk.slice(5, 7), 10);
    if (!isNaN(yr) && !isNaN(mo)) {
      return mo >= 4
        ? 'FY ' + String(yr).slice(2)     + '-' + String(yr + 1).slice(2)
        : 'FY ' + String(yr - 1).slice(2) + '-' + String(yr).slice(2);
    }
  }
  if (r['_FY']) return window._normFyStr(r['_FY']);
  return window._normFyStr(String(r['FY YEAR'] || ''));
};

window.inrFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
window.fmt = {
  short: function(v) {
    const x = Math.round(Number(v) || 0);
    if (x >= 10000000) return (x / 10000000).toFixed(2) + 'Cr';
    if (x >= 100000)   return (x / 100000).toFixed(1)   + 'L';
    if (x >= 1000)     return (x / 1000).toFixed(1)     + 'K';
    return window.inrFormatter.format(x);
  },
  num: function(v) { return window.inrFormatter.format(Math.round(Number(v || 0))); },
  pct: function(v) {
    if (v === null || v === undefined || isNaN(v)) return '-';
    return (v > 0 ? '+' : '') + Number(v || 0).toFixed(1) + '%';
  },
  date: function(v) {
    if (!v || v === '-' || v === '') return '-';
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const p = s.slice(0, 10).split('-');
      return p[2] + ' ' + window.MN[parseInt(p[1], 10) - 1] + ' ' + p[0].slice(-2);
    }
    const d = new Date(s);
    if (!isNaN(d.getTime())) return String(d.getDate()).padStart(2, '0') + ' ' + window.MN[d.getMonth()] + ' ' + String(d.getFullYear()).slice(-2);
    return s.split('T')[0];
  },
  currency: function(v) { return '₹' + window.fmt.short(v); }
};

window.fmtK = function(v) {
  const x = Math.round(Number(v) || 0);
  if (x >= 10000000) return Math.round(x / 10000000) + 'Cr';
  if (x >= 100000)   return Math.round(x / 100000)  + 'L';
  if (x >= 1000)     return Math.round(x / 1000)    + 'K';
  return String(x);
};

window._loadingRow = function(cols) {
  return '<tr><td colspan="' + cols + '" style="text-align:center;padding:40px;color:var(--text-muted)"><i class="ph ph-hourglass" style="font-size:24px;margin-bottom:8px;display:block"></i>Loading data...</td></tr>';
};

window._emptyRow = function(cols, msg) {
  return '<tr><td colspan="' + cols + '" style="text-align:center;padding:40px;color:var(--text-muted)">' + (msg || 'No data found.') + '</td></tr>';
};

window._errorRow = function(cols, msg) {
  return '<tr><td colspan="' + cols + '" style="text-align:center;padding:40px;color:var(--danger)"><i class="ph ph-warning-circle"></i> ' + (msg || 'Load failed.') + '</td></tr>';
};

window._tableItems = function(res) {
  if (!res) return [];
  return res.items ? res.items : (Array.isArray(res) ? res : []);
};

window._renderPagination = function(res, callbackName, containerId) {
    const container = document.getElementById(containerId);
    if(!container) return;
    
    if(!res || !res.totalPages || res.totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '<div style="display:flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-top: 1px solid var(--border); background: var(--bg-surface)">';
    html += '<div style="font-size: 11.5px; font-weight:600; color: var(--text-muted)">Showing page ' + res.page + ' of ' + res.totalPages + ' <span style="opacity:0.6">(' + res.total + ' total)</span></div>';
    html += '<div class="btn-group">';
    
    const prevDisabled = res.page === 1 ? 'disabled style="opacity:0.5;pointer-events:none"' : '';
    const nextDisabled = res.page === res.totalPages ? 'disabled style="opacity:0.5;pointer-events:none"' : '';

    html += '<button class="btn btn-sm btn-ghost" ' + prevDisabled + ' onclick="window.' + callbackName + '(' + (res.page - 1) + ')"><i class="ph ph-caret-left"></i> Prev</button>';
    html += '<button class="btn btn-sm btn-ghost" ' + nextDisabled + ' onclick="window.' + callbackName + '(' + (res.page + 1) + ')">Next <i class="ph ph-caret-right"></i></button>';
    
    html += '</div></div>';
    container.innerHTML = html;
};

window._modalCb = null;
window.showConfirmModal = function(cb, title, desc) {
  window._modalCb = cb;
  const mt = document.getElementById('modal-title');
  const md = document.getElementById('modal-desc');
  const mc = document.getElementById('confirm-modal');
  if (mt && title) mt.textContent = title;
  if (md && desc)  md.innerHTML   = desc;
  if (mc) mc.classList.add('show');
};

window.closeModal = function() {
  const mc = document.getElementById('confirm-modal');
  if (mc) mc.classList.remove('show');
  window._modalCb = null;
};

window.confirmModalAction = function() { 
  if (window._modalCb) window._modalCb(); 
  window.closeModal(); 
};

window.openSettingsModal = function() {
  if (typeof window.navigate === 'function') {
    window.navigate('settings');
  }
};

window.closeSettingsModal = function() {
  // Deprecated: No longer a modal. Empty stub to prevent breaking old code.
};

window.loadConnectionsConfig = function() {
  window.api('getConnections').then(function(data) {
    const container = document.getElementById('connections-container');
    if (container) container.innerHTML = '';
    
    if (data && data.connections && Array.isArray(data.connections)) {
      data.connections.forEach(c => window.addConnectionRow(c.id, c.name, c.url, c.key, c.id === data.activeId));
    }
    
    if (container && container.children.length === 0) {
      window.addConnectionRow('default', 'Primary Database', '', '', true);
    }
  }).catch(function(err) {
    console.error('Failed to load connections:', err);
    window.toast('Failed to load connections: ' + err.message, 'error');
  });
};

window.addConnectionRow = function(id = '', name = '', url = '', key = '', isActive = false) {
  const container = document.getElementById('connections-container');
  if (!container) return;
  const rowId = id || 'conn_' + Date.now();
  const row = document.createElement('div');
  row.className = 'cfg-conn-row';
  row.dataset.id = rowId;
  row.style = 'border:1px solid var(--border);border-radius:var(--radius);padding:12px;background:var(--surface1);display:flex;flex-direction:column;gap:8px;position:relative;';
  
  let activeBadge = isActive ? '<span style="position:absolute;top:12px;right:12px;background:var(--primary);color:white;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:700;">ACTIVE</span>' : '';
  let setActiveBtn = !isActive ? `<button class="btn btn-ghost btn-sm" onclick="setConnectionActive('${rowId}')"><i class="ph ph-check-circle"></i> Set Active</button>` : '';

  row.innerHTML = `
    ${activeBadge}
    <div style="display:flex;gap:10px;align-items:center;">
      <div style="flex:1;"><label style="font-size:10px;color:var(--text3);">Connection Name</label><input type="text" class="form-input conn-name" placeholder="e.g. Primary Database" value="${name}" /></div>
    </div>
    <div style="display:flex;gap:10px;align-items:center;">
      <div style="flex:1;"><label style="font-size:10px;color:var(--text3);">Supabase URL</label><input type="text" class="form-input conn-url" placeholder="https://..." value="${url}" /></div>
    </div>
    <div style="display:flex;gap:10px;align-items:center;">
      <div style="flex:1;"><label style="font-size:10px;color:var(--text3);">Supabase Key</label><input type="password" class="form-input conn-key" placeholder="eyJ..." value="${key}" /></div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px;">
      ${setActiveBtn}
      <button class="btn btn-ghost btn-sm" style="color:var(--danger);" onclick="this.closest('.cfg-conn-row').remove()"><i class="ph ph-trash"></i> Remove</button>
    </div>
  `;
  container.appendChild(row);
};

window.setConnectionActive = function(rowId) {
  document.querySelectorAll('.cfg-conn-row').forEach(row => {
    const isThisRow = row.dataset.id === rowId;
    const oldBadge = row.querySelector('span');
    if (oldBadge && oldBadge.textContent === 'ACTIVE') oldBadge.remove();
    
    const btnsDiv = row.querySelector('div:last-child');
    if (isThisRow) {
      row.innerHTML += '<span style="position:absolute;top:12px;right:12px;background:var(--primary);color:white;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:700;" class="active-badge">ACTIVE</span>';
      const setBtn = btnsDiv.querySelector('button:not([style*="color:var(--danger)"])');
      if (setBtn) setBtn.remove();
      row.dataset.active = 'true';
    } else {
      row.dataset.active = 'false';
      if (!btnsDiv.querySelector('button:not([style*="color:var(--danger)"])')) {
        btnsDiv.insertAdjacentHTML('afterbegin', `<button class="btn btn-ghost btn-sm" onclick="setConnectionActive('${row.dataset.id}')"><i class="ph ph-check-circle"></i> Set Active</button>`);
      }
    }
  });
};

window.saveConnections = function(event) {
  const btn = event.currentTarget;
  const connections = [];
  let activeId = null;
  
  document.querySelectorAll('.cfg-conn-row').forEach(row => {
    const id = row.dataset.id;
    const name = row.querySelector('.conn-name').value.trim();
    const url = row.querySelector('.conn-url').value.trim();
    const key = row.querySelector('.conn-key').value.trim();
    
    if (name && url && key) {
      connections.push({ id, name, url, key });
      if (row.dataset.active === 'true' || row.querySelector('.active-badge') || row.innerHTML.includes('ACTIVE</span>')) {
        activeId = id;
      }
    }
  });
  
  if (connections.length > 0 && !activeId) activeId = connections[0].id;
  
  const oldHtml = btn.innerHTML;
  btn.innerHTML = '<i class="ph ph-spinner" style="animation:spinCW 1s linear infinite;"></i> Saving...';
  window.api('updateConnections', { connectionData: { activeId, connections } }).then(function() {
    window.toast('Connections saved! The dashboard will now use the active database.', 'success');
    btn.innerHTML = oldHtml;
    // Force a full reload to re-initialize the dashboard with the new DB
    setTimeout(() => window.location.reload(), 1500);
  }).catch(function(err) {
    window.toast('Failed to save connections: ' + err.message, 'error');
    btn.innerHTML = oldHtml;
  });
};

window.switchSettingsTab = function(tabId) {
  // Hide all panes
  document.querySelectorAll('.settings-pane').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.settings-tab').forEach(el => el.classList.remove('active'));
  
  // Show selected pane
  const pane = document.getElementById(tabId);
  if (pane) {
    if (tabId === 'tab-users') {
      pane.style.display = 'flex';
      pane.style.flexDirection = 'column';
      pane.style.height = '100%';
    } else {
      pane.style.display = 'block';
    }
  }
  
  // Activate tab
  const tab = document.querySelector(`.settings-tab[data-tab="${tabId}"]`);
  if (tab) tab.classList.add('active');
};

window.loadGoogleSheetsConfig = function() {
  window.api('getSettings').then(function(settings) {
    const container = document.getElementById('cfg-raw-sheets-container');
    if (container) container.innerHTML = '';
    
    if (settings) {
      if (document.getElementById('cfg-outstanding-id')) document.getElementById('cfg-outstanding-id').value = settings.OUTSTANDING_SHEET_ID || '';
      if (document.getElementById('cfg-outstanding-name')) document.getElementById('cfg-outstanding-name').value = settings.OUTSTANDING_SHEET_NAME || 'CUSTOMER MASTER';
      if (document.getElementById('cfg-target-id')) document.getElementById('cfg-target-id').value = settings.TARGET_SHEET_ID || '';
      if (document.getElementById('cfg-target-name')) document.getElementById('cfg-target-name').value = settings.TARGET_SHEET_NAME || 'TARGET_DATA';
      if (settings.SOURCE_SHEETS && Array.isArray(settings.SOURCE_SHEETS)) {
        if (container) {
          settings.SOURCE_SHEETS.forEach(s => window.addSourceSheetRow(s.fy, s.id, s.name || 'RAW DATA'));
        }
      }
      
      const customReportsContainer = document.getElementById('cfg-custom-reports-container');
      if (customReportsContainer) {
        customReportsContainer.innerHTML = '';
        if (settings.CUSTOM_REPORTS) {
          settings.CUSTOM_REPORTS.forEach(r => window.addCustomReportRow(r.name, r.id, r.sheet, r.rowDim, r.colDim, r.metrics, r.rules));
        } else {
          // one empty row by default
          window.addCustomReportRow('', '', '', '', '', '', '[]');
        }
      }
    }
    
    if (container && container.children.length === 0) {
      window.addSourceSheetRow('', '', '');
    }
  }).catch(function(err) {
    console.error('Failed to load settings:', err);
    const container = document.getElementById('cfg-raw-sheets-container');
    if (container && container.children.length === 0) {
      window.addSourceSheetRow('', '', '');
    }
  });
};

window.addSourceSheetRow = function(fy = '', id = '', name = '') {
  const container = document.getElementById('cfg-raw-sheets-container');
  if (!container) return;
  const row = document.createElement('div');
  row.style = 'display:flex;gap:10px;align-items:center;';
  row.className = 'cfg-raw-sheet-row';
  row.innerHTML = `
    <input type="text" class="form-input" style="flex:0.3" placeholder="FY 24-25" value="${fy}" />
    <input type="text" class="form-input" style="flex:1" placeholder="Sheet ID" value="${id}" />
    <input type="text" class="form-input" style="flex:0.6" placeholder="Sheet Name" value="${name}" />
    <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="this.parentElement.remove()"><i class="ph ph-trash"></i></button>
  `;
  container.appendChild(row);
};

window.addCustomReportRow = function(name = '', id = '', sheet = '', rowDim = '', colDim = '', metrics = '', rules = '[]') {
  const container = document.getElementById('cfg-custom-reports-container');
  if (!container) return;
  const row = document.createElement('div');
  row.style = 'display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px; background:var(--bg-elevated); padding:12px; border-radius:var(--radius); border:1px solid var(--border); margin-right:32px; position:relative;';
  row.className = 'cfg-custom-report-row';
  
  // Create placeholders if values exist but headers aren't fetched yet
  const sheetOpt = sheet ? `<option value="${sheet}" selected>${sheet}</option>` : `<option value="">-- Load Tabs first --</option>`;
  const colOpt = colDim ? `<option value="${colDim}" selected>${colDim}</option>` : `<option value="">-- Connect to select --</option>`;
  
  let rowHtml = `<div style="color:var(--text-muted);font-size:12px;margin:auto;">Connect to select</div>`;
  if (rowDim) {
    rowHtml = rowDim.split(',').map(m => `
      <label style="display:flex;align-items:center;gap:4px;background:var(--surface2);padding:4px 8px;border-radius:100px;font-size:11px;border:1px solid var(--border);cursor:pointer;">
        <input type="checkbox" checked value="${m.trim()}" onchange="updatePillInput(this, '.r-row')"> ${m.trim()}
      </label>
    `).join('');
  }

  let metricsHtml = `<div style="color:var(--text-muted);font-size:12px;margin:auto;">Connect to select metrics</div>`;
  if (metrics) {
    metricsHtml = metrics.split(',').map(m => `
      <label style="display:flex;align-items:center;gap:4px;background:var(--surface2);padding:4px 8px;border-radius:100px;font-size:11px;border:1px solid var(--border);cursor:pointer;">
        <input type="checkbox" checked value="${m.trim()}" onchange="updatePillInput(this, '.r-metrics')"> ${m.trim()}
      </label>
    `).join('');
  }
  
  // Parse existing rules
  let parsedRules = [];
  try { parsedRules = JSON.parse(rules); } catch(e) {}
  let rulesHtml = '';
  parsedRules.forEach(r => {
    rulesHtml += `
      <div class="format-rule" style="display:flex; gap:6px; background:var(--bg); padding:6px; border:1px solid var(--border); border-radius:var(--radius); align-items:center;">
        <span style="font-size:12px;">If</span>
        <select class="form-select rule-metric" onchange="updateRulesInput(this)" style="flex:1" data-val="${r.metric}"><option value="${r.metric}">${r.metric}</option></select>
        <select class="form-select rule-op" onchange="updateRulesInput(this)" style="width:60px;">
          <option value=">" ${r.operator==='>'?'selected':''}>&gt;</option>
          <option value="<" ${r.operator==='<'?'selected':''}>&lt;</option>
          <option value="=" ${r.operator==='='?'selected':''}>=</option>
        </select>
        <input type="text" class="form-input rule-val" placeholder="Value" value="${r.target}" onchange="updateRulesInput(this)" style="flex:1"/>
        <span style="font-size:12px;">then color</span>
        <select class="form-select rule-color" onchange="updateRulesInput(this)" style="width:100px;">
          <option value="var(--green)" ${r.color==='var(--green)'?'selected':''}>Green</option>
          <option value="var(--danger)" ${r.color==='var(--danger)'?'selected':''}>Red</option>
          <option value="var(--warning)" ${r.color==='var(--warning)'?'selected':''}>Yellow</option>
        </select>
        <button type="button" class="btn btn-sm btn-ghost" style="color:var(--danger);" onclick="this.parentElement.remove(); updateRulesInput(this)"><i class="ph ph-x"></i></button>
      </div>
    `;
  });

  row.innerHTML = `
    <div class="form-field"><label class="form-label">Report Name</label><input type="text" class="form-input r-name" placeholder="POP Dashboard" value="${name}" /></div>
    <div class="form-field">
      <label class="form-label">Sheet ID</label>
      <div style="display:flex;gap:6px;">
        <input type="text" class="form-input r-id" style="flex:1;" placeholder="1wpaZ..." value="${id}" />
        <button type="button" class="btn btn-sm btn-outline" onclick="fetchTabsForBuilder(this)"><i class="ph ph-list"></i> Tabs</button>
      </div>
    </div>
    <div class="form-field">
      <label class="form-label">Sheet Tab Name</label>
      <div style="display:flex;gap:6px;">
        <select class="form-select r-sheet" style="flex:1;" data-val="${sheet}">${sheetOpt}</select>
        <button type="button" class="btn btn-sm btn-primary" onclick="fetchColumnsForBuilder(this)"><i class="ph ph-plug"></i> Connect</button>
      </div>
    </div>
    
    <div class="builder-area" style="grid-column: 1 / -1; display:flex; gap:12px; background:var(--surface); padding:12px; border-radius:var(--radius); border:1px dashed var(--border);">
      <div style="flex:2;" class="form-field">
          <label class="form-label"><i class="ph ph-rows"></i> Row Dimensions</label>
          <div class="r-row-container" style="display:flex; gap:6px; flex-wrap:wrap; min-height:36px; padding:6px; background:var(--bg); border:1px solid var(--border); border-radius:var(--radius);" data-val="${rowDim}">
             ${rowHtml}
          </div>
          <input type="hidden" class="r-row" value="${rowDim}" />
      </div>
      <div style="flex:1;" class="form-field">
          <label class="form-label"><i class="ph ph-columns"></i> Column Dimension</label>
          <select class="form-select r-col" data-val="${colDim}">${colOpt}</select>
      </div>
      <div style="flex:2;" class="form-field">
          <label class="form-label"><i class="ph ph-calculator"></i> Metrics (Values)</label>
          <div class="r-metrics-container" style="display:flex; gap:6px; flex-wrap:wrap; min-height:36px; padding:6px; background:var(--bg); border:1px solid var(--border); border-radius:var(--radius);" data-val="${metrics}">
             ${metricsHtml}
          </div>
          <input type="hidden" class="r-metrics" value="${metrics}" />
      </div>
    </div>
    
    <div class="formatting-area" style="grid-column: 1 / -1; margin-top:4px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <label class="form-label"><i class="ph ph-palette"></i> Conditional Formatting</label>
        <button type="button" class="btn btn-sm btn-ghost" onclick="addFormatRule(this)"><i class="ph ph-plus"></i> Add Rule</button>
      </div>
      <div class="rules-container" style="display:flex; flex-direction:column; gap:8px;">
        ${rulesHtml}
      </div>
      <input type="hidden" class="r-rules" value='${rules.replace(/'/g, "&apos;")}' />
    </div>
    <button type="button" class="btn btn-ghost btn-sm" style="position:absolute; right:-38px; top:12px; color:var(--danger); padding:6px;" onclick="this.closest('.cfg-custom-report-row').remove()"><i class="ph ph-trash"></i></button>
  `;
  container.appendChild(row);
};

window.addFormatRule = function(btn) {
  const container = btn.closest('.formatting-area').querySelector('.rules-container');
  // Get available metrics from the hidden input
  const metricsVal = btn.closest('.cfg-custom-report-row').querySelector('.r-metrics').value;
  const metrics = metricsVal ? metricsVal.split(',').map(m => m.trim()) : [];
  
  let metricOpts = '<option value="">-- Metric --</option>';
  metrics.forEach(m => { metricOpts += `<option value="${m}">${m}</option>`; });
  
  const ruleDiv = document.createElement('div');
  ruleDiv.className = 'format-rule';
  ruleDiv.style = 'display:flex; gap:6px; background:var(--bg); padding:6px; border:1px solid var(--border); border-radius:var(--radius); align-items:center;';
  ruleDiv.innerHTML = `
    <span style="font-size:12px;">If</span>
    <select class="form-select rule-metric" onchange="updateRulesInput(this)" style="flex:1">${metricOpts}</select>
    <select class="form-select rule-op" onchange="updateRulesInput(this)" style="width:60px;">
      <option value=">">&gt;</option>
      <option value="<">&lt;</option>
      <option value="=">=</option>
    </select>
    <input type="text" class="form-input rule-val" placeholder="Value" onchange="updateRulesInput(this)" style="flex:1"/>
    <span style="font-size:12px;">then color</span>
    <select class="form-select rule-color" onchange="updateRulesInput(this)" style="width:100px;">
      <option value="var(--green)">Green</option>
      <option value="var(--danger)">Red</option>
      <option value="var(--warning)">Yellow</option>
    </select>
    <button type="button" class="btn btn-sm btn-ghost" style="color:var(--danger);" onclick="this.parentElement.remove(); window.updateRulesInput(this)"><i class="ph ph-x"></i></button>
  `;
  container.appendChild(ruleDiv);
  window.updateRulesInput(ruleDiv.querySelector('.rule-metric'));
};

window.updateRulesInput = function(el) {
  const container = el.closest('.formatting-area');
  const rulesList = Array.from(container.querySelectorAll('.format-rule'));
  const rules = rulesList.map(r => {
    return {
      metric: r.querySelector('.rule-metric').value,
      operator: r.querySelector('.rule-op').value,
      target: r.querySelector('.rule-val').value,
      color: r.querySelector('.rule-color').value
    };
  }).filter(r => r.metric && r.target !== '');
  container.querySelector('.r-rules').value = JSON.stringify(rules);
};

window.updatePillInput = function(checkbox, targetClass) {
  const container = checkbox.closest(targetClass + '-container');
  const hiddenInput = container.parentElement.querySelector(targetClass);
  const checked = Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
  hiddenInput.value = checked.join(', ');
};

window.fetchTabsForBuilder = async function(btn) {
  const row = btn.closest('.cfg-custom-report-row');
  const sheetId = row.querySelector('.r-id').value.trim();
  
  if (!sheetId) return window.toast('Please enter a Sheet ID first', 'error');
  
  const oldHtml = btn.innerHTML;
  btn.innerHTML = '<i class="ph ph-spinner spin"></i>';
  btn.disabled = true;
  
  try {
    const tabs = await window.api('getSheetTabs', { options: { sheetId } });
    if (!tabs || !tabs.length) throw new Error('No tabs found in sheet');
    
    const sheetSel = row.querySelector('.r-sheet');
    const curSheet = sheetSel.dataset.val || sheetSel.value;
    
    let optionsHtml = '<option value="">-- Select Tab --</option>';
    tabs.forEach(t => { optionsHtml += `<option value="${t}">${t}</option>`; });
    sheetSel.innerHTML = optionsHtml;
    
    if (tabs.includes(curSheet)) sheetSel.value = curSheet;
    
    window.toast('Tabs loaded successfully!', 'success');
  } catch (err) {
    window.toast(err.message, 'error');
  } finally {
    btn.innerHTML = oldHtml;
    btn.disabled = false;
  }
};

window.fetchColumnsForBuilder = async function(btn) {
  const row = btn.closest('.cfg-custom-report-row');
  const sheetId = row.querySelector('.r-id').value.trim();
  const sheetName = row.querySelector('.r-sheet').value.trim();
  
  if (!sheetId || !sheetName) {
    return window.toast('Please enter Sheet ID and Tab Name first', 'error');
  }
  
  const oldHtml = btn.innerHTML;
  btn.innerHTML = '<i class="ph ph-spinner spin"></i>';
  btn.disabled = true;
  
  try {
    const headers = await window.api('getSheetHeaders', { options: { sheetId, sheetName } });
    if (!headers || !headers.length) throw new Error('No headers found in sheet row 1');
    
    const rowCont = row.querySelector('.r-row-container');
    const rowHid = row.querySelector('.r-row');
    const colSel = row.querySelector('.r-col');
    const metCont = row.querySelector('.r-metrics-container');
    const metHid = row.querySelector('.r-metrics');
    
    const curRow = (rowCont.dataset.val || rowHid.value || '').split(',').map(s=>s.trim());
    const curCol = colSel.dataset.val || colSel.value;
    const curMet = (metCont.dataset.val || metHid.value || '').split(',').map(s=>s.trim());
    
    // Populate Selects for Column
    let optionsHtml = '<option value="">-- Select --</option>';
    headers.forEach(h => { optionsHtml += `<option value="${h}">${h}</option>`; });
    colSel.innerHTML = optionsHtml;
    if (headers.includes(curCol)) colSel.value = curCol;
    
    // Populate Checkboxes
    const buildPills = (checkedArr, updateClass) => {
      return headers.map(h => {
        const isChecked = checkedArr.includes(h);
        return `
          <label style="display:flex;align-items:center;gap:4px;background:var(--surface2);padding:4px 8px;border-radius:100px;font-size:11px;border:1px solid var(--border);cursor:pointer; transition:all 0.2s;" onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='var(--border)'">
            <input type="checkbox" value="${h}" ${isChecked ? 'checked' : ''} onchange="updatePillInput(this, '${updateClass}')"> ${h}
          </label>
        `;
      }).join('');
    };
    
    rowCont.innerHTML = buildPills(curRow, '.r-row');
    metCont.innerHTML = buildPills(curMet, '.r-metrics');
    
    window.updatePillInput(rowCont.querySelector('input') || {closest: ()=>rowCont}, '.r-row');
    window.updatePillInput(metCont.querySelector('input') || {closest: ()=>metCont}, '.r-metrics');
    
    window.toast('Columns loaded successfully!', 'success');
  } catch (err) {
    window.toast(err.message, 'error');
  } finally {
    btn.innerHTML = '<i class="ph ph-check-circle"></i> Connected';
    btn.disabled = false;
    setTimeout(() => { btn.innerHTML = oldHtml; }, 2000);
  }
};

window.saveGoogleSheetsConfig = function() {
  const btn = event.currentTarget;
  const outId = document.getElementById('cfg-outstanding-id').value.trim();
  const outName = document.getElementById('cfg-outstanding-name') ? document.getElementById('cfg-outstanding-name').value.trim() : 'CUSTOMER MASTER';
  const tgtId = document.getElementById('cfg-target-id').value.trim();
  const tgtName = document.getElementById('cfg-target-name') ? document.getElementById('cfg-target-name').value.trim() : 'TARGET_DATA';
  const sourceSheets = [];
  document.querySelectorAll('.cfg-raw-sheet-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const fy = inputs[0].value.trim();
    const id = inputs[1].value.trim();
    const name = inputs[2].value.trim();
    if (fy && id) {
      sourceSheets.push({ fy, id, name });
    }
  });
  
  const customReports = [];
  document.querySelectorAll('.cfg-custom-report-row').forEach(row => {
    const name = row.querySelector('.r-name').value.trim();
    const id = row.querySelector('.r-id').value.trim();
    const sheet = row.querySelector('.r-sheet').value.trim();
    const rowDim = row.querySelector('.r-row').value.trim();
    const colDim = row.querySelector('.r-col').value.trim();
    const metrics = row.querySelector('.r-metrics').value.trim();
    if (name && id && sheet && rowDim && colDim && metrics) {
      customReports.push({ name, id, sheet, rowDim, colDim, metrics });
    }
  });
  
  const configValue = {
    OUTSTANDING_SHEET_ID: outId,
    OUTSTANDING_SHEET_NAME: outName,
    TARGET_SHEET_ID: tgtId,
    TARGET_SHEET_NAME: tgtName,
    SOURCE_SHEETS: sourceSheets,
    CUSTOM_REPORTS: customReports
  };
  
  const oldHtml = btn.innerHTML;
  btn.innerHTML = '<i class="ph ph-spinner" style="animation:spinCW 1s linear infinite;"></i> Saving...';
  window.api('updateSettings', { configValue: configValue }).then(function() {
    window.toast('Configuration saved successfully!', 'success');
    btn.innerHTML = oldHtml;
  }).catch(function(err) {
    window.toast('Failed to save settings: ' + err.message, 'error');
    btn.innerHTML = oldHtml;
  });
};

/**
 * Registry of paginated tables whose Export must include EVERY row, not just
 * the visible page. Each entry maps the table's <tbody> id to:
 *   key    — the value exportAll is set to while expanding the table
 *   reload — re-renders/re-fetches the table at its current state. When
 *            window.App.exportAll === key, the render/loader emits ALL rows.
 * Tables not listed here render every row already, so the plain DOM scrape is
 * complete on its own.
 */
window._EXPORT_TABLES = {
  'tbl-outstanding-body': { key: 'outstanding', reload: function () { return window._renderOutstandingTable(); } },
  'tbl-custqoq-body':     { key: 'custqoq',     reload: function () { return window.loadCustSale(window.custSalePage || 1); } },
  'tbl-targets-body':     { key: 'targets',     reload: function () { return window.loadTargets(window.targetPage || 1); } },
  'tbl-targets-hod-body': { key: 'hodtargets',  reload: function () { return window.loadHodTargets(window.hodTargetPage || 1); } },
  'tbl-customers-body':   { key: 'customers',   reload: function () { return window.loadTopCustomers(1); } },
  'tbl-rfm-body':         { key: 'rfm',         reload: function () { return window.loadRFM(1); } },
  'tbl-declining-body':   { key: 'declining',   reload: function () { return window.loadDeclining(1); } },
  'tbl-inactive-body':    { key: 'inactive',    reload: function () { return window.loadInactive(1); } },
  'tbl-losthv-body':      { key: 'losthv',      reload: function () { return window.loadLostHV(1); } }
};

/**
 * Orchestrates a full-dataset export. For registered paginated tables it flips
 * window.App.exportAll, re-renders so every row is in the DOM, scrapes, then
 * restores the paged view. Unregistered tables scrape directly.
 */
window.exportTableToCSV = async function(theadId, tbodyId, filename) {
  const meta = window._EXPORT_TABLES[tbodyId];
  if (!meta || !meta.reload) { window._scrapeTableToCSV(theadId, tbodyId, filename); return; }

  const prev = window.App.exportAll;
  window.App.exportAll = meta.key;
  try {
    await meta.reload();                 // render/fetch ALL rows
    window._scrapeTableToCSV(theadId, tbodyId, filename);
  } catch (e) {
    window.toast('Export failed: ' + (e && e.message ? e.message : e), 'error');
  } finally {
    window.App.exportAll = prev;
    try { await meta.reload(); } catch (e) {}   // restore paged view
  }
};

// Server-paginated loaders use these so that, while exporting, they request a
// single huge first page covering the whole result set.
window._expPage = function(key, page) { return window.App.exportAll === key ? 1 : page; };
window._expSize = function(key) { return window.App.exportAll === key ? 100000 : 50; };

window._scrapeTableToCSV = function(theadId, tbodyId, filename) {
  const rows = [];
  if (theadId) {
    const thead = document.getElementById(theadId);
    if (thead) {
      const headers = [];
      thead.querySelectorAll('th').forEach(function(th) {
        const txt = th.innerText.replace(/●/g, '').replace(/\n/g, ' ').trim().replace(/"/g, '""');
        headers.push('"' + txt + '"');
      });
      if (headers.length) rows.push(headers.join(','));
    }
  }

  const tbody = document.getElementById(tbodyId);
  if (!tbody) { window.toast('No table data to export.', 'error'); return; }

  tbody.querySelectorAll('tr').forEach(function(tr) {
    const tds = tr.querySelectorAll('td');
    if (!tds.length || (tds.length === 1 && tds[0].hasAttribute('colspan'))) return;
    const cells = [];
    tds.forEach(function(td) {
      cells.push('"' + td.innerText.replace(/\n/g, ' ').trim().replace(/"/g, '""') + '"');
    });
    rows.push(cells.join(','));
  });

  if (rows.length <= (theadId ? 1 : 0)) { window.toast('No data rows to export.', 'info'); return; }

  const csv  = rows.join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = (filename || 'export') + '_' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  window.toast('Exported ' + (rows.length - (theadId ? 1 : 0)) + ' rows successfully.', 'success');
};

window.formatAIResponse = function(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--text-main); font-weight:700;">$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>')
    .replace(/- (.*?)<br>/g, '<li style="margin-left:14px; margin-bottom:4px;">$1</li>');
};

window.toggleCopilot = function() {
  const panel = document.getElementById('copilot-panel');
  if (!panel) return;
  if (panel.classList.contains('hidden')) {
    const lbl = document.getElementById('copilot-context-label');
    const pt = document.getElementById('page-title');
    if (lbl && pt) lbl.textContent = 'Context: ' + pt.textContent;
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }
};

window.handleCopilotEnter = function(e) { 
  if (e.key === 'Enter') window.submitCopilot(); 
};

window._getCopilotContext = function() {
  const activePage = document.querySelector('.page.active');
  if (!activePage) return "No active context";
  const kpis = [];
  const kpiCards = activePage.querySelectorAll('.kpi-card');
  kpiCards.forEach(card => {
     const label = card.querySelector('.kpi-label');
     const value = card.querySelector('.kpi-value');
     if (label && value) {
        kpis.push(`${label.innerText}: ${value.innerText}`);
     }
  });
  return {
    pageName: document.getElementById('page-title') ? document.getElementById('page-title').innerText : window.App.currentPage,
    kpis: kpis,
    filters: window.App.filters
  };
};

window.submitCopilot = async function() {
  const input = document.getElementById('copilot-input');
  const chat  = document.getElementById('copilot-chat');
  const q     = input.value.trim();
  if (!q) return;
  chat.innerHTML += `<div class="chat-msg user">${q}</div>`;
  input.value = '';
  const loaderId = 'loader-' + Date.now();
  chat.innerHTML += `<div id="${loaderId}" class="chat-msg ai"><i class="ph ph-spinner" style="animation:spinCW 1s linear infinite; margin-right:6px"></i> Thinking...</div>`;
  chat.scrollTop = chat.scrollHeight;
  try {
    const contextData       = window._getCopilotContext();
    contextData._history    = window.copilotHistory.slice(-10);
    const res = await window.api('askCopilot', { contextName: contextData.pageName, contextData: contextData, question: q });
    document.getElementById(loaderId).remove();
    chat.innerHTML += `<div class="chat-msg ai">${window.formatAIResponse(res)}</div>`;
    window.copilotHistory.push({ role: 'user', content: q });
    window.copilotHistory.push({ role: 'ai',   content: res });
    if (window.copilotHistory.length > 20) window.copilotHistory = window.copilotHistory.slice(-20);
  } catch(e) {
    document.getElementById(loaderId).remove();
    chat.innerHTML += `<div class="chat-msg ai" style="color:var(--danger)">Error: ${e.message}</div>`;
  }
  chat.scrollTop = chat.scrollHeight;
};

window.openTableAI = function(pageId, title) {
  window.App.currentTableAI = pageId;
  window.tableAIHistory[pageId] = [];
  const m        = document.getElementById('table-ai-modal');
  const ctxLabel = document.getElementById('table-ai-context');
  const chat     = document.getElementById('table-ai-chat');
  const input    = document.getElementById('table-ai-input');
  if (ctxLabel) ctxLabel.textContent = `Analyzing: ${title}`;
  if (chat)     chat.innerHTML = `<div class="chat-msg ai">Ask me anything specifically about the data currently loaded in the <strong>${title}</strong> table.</div>`;
  if (input)    input.value = '';
  if (m) m.classList.add('show');
};

window.closeTableAI = function() {
  const m = document.getElementById('table-ai-modal');
  if (m) m.classList.remove('show');
  window.App.currentTableAI = null;
};

window.handleTableAIEnter = function(e) { 
  if (e.key === 'Enter') window.submitTableAI(); 
};

window._scrapeTableData = function(pageId) {
  const data = window.App.lastTableData[pageId];
  if (!data || !data.length) return "The provided table data is empty.";
  return JSON.stringify(data.slice(0, 50), null, 2);
};

window.submitTableAI = async function() {
  const input = document.getElementById('table-ai-input');
  const chat  = document.getElementById('table-ai-chat');
  const q     = input.value.trim();
  if (!q || !window.App.currentTableAI) return;
  chat.innerHTML += `<div class="chat-msg user">${q}</div>`;
  input.value = '';
  const loaderId = 'loader-tbl-' + Date.now();
  chat.innerHTML += `<div id="${loaderId}" class="chat-msg ai"><i class="ph ph-spinner" style="animation:spinCW 1s linear infinite; margin-right:6px"></i> Scanning table data...</div>`;
  chat.scrollTop = chat.scrollHeight;
  try {
    const currentHistory = (window.tableAIHistory[window.App.currentTableAI] || []).slice(-10);
    const tableData      = window._scrapeTableData(window.App.currentTableAI);
    const wrappedData    = JSON.stringify({ table: tableData, _history: currentHistory });
    const res = await window.api('askTable', { tableData: wrappedData, question: q });
    document.getElementById(loaderId).remove();
    chat.innerHTML += `<div class="chat-msg ai">${window.formatAIResponse(res)}</div>`;
    if (!window.tableAIHistory[window.App.currentTableAI]) window.tableAIHistory[window.App.currentTableAI] = [];
    window.tableAIHistory[window.App.currentTableAI].push({ role: 'user', content: q });
    window.tableAIHistory[window.App.currentTableAI].push({ role: 'ai',   content: res });
    if (window.tableAIHistory[window.App.currentTableAI].length > 20) {
      window.tableAIHistory[window.App.currentTableAI] = window.tableAIHistory[window.App.currentTableAI].slice(-20);
    }
  } catch(e) {
    document.getElementById(loaderId).remove();
    chat.innerHTML += `<div class="chat-msg ai" style="color:var(--danger)">Error: ${e.message}</div>`;
  }
  chat.scrollTop = chat.scrollHeight;
};

window.applyRoleSimulation = function() {
  const sel  = document.getElementById('sim-role-select');
  if (!sel) return;
  const role = sel.value;
  const roleNames = { super_admin: 'Super Admin', hod: 'HOD', state_manager: 'State Manager', viewer: 'Viewer' };

  window.App.currentUser.role = role;

  if (role === 'hod') {
    const h = prompt("Enter HOD Name to simulate (e.g. 'JOHN DOE'):", "JOHN DOE");
    window.App.currentUser.hod_name       = h ? h.toUpperCase() : 'JOHN DOE';
    window.App.currentUser.allowed_states = null;
  } else if (role === 'state_manager' || role === 'viewer') {
    const s = prompt("Enter Allowed States, comma separated (e.g. 'GUJARAT, DELHI'):", "GUJARAT, DELHI");
    window.App.currentUser.allowed_states = s ? s.split(',').map(function(x){ return x.trim().toUpperCase(); }) : ['GUJARAT'];
    window.App.currentUser.hod_name       = null;
  } else {
    window.App.currentUser.hod_name       = null;
    window.App.currentUser.allowed_states = null;
  }

  const uRole = document.getElementById('sidebar-user-role');
  if (uRole) uRole.textContent = roleNames[role] || role;

  window.closeSettingsModal();
  window.toast('Simulating: ' + (roleNames[role] || role) + '. Refreshing data…', 'info');
  if (window.debouncedCacheUpdate) window.debouncedCacheUpdate();
};

window.navigate = function(pageId) {
  if (document.startViewTransition) {
    document.startViewTransition(function() { window._doNavigate(pageId); });
  } else {
    window._doNavigate(pageId);
  }
};

window._doNavigate = function(pageId) {
  document.querySelectorAll('.nav-submenu.open').forEach(m => m.classList.remove('open'));
  document.querySelectorAll('.nav-group-btn.open').forEach(b => b.classList.remove('open'));
  window.App.currentPage = pageId;
  document.querySelectorAll('.nav-item').forEach(function(el) {
    el.classList.toggle('active', el.dataset.page === pageId);
  });
  document.querySelectorAll('.page').forEach(function(el) {
    el.classList.toggle('active', el.id === 'page-' + pageId);
  });
  
  const activePage = document.getElementById('page-' + pageId);
  if (activePage) setTimeout(() => activePage.classList.add('visited'), 500);

  const lb = document.querySelector('[data-page="' + pageId + '"] .nav-label');
  const pt = document.getElementById('page-title');
  if (pt) pt.textContent = lb ? lb.textContent : '';
  
  // Lock scroll on table pages to freeze KPIs & Toolbars
  const contentEl = document.getElementById('content');
  const scrollablePages = ['overview', 'product', 'producttype'];
  if (scrollablePages.includes(pageId)) {
      contentEl.style.overflowY = 'auto';
  } else {
      contentEl.style.overflowY = 'hidden';
  }

  const filterPanel = document.getElementById('filter-panel');
  if(filterPanel && !filterPanel.classList.contains('hidden')) filterPanel.classList.add('hidden');
  
  const copilotPanel = document.getElementById('copilot-panel');
  if (copilotPanel && !copilotPanel.classList.contains('hidden')) {
      document.getElementById('copilot-context-label').textContent = 'Context: ' + (lb ? lb.textContent : 'Dashboard');
  }
  
  if (window.updateNavIndicator) window.updateNavIndicator();
  if (window.loadPage) window.loadPage(pageId, 1, true); 
};

window.loadPage = function(id, page = 1, useCache = false) {
  const loaders = {
    overview:     () => typeof window.loadOverview === 'function' ? window.loadOverview(useCache) : null,
    hodqoq:       () => typeof window.loadHODQoQ === 'function' ? window.loadHODQoQ() : null,
    custqoq:      () => typeof window.loadCustSale === 'function' ? window.loadCustSale(page) : null, 
    settings:     () => { 
      if (typeof window.loadUsers === 'function') window.loadUsers(); 
      if (typeof window.loadGoogleSheetsConfig === 'function') window.loadGoogleSheetsConfig(); 
      if (typeof window.loadConnectionsConfig === 'function') window.loadConnectionsConfig();
    },
    skutypeqoq:   () => typeof window.loadSkuTypeSale === 'function' ? window.loadSkuTypeSale(page) : null, 
    hodtargets:   () => typeof window.loadHodTargets === 'function' ? window.loadHodTargets(page) : null,
    targets:      () => typeof window.loadTargets === 'function' ? window.loadTargets(page) : null,
    outstanding:  () => typeof window.loadOutstanding === 'function' ? window.loadOutstanding() : null,
    pareto:       () => typeof window.loadTopCustomers === 'function' ? window.loadTopCustomers(page) : null,
    rfm:          () => typeof window.loadRFM === 'function' ? window.loadRFM(page) : null,
    risk:         () => {
        if(window._activeRiskTab === 'declining' && window.loadDeclining) window.loadDeclining(page);
        else if(window._activeRiskTab === 'inactive' && window.loadInactive) window.loadInactive(page);
        else if(window._activeRiskTab === 'losthv' && window.loadLostHV) window.loadLostHV(page);
    },
    product:      () => typeof window.loadTimeWiseSales === 'function' ? window.loadTimeWiseSales() : null,
    hodsku:       () => typeof window.loadHodSkuSales === 'function' ? window.loadHodSkuSales() : null,
    producttype:  () => typeof window.loadProductType === 'function' ? window.loadProductType() : null,
    topsku:       () => typeof window.loadTopSKUs === 'function' ? window.loadTopSKUs(page) : null
  };
  if (loaders[id] && typeof loaders[id] === 'function') loaders[id]();
};

window.toggleAnalytics = function(btn)  { btn.classList.toggle('open'); document.getElementById('analytics-submenu').classList.toggle('open'); };
window.togglePopover = function(btn, menuId, e) {
  e.stopPropagation();
  const menu = document.getElementById(menuId);
  const isOpen = menu.classList.contains('open');
  
  document.querySelectorAll('.nav-submenu.open').forEach(m => m.classList.remove('open'));
  document.querySelectorAll('.nav-group-btn.open').forEach(b => b.classList.remove('open'));

  if (!isOpen) {
    const rect = btn.getBoundingClientRect();
    menu.style.top = Math.max(0, rect.top - 10) + 'px';
    menu.style.left = rect.right + 4 + 'px';
    menu.classList.add('open');
    btn.classList.add('open');
  }
};

document.addEventListener('click', function(e) {
  if (!e.target.closest('.nav-group-wrapper') && !e.target.closest('.nav-submenu')) {
    document.querySelectorAll('.nav-submenu.open').forEach(m => m.classList.remove('open'));
    document.querySelectorAll('.nav-group-btn.open').forEach(b => b.classList.remove('open'));
  }
});

window.actionAppend = function(e) { if (e) e.stopPropagation(); window.closeSettingsModal(); window.triggerAggregation(); };
window.actionCache = function(e)  { if (e) e.stopPropagation(); window.closeSettingsModal(); if(window.debouncedCacheUpdate) window.debouncedCacheUpdate(); };
window.actionReset = function(e)  { if (e) e.stopPropagation(); window.closeSettingsModal(); window.triggerReset(); };
window.actionLogout = function(e) { if (e) e.stopPropagation(); window.closeSettingsModal(); window.toast('Logging out securely...', 'success'); };

window.actionSyncOutstanding = function(e) {
  if (e) e.stopPropagation();
  window.closeSettingsModal();
  window.showConfirmModal(
    function() {
      window.loading(true);
      window.toast('Syncing Outstanding data from Customer Master…', 'info', 8000);
      window.api('syncOutstanding', {})
        .then(function(res) {
          window.loading(false);
          window.toast((res && res.message) ? res.message : 'Outstanding sync complete!', 'success', 6000);
          if (window.App.currentPage === 'outstanding' && window.loadOutstanding) window.loadOutstanding();
        })
        .catch(function(err) {
          window.loading(false);
          window.toast('Sync failed: ' + err.message, 'error', 8000);
        });
    },
    'Sync Outstanding Data?',
    'Fetches latest data from Customer Master sheet and updates Supabase. Takes 10–30 seconds.'
  );
};

window.actionSyncTargets = function(e) {
  if (e) e.stopPropagation();
  window.closeSettingsModal();
  window.showConfirmModal(
    function() {
      window.loading(true);
      window.toast('Syncing Executive Targets data from Google Sheets…', 'info', 8000);
      window.api('syncTargets', {})
        .then(function(res) {
          window.loading(false);
          window.toast((res && res.message) ? res.message : 'Targets sync complete!', 'success', 6000);
          if ((window.App.currentPage === 'targets' || window.App.currentPage === 'hodtargets') && window.loadPage) window.loadPage(window.App.currentPage);
        })
        .catch(function(err) {
          window.loading(false);
          window.toast('Sync failed: ' + err.message, 'error', 8000);
        });
    },
    'Sync Target Data?',
    'Fetches latest target data from the Google Sheet and updates Supabase. This may take 10–30 seconds.'
  );
};

window.toggleSidebar = function() {
  const sb = document.getElementById('sidebar');
  if (window.innerWidth <= 900) {
    sb.classList.toggle('mobile-open');
    sb.classList.remove('pinned');
  } else {
    sb.classList.toggle('pinned');
  }
  if (window.updateNavIndicator) setTimeout(window.updateNavIndicator, 250);
};

// Click outside to close mobile sidebar
document.addEventListener('click', function(e) {
  const sb = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('toggle-sidebar');
  const closeBtn = document.getElementById('close-sidebar');
  if (sb && sb.classList.contains('mobile-open')) {
    if (!sb.contains(e.target) && (!toggleBtn || !toggleBtn.contains(e.target)) && (!closeBtn || !closeBtn.contains(e.target))) {
      sb.classList.remove('mobile-open');
    }
  }
});

window.runPollingLoop = function(mode, onDone, onError) {
  let token = null, iter = 0;
  const MAX = 400;
  let currentMode = mode;
  function poll() {
    if (iter++ > MAX) { onError(new Error('Polling cap reached.')); return; }
    window.api('processAggregation', { options: { mode: currentMode, token: token } })
      .then(function(res) {
        window.setBlockProgress(Number(res.progress) || 0, res.message || 'Processing…');
        window.setHeaderProgress(Number(res.progress) || 0, res.message || '');
        if (res.status === 'COMPLETE') { onDone(); }
        else if (res.nextToken)        { token = res.nextToken; currentMode = 'resume'; setTimeout(poll, 30); }
        else                           { onDone(); }
      }).catch(function(err) { onError(err); });
  }
  poll();
};

window.startAggregation = function(mode) {
  const isReset = mode === 'reset';
  window.showConfirmModal(
    function() {
      window.loading(true, true, true);
      window.setBlockProgress(0, 'Initializing…');
      window.toast((isReset ? 'Hard Reset' : 'Append New Data') + ' started…', 'info', 7000);
      window.runPollingLoop(mode,
        async function() {
          window.loading(false);
          window.toast('Sync complete! Refreshing dashboard…', 'success', 8000);
          // ── FIXED: call direct forced refresh, not debounced, ignore visibility state
          await window._forceCacheUpdate();
        },
        function(err) { window.loading(false); window.toast('Failed: ' + err.message, 'error', 10000); }
      );
    },
    isReset ? 'Hard Reset Sync?' : 'Append New Data?',
    isReset
      ? '<b>Wipes all Supabase rows</b> then re-uploads all sheets from scratch.'
      : 'Syncs any new Google Sheets rows to Supabase.'
  );
};

window.triggerAggregation = function() { window.startAggregation('resume'); };
window.triggerReset       = function() { window.startAggregation('reset');  };

window._cacheUpdateTimer = null;

window.triggerCacheUpdate = async function() {
  // Thin wrapper — delegates to _forceCacheUpdate (visibility check intentionally removed)
  await window._forceCacheUpdate();
};

window.debouncedCacheUpdate = function() {
  clearTimeout(window._cacheUpdateTimer);
  window._cacheUpdateTimer = setTimeout(window.triggerCacheUpdate, 500);
};

window._forceCacheUpdate = async function() {
  window.App.filters._v = Date.now();
  window.App.data.overview = null;
  window.loading(true);
  try {
    // 1. Bust server cache — get DB row count as sanity check
    const cacheResult = await window.api('clearServerCache');
    if (cacheResult && cacheResult.dbRows !== undefined) {
      window.toast('DB has ' + parseInt(cacheResult.dbRows).toLocaleString('en-IN') + ' rows. Fetching data…', 'info', 4000);
    }

    // 2. Refresh filter options (new data may have new months/states)
    const fOpts = await window.api('getFilterOptions');
    if (typeof window.populateFilters === 'function') window.populateFilters(fOpts || {});

    // 3. Reload current page with fresh data
    if (window.App.currentPage === 'overview' && typeof window.loadOverview === 'function') {
      await window.loadOverview(false);
    } else if (window.loadPage) {
      window.loadPage(window.App.currentPage);
    }

    window.toast('Dashboard refreshed!', 'success');
  } catch(e) {
    window.toast('Refresh error: ' + e.message, 'error', 8000);
  } finally {
    window.loading(false);
  }
};

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === 'visible') {
    document.body.classList.remove('tab-hidden');
  } else {
    document.body.classList.add('tab-hidden');
  }
});

window._ROLE_LABEL = { super_admin: 'Super Admin', admin: 'Admin', hod: 'HOD', zonal_head: 'Zonal Head' };

window.exportUsersCSV = function() {
  if (!window._lastLoadedUsers || !window._lastLoadedUsers.length) return window.toast('No users to export.', 'error');
  var csv = 'Username,Full Name,Role,Status,Assigned Scope\n';
  window._lastLoadedUsers.forEach(function(u) {
    var scope = (u.role === 'hod') ? ((u.allowed_hods || []).join('; ') || '—')
      : (u.role === 'zonal_head') ? ((u.allowed_zones || []).join('; ') || '—')
      : 'All data';
    csv += '"' + (u.username||'') + '","' + (u.full_name||'') + '","' + (u.role||'') + '","' + (u.is_active?'Active':'Inactive') + '","' + scope + '"\n';
  });
  var blob = new Blob([csv], { type: 'text/csv' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'user_directory_export.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

window.loadUsers = async function() {
  const tbody = document.getElementById('tbl-users-body');
  if (!tbody) return;
  // populate the HOD / Zone pickers from the current filter options
  window._populateScopePickers();
  tbody.innerHTML = window._loadingRow(4);
  try {
    const users = await window.api('listUsers');
    window._lastLoadedUsers = users;
    if (!users || !users.length) { tbody.innerHTML = window._emptyRow(4, 'No users found.'); return; }
    const rc = { super_admin: 'badge-amber', admin: 'badge-blue', hod: 'badge-green', zonal_head: 'badge-gray' };
    let htmlStr = '';
    users.forEach(function(u) {
      var scope = (u.role === 'hod') ? ((u.allowed_hods || []).join(', ') || '—')
        : (u.role === 'zonal_head') ? ((u.allowed_zones || []).join(', ') || '—')
        : 'All data';
      htmlStr += '<tr>'
        + '<td style="padding:12px 18px;"><b>' + (u.full_name || u.username) + '</b><br><span style="color:var(--text-muted);font-size:11px;">@' + u.username + '</span>'
        + '<div style="color:var(--text-muted);font-size:10.5px;margin-top:3px;max-width:260px;">' + scope + '</div></td>'
        + '<td style="padding:12px 18px;"><span class="badge ' + (rc[u.role] || 'badge-gray') + '">' + (window._ROLE_LABEL[u.role] || u.role) + '</span></td>'
        + '<td style="padding:12px 18px;"><span class="badge ' + (u.is_active ? 'badge-green' : 'badge-red') + '">' + (u.is_active ? 'Active' : 'Inactive') + '</span></td>'
        + '<td style="padding:12px 18px;text-align:right;white-space:nowrap;">'
        + '<button class="btn btn-ghost btn-sm" onclick="window.openEditUser(\'' + u.id + '\')"><i class="ph ph-pencil"></i> Edit</button> '
        + '<button class="btn btn-ghost btn-sm" onclick="window.toggleUserActive(\'' + u.id + '\',' + u.is_active + ')">' + (u.is_active ? 'Deactivate' : 'Activate') + '</button>'
        + (u.username === 'superadmin' ? '' : ' <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="window.deleteUser(\'' + u.id + '\',\'' + u.username + '\')"><i class="ph ph-trash"></i></button>')
        + '</td>'
        + '</tr>';
    });
    tbody.innerHTML = htmlStr;
  } catch(e) { window.toast('Failed to load users: ' + e.message, 'error'); }
};

// Fill the multi-select HOD/Zone pickers from App.filterOptions (loaded at boot).
window._populateScopePickers = function() {
  var opts = window.App.filterOptions || {};
  var hodSel = document.getElementById('uf-hods');
  var zoneSel = document.getElementById('uf-zones');
  var fill = function(sel, list) {
    if (!sel) return;
    var cur = list || [];
    sel.innerHTML = cur.filter(function(v){ return v && v !== 'All'; })
      .map(function(v){ return '<option value="' + window._escAttr(v) + '">' + v + '</option>'; }).join('');
    
    if (!sel._ms) sel._ms = new CustomMultiSelect(sel);
    else sel._ms.update();
  };
  fill(hodSel, opts.hod);
  fill(zoneSel, opts.zone);
};

class CustomMultiSelect {
  constructor(selectEl) {
    this.select = selectEl;
    this.select.style.display = 'none';
    this.container = document.createElement('div');
    this.container.style.position = 'relative';
    this.container.style.userSelect = 'none';
    
    this.trigger = document.createElement('div');
    this.trigger.className = 'form-input';
    this.trigger.style.height = 'auto';
    this.trigger.style.minHeight = '42px';
    this.trigger.style.display = 'flex';
    this.trigger.style.flexWrap = 'wrap';
    this.trigger.style.gap = '6px';
    this.trigger.style.alignItems = 'center';
    this.trigger.style.cursor = 'pointer';
    this.trigger.style.padding = '6px 12px';
    
    this.dropdown = document.createElement('div');
    this.dropdown.style.position = 'absolute';
    this.dropdown.style.top = 'calc(100% + 4px)';
    this.dropdown.style.left = '0';
    this.dropdown.style.right = '0';
    this.dropdown.style.background = 'var(--bg-card)';
    this.dropdown.style.border = '1px solid var(--border)';
    this.dropdown.style.borderRadius = 'var(--radius)';
    this.dropdown.style.boxShadow = 'var(--shadow-lg)';
    this.dropdown.style.maxHeight = '240px';
    this.dropdown.style.overflowY = 'auto';
    this.dropdown.style.zIndex = '2000';
    this.dropdown.style.display = 'none';
    this.dropdown.style.flexDirection = 'column';
    this.dropdown.style.padding = '4px';

    this.container.appendChild(this.trigger);
    this.container.appendChild(this.dropdown);
    this.select.parentNode.insertBefore(this.container, this.select);

    this.trigger.addEventListener('click', (e) => {
      if(e.target.closest('.cm-remove')) return;
      this.dropdown.style.display = this.dropdown.style.display === 'none' ? 'flex' : 'none';
    });

    document.addEventListener('click', (e) => {
      if(!this.container.contains(e.target)) this.dropdown.style.display = 'none';
    });

    this.update();
  }

  update() {
    this.dropdown.innerHTML = '';
    this.trigger.innerHTML = '';
    let hasSelected = false;

    Array.from(this.select.options).forEach((opt) => {
      let item = document.createElement('div');
      item.style.padding = '8px 12px';
      item.style.cursor = 'pointer';
      item.style.borderRadius = '6px';
      item.style.display = 'flex';
      item.style.alignItems = 'center';
      item.style.gap = '10px';
      item.style.fontSize = '13px';
      item.style.color = opt.selected ? 'var(--brand-primary)' : 'var(--text-main)';
      item.style.background = opt.selected ? 'var(--brand-muted)' : 'transparent';
      item.style.fontWeight = opt.selected ? '700' : '500';
      item.style.transition = 'background 0.2s';
      
      let checkbox = document.createElement('div');
      checkbox.style.width = '16px';
      checkbox.style.height = '16px';
      checkbox.style.border = '1px solid ' + (opt.selected ? 'var(--brand-primary)' : 'var(--border-light)');
      checkbox.style.borderRadius = '4px';
      checkbox.style.background = opt.selected ? 'var(--brand-primary)' : 'transparent';
      checkbox.style.display = 'flex';
      checkbox.style.alignItems = 'center';
      checkbox.style.justifyContent = 'center';
      checkbox.style.color = '#fff';
      checkbox.style.flexShrink = '0';
      checkbox.innerHTML = opt.selected ? '<i class="ph-bold ph-check" style="font-size:10px"></i>' : '';
      
      let label = document.createElement('span');
      label.textContent = opt.text;

      item.appendChild(checkbox);
      item.appendChild(label);

      item.addEventListener('mouseover', () => { if(!opt.selected) item.style.background = 'var(--bg-hover)'; });
      item.addEventListener('mouseout', () => { if(!opt.selected) item.style.background = 'transparent'; });

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        opt.selected = !opt.selected;
        this.select.dispatchEvent(new Event('change'));
        this.update();
      });
      
      this.dropdown.appendChild(item);

      if(opt.selected) {
        hasSelected = true;
        let pill = document.createElement('div');
        pill.style.background = 'var(--brand-primary)';
        pill.style.color = '#fff';
        pill.style.padding = '4px 8px';
        pill.style.borderRadius = '6px';
        pill.style.fontSize = '11.5px';
        pill.style.fontWeight = '600';
        pill.style.display = 'flex';
        pill.style.alignItems = 'center';
        pill.style.gap = '6px';
        pill.style.boxShadow = 'var(--shadow-sm)';
        
        let text = document.createElement('span');
        text.textContent = opt.text;
        
        let remove = document.createElement('i');
        remove.className = 'ph-bold ph-x cm-remove';
        remove.style.cursor = 'pointer';
        remove.style.opacity = '0.8';
        remove.addEventListener('mouseover', () => remove.style.opacity = '1');
        remove.addEventListener('mouseout', () => remove.style.opacity = '0.8');
        remove.addEventListener('click', (e) => {
          e.stopPropagation();
          opt.selected = false;
          this.select.dispatchEvent(new Event('change'));
          this.update();
        });

        pill.appendChild(text);
        pill.appendChild(remove);
        this.trigger.appendChild(pill);
      }
    });

    if(!hasSelected) {
      let placeholder = document.createElement('span');
      placeholder.textContent = 'Select options...';
      placeholder.style.color = 'var(--text-muted)';
      placeholder.style.padding = '4px 0';
      this.trigger.appendChild(placeholder);
    }
  }
}

window._escAttr = function(s){ return String(s).replace(/"/g, '&quot;'); };

window.onRoleChange = function() {
  var roleEl = document.getElementById('uf-role');
  if (!roleEl) return;
  var role = roleEl.value;
  var hw = document.getElementById('uf-hods-wrap');
  var zw = document.getElementById('uf-zones-wrap');
  if (hw) hw.style.display = (role === 'hod') ? 'block' : 'none';
  if (zw) zw.style.display = (role === 'zonal_head') ? 'block' : 'none';
};

window.submitNewUser = function() {
  var name     = (document.getElementById('uf-name') || {}).value || '';
  var username = (document.getElementById('uf-username') || {}).value || '';
  var password = (document.getElementById('uf-password') || {}).value || '';
  var role     = (document.getElementById('uf-role') || {}).value || 'hod';
  var status   = document.getElementById('uf-status');
  name = name.trim(); username = username.trim();

  if (!username) { window.toast('Username is required.', 'error'); return; }
  if (!password) { window.toast('Password is required.', 'error'); return; }

  var allowed_hods = [], allowed_zones = [];
  if (role === 'hod') {
    allowed_hods = window._selectedValues('uf-hods');
    if (!allowed_hods.length) { window.toast('Select at least one HOD name for an HOD user.', 'error'); return; }
  } else if (role === 'zonal_head') {
    allowed_zones = window._selectedValues('uf-zones');
    if (!allowed_zones.length) { window.toast('Select at least one zone for a Zonal Head.', 'error'); return; }
  }

  if (status) { status.textContent = 'Creating user…'; status.style.color = 'var(--text-muted)'; }
  window.api('createUser', { userData: {
    username: username, full_name: name || username, password: password,
    role: role, allowed_hods: allowed_hods, allowed_zones: allowed_zones
  } })
    .then(function() {
      if (status) { status.textContent = '✓ User created!'; status.style.color = 'var(--accent3)'; }
      window.toast(username + ' added successfully.', 'success');
      ['uf-name','uf-username','uf-password'].forEach(function(id){ var el = document.getElementById(id); if (el) el.value = ''; });
      var h = document.getElementById('uf-hods'), z = document.getElementById('uf-zones');
      if (h) Array.from(h.options).forEach(function(o){ o.selected = false; });
      if (z) Array.from(z.options).forEach(function(o){ o.selected = false; });
      if (window.loadUsers) window.loadUsers();
    })
    .catch(function(e) { if (status) { status.textContent = '✗ ' + e.message; status.style.color = 'var(--danger)'; } window.toast('Create failed: ' + e.message, 'error'); });
};

window._selectedValues = function(selId) {
  var sel = document.getElementById(selId);
  if (!sel) return [];
  return Array.from(sel.selectedOptions || []).map(function(o){ return o.value; });
};

window.toggleUserActive = function(profileId, currentlyActive) {
  window.api('updateUser', { profileId: profileId, userData: { is_active: !currentlyActive } })
    .then(function()   { window.toast('User ' + (currentlyActive ? 'deactivated' : 'activated') + '.', 'success'); if(window.loadUsers) window.loadUsers(); })
    .catch(function(e) { window.toast('Update failed: ' + e.message, 'error'); });
};

window.deleteUser = function(profileId, username) {
  if (!window.confirm('Delete user "' + username + '"? This cannot be undone.')) return;
  window.api('deleteUser', { profileId: profileId })
    .then(function()   { window.toast('User "' + username + '" deleted.', 'success'); if(window.loadUsers) window.loadUsers(); })
    .catch(function(e) { window.toast('Delete failed: ' + e.message, 'error'); });
};

window.openEditUser = function(uid) {
  console.log('openEditUser called with uid:', uid);
  console.log('window._lastLoadedUsers:', window._lastLoadedUsers);
  try {
    var u = (window._lastLoadedUsers || []).find(function(x) { return String(x.id) === String(uid); });
    if (!u) {
      window.toast('User not found in memory.', 'error');
      console.error('User not found for uid:', uid);
      return;
    }
    document.getElementById('edit-user-id').value = u.id;
    document.getElementById('edit-user-username').value = u.username || '';
    document.getElementById('edit-user-fullname').value = u.full_name || '';
    document.getElementById('edit-user-role').value = u.role || 'hod';
    document.getElementById('edit-user-password').value = '';
    
    var selH = document.getElementById('edit-user-hods');
    var selZ = document.getElementById('edit-user-zones');
    var ufH = document.getElementById('uf-hods');
    var ufZ = document.getElementById('uf-zones');
    if (selH && ufH) selH.innerHTML = ufH.innerHTML;
    if (selZ && ufZ) selZ.innerHTML = ufZ.innerHTML;
    
    if (u.role === 'hod' && Array.isArray(u.allowed_hods) && selH) {
      Array.from(selH.options).forEach(function(o){ o.selected = (u.allowed_hods.indexOf(o.value) !== -1); });
    }
    if (u.role === 'zonal_head' && Array.isArray(u.allowed_zones) && selZ) {
      Array.from(selZ.options).forEach(function(o){ o.selected = (u.allowed_zones.indexOf(o.value) !== -1); });
    }
    if(window.onEditRoleChange) window.onEditRoleChange();
    
    var modal = document.getElementById('edit-user-modal');
    if (modal) {
      modal.style.display = 'flex';
      console.log('Modal opened.');
    } else {
      console.error('Modal element not found!');
    }
  } catch(e) {
    console.error('Error opening edit modal:', e);
    window.toast('Error opening edit modal: ' + e.message, 'error');
  }
};

window.onEditRoleChange = function() {
  var role = document.getElementById('edit-user-role').value;
  var hw = document.getElementById('edit-hods-wrap');
  var zw = document.getElementById('edit-zones-wrap');
  if(hw) hw.style.display = (role === 'hod') ? 'block' : 'none';
  if(zw) zw.style.display = (role === 'zonal_head') ? 'block' : 'none';
};

window.submitEditUser = function() {
  var id = document.getElementById('edit-user-id').value;
  var uname = document.getElementById('edit-user-username').value.trim();
  var fname = document.getElementById('edit-user-fullname').value.trim();
  var role = document.getElementById('edit-user-role').value;
  var pwd = document.getElementById('edit-user-password').value;
  
  if (!uname) return window.toast('Username is required.', 'error');
  
  var updateData = { username: uname, full_name: fname, role: role };
  if (pwd) updateData.password = pwd;
  
  var scopeArr = [];
  if (role === 'hod') scopeArr = window._selectedValues('edit-user-hods');
  else if (role === 'zonal_head') scopeArr = window._selectedValues('edit-user-zones');
  
  updateData.allowed_hods = (role === 'hod') ? scopeArr : [];
  updateData.allowed_zones = (role === 'zonal_head') ? scopeArr : [];
  
  var btn = document.querySelector('#edit-user-modal .btn-primary');
  var origText = btn.innerHTML;
  btn.innerHTML = '<i class="ph ph-spinner spin"></i> Saving...';
  btn.disabled = true;
  
  window.api('updateUser', { profileId: id, userData: updateData })
    .then(function() {
      btn.innerHTML = origText;
      btn.disabled = false;
      window.toast('User updated successfully.', 'success');
      var modal = document.getElementById('edit-user-modal');
      if (modal) modal.style.display = 'none';
      if (window.loadUsers) window.loadUsers();
    })
    .catch(function(e) {
      btn.innerHTML = origText;
      btn.disabled = false;
      window.toast('Update failed: ' + e.message, 'error');
    });
};

window.updateMyPassword = function() {
  var pwd = document.getElementById('profile-new-password').value;
  var conf = document.getElementById('profile-confirm-password').value;
  if (!pwd) return window.toast('Password cannot be empty.', 'error');
  if (pwd !== conf) return window.toast('Passwords do not match.', 'error');
  
  var btn = document.querySelector('#tab-account .btn-primary');
  var origText = btn.innerHTML;
  btn.innerHTML = '<i class="ph ph-spinner spin"></i> Updating...';
  btn.disabled = true;
  
  window.api('updateMyPassword', { newPassword: pwd })
    .then(function() {
      window.toast('Password updated successfully.', 'success');
      document.getElementById('profile-new-password').value = '';
      document.getElementById('profile-confirm-password').value = '';
    })
    .catch(function(e) {
      window.toast('Failed to update password: ' + e.message, 'error');
    })
    .finally(function() {
      btn.innerHTML = origText;
      btn.disabled = false;
    });
};

window._bootDashboard = async function() {
  if (!window.App.currentUser) { window._forceLogin(); return; }
  window.loading(true);

  const kg = document.getElementById('kpi-grid');
  if (kg) {
    let s = '';
    for (let i = 0; i < 6; i++) s += '<div class="skeleton kpi-card" style="height:110px;animation-delay:' + (i * 0.06) + 's"></div>';
    kg.innerHTML = s;
  }
  
  try {
    const fOpts = await window.api('getFilterOptions');
    if (typeof window.populateFilters === 'function') window.populateFilters(fOpts || {});
    
    window.App.currentPage = 'overview';
    document.querySelectorAll('.nav-item').forEach(function(el) { el.classList.toggle('active', el.dataset.page === 'overview'); });
    document.querySelectorAll('.page').forEach(function(el)     { el.classList.toggle('active', el.id === 'page-overview'); });
    const pt = document.getElementById('page-title');
    if (pt) pt.textContent = 'Dashboard';
    
    const [kpis, overview, settings] = await Promise.all([
        window.api('getKPIs'),
        window.api('getOverviewData'),
        window.api('getSettings')
    ]);
    
    // Inject custom reports into sidebar
    const customReportsContainer = document.getElementById('sidebar-custom-reports');
    if (customReportsContainer && settings && settings.CUSTOM_REPORTS && settings.CUSTOM_REPORTS.length > 0) {
      let html = '<div class="nav-section" style="margin-top:12px;">Custom Reports</div>';
      settings.CUSTOM_REPORTS.forEach((rep, idx) => {
        html += `
          <div class="nav-item" data-page="custom-report-${idx}" onclick="navigateCustomReport(${idx}, '${rep.name}')">
            <span class="nav-icon"><i class="ph ph-table"></i></span>
            <span class="nav-label" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${rep.name}">${rep.name}</span>
          </div>
        `;
      });
      customReportsContainer.innerHTML = html;
      window.App.customReports = settings.CUSTOM_REPORTS;
    }
    
    window.App.data.overview = { kpis: kpis, monthly: overview.monthly, states: overview.states };
    
    if (typeof window.renderKPIs === 'function') window.renderKPIs(kpis || {}, overview.monthly || []);
    if (typeof window.renderMonthlyChart === 'function') window.renderMonthlyChart(overview.monthly || []);
    if (typeof window.renderStateChart === 'function') window.renderStateChart(overview.states || []);
    if (typeof window.renderQoQChart === 'function') window.renderQoQChart(overview.monthly || []);
    
    const el = document.getElementById('last-updated-val');
    if (el && kpis && kpis.lastUpdated) {
      try { el.textContent = new Date(kpis.lastUpdated).toLocaleString('en-IN'); el.style.display = ''; }
      catch(e) { el.textContent = kpis.lastUpdated; }
    }
    
    setInterval(function() { 
      if (document.visibilityState === 'visible' && window.debouncedCacheUpdate) window.debouncedCacheUpdate(); 
    }, 3600000);

  } catch(e) {
    window.toast('Boot error: ' + e.message, 'error', 10000);
    if (kg) {
      kg.innerHTML = '<div style="color:var(--danger); padding:20px;"><i class="ph ph-warning"></i> Dashboard failed to load data.</div>';
    }
  } finally {
    window.loading(false);
    window._appReady = true;
  }
};

window.toggleSidebarSyncPopover = function(e) {
  e.stopPropagation();
  const popover = document.getElementById('sidebar-sync-popover');
  const btn = document.getElementById('sidebar-data-sync-btn');
  if (!popover || !btn) return;
  
  if (popover.classList.contains('show')) {
    popover.classList.remove('show');
  } else {
    // Close other popovers if needed (like filter drops)
    document.querySelectorAll('.ms-wrap').forEach(w => w.classList.remove('open'));
    window._activeDrop = null;
    
    // Position the popover dynamically
    const rect = btn.getBoundingClientRect();
    // Position to the right of the sidebar, aligned with the button
    popover.style.left = (rect.right + 8) + 'px';
    // If the button is too low, we adjust bottom so it doesn't clip screen
    const spaceBelow = window.innerHeight - rect.bottom;
    const popoverHeight = 300; // estimated max height
    
    if (spaceBelow < popoverHeight / 2) {
      popover.style.bottom = '20px';
      popover.style.top = 'auto';
    } else {
      popover.style.top = (rect.top - 20) + 'px';
      popover.style.bottom = 'auto';
    }
    
    popover.classList.add('show');
  }
};

// Close popover when clicking outside
document.addEventListener('click', function(e) {
  const popover = document.getElementById('sidebar-sync-popover');
  const btn = document.getElementById('sidebar-data-sync-btn');
  if (popover && popover.classList.contains('show')) {
    if (!popover.contains(e.target) && (!btn || !btn.contains(e.target))) {
      popover.classList.remove('show');
    }
  }
});

window.updateNavIndicator = function() {
  const activeItem = document.querySelector('nav > .nav-item.active');
  const indicator = document.getElementById('nav-indicator');
  if (indicator) {
    if (activeItem) {
      indicator.style.opacity = '1';
      indicator.style.top = activeItem.offsetTop + 'px';
      indicator.style.height = activeItem.offsetHeight + 'px';
    } else {
      indicator.style.opacity = '0';
    }
  }
};

window.initMicroInteractions = function() {
  // 1. Initial nav indicator draw
  setTimeout(window.updateNavIndicator, 400);
  
  // Update indicator on window resize
  window.addEventListener('resize', window.updateNavIndicator);

  // 2. 3D Tilt and Shine effect on KPI cards
  const initKpiTilt = () => {
    document.querySelectorAll('.kpi-card').forEach(card => {
      if (card.classList.contains('tilt-enabled')) return;
      card.classList.add('tilt-enabled');
      
      card.addEventListener('mousemove', e => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const xc = rect.width / 2;
        const yc = rect.height / 2;
        const dx = x - xc;
        const dy = y - yc;
        
        // Tilt rotation: max 4.5 degrees
        const rx = -(dy / yc) * 4.5;
        const ry = (dx / xc) * 4.5;
        
        card.style.transform = `perspective(1000px) rotateX(${rx}deg) rotateY(${ry}deg) scale(1.02)`;
        card.style.setProperty('--shine-x', `${(x / rect.width) * 100}%`);
        card.style.setProperty('--shine-y', `${(y / rect.height) * 100}%`);
      });
      
      card.addEventListener('mouseleave', () => {
        card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)';
        card.style.setProperty('--shine-x', '50%');
        card.style.setProperty('--shine-y', '50%');
      });
    });
  };
  
  initKpiTilt();
  
  // 3. MutationObserver to auto-inject stagger index to table rows and also re-init KPI tilts if page changes
  const observer = new MutationObserver(mutations => {
    let checkKpis = false;
    mutations.forEach(mutation => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(node => {
          if (node.tagName === 'TR') {
            const parent = node.parentNode;
            if (parent) {
              const siblings = Array.from(parent.children);
              node.style.setProperty('--row-index', siblings.indexOf(node));
              node.classList.add('stagger-row');
            }
          } else if (node.querySelectorAll) {
            node.querySelectorAll('tbody tr').forEach(row => {
              const parent = row.parentNode;
              if (parent) {
                const siblings = Array.from(parent.children);
                row.style.setProperty('--row-index', siblings.indexOf(row));
                row.classList.add('stagger-row');
              }
            });
            if (node.querySelector('.kpi-card') || node.classList.contains('kpi-card')) {
              checkKpis = true;
            }
          }
        });
      }
    });
    
    if (checkKpis) {
      initKpiTilt();
    }
  });
  
  const content = document.getElementById('content');
  if (content) {
    observer.observe(content, { childList: true, subtree: true });
  }
};

window.addEventListener('DOMContentLoaded', function() {
  if (window.initTheme) window.initTheme();
  if (window.initTooltip) window.initTooltip();
  if (window.onRoleChange) window.onRoleChange();
  // Gate the whole app behind login (validates any stored token first).
  if (window._initAuth) window._initAuth();
  
  // Initialize Premium Micro-interactions
  if (window.initMicroInteractions) window.initMicroInteractions();
});