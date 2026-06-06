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

window.toggleTheme = function() { 
  window.applyTheme(window.theme() === 'dark' ? 'light' : 'dark'); 
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
  var payload = Object.assign({ action: action, filters: window.App.filters }, extra);
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
      if (r.ok) return r.data;
      throw new Error(r.error || ('Server error on action: ' + action));
    });
  });
};

window.toast = function(msg, type, dur) {
  const icons = { success: 'ph-check-circle', error: 'ph-warning-circle', info: 'ph-info' };
  const w = document.getElementById('toast-wrap');
  if (!w) return;
  const t = document.createElement('div');
  t.className = 'toast ' + (type || 'info');
  t.innerHTML = '<i class="ph ' + (icons[type || 'info']) + '"></i><span>' + msg + '</span>';
  w.appendChild(t);
  setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, dur || 4000);
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
  }
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
  if (pane) pane.style.display = 'block';
  
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
  
  const configValue = {
    OUTSTANDING_SHEET_ID: outId,
    OUTSTANDING_SHEET_NAME: outName,
    TARGET_SHEET_ID: tgtId,
    TARGET_SHEET_NAME: tgtName,
    SOURCE_SHEETS: sourceSheets
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

window.exportTableToCSV = function(theadId, tbodyId, filename) {
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
    product:      () => typeof window.loadBrandFinish === 'function' ? window.loadBrandFinish() : null,
    producttype:  () => typeof window.loadProductType === 'function' ? window.loadProductType() : null,
    topsku:       () => typeof window.loadTopSKUs === 'function' ? window.loadTopSKUs(page) : null
  };
  if (loaders[id] && typeof loaders[id] === 'function') loaders[id]();
};

window.toggleAnalytics = function(btn)  { btn.classList.toggle('open'); document.getElementById('analytics-submenu').classList.toggle('open'); };
window.toggleProductNav = function(btn) { btn.classList.toggle('open'); document.getElementById('product-submenu').classList.toggle('open'); };

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
};

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

window.loadUsers = async function() {
  const tbody = document.getElementById('tbl-users-body');
  if (!tbody) return;
  tbody.innerHTML = window._loadingRow(4);
  try {
    const users = await window.api('listUsers');
    if (!users || !users.length) { tbody.innerHTML = window._emptyRow(4, 'No users found.'); return; }
    const rc = { super_admin: 'badge-amber', hod: 'badge-blue', state_manager: 'badge-green', viewer: 'badge-gray' };
    
    let htmlStr = '';
    users.forEach(function(u) {
      htmlStr += '<tr>'
        + '<td style="padding:12px 18px;"><b>' + u.full_name + '</b><br><span style="color:var(--text-muted);font-size:11px;">' + u.email + '</span></td>'
        + '<td style="padding:12px 18px;"><span class="badge ' + (rc[u.role] || 'badge-gray') + '">' + u.role + '</span></td>'
        + '<td style="padding:12px 18px;"><span class="badge ' + (u.is_active ? 'badge-green' : 'badge-red') + '">' + (u.is_active ? 'Active' : 'Inactive') + '</span></td>'
        + '<td style="padding:12px 18px;text-align:right;"><button class="btn btn-ghost btn-sm" onclick="window.toggleUserActive(\'' + u.id + '\',' + u.is_active + ')">' + (u.is_active ? 'Deactivate' : 'Activate') + '</button></td>'
        + '</tr>';
    });
    tbody.innerHTML = htmlStr;
  } catch(e) { window.toast('Failed to load users: ' + e.message, 'error'); }
};

window.onRoleChange = function() {
  const role = document.getElementById('uf-role').value;
  const hw   = document.getElementById('uf-hod-wrap');
  const sw   = document.getElementById('uf-states-wrap');
  if (hw) hw.style.display = role === 'hod'                                  ? 'flex' : 'none';
  if (sw) sw.style.display = (role === 'state_manager' || role === 'viewer') ? 'flex' : 'none';
};

window.submitNewUser = function() {
  const name     = document.getElementById('uf-name').value.trim();
  const email    = document.getElementById('uf-email').value.trim();
  const password = document.getElementById('uf-password').value.trim();
  const role     = document.getElementById('uf-role').value;
  const hod      = document.getElementById('uf-hod').value.trim();
  const stRaw    = document.getElementById('uf-states').value.trim();
  const status   = document.getElementById('uf-status');
  
  if (!name || !email) { window.toast('Name and email are required.', 'error'); return; }
  
  const states = stRaw ? stRaw.split(',').map(function(s) { return s.trim().toUpperCase(); }).filter(Boolean) : null;
  status.textContent = 'Creating user…'; status.style.color = 'var(--text-muted)';
  
  window.api('createUser', { userData: { full_name: name, email: email, password: password || 'Welcome@123', role: role, hod_name: hod || null, allowed_states: states } })
    .then(function() {
      status.textContent = '✓ User created!'; status.style.color = 'var(--accent3)';
      window.toast(name + ' added successfully.', 'success');
      ['uf-name','uf-email','uf-password','uf-hod','uf-states'].forEach(function(id) {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      if(window.loadUsers) window.loadUsers();
    })
    .catch(function(e) { status.textContent = '✗ ' + e.message; status.style.color = 'var(--danger)'; window.toast('Create failed: ' + e.message, 'error'); });
};

window.toggleUserActive = function(profileId, currentlyActive) {
  window.api('updateUser', { profileId: profileId, userData: { is_active: !currentlyActive } })
    .then(function()   { window.toast('User ' + (currentlyActive ? 'deactivated' : 'activated') + '.', 'success'); if(window.loadUsers) window.loadUsers(); })
    .catch(function(e) { window.toast('Update failed: ' + e.message, 'error'); });
};

window._bootDashboard = async function() {
  window.loading(true);
  window.App.currentUser = {
    id: 'bypass-001', full_name: 'Admin User',
    email: 'admin@virgoasia.com', role: 'super_admin',
    hod_name: null, allowed_states: null, is_active: true
  };
  
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
    
    const [kpis, overview] = await Promise.all([
        window.api('getKPIs'),
        window.api('getOverviewData')
    ]);
    
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

window.addEventListener('DOMContentLoaded', function() {
  if (window.initTheme) window.initTheme();
  if (window.initTooltip) window.initTooltip();
  if (window.onRoleChange) window.onRoleChange();
  if (window._bootDashboard) window._bootDashboard();
});