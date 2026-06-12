// ===========================================================
// JAVASCRIPT — Front-end Logic (Part 3/3)
// SKU Grouping, Outstanding, Analytics, Charts & Filters
// ===========================================================

window._activeRiskTab = 'declining';

window.switchRiskTab = function(tabId, btn) {
  window._activeRiskTab = tabId;
  document.querySelectorAll('.risk-btn').forEach(b => { b.classList.remove('btn-primary'); b.classList.add('btn-ghost'); });
  if (btn) { btn.classList.remove('btn-ghost'); btn.classList.add('btn-primary'); }
  document.querySelectorAll('.risk-pane').forEach(p => p.classList.remove('active'));
  const pane = document.getElementById('pane-' + tabId);
  if (pane) pane.classList.add('active');
  window.loadPage('risk', 1);
};

window.setSkuTypeView = function(v, btn) {
  window.skuTypeSaleView = v;
  document.querySelectorAll('#skutypeqoq-toggles .btn').forEach(function(b) { b.className = 'btn btn-sm btn-ghost'; });
  if (btn) btn.className = 'btn btn-sm btn-primary';
  window.loadSkuTypeSale(1);
};

window.setSkuTypeSalePage = function(p) { 
  window.skuTypeSalePage = p; 
  window.loadSkuTypeSale(p); 
};

window.loadSkuTypeSale = async function(page = 1) {
  const tbody = document.getElementById('tbl-skutypeqoq-body');
  const thead = document.getElementById('tbl-skutypeqoq-head');
  if (!tbody || !thead) return;
  tbody.innerHTML = window._loadingRow(6);
  
  let pagContainer = document.getElementById('pagination-skutypeqoq');
  if(!pagContainer) {
      const wrap = document.querySelector('#page-skutypeqoq .table-card');
      if(wrap) { 
        pagContainer = document.createElement('div'); 
        pagContainer.id = 'pagination-skutypeqoq'; 
        wrap.appendChild(pagContainer); 
      }
  }

  try {
    if (page === 1) {
       const trendData = await window.api('getSkuTypeMonthlySummary');
       if (trendData && trendData.length) window.renderSkuTypeTrendChart(trendData);
    }
    
    if (window.skuTypeSaleView === 'year')       await window._loadSkuTypeByYear(tbody, thead, page);
    else if (window.skuTypeSaleView === 'month') await window._loadSkuTypeByMonth(tbody, thead, page);
    else                                          await window._loadSkuTypeByQuarter(tbody, thead, page);
  } catch(e) { tbody.innerHTML = window._errorRow(6, e.message); }
};

window._loadSkuTypeByMonth = async function(tbody, thead, page) {
  const dataList = await window.api('getSkuTypeMonthlySummary');
  const sq = (window.searchQueries['skutypeqoq'] || '').toLowerCase();

  const monthSet = new Set();
  dataList.forEach(r => { if (r.MONTH) monthSet.add(r.MONTH); });
  let periods = Array.from(monthSet).sort((a, b) => {
    const parse = m => { const p = m.trim().replace(/-/g,' ').split(/\s+/); const mi = window.MN.indexOf((p[0]||'').toUpperCase()); let yr = p[1]||'0'; if(yr.length===2) yr='20'+yr; return parseInt(yr)*100+(mi+1); };
    return parse(b) - parse(a);
  }).slice(0, 4);
  periods = periods.reverse(); 

  const skuTypeSet = new Set();
  dataList.forEach(r => { if (r.SKU_TYPE) skuTypeSet.add(r.SKU_TYPE); });
  const skuTypes = Array.from(skuTypeSet).sort();

  const hodMap = {};
  dataList.forEach(r => {
    const key = r.STATE + '||' + r.HOD;
    if (sq && (r.STATE + r.HOD + r.SKU_TYPE).toLowerCase().indexOf(sq) === -1) return;
    if (!periods.includes(r.MONTH)) return;
    
    if (!hodMap[key]) {
      hodMap[key] = { STATE: r.STATE, HOD: r.HOD, OVERALL_TOTAL: 0, periods: {} };
      periods.forEach(p => hodMap[key].periods[p] = { TOTAL: 0, skus: {} });
    }
    
    const val = r.TOTAL_SQFT || 0;
    hodMap[key].OVERALL_TOTAL += val;
    hodMap[key].periods[r.MONTH].TOTAL += val;
    if (r.SKU_TYPE) hodMap[key].periods[r.MONTH].skus[r.SKU_TYPE] = (hodMap[key].periods[r.MONTH].skus[r.SKU_TYPE] || 0) + val;
  });

  window._renderSkuTypeTable(hodMap, periods, skuTypes, tbody, thead, page);
};

window._loadSkuTypeByQuarter = async function(tbody, thead, page) {
  const dataList = await window.api('getSkuTypeQoQ');
  const sq = (window.searchQueries['skutypeqoq'] || '').toLowerCase();

  const skuTypeSet = new Set();
  dataList.forEach(r => { if (r.SKU_TYPE) skuTypeSet.add(r.SKU_TYPE); });
  const skuTypes = Array.from(skuTypeSet).sort();

  const periods = ['Q1', 'Q2', 'Q3', 'Q4'];
  const qField = { Q1: 'Q1_SQFT', Q2: 'Q2_SQFT', Q3: 'Q3_SQFT', Q4: 'Q4_SQFT' };

  const hodMap = {};
  dataList.forEach(r => {
    const key = r.STATE + '||' + r.HOD;
    if (sq && (r.STATE + r.HOD + r.SKU_TYPE).toLowerCase().indexOf(sq) === -1) return;
    if (!hodMap[key]) {
      hodMap[key] = { STATE: r.STATE, HOD: r.HOD, OVERALL_TOTAL: 0, periods: {} };
      periods.forEach(p => hodMap[key].periods[p] = { TOTAL: 0, skus: {} });
    }
    
    hodMap[key].OVERALL_TOTAL += (r.TOTAL_SQFT || 0);
    periods.forEach(p => {
      const val = r[qField[p]] || 0;
      hodMap[key].periods[p].TOTAL += val;
      if (r.SKU_TYPE) hodMap[key].periods[p].skus[r.SKU_TYPE] = (hodMap[key].periods[p].skus[r.SKU_TYPE] || 0) + val;
    });
  });

  window._renderSkuTypeTable(hodMap, periods, skuTypes, tbody, thead, page);
};

window._loadSkuTypeByYear = async function(tbody, thead, page) {
  const dataList = await window.api('getSkuTypeAllFYSummary');
  const sq = (window.searchQueries['skutypeqoq'] || '').toLowerCase();

  const fySet = new Set();
  dataList.forEach(r => { if (r.FY) fySet.add(r.FY); });
  let periods = Array.from(fySet).sort().reverse().slice(0, 3); 
  periods = periods.reverse(); 

  const skuTypeSet = new Set();
  dataList.forEach(r => { if (r.SKU_TYPE) skuTypeSet.add(r.SKU_TYPE); });
  const skuTypes = Array.from(skuTypeSet).sort();

  const hodMap = {};
  dataList.forEach(r => {
    const key = r.STATE + '||' + r.HOD;
    if (sq && (r.STATE + r.HOD + r.SKU_TYPE).toLowerCase().indexOf(sq) === -1) return;
    if (!periods.includes(r.FY)) return;
    
    if (!hodMap[key]) {
      hodMap[key] = { STATE: r.STATE, HOD: r.HOD, OVERALL_TOTAL: 0, periods: {} };
      periods.forEach(p => hodMap[key].periods[p] = { TOTAL: 0, skus: {} });
    }
    
    const val = r.TOTAL_SQFT || 0;
    hodMap[key].OVERALL_TOTAL += val;
    hodMap[key].periods[r.FY].TOTAL += val;
    if (r.SKU_TYPE) hodMap[key].periods[r.FY].skus[r.SKU_TYPE] = (hodMap[key].periods[r.FY].skus[r.SKU_TYPE] || 0) + val;
  });

  window._renderSkuTypeTable(hodMap, periods, skuTypes, tbody, thead, page);
};

window._renderSkuTypeTable = function(hodMap, periods, skuTypes, tbody, thead, page) {
  const sorted = Object.values(hodMap).sort((a, b) => b.OVERALL_TOTAL - a.OVERALL_TOTAL);
  const ps = 50, totalPages = Math.ceil(sorted.length / ps) || 1;
  const displayRows = sorted.slice((page-1)*ps, page*ps);
  window.App.lastTableData['skutypeqoq'] = displayRows;

  const stickyST  = 'position:sticky;left:0;z-index:3;background:var(--brand-primary);min-width:110px;padding:12px 14px;';
  const stickyHOD = 'position:sticky;left:110px;z-index:3;background:var(--brand-primary);min-width:160px;max-width:160px;border-right:1px solid rgba(255,255,255,0.2);padding:12px 14px;';
  const stickyRowST  = 'position:sticky;left:0;z-index:1;background:var(--bg-card);min-width:110px;padding:10px 14px;';
  const stickyRowHOD = 'position:sticky;left:110px;z-index:1;background:var(--bg-card);min-width:160px;max-width:160px;border-right:1px solid var(--border);padding:10px 14px;';

  let thHtml = `<tr>
    <th style="${stickyST}">STATE</th>
    <th style="${stickyHOD}">HOD</th>`;
  
  periods.forEach(p => {
    thHtml += `<th style="min-width:140px;padding:12px 14px;border-left:2px solid rgba(255,255,255,0.2);text-align:left;font-weight:800;color:#ffffff;">TOTAL (${p})</th>`;
    skuTypes.forEach(sku => {
      thHtml += `<th style="min-width:130px;padding:12px 14px;text-align:left;text-transform:uppercase;">${sku}</th>`;
    });
  });
  thHtml += '</tr>';
  thead.innerHTML = thHtml;

  if (!displayRows.length) { tbody.innerHTML = window._emptyRow(2 + periods.length * (skuTypes.length + 1), 'No data found.'); return; }

  let html = '';
  displayRows.forEach(r => {
    html += `<tr>
      <td style="font-weight:600;color:var(--text-main);${stickyRowST}">${r.STATE || '-'}</td>
      <td style="font-weight:700;color:var(--text-main);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${stickyRowHOD}" title="${r.HOD || '-'}">${r.HOD || '-'}</td>`;
    
    periods.forEach(p => {
      const pData = r.periods[p];
      const total = pData.TOTAL;
      html += `<td style="font-weight:800;color:var(--brand-primary);padding:10px 14px;border-left:2px solid var(--border)">${total > 0 ? window.fmt.num(total) : '-'}</td>`;
      
      skuTypes.forEach(sku => {
        const val = pData.skus[sku] || 0;
        if (val > 0) {
          const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0.0';
          html += `<td style="padding:10px 14px;">
            <div style="font-weight:700;font-size:13px;color:var(--text-main);">${window.fmt.num(val)}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
              <span style="font-size:11px;font-weight:600;color:var(--text-muted);">
                <span style="color:var(--brand-primary)">●</span> ${pct}%
              </span>
            </div>
          </td>`;
        } else {
          html += `<td style="padding:10px 14px;"><div style="font-weight:700;font-size:13px;color:var(--text-main);">0</div><div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-top:4px;">0.0%</div></td>`;
        }
      });
    });
    html += `</tr>`;
  });
  tbody.innerHTML = html;
  window._renderPagination({ page, totalPages, total: sorted.length }, 'setSkuTypeSalePage', 'pagination-skutypeqoq');
};

window.setOutstandingPage = function(p) { 
  window.outstandingPage = p; 
  window._renderOutstandingTable(); 
};

window.outAgingFilter = 'all';
window.setOutAging = function(f, btn) {
  window.outAgingFilter = f; window.outstandingPage = 1;
  document.querySelectorAll('#out-aging-toggle .btn').forEach(function(b) { b.className = 'btn btn-sm btn-ghost'; });
  if (btn) btn.className = 'btn btn-sm btn-primary';
  window._renderOutstandingTable();
};

window.loadOutstanding = async function() {
  const kpiGrid = document.getElementById('outstanding-kpi-grid');
  const tbody   = document.getElementById('tbl-outstanding-body');
  if (!tbody) return;
  tbody.innerHTML = window._loadingRow(9);
  if (kpiGrid) kpiGrid.innerHTML = '';

  try {
    const rowsData = await window.api('getOutstandingSummary');
    const rows = rowsData || []; window.App.data.outstanding = rows;

    const totalOutstanding = rows.reduce(function(s, r) { return s + (r.CURRENT_OUTSTANDING || 0); }, 0);
    const total90Plus      = rows.reduce(function(s, r) { return s + (r.DAYS_90_PLUS || 0); }, 0);
    const totalAbove45     = rows.reduce(function(s, r) { return s + (r.ABOVE_45 || 0); }, 0);
    const totalCustomers   = rows.length; 
    const riskCustCount    = rows.filter(function(r){ return (r.DAYS_90_PLUS || 0) > 0; }).length;

    const lbl = document.getElementById('outstanding-sync-label');
    if (lbl) lbl.textContent = 'Live data · auto-syncs every 2h';

    if (kpiGrid) {
      kpiGrid.innerHTML = `
        <div class="kpi-card" style="--kpi-color:var(--accent4)"><div class="kpi-header-row"><div class="kpi-icon" style="color:var(--accent4)"><i class="ph ph-currency-inr"></i></div><div class="kpi-label">Total Outstanding</div></div><div class="kpi-value" style="font-size:24px;">₹${window.fmt.short(totalOutstanding)}</div><div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:auto;">${window.fmt.num(totalOutstanding)} absolute</div><div class="kpi-footer"><div class="kpi-sub">Current outstanding</div></div></div>
        <div class="kpi-card" style="--kpi-color:var(--danger)"><div class="kpi-header-row"><div class="kpi-icon" style="color:var(--danger)"><i class="ph ph-warning-circle"></i></div><div class="kpi-label">90+ Days Amount</div></div><div class="kpi-value" style="color:var(--danger);font-size:24px;">₹${window.fmt.short(total90Plus)}</div><div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:auto;">${window.fmt.num(total90Plus)} absolute</div><div class="kpi-footer"><div class="kpi-sub kpi-delta down" style="padding:4px 10px">${totalOutstanding > 0 ? ((total90Plus / totalOutstanding) * 100).toFixed(1) + '% of total' : '—'}</div></div></div>
        <div class="kpi-card" style="--kpi-color:#f97316"><div class="kpi-header-row"><div class="kpi-icon" style="color:#f97316"><i class="ph ph-clock-countdown"></i></div><div class="kpi-label">Above 45 Days</div></div><div class="kpi-value" style="color:#f97316;font-size:24px;">₹${window.fmt.short(totalAbove45)}</div><div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:auto;">${window.fmt.num(totalAbove45)} absolute</div><div class="kpi-footer"><div class="kpi-sub">Overdue receivables</div></div></div>
        <div class="kpi-card" style="--kpi-color:var(--brand-primary)"><div class="kpi-header-row"><div class="kpi-icon" style="color:var(--brand-primary)"><i class="ph ph-users"></i></div><div class="kpi-label">Total Debtors</div></div><div class="kpi-value" style="font-size:24px;">${window.fmt.num(totalCustomers)}</div><div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:auto;">customers</div><div class="kpi-footer"><div class="kpi-sub">Customers with outstanding</div></div></div>
        <div class="kpi-card" style="--kpi-color:var(--danger)"><div class="kpi-header-row"><div class="kpi-icon" style="color:var(--danger)"><i class="ph ph-warning"></i></div><div class="kpi-label">90+ Days Accounts</div></div><div class="kpi-value" style="font-size:24px;">${window.fmt.num(riskCustCount)}</div><div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:auto;">customers in default</div><div class="kpi-footer"><div class="kpi-sub">High risk debtors</div></div></div>
      `;
    }
    window._renderOutstandingTable();
  } catch(e) { 
    if (tbody) tbody.innerHTML = window._errorRow(9, e.message); 
    window.toast('Outstanding error: ' + e.message, 'error', 8000); 
  }
};

window._renderOutstandingTable = function() {
  const tbody = document.getElementById('tbl-outstanding-body'); const thead = document.getElementById('tbl-outstanding-head');
  if (!tbody || !thead) return;
  let rows = window.App.data.outstanding || [];

  if (window.outAgingFilter === '90') {
    rows = rows.filter(function(r) { return (r.DAYS_90_PLUS || 0) > 0; });
  } else if (window.outAgingFilter === '45') {
    rows = rows.filter(function(r) { return (r.ABOVE_45 || 0) > 0; });
  } else if (window.outAgingFilter === 'clean') {
    rows = rows.filter(function(r) { return (r.BELOW_45 || 0) > 0 && !(r.ABOVE_45 || 0) && !(r.DAYS_90_PLUS || 0); });
  }

  const sq = (window.searchQueries['outstanding'] || '').toLowerCase();
  if (sq) { rows = rows.filter(function(r) { return (r.STATE || '').toLowerCase().indexOf(sq) !== -1 || (r.HOD || '').toLowerCase().indexOf(sq) !== -1 || (r.CUSTOMER_NAME || '').toLowerCase().indexOf(sq) !== -1; }); }

  const stickyN   = 'position:sticky;left:0;z-index:3;background:var(--brand-primary);width:44px;padding:8px 12px;';
  const stickyST  = 'position:sticky;left:44px;z-index:3;background:var(--brand-primary);min-width:110px;padding:8px 12px;';
  const stickyHOD = 'position:sticky;left:154px;z-index:3;background:var(--brand-primary);min-width:150px;border-right:1px solid rgba(255,255,255,0.2);padding:8px 12px;';
  const stickyRowN   = 'position:sticky;left:0;z-index:1;background:var(--bg-card);width:44px;padding:6px 12px;';
  const stickyRowST  = 'position:sticky;left:44px;z-index:1;background:var(--bg-card);min-width:110px;padding:6px 12px;';
  const stickyRowHOD = 'position:sticky;left:154px;z-index:1;background:var(--bg-card);min-width:150px;border-right:1px solid var(--border);padding:6px 12px;';

  thead.innerHTML = '<tr><th style="' + stickyN + '">#</th><th style="' + stickyST + '">State</th><th style="' + stickyHOD + '">HOD Name</th>'
    + '<th style="min-width:200px;padding:8px 12px;">Customer Name</th><th style="min-width:120px;text-align:right;padding:8px 12px;">Credit Limit</th><th style="min-width:120px;text-align:right;padding:8px 12px;">Outstanding</th><th style="min-width:110px;text-align:right;padding:8px 12px;">Below 45d</th><th style="min-width:110px;text-align:right;color:#fcd34d;padding:8px 12px;">Above 45d</th><th style="min-width:100px;text-align:right;color:#fca5a5;padding:8px 12px;">90+ Days</th><th style="min-width:80px;text-align:right;padding:8px 12px;">Risk %</th></tr>';

  if (!rows.length) { tbody.innerHTML = window._emptyRow(10, 'No outstanding data matching criteria.'); window._renderPagination(null, '', 'pagination-outstanding'); return; }

  const ps = 50; const totalPages = Math.ceil(rows.length / ps);
  if (window.outstandingPage > totalPages) window.outstandingPage = totalPages;
  
  if (window.tableSortRules['outstanding'] && window.tableSortRules['outstanding'].length > 0) {
    rows = window.applyMultiSort(rows, 'outstanding');
  }

  const displayRows = rows.slice((window.outstandingPage - 1) * ps, window.outstandingPage * ps);
  window.App.lastTableData['outstanding'] = displayRows;

  let htmlStr = '';
  displayRows.forEach(function(r, i) {
    const total  = r.CURRENT_OUTSTANDING || 0;
    const risk   = total > 0 ? ((r.DAYS_90_PLUS || 0) / total * 100).toFixed(1) : '0.0';
    const rColor = parseFloat(risk) >= 30 ? 'var(--danger)' : parseFloat(risk) >= 15 ? '#f97316' : 'var(--accent3)';
    const idx    = ((window.outstandingPage - 1) * ps) + i + 1;
    htmlStr += '<tr><td style="' + stickyRowN + '">' + idx + '</td><td style="color:var(--text-muted);white-space:nowrap;' + stickyRowST + '">' + (r.STATE || '-') + '</td><td style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-main);' + stickyRowHOD + '">' + (r.HOD || '-') + '</td><td style="font-weight:700;color:var(--text-main);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:6px 12px;">' + (r.CUSTOMER_NAME || '-') + '</td><td style="text-align:right;color:var(--text-muted);padding:6px 12px;">' + window.fmt.num(r.CREDIT_LIMIT) + '</td><td style="text-align:right;font-weight:700;color:var(--text-main);padding:6px 12px;">' + window.fmt.num(total) + '</td><td style="text-align:right;color:var(--accent3);padding:6px 12px;">' + window.fmt.num(r.BELOW_45) + '</td><td style="text-align:right;color:#f97316;padding:6px 12px;">' + window.fmt.num(r.ABOVE_45) + '</td><td style="text-align:right;font-weight:700;color:var(--danger);padding:6px 12px;">' + window.fmt.num(r.DAYS_90_PLUS) + '</td><td style="text-align:right;font-weight:700;color:' + rColor + ';padding:6px 12px;">' + risk + '%</td></tr>';
  });
  tbody.innerHTML = htmlStr;
  window._renderPagination({ page: window.outstandingPage, totalPages: totalPages, total: rows.length }, 'setOutstandingPage', 'pagination-outstanding');
};

window.setCustSort = function(s, btn) {
  window.custSort = s; document.querySelectorAll('#page-pareto .btn-group:not(#pareto-time-toggle) .btn').forEach(function(b) { b.className = 'btn btn-sm btn-ghost'; });
  if (btn) btn.className = 'btn btn-sm btn-primary'; window.loadTopCustomers(1);
};

window.paretoActiveDays = 0;
window.setParetoTime = function(days, btn) {
  window.paretoActiveDays = days;
  document.querySelectorAll('#pareto-time-toggle .btn').forEach(function(b) { b.className = 'btn btn-sm btn-ghost'; });
  if (btn) btn.className = 'btn btn-sm btn-primary';
  window.loadTopCustomers(1);
};

window.loadTopCustomers = async function(page = 1) {
  const tbody = document.getElementById('tbl-customers-body'); if (!tbody) return;
  tbody.innerHTML = window._loadingRow(9);
  let pagContainer = document.getElementById('pagination-customers');
  if(!pagContainer) { const wrap = document.querySelector('#page-pareto .table-card'); pagContainer = document.createElement('div'); pagContainer.id = 'pagination-customers'; wrap.appendChild(pagContainer); }
  
  try {
    const res  = await window.api('getTopCustomers', { options: { pareto80: true, sortBy: window.custSort, activeDays: window.paretoActiveDays, page: page, pageSize: 50, search: window.searchQueries['customers'] } });
    const rows = window._tableItems(res);
    window._renderPagination(res, 'loadTopCustomers', 'pagination-customers');
    const kg = document.getElementById('customers-kpi-grid');
    if (kg) {
        kg.innerHTML = '<div class="kpi-card stagger-1" style="--kpi-color:#38bdf8"><div class="kpi-header-row"><div class="kpi-icon" style="color:#38bdf8"><i class="ph ph-users"></i></div><div class="kpi-label">Top 80% Accounts</div></div><div class="kpi-value" style="font-size:24px;">' + window.fmt.num(res.total) + '</div></div>'
        + '<div class="kpi-card stagger-1" style="--kpi-color:#10b981"><div class="kpi-header-row"><div class="kpi-icon" style="color:#10b981"><i class="ph ph-ruler"></i></div><div class="kpi-label">Total SQ FT (80%)</div></div><div class="kpi-value" style="font-size:24px;">' + window.fmt.short(res.paretoSqft || 0) + '</div></div>';
    }
    if (window.tableSortRules['customers'] && window.tableSortRules['customers'].length > 0) {
      rows = window.applyMultiSort(rows, 'customers');
    }
    window.App.lastTableData['customers'] = rows;
    if (!rows.length) { tbody.innerHTML = window._emptyRow(9, 'No customers found.'); return; }
    
    let htmlStr = '';
    rows.forEach(function(r, i) {
      const days   = r['DAYS SINCE LAST PURCHASE'] || 0;
      const dBadge = days <= 30 ? 'badge-green' : days <= 90 ? 'badge-blue' : days <= 180 ? 'badge-amber' : 'badge-red';
      const index = ((res.page - 1) * res.pageSize) + i + 1;
      const safeName = (r['CUSTOMER NAME'] || '-').replace(/'/g, "&#39;").replace(/"/g, "&quot;");
      const ttHtml = '<b>State:</b> ' + (r['STATE'] || '-') + '<br><b>SQ FT:</b> ' + window.fmt.num(r['SQ FT.']) + '<br><b>Txns:</b> ' + r['TRANSACTION COUNT'];
      
      htmlStr += '<tr onmouseenter="window.showRowTooltip(event, \'' + safeName + '\', \'' + ttHtml + '\')" onmouseleave="window.hideRowTooltip()">'
        + '<td style="padding:6px 12px;">' + index + '</td><td style="font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-main);padding:6px 12px;">' + safeName + '</td><td style="padding:6px 12px;">' + (r['STATE'] || '-') + '</td><td style="padding:6px 12px;">' + (r['HOD NAME'] || 'Unassigned') + '</td><td style="font-weight:700;color:var(--text-main);padding:6px 12px;">' + window.fmt.num(r['SQ FT.']) + '</td><td style="padding:6px 12px;">' + window.fmt.num(r['TOTAL SQM']) + '</td><td style="padding:6px 12px;">' + window.fmt.num(r['TRANSACTION COUNT']) + '</td><td style="padding:6px 12px;">' + window.fmt.date(r['LAST PURCHASE DATE']) + '</td><td style="padding:6px 12px;"><span class="badge ' + dBadge + '">' + days + 'd</span></td></tr>';
    });
    tbody.innerHTML = htmlStr;
  } catch(e) { tbody.innerHTML = window._errorRow(9, e.message); }
};

window.setInactiveDays = function(d, btn) {
  window.inactiveDays = d; document.querySelectorAll('#pane-inactive .btn-group .btn').forEach(function(b) { b.className = 'btn btn-sm btn-ghost'; });
  if (btn) btn.className = 'btn btn-sm btn-primary'; window.loadInactive(1);
};

window.loadInactive = async function(page = 1) {
  const tbody = document.getElementById('tbl-inactive-body'); if (!tbody) return;
  tbody.innerHTML = window._loadingRow(8);
  let pagContainer = document.getElementById('pagination-inactive');
  if(!pagContainer) { const wrap = document.querySelector('#pane-inactive .table-card'); pagContainer = document.createElement('div'); pagContainer.id = 'pagination-inactive'; wrap.appendChild(pagContainer); }
  
  try {
    const res  = await window.api('getInactiveCustomers', { options: { days: window.inactiveDays, page: page, pageSize: 50, search: window.searchQueries['inactive'] } });
    const rows = window._tableItems(res); window._renderPagination(res, 'loadInactive', 'pagination-inactive');
    const totalSqft = rows.reduce((s, r) => s + (r['SQ FT.'] || 0), 0);
    const kg = document.getElementById('inactive-kpi-grid');
    if (kg) {
        kg.innerHTML = '<div class="kpi-card stagger-1" style="--kpi-color:#f59e0b"><div class="kpi-header-row"><div class="kpi-icon" style="color:#f59e0b"><i class="ph ph-clock"></i></div><div class="kpi-label">Inactive Accounts</div></div><div class="kpi-value" style="font-size:24px;">' + window.fmt.num(rows.length) + '</div></div>'
        + '<div class="kpi-card stagger-1" style="--kpi-color:#ef4444"><div class="kpi-header-row"><div class="kpi-icon" style="color:#ef4444"><i class="ph ph-ruler"></i></div><div class="kpi-label">Lifetime SQ FT at Risk</div></div><div class="kpi-value" style="font-size:24px;">' + window.fmt.short(totalSqft) + '</div></div>';
    }
    window.App.lastTableData['inactive'] = rows;
    if (!rows.length) { tbody.innerHTML = window._emptyRow(8, 'No inactive customers found.'); return; }
    
    let htmlStr = '';
    rows.forEach(function(r, i) {
      const cat   = r['INACTIVE CATEGORY'] || '';
      const badge = cat.indexOf('180') !== -1 ? 'badge-red' : cat.indexOf('120') !== -1 ? 'badge-amber' : 'badge-blue';
      const idx = ((res.page - 1) * res.pageSize) + i + 1;
      htmlStr += '<tr><td style="padding:6px 12px;">' + idx + '</td><td style="font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-main);padding:6px 12px;">' + (r['CUSTOMER NAME'] || '-') + '</td><td style="padding:6px 12px;">' + (r['STATE'] || '-') + '</td><td style="padding:6px 12px;">' + window.fmt.date(r['LAST PURCHASE DATE']) + '</td><td style="font-weight:700;color:var(--danger);padding:6px 12px;">' + (r['DAYS SINCE LAST PURCHASE'] || 0) + 'd</td><td style="padding:6px 12px;">' + window.fmt.num(r['SQ FT.']) + '</td><td style="padding:6px 12px;">' + window.fmt.num(r['TRANSACTION COUNT']) + '</td><td style="padding:6px 12px;"><span class="badge ' + badge + '" style="white-space:nowrap">' + (cat || '-') + '</span></td></tr>';
    });
    tbody.innerHTML = htmlStr;
  } catch(e) { tbody.innerHTML = window._errorRow(8, e.message); }
};

window.loadDeclining = async function(page = 1) {
  const tbody = document.getElementById('tbl-declining-body'); if (!tbody) return;
  tbody.innerHTML = window._loadingRow(8);
  let pagContainer = document.getElementById('pagination-declining');
  if(!pagContainer) { const wrap = document.querySelector('#pane-declining .table-card'); pagContainer = document.createElement('div'); pagContainer.id = 'pagination-declining'; wrap.appendChild(pagContainer); }
  
  try {
    const res  = await window.api('getDecliningCustomers', { options: { page: page, pageSize: 50, search: window.searchQueries['declining'] } });
    const rows = window._tableItems(res); window._renderPagination(res, 'loadDeclining', 'pagination-declining');
    const totalDrop = rows.reduce((s, r) => s + Math.abs((r['SQM CHANGE'] || 0) * 10.76391), 0);
    const kg = document.getElementById('declining-kpi-grid');
    if (kg) {
        kg.innerHTML = '<div class="kpi-card stagger-1" style="--kpi-color:#ef4444"><div class="kpi-header-row"><div class="kpi-icon" style="color:#ef4444"><i class="ph ph-trend-down"></i></div><div class="kpi-label">Declining Accounts</div></div><div class="kpi-value" style="font-size:24px;">' + window.fmt.num(rows.length) + '</div></div>'
        + '<div class="kpi-card stagger-1" style="--kpi-color:#f97316"><div class="kpi-header-row"><div class="kpi-icon" style="color:#f97316"><i class="ph ph-ruler"></i></div><div class="kpi-label">Total SQ FT Dropped</div></div><div class="kpi-value" style="font-size:24px;">' + window.fmt.short(totalDrop) + '</div></div>';
    }
    if (window.tableSortRules['declining'] && window.tableSortRules['declining'].length > 0) {
      rows = window.applyMultiSort(rows, 'declining');
    }
    window.App.lastTableData['declining'] = rows;
    if (!rows.length) { tbody.innerHTML = window._emptyRow(8, 'No declining customers found.'); return; }
    
    let htmlStr = '';
    rows.forEach(function(r, i) {
      const pct   = r['DECLINE %'] || 0; const cat   = r['DECLINE CATEGORY'] || '';
      const badge = cat.indexOf('Critical') !== -1 ? 'badge-red' : cat.indexOf('Severe') !== -1 ? 'badge-amber' : 'badge-purple';
      const idx = ((res.page - 1) * res.pageSize) + i + 1;
      htmlStr += '<tr><td style="padding:6px 12px;">' + idx + '</td><td style="font-weight:600;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-main);padding:6px 12px;">' + (r['CUSTOMER NAME'] || '-') + '</td><td style="padding:6px 12px;">' + (r['STATE'] || '-') + '</td><td style="padding:6px 12px;">' + window.fmt.num((r['PREV 6M SQM'] || 0) * 10.76391) + '</td><td style="padding:6px 12px;">' + window.fmt.num((r['LAST 6M SQM'] || 0) * 10.76391) + '</td><td style="color:var(--danger);font-weight:700;padding:6px 12px;">' + window.fmt.num((r['SQM CHANGE'] || 0) * 10.76391) + '</td><td style="color:var(--danger);font-weight:800;padding:6px 12px;">' + pct.toFixed(1) + '%</td><td style="padding:6px 12px;"><span class="badge ' + badge + '" style="white-space:nowrap">' + (cat || '-') + '</span></td></tr>';
    });
    tbody.innerHTML = htmlStr;
  } catch(e) { tbody.innerHTML = window._errorRow(8, e.message); }
};

window.loadLostHV = async function(page = 1) {
  const tbody = document.getElementById('tbl-losthv-body'); if (!tbody) return;
  tbody.innerHTML = window._loadingRow(7);
  let pagContainer = document.getElementById('pagination-losthv');
  if(!pagContainer) { const wrap = document.querySelector('#pane-losthv .table-card'); pagContainer = document.createElement('div'); pagContainer.id = 'pagination-losthv'; wrap.appendChild(pagContainer); }
  
  try {
    const res  = await window.api('getLostHVCustomers', { options: { page: page, pageSize: 50, search: window.searchQueries['losthv'] } });
    const rows = window._tableItems(res); window._renderPagination(res, 'loadLostHV', 'pagination-losthv');
    const totalSqft = rows.reduce((s, r) => s + (r['SQ FT.'] || 0), 0);
    const kg = document.getElementById('losthv-kpi-grid');
    if (kg) {
        kg.innerHTML = '<div class="kpi-card stagger-1" style="--kpi-color:#ef4444"><div class="kpi-header-row"><div class="kpi-icon" style="color:#ef4444"><i class="ph ph-x-circle"></i></div><div class="kpi-label">Lost Accounts</div></div><div class="kpi-value" style="font-size:24px;">' + window.fmt.num(rows.length) + '</div></div>'
        + '<div class="kpi-card stagger-1" style="--kpi-color:#a855f7"><div class="kpi-header-row"><div class="kpi-icon" style="color:#a855f7"><i class="ph ph-ruler"></i></div><div class="kpi-label">Lifetime SQ FT Lost</div></div><div class="kpi-value" style="font-size:24px;">' + window.fmt.short(totalSqft) + '</div></div>';
    }
    window.App.lastTableData['losthv'] = rows;
    if (!rows.length) { tbody.innerHTML = window._emptyRow(7, 'No lost high-value customers found.'); return; }
    
    let htmlStr = '';
    rows.forEach(function(r, i) {
      const idx = ((res.page - 1) * res.pageSize) + i + 1;
      htmlStr += '<tr><td style="padding:6px 12px;">' + idx + '</td><td style="font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-main);padding:6px 12px;">' + (r['CUSTOMER NAME'] || '-') + '</td><td style="padding:6px 12px;">' + (r['STATE'] || '-') + '</td><td style="font-weight:700;color:var(--brand-primary);padding:6px 12px;">' + window.fmt.num(r['SQ FT.']) + '</td><td style="padding:6px 12px;">' + window.fmt.date(r['LAST PURCHASE DATE']) + '</td><td style="color:var(--danger);font-weight:700;padding:6px 12px;">' + (r['DAYS INACTIVE'] || 0) + 'd</td><td style="padding:6px 12px;"><span class="badge badge-purple">Top ' + (100 - (r['SQM PERCENTILE'] || 0)) + '%</span></td></tr>';
    });
    tbody.innerHTML = htmlStr;
  } catch(e) { tbody.innerHTML = window._errorRow(7, e.message); }
};

window.setRfmSeg = function(s, btn) {
  window.rfmSegFilter = s; document.querySelectorAll('#page-rfm .btn-group .btn').forEach(function(b) { b.className = 'btn btn-sm btn-ghost'; });
  if (btn) btn.className = 'btn btn-sm btn-primary'; window.loadRFM(1);
};

window.loadRFM = async function(page = 1) {
  const tbody = document.getElementById('tbl-rfm-body'); if (!tbody) return;
  tbody.innerHTML = window._loadingRow(8);
  let pagContainer = document.getElementById('pagination-rfm');
  if(!pagContainer) { const wrap = document.querySelector('#page-rfm .table-card'); pagContainer = document.createElement('div'); pagContainer.id = 'pagination-rfm'; wrap.appendChild(pagContainer); }
  
  try {
    const dist = await window.api('getRFMDistribution'); const kg = document.getElementById('rfm-kpi-grid');
    if(kg && dist) {
       let champ = 0, loyal = 0, risk = 0, lost = 0;
       dist.forEach(d => { if(d.segment === 'Champions') champ = d.count; if(d.segment === 'Loyal') loyal = d.count; if(d.segment === 'At Risk') risk = d.count; if(d.segment === 'Lost') lost = d.count; });
       kg.innerHTML = '<div class="kpi-card stagger-1" style="--kpi-color:#10b981"><div class="kpi-header-row"><div class="kpi-icon" style="color:#10b981"><i class="ph ph-crown"></i></div><div class="kpi-label">Champions</div></div><div class="kpi-value" style="font-size:24px;">' + window.fmt.num(champ) + '</div><div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:auto;">high value, recent</div></div>'
        + '<div class="kpi-card stagger-1" style="--kpi-color:#38bdf8"><div class="kpi-header-row"><div class="kpi-icon" style="color:#38bdf8"><i class="ph ph-users"></i></div><div class="kpi-label">Loyal</div></div><div class="kpi-value" style="font-size:24px;">' + window.fmt.num(loyal) + '</div><div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:auto;">consistent buyers</div></div>'
        + '<div class="kpi-card stagger-1" style="--kpi-color:#f59e0b"><div class="kpi-header-row"><div class="kpi-icon" style="color:#f59e0b"><i class="ph ph-warning-circle"></i></div><div class="kpi-label">At Risk</div></div><div class="kpi-value" style="font-size:24px;">' + window.fmt.num(risk) + '</div><div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:auto;">slipping away</div></div>'
        + '<div class="kpi-card stagger-1" style="--kpi-color:#ef4444"><div class="kpi-header-row"><div class="kpi-icon" style="color:#ef4444"><i class="ph ph-x-circle"></i></div><div class="kpi-label">Lost</div></div><div class="kpi-value" style="font-size:24px;">' + window.fmt.num(lost) + '</div><div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:auto;">churned customers</div></div>';
    }
    
    const res  = await window.api('getRFMData', { options: { segment: window.rfmSegFilter, page: page, pageSize: 50, search: window.searchQueries['rfm'] } });
    const rows = window._tableItems(res); window._renderPagination(res, 'loadRFM', 'pagination-rfm');
    if (window.tableSortRules['rfm'] && window.tableSortRules['rfm'].length > 0) {
      rows = window.applyMultiSort(rows, 'rfm');
    }
    window.App.lastTableData['rfm'] = rows;
    if (!rows.length) { tbody.innerHTML = window._emptyRow(8, 'No RFM data found.'); return; }
    
    let htmlStr = ''; const segColors = { Champions: 'badge-green', Loyal: 'badge-blue', 'At Risk': 'badge-amber', Hibernating: 'badge-purple', Lost: 'badge-red' };
    rows.forEach(function(r, i) {
      const seg   = r['SEGMENT'] || '-'; const badge = segColors[seg] || 'badge-gray'; const idx = ((res.page - 1) * res.pageSize) + i + 1;
      htmlStr += '<tr><td style="padding:6px 12px;">' + idx + '</td><td style="font-weight:600;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-main);padding:6px 12px;">' + (r['CUSTOMER NAME'] || '-') + '</td><td style="padding:6px 12px;">' + (r['STATE'] || '-') + '</td><td style="font-size:11px;color:var(--text-muted);padding:6px 12px;">' + (r['RECENCY (DAYS)'] || 0) + 'd ago · ' + (r['FREQUENCY'] || 0) + ' orders</td><td style="font-weight:700;color:var(--text-main);padding:6px 12px;">' + window.fmt.num(r['SQ FT.']) + '</td><td style="font-size:11px;font-weight:600;padding:6px 12px;"><span style="color:var(--accent)">R' + (r['R SCORE']||0) + '</span> <span style="color:var(--accent3)">F' + (r['F SCORE']||0) + '</span> <span style="color:var(--accent2)">M' + (r['M SCORE']||0) + '</span></td><td style="font-weight:800;color:var(--text-main);padding:6px 12px;">' + (r['RFM TOTAL'] || 0) + '</td><td style="padding:6px 12px;"><span class="badge ' + badge + '">' + seg + '</span></td></tr>';
    });
    tbody.innerHTML = htmlStr;
  } catch(e) { tbody.innerHTML = window._errorRow(8, e.message); }
};

window.categoricalGroupBy = 'FINISH';

window.setCategoricalGroup = function(g, btn) {
  window.categoricalGroupBy = g;
  document.querySelectorAll('#cat-group-toggles .btn').forEach(b => b.className = 'btn btn-sm btn-ghost');
  if (btn) btn.className = 'btn btn-sm btn-primary';
  const th = document.getElementById('th-cat-group');
  if (th) th.innerText = g === 'THICKNESS TYPE' ? 'Thickness' : g === 'PRODUCT TYPE' ? 'Product Type' : g === 'SKU TYPE' ? 'SKU Type' : 'Finish';
  window.loadCategoricalPerformance();
};

window.setTimeWiseGroup = function(g, btn) {
  window.App.timeWiseGroupBy = g;
  if (btn) {
    const btns = document.getElementById('timewise-group-toggles').querySelectorAll('button');
    btns.forEach(b => b.className = 'btn btn-sm btn-ghost');
    btn.className = 'btn btn-sm btn-primary';
  }
  window.loadTimeWiseSales();
};

window.loadTimeWiseSales = async function() {
  const tb = document.getElementById('tbl-product-body');
  const thead = document.getElementById('th-product-head');
  if (!tb || !thead) return;
  
  const timeGb = window.App.timeWiseGroupBy || 'quarter';
  const rowGbSelect = document.getElementById('pivot-row-group');
  const rowGb = rowGbSelect ? rowGbSelect.value : 'product_type';
  
  tb.innerHTML = window._loadingRow(6);
  
  try {
    const payload = await window.api('getProductPivotSales', { options: { timeGroup: timeGb, rowGroup: rowGb } });
    let cols = payload.columns || [];
    let data = payload.rows || [];
    
    if (!data || data.length === 0) {
      tb.innerHTML = window._emptyRow(6, 'No sales data found for this period.');
      return;
    }
    
    let displayCols = cols.slice().reverse(); // Newest first
    
    if (window.comparisonMode === 'pop') {
        displayCols = displayCols.slice(0, 2);
    } else if (window.comparisonMode === 'yoy') {
        if (displayCols.length > 0) {
           const current = displayCols[0];
           const prevYearStr = current.replace(/\d{2}-\d{2}/, function(match) {
               const parts = match.split('-');
               return (parseInt(parts[0]) - 1) + '-' + (parseInt(parts[1]) - 1);
           });
           if (cols.indexOf(prevYearStr) !== -1) {
               displayCols = [current, prevYearStr];
           } else if (cols.length >= 5 && timeGb === 'quarter') {
               displayCols = [current, displayCols[4]]; 
           } else if (cols.length >= 13 && timeGb === 'month') {
               displayCols = [current, displayCols[12]];
           } else {
               displayCols = [current];
           }
        }
    }
    
    if (window.comparisonMode !== 'none' && displayCols.length >= 2) {
        data = data.filter(function(r) { 
            return Math.abs(r[displayCols[0]] || 0) > 0.001 || Math.abs(r[displayCols[1]] || 0) > 0.001; 
        });
    }
    
    let rowLabel = 'Category';
    if (rowGb === 'finish') rowLabel = 'Finish';
    else if (rowGb === 'product_type') rowLabel = 'Product Type';
    else if (rowGb === 'sku_type') rowLabel = 'SKU Type';
    else if (rowGb === 'brand') rowLabel = 'Brand';

    if (window.tableSortRules['product'] && window.tableSortRules['product'].length > 0) {
      data = window.applyMultiSort(data, 'product');
    }
    
    const stickyN   = 'position:sticky;left:0;z-index:3;background:var(--brand-primary);width:44px;padding:8px 12px;';
    const stickyCAT = 'position:sticky;left:44px;z-index:3;background:var(--brand-primary);min-width:180px;max-width:180px;padding:8px 12px;border-right:1px solid var(--border);';
    
    const stickyRowN   = 'position:sticky;left:0;z-index:1;background:var(--bg-card);width:44px;padding:6px 12px;';
    const stickyRowCAT = 'position:sticky;left:44px;z-index:1;background:var(--bg-card);min-width:180px;max-width:180px;padding:6px 12px;border-right:1px solid var(--border);';
    
    let trHead = '<tr><th style="' + stickyN + '">#</th><th style="' + stickyCAT + '">' + rowLabel + '</th>';
    if (window.comparisonMode === 'none') {
        trHead += '<th style="text-align:right; font-weight:800; color:var(--brand-primary); min-width:120px; padding:8px 12px; border-right:1px solid rgba(255,255,255,0.1);">TOTAL (SQ FT)</th>';
    }
    displayCols.forEach((c, i) => { 
        let sub = '';
        if (i === 0) sub = 'latest';
        else if (window.comparisonMode === 'pop') sub = 'prev';
        else if (window.comparisonMode === 'yoy') sub = '1 yr ago';
        const hasVar = (window.comparisonMode !== 'none' && i + 1 < displayCols.length);
        if (window._hodTh) {
           trHead += window._hodTh(c, i === 0, sub, hasVar);
        } else {
           trHead += '<th style="text-align:right;">' + c + '</th>';
        }
    });
    trHead += '</tr>';
    thead.innerHTML = trHead;
    
    let html = '';
    data.forEach((r, i) => {
      let tr = '<tr><td style="' + stickyRowN + '">' + (i + 1) + '</td><td style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-main);' + stickyRowCAT + '">' + (r.CATEGORY || 'Unknown') + '</td>';
      if (window.comparisonMode === 'none') {
          tr += '<td style="text-align:right; font-weight:800; white-space:nowrap; color:var(--brand-primary); padding:6px 12px; border-right:1px solid var(--border);">' + window.fmt.num(r.TOTAL_SQFT || 0) + '</td>';
      }
      displayCols.forEach((c, mi) => {
         const val = r[c] || 0;
         if (window._hodTd) {
             let prevVal;
             if (window.comparisonMode !== 'none' && (mi + 1 < displayCols.length)) {
                 prevVal = r[displayCols[mi + 1]] || 0;
             }
             tr += window._hodTd(val, mi === 0, prevVal);
         } else {
             tr += '<td style="text-align:right; white-space:nowrap;">' + window.fmt.num(val) + '</td>';
         }
      });
      tr += '</tr>';
      html += tr;
    });
    tb.innerHTML = html;
  } catch (err) {
    tb.innerHTML = window._errorRow(6, err.message || err);
  }
};

window.setHodSkuTimeGroup = function(mode, btn) {
  window.App.hodSkuTimeGroup = mode;
  document.querySelectorAll('#hodsku-group-toggles .btn').forEach(b => b.className = 'btn btn-sm btn-ghost');
  if (btn) btn.className = 'btn btn-sm btn-primary';
  window.loadHodSkuSales();
};

window.loadHodSkuSales = async function() {
  const tb = document.getElementById('tbl-hodsku-body');
  const thead = document.getElementById('th-hodsku-head');
  if (!tb || !thead) return;
  
  const timeGb = window.App.hodSkuTimeGroup || 'quarter';
  tb.innerHTML = window._loadingRow(10);
  
  try {
    const payload = await window.api('getHodSkuPivotSales', { options: { timeGroup: timeGb } });
    let cols = payload.columns || [];
    let rawData = payload.rows || [];
    
    if (!rawData || rawData.length === 0) {
      tb.innerHTML = window._emptyRow(10, 'No sales data found for this period.');
      return;
    }
    
    let displayCols = cols.slice().reverse();
    if (window.comparisonMode === 'pop') {
        displayCols = displayCols.slice(0, 2);
    } else if (window.comparisonMode === 'yoy') {
        if (displayCols.length > 0) {
           const current = displayCols[0];
           const prevYearStr = current.replace(/\d{2}-\d{2}/, function(match) {
               const parts = match.split('-');
               return (parseInt(parts[0]) - 1) + '-' + (parseInt(parts[1]) - 1);
           });
           if (cols.indexOf(prevYearStr) !== -1) {
               displayCols = [current, prevYearStr];
           } else if (cols.length >= 5 && timeGb === 'quarter') {
               displayCols = [current, displayCols[4]]; 
           } else if (cols.length >= 13 && timeGb === 'month') {
               displayCols = [current, displayCols[12]];
           } else {
               displayCols = [current];
           }
        }
    }
    
    const skuSet = new Set();
    rawData.forEach(r => { if (r.SKU && r.SKU !== 'Unknown') skuSet.add(r.SKU); });
    const skus = Array.from(skuSet).sort();
    
    const hodMap = {};
    rawData.forEach(r => {
        if (!r.HOD) return;
        if (!hodMap[r.HOD]) {
            hodMap[r.HOD] = { HOD: r.HOD, totalSqftByPeriod: {} };
            displayCols.forEach(c => hodMap[r.HOD].totalSqftByPeriod[c] = 0);
            skus.forEach(s => hodMap[r.HOD][s] = {});
        }
        if (hodMap[r.HOD][r.SKU]) {
            displayCols.forEach(c => {
                const val = r[c] || 0;
                hodMap[r.HOD][r.SKU][c] = val;
                hodMap[r.HOD].totalSqftByPeriod[c] += val;
            });
        }
    });
    
    let hodList = Object.values(hodMap);
    if (window.comparisonMode !== 'none' && displayCols.length >= 2) {
        hodList = hodList.filter(h => {
            return h.totalSqftByPeriod[displayCols[0]] > 0.001 || h.totalSqftByPeriod[displayCols[1]] > 0.001;
        });
    }
    
    hodList.sort((a, b) => {
        const latest = displayCols[0];
        return (b.totalSqftByPeriod[latest] || 0) - (a.totalSqftByPeriod[latest] || 0);
    });
    
    const stickyN   = 'position:sticky;left:0;z-index:20;background:var(--brand-primary);width:44px;padding:8px 12px;';
    const stickyHOD = 'position:sticky;left:44px;z-index:20;background:var(--brand-primary);min-width:180px;max-width:180px;padding:8px 12px;border-right:1px solid var(--border);';
    
    const stickyRowN   = 'position:sticky;left:0;z-index:10;background:var(--bg-card);width:44px;padding:6px 12px;';
    const stickyRowHOD = 'position:sticky;left:44px;z-index:10;background:var(--bg-card);min-width:180px;max-width:180px;padding:6px 12px;border-right:1px solid var(--border);color:var(--text-main);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    
    let trHead1 = '<tr><th style="' + stickyN + ' border-bottom:none;">#</th><th style="' + stickyHOD + ' border-bottom:none;">HOD</th>';
    let trHead2 = '<tr><th style="' + stickyN + ' border-top:none; padding:0;"></th><th style="' + stickyHOD + ' border-top:none; padding:0;"></th>';
    
    displayCols.forEach((c, i) => { 
        let sub = '';
        if (i === 0) sub = 'latest';
        else if (window.comparisonMode === 'pop') sub = 'prev';
        else if (window.comparisonMode === 'yoy') sub = '1 yr ago';
        const hasVar = (window.comparisonMode !== 'none' && i + 1 < displayCols.length);
        
        if (window._hodTh) {
           const thRaw = window._hodTh(c, i === 0, sub, hasVar);
           trHead1 += thRaw.replace('<th', '<th colspan="' + skus.length + '" style="text-align:center; border-left:1px solid var(--border);"');
        } else {
           trHead1 += '<th colspan="' + skus.length + '" style="text-align:center; border-left:1px solid var(--border);">' + c + '</th>';
        }
        
        skus.forEach((s, si) => {
            let borderStyle = (si === 0) ? 'border-left:1px solid var(--border);' : '';
            trHead2 += '<th style="text-align:right; font-size:11px; padding:6px 8px; color:var(--text-muted); background:var(--bg-elevated); ' + borderStyle + '">' + s + ' %</th>';
        });
    });
    trHead1 += '</tr>';
    trHead2 += '</tr>';
    thead.innerHTML = trHead1 + trHead2;
    
    let html = '';
    hodList.forEach((h, i) => {
      let tr = '<tr><td style="' + stickyRowN + '">' + (i + 1) + '</td><td style="' + stickyRowHOD + '" title="' + h.HOD + '">' + h.HOD + '</td>';
      
      displayCols.forEach((c, mi) => {
         const total = h.totalSqftByPeriod[c] || 0;
         
         skus.forEach((s, si) => {
             const val = h[s][c] || 0;
             let pctStr = '-';
             let pctRaw = 0;
             if (total > 0.001) {
                 pctRaw = (val / total) * 100;
                 pctStr = pctRaw.toFixed(1) + '%';
             }
             
             let colorStyle = '';
             if (pctRaw > 50) colorStyle = 'color:var(--success); font-weight:600;';
             else if (pctRaw > 20) colorStyle = 'color:var(--text-main); font-weight:500;';
             else colorStyle = 'color:var(--text-muted);';
             
             let borderStyle = (si === 0) ? 'border-left:1px solid var(--border);' : '';
             
             tr += '<td style="text-align:right; white-space:nowrap; ' + borderStyle + colorStyle + '">' + pctStr + '</td>';
         });
      });
      tr += '</tr>';
      html += tr;
    });
    tb.innerHTML = html;
  } catch (err) {
    tb.innerHTML = window._errorRow(10, err.message || err);
  }
};

window.loadBrandFinish = async function() {
  const kg = document.getElementById('prod-kpi-grid');
  if (kg) kg.innerHTML = window._loadingRow(1);
  try {
    const [finishes, thicks, prods, skus] = await Promise.all([
      window.api('getCategoricalPerformance', { options: { groupBy: 'FINISH' } }),
      window.api('getCategoricalPerformance', { options: { groupBy: 'THICKNESS TYPE' } }),
      window.api('getCategoricalPerformance', { options: { groupBy: 'PRODUCT TYPE' } }),
      window.api('getCategoricalPerformance', { options: { groupBy: 'SKU TYPE' } })
    ]);
    
    let totalSqft = 0, totalRev = 0, totalTxns = 0;
    finishes.forEach(f => { totalSqft += f.TOTAL_SQFT; totalRev += f.NET_REVENUE; totalTxns += f.TXN_COUNT; });
    
    const topFinish = finishes.length ? finishes[0].CATEGORY : '-';
    const topThick = thicks.length ? thicks[0].CATEGORY : '-';
    const topProd = prods.length ? prods[0].CATEGORY : '-';
    
    let stdSqft = 0;
    skus.forEach(s => { if(s.CATEGORY.indexOf('STANDARD') !== -1) stdSqft += s.TOTAL_SQFT; });
    const stdMix = totalSqft > 0 ? ((stdSqft / totalSqft) * 100).toFixed(1) + '%' : '0%';

    if (kg) {
      kg.innerHTML = 
          '<div class="kpi-card stagger-1" style="--kpi-color:#10b981"><div class="kpi-header-row"><div class="kpi-icon" style="color:#10b981"><i class="ph ph-ruler"></i></div><div class="kpi-label">Total SQ FT</div></div><div class="kpi-value" style="font-size:24px;">' + window.fmt.short(totalSqft) + '</div></div>'
        + '<div class="kpi-card stagger-1" style="--kpi-color:#a855f7"><div class="kpi-header-row"><div class="kpi-icon" style="color:#a855f7"><i class="ph ph-receipt"></i></div><div class="kpi-label">Total Revenue</div></div><div class="kpi-value" style="font-size:24px;">' + window.fmt.currency(totalRev) + '</div></div>'
        + '<div class="kpi-card stagger-1" style="--kpi-color:#f59e0b"><div class="kpi-header-row"><div class="kpi-icon" style="color:#f59e0b"><i class="ph ph-stack"></i></div><div class="kpi-label">Top Prod Type</div></div><div class="kpi-value" style="font-size:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + topProd + '</div></div>'
        + '<div class="kpi-card stagger-1" style="--kpi-color:#ec4899"><div class="kpi-header-row"><div class="kpi-icon" style="color:#ec4899"><i class="ph ph-paint-bucket"></i></div><div class="kpi-label">Top Finish</div></div><div class="kpi-value" style="font-size:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + topFinish + '</div></div>'
        + '<div class="kpi-card stagger-1" style="--kpi-color:#38bdf8"><div class="kpi-header-row"><div class="kpi-icon" style="color:#38bdf8"><i class="ph ph-line-segments"></i></div><div class="kpi-label">Top Thickness</div></div><div class="kpi-value" style="font-size:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + topThick + '</div></div>'
        + '<div class="kpi-card stagger-1" style="--kpi-color:#4f46e5"><div class="kpi-header-row"><div class="kpi-icon" style="color:#4f46e5"><i class="ph ph-star"></i></div><div class="kpi-label">Standard Mix</div></div><div class="kpi-value" style="font-size:24px;">' + stdMix + '</div></div>';
    }
    
    window.App.catDataCache = { 'FINISH': finishes, 'THICKNESS TYPE': thicks, 'PRODUCT TYPE': prods, 'SKU TYPE': skus };
    window.loadCategoricalPerformance();
    
  } catch(e) { if(kg) kg.innerHTML = window._errorRow(1, e.message); }
};

window.loadCategoricalPerformance = function() {
  const tbody = document.getElementById('tbl-cat-body'); if (!tbody) return;
  const data = window.App.catDataCache ? window.App.catDataCache[window.categoricalGroupBy] : null;
  if (!data || !data.length) { tbody.innerHTML = window._emptyRow(8, 'No data found.'); return; }
  
  const sq = (window.searchQueries['categorical'] || '').toLowerCase(); let rows = data;
  if(sq) rows = rows.filter(r => (r.CATEGORY||'').toLowerCase().includes(sq));
  
  const totalSqft = rows.reduce((s, b) => s + (b.TOTAL_SQFT || 0), 0);
  window.App.lastTableData['categorical'] = rows;
  
  let htmlStr = '';
  rows.forEach(function(r, i) {
    const share = totalSqft > 0 ? ((r.TOTAL_SQFT / totalSqft) * 100).toFixed(1) : '0.0';
    htmlStr += '<tr><td style="padding:6px 12px;">' + (i + 1) + '</td><td style="font-weight:700;color:var(--text-main);padding:6px 12px;">' + (r.CATEGORY || '-') + '</td><td style="font-weight:700;color:var(--brand-primary);padding:6px 12px;">' + window.fmt.num(r.TOTAL_SQFT) + '</td><td style="padding:6px 12px;"><div style="display:flex;align-items:center;gap:8px"><div style="height:5px;width:' + Math.min(80, Math.round(parseFloat(share))) + 'px;background:var(--accent2);border-radius:100px"></div><span style="font-size:11.5px;font-weight:600;color:var(--text-muted)">' + share + '%</span></div></td><td style="padding:6px 12px;">' + window.fmt.num(r.TOTAL_SQM) + '</td><td style="padding:6px 12px;">' + window.fmt.num(r.TOTAL_QTY) + '</td><td style="padding:6px 12px;">' + window.fmt.num(r.TXN_COUNT) + '</td><td style="font-weight:600;padding:6px 12px;">' + window.fmt.currency(r.NET_REVENUE) + '</td></tr>';
  });
  tbody.innerHTML = htmlStr;
};

window._cDefaults = function(extra) {
  extra = extra || {};
  const scales = Object.assign({ x: { ticks: { color: window.tc(), font: { size: 11.5, family: 'Inter', weight: 600 } }, grid: { color: window.gc(), drawBorder: false } }, y: { ticks: { color: window.tc(), font: { size: 11.5, family: 'Inter', weight: 600 } }, grid: { color: window.gc(), drawBorder: false } } }, extra.scales || {});
  return Object.assign({
    responsive: true, maintainAspectRatio: false, animation: { duration: 700, easing: 'easeOutQuart' }, interaction: { mode: 'index', intersect: false },
    plugins: { legend: { labels: { color: window.tc(), font: { size: 11.5, family: 'Inter', weight: 700 }, usePointStyle: true, boxWidth: 8, padding: 16 } }, tooltip: { backgroundColor: window.ttBg(), titleColor: window.ttTitle(), bodyColor: window.tc(), borderColor: window.ttBorder(), borderWidth: 1, padding: 12, cornerRadius: 10, titleFont: { size: 13, family: 'Inter', weight: 700 }, bodyFont: { size: 12, family: 'Inter', weight: 600 } } },
    scales: scales
  }, extra);
};

window.renderBrandChart = function(brands) {
  if (typeof Chart === 'undefined') return;
  const ctx = document.getElementById('chart-brand'); if (!ctx) return;
  const top = brands.slice(0, 8);
  const palette = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#38bdf8', '#8b5cf6'];
  
  const allFinishes = new Set();
  top.forEach(b => { if(b.finishes) Object.keys(b.finishes).forEach(f => allFinishes.add(f)); });
  const fList = Array.from(allFinishes);
  
  const datasets = fList.map((fn, i) => {
    return {
      label: fn,
      data: top.map(b => (b.finishes && b.finishes[fn]) ? b.finishes[fn] : 0),
      backgroundColor: palette[i % palette.length],
      borderRadius: 4
    };
  });

  if (window.App.charts.brand) {
      window.App.charts.brand.data.labels = top.map(b => b.BRAND);
      window.App.charts.brand.data.datasets = datasets;
      window.App.charts.brand.update('none'); 
  } else {
      window.App.charts.brand = new Chart(ctx, {
        type: 'bar',
        data: { labels: top.map(b => b.BRAND), datasets: datasets },
        options: window._cDefaults({ 
          scales: { 
            x: { stacked: true, ticks: { color: window.tc(), font: { size: 11, weight: 600 } }, grid: { display: false } }, 
            y: { stacked: true, ticks: { color: window.tc(), font: { size: 11, weight: 600 }, callback: function(v) { return window.fmtK(v); } }, grid: { color: window.gc(), drawBorder: false } } 
          }, 
          plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: {size: 11, weight: 600}, color: window.tc() } }, tooltip: { mode: 'index', intersect: false } } 
        })
      });
  }
};

window.renderFinishChart = function(finishes) {
  if (typeof Chart === 'undefined') return;
  const ctx = document.getElementById('chart-finish'); if (!ctx) return;
  const palette = ['#38bdf8','#a855f7','#10b981','#f59e0b','#ef4444','#ec4899','#6366f1','#14b8a6'];
  if (window.App.charts.finish) {
      window.App.charts.finish.data.labels = finishes.map(f => f.FINISH); window.App.charts.finish.data.datasets[0].data = finishes.map(f => f.TOTAL_SQFT); window.App.charts.finish.data.datasets[0].backgroundColor = finishes.map((_, i) => palette[i % palette.length]); window.App.charts.finish.update('none');
  } else {
      window.App.charts.finish = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: finishes.map(f => f.FINISH), datasets: [{ data: finishes.map(f => f.TOTAL_SQFT), backgroundColor: finishes.map((_, i) => palette[i % palette.length]), borderWidth: 2, borderColor: window.doughnutBorder(), hoverOffset: 6 }] },
        options: { cutout: '60%', responsive: true, maintainAspectRatio: false, plugins: { legend:  { position: 'right', labels: { color: window.tc(), font: { size: 11, family: 'Inter', weight: 600 }, usePointStyle: true, boxWidth: 8, padding: 12 } }, tooltip: { backgroundColor: window.ttBg(), titleColor: window.ttTitle(), bodyColor: window.tc(), borderColor: window.ttBorder(), borderWidth: 1, padding: 12, callbacks: { label: function(c) { return ' ' + c.label + ': ' + window.fmt.num(c.raw) + ' sq ft'; } } } } }
      });
  }
};

window.loadProductType = async function() {
  const tbody = document.getElementById('tbl-dim-body');
  const thead = document.getElementById('tbl-dim-head');
  if (!tbody || !thead) return;
  tbody.innerHTML = window._loadingRow(1);
  try {
    const dimData = await window.api('getDimensionalSummary');
    if (!dimData || !dimData.length) { tbody.innerHTML = window._emptyRow(1, 'No dimensional data.'); return; }
    window.App.lastTableData['dimensional'] = dimData;
    
    const sizes = Array.from(new Set(dimData.map(d => d.SIZE))).sort();
    const thicks = Array.from(new Set(dimData.map(d => d.THICKNESS))).sort();
    
    let headHtml = '<tr><th style="background:var(--bg-elevated);text-align:left;padding:8px 12px;border-bottom:1px solid var(--border)">Thickness / Size</th>';
    sizes.forEach(s => headHtml += '<th style="padding:8px 12px;border-bottom:1px solid var(--border)">' + s + '</th>');
    headHtml += '<th style="padding:8px 12px;border-bottom:1px solid var(--border)">Total</th></tr>';
    thead.innerHTML = headHtml;
    
    let bodyHtml = '';
    thicks.forEach(t => {
      let rowHtml = '<tr><td style="font-weight:700;text-align:left;background:var(--bg-elevated);padding:8px 12px;border-bottom:1px solid var(--border)">' + t + '</td>';
      let rowTotal = 0;
      sizes.forEach(s => {
        const cell = dimData.find(d => d.SIZE === s && d.THICKNESS === t);
        const val = cell ? cell.TOTAL_SQFT : 0;
        rowTotal += val;
        if (val > 0) rowHtml += '<td style="color:var(--brand-primary);font-weight:600;padding:8px 12px;border-bottom:1px solid var(--border)">' + window.fmt.num(val) + '</td>';
        else rowHtml += '<td style="color:var(--text-sub);padding:8px 12px;border-bottom:1px solid var(--border)">-</td>';
      });
      rowHtml += '<td style="font-weight:800;background:var(--bg-elevated);padding:8px 12px;border-bottom:1px solid var(--border)">' + window.fmt.num(rowTotal) + '</td></tr>';
      bodyHtml += rowHtml;
    });
    tbody.innerHTML = bodyHtml;
  } catch(e) { tbody.innerHTML = window._errorRow(1, e.message); }
};

window.renderProdTypeChart = function(rows) {
  if (typeof Chart === 'undefined') return;
  const ctx = document.getElementById('chart-prodtype'); if (!ctx) return;
  const palette = ['#38bdf8','#a855f7','#10b981','#f59e0b','#ef4444','#ec4899'];
  if (window.App.charts.prodtype) {
      window.App.charts.prodtype.data.labels = rows.map(r => r.PRODUCT_TYPE); window.App.charts.prodtype.data.datasets[0].data = rows.map(r => r.TOTAL_SQFT); window.App.charts.prodtype.data.datasets[0].backgroundColor = rows.map((_, i) => palette[i % palette.length]); window.App.charts.prodtype.update('none');
  } else {
      window.App.charts.prodtype = new Chart(ctx, {
        type: 'bar',
        data: { labels: rows.map(r => r.PRODUCT_TYPE), datasets: [{ label: 'SQ FT', data: rows.map(r => r.TOTAL_SQFT), backgroundColor: rows.map((_, i) => palette[i % palette.length]), borderRadius: 6 }] },
        options: window._cDefaults({ scales: { x: { ticks: { color: window.tc(), font: { size: 11, weight: 600 }, maxRotation: 35 }, grid: { display: false } }, y: { ticks: { color: window.tc(), font: { size: 11, weight: 600 }, callback: function(v) { return window.fmtK(v); } }, grid: { color: window.gc(), drawBorder: false } } }, plugins: { legend: { display: false } } })
      });
  }
};

window.setSkuBrand = function(b, btn) {
  window.skuBrandFilter = b; document.querySelectorAll('#sku-brand-filter .btn').forEach(function(x) { x.className = 'btn btn-sm btn-ghost'; });
  if (btn) btn.className = 'btn btn-sm btn-primary'; window.loadTopSKUs(1);
};

window.setSkuType = function(t, btn) {
  window.skuTypeFilter = t; document.querySelectorAll('#page-topsku .btn-group:last-of-type .btn').forEach(function(x) { x.className = 'btn btn-sm btn-ghost'; });
  if (btn) btn.className = 'btn btn-sm btn-primary'; window.loadTopSKUs(1);
};

window.loadTopSKUs = async function(page = 1) {
  const tbody = document.getElementById('tbl-topsku-body'); if (!tbody) return;
  tbody.innerHTML = window._loadingRow(11);
  let pagContainer = document.getElementById('pagination-topsku');
  if(!pagContainer) { const wrap = document.querySelector('#page-topsku .table-card'); pagContainer = document.createElement('div'); pagContainer.id = 'pagination-topsku'; wrap.appendChild(pagContainer); }
  
  try {
    if (page === 1) {
        const allForChart = await window.api('getTopSKUs', { options: { brand: window.skuBrandFilter, skuType: window.skuTypeFilter, pareto80: true, pageSize: 500 } });
        if(allForChart && allForChart.items) window.renderParetoChart(allForChart.items);
    }
    
    const res    = await window.api('getTopSKUs', { options: { brand: window.skuBrandFilter, skuType: window.skuTypeFilter, page: page, pageSize: 50, search: window.searchQueries['topsku'] } });
    const rows   = window._tableItems(res); const brands = (res && res.brands) ? res.brands : [];
    window._renderPagination(res, 'loadTopSKUs', 'pagination-topsku'); window.App.lastTableData['topsku'] = rows;
    
    const bf = document.getElementById('sku-brand-filter');
    if (bf && brands.length && bf.children.length <= 1) { 
      bf.innerHTML = '<button class="btn btn-sm ' + (window.skuBrandFilter === 'All' ? 'btn-primary' : 'btn-ghost') + '" onclick="window.setSkuBrand(\'All\',this)">All</button>';
      brands.forEach(function(b) { bf.innerHTML += '<button class="btn btn-sm ' + (window.skuBrandFilter === b ? 'btn-primary' : 'btn-ghost') + '" onclick="window.setSkuBrand(\'' + b + '\',this)">' + b + '</button>'; });
    }
    if (!rows.length) { tbody.innerHTML = window._emptyRow(11, 'No SKUs found.'); return; }
    
    let htmlStr = '';
    rows.forEach(function(r, i) {
      const skuBadge = (r.SKU_TYPE || '').indexOf('STANDARD') !== -1 ? 'badge-blue' : 'badge-gray'; const idx = ((res.page - 1) * res.pageSize) + i + 1;
      htmlStr += '<tr><td style="padding:6px 12px;">' + idx + '</td><td style="font-weight:700;font-size:12.5px;color:var(--text-main);padding:6px 12px;">' + (r.ITEM_CODE || '-') + '</td><td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;padding:6px 12px;">' + (r.ITEM_DESCRIPTION || '-') + '</td><td style="padding:6px 12px;">' + (r.BRAND || '-') + '</td><td style="padding:6px 12px;">' + (r.FINISH || '-') + '</td><td style="padding:6px 12px;">' + (r.SIZE || '-') + '</td><td style="padding:6px 12px;"><span class="badge ' + skuBadge + '">' + (r.SKU_TYPE || '-') + '</span></td><td style="font-weight:700;color:var(--brand-primary);padding:6px 12px;">' + window.fmt.num(r.TOTAL_SQFT) + '</td><td style="padding:6px 12px;">' + window.fmt.num(r.TOTAL_SQM) + '</td><td style="padding:6px 12px;">' + window.fmt.num(r.TOTAL_QTY) + '</td><td style="padding:6px 12px;">' + window.fmt.num(r.TXN_COUNT) + '</td></tr>';
    });
    tbody.innerHTML = htmlStr;
  } catch(e) { tbody.innerHTML = window._errorRow(11, e.message); }
};

window.renderParetoChart = function(rows) {
  if (typeof Chart === 'undefined') return;
  const ctx = document.getElementById('chart-sku-pareto'); if (!ctx) return;
  
  let tot = 0; rows.forEach(r => tot += r.TOTAL_SQFT);
  let run = 0;
  const cumData = rows.map(r => { run += r.TOTAL_SQFT; return (run/tot)*100; });
  
  const chartRows = rows.slice(0, 30);
  const chartCum = cumData.slice(0, 30);
  
  if (window.App.charts.pareto) {
      window.App.charts.pareto.data.labels = chartRows.map(r => r.ITEM_CODE);
      window.App.charts.pareto.data.datasets[0].data = chartCum;
      window.App.charts.pareto.data.datasets[1].data = chartRows.map(r => r.TOTAL_SQFT);
      window.App.charts.pareto.update('none');
  } else {
      window.App.charts.pareto = new Chart(ctx, {
        type: 'bar',
        data: { 
          labels: chartRows.map(r => r.ITEM_CODE), 
          datasets: [
            { type: 'line', label: 'Cumulative %', data: chartCum, borderColor: '#ec4899', backgroundColor: '#ec4899', borderWidth: 2, pointRadius: 3, yAxisID: 'y1' },
            { type: 'bar', label: 'SQ FT', data: chartRows.map(r => r.TOTAL_SQFT), backgroundColor: 'rgba(79,70,229,0.8)', hoverBackgroundColor: '#4f46e5', borderRadius: 4, yAxisID: 'y' }
          ] 
        },
        options: window._cDefaults({ 
          scales: { 
            x: { ticks: { color: window.tc(), font: { size: 10, weight: 600 }, maxRotation: 45 }, grid: { display: false } }, 
            y: { position: 'left', ticks: { color: window.tc(), font: { size: 11, weight: 600 }, callback: function(v) { return window.fmtK(v); } }, grid: { color: window.gc(), drawBorder: false } },
            y1: { position: 'right', max: 100, min: 0, ticks: { color: window.tc(), font: { size: 11, weight: 600 }, callback: function(v) { return v + '%'; } }, grid: { display: false } }
          }, 
          plugins: { legend: { display: true }, tooltip: { mode: 'index', intersect: false } } 
        })
      });
  }
};

window._sparklineLine = function(data, color, gid) {
  if (!data || data.length < 2) return '';
  const max = Math.max.apply(null, data) || 1; const min = Math.min.apply(null, data); const range = (max - min) || max || 1; const W = 100, H = 34, n = data.length;
  const pts = data.map(function(v, i) { return (i / (n - 1) * W).toFixed(1) + ',' + (H - 4 - ((v - min) / range) * (H - 8)).toFixed(1); });
  const pStr = pts.join(' '); const last = pts[pts.length - 1].split(',');
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="width:100%;height:34px;display:block;margin-top:5px;margin-bottom:auto;"><defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + color + '" stop-opacity="0.2"/><stop offset="100%" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs><polygon points="0,' + H + ' ' + pStr + ' ' + W + ',' + H + '" fill="url(#' + gid + ')"/><polyline points="' + pStr + '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="' + last[0] + '" cy="' + last[1] + '" r="3" fill="' + color + '"/></svg>';
};

window._sparklineBar = function(data, color) {
  if (!data || !data.length) return '';
  const max = Math.max.apply(null, data) || 1; 
  const W = 160, H = 48, n = data.length; 
  const barW = (W / n) * 0.65; const gap  = (W / n) * 0.35;
  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="width:100%;height:48px;display:block;margin-top:2px;margin-bottom:auto;overflow:visible;">';
  data.forEach(function(v, i) { 
    const h = Math.max(2, (v / max) * (H - 16));
    const x = i * (barW + gap) + gap/2; 
    const y = H - h; 
    svg += '<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + h + '" fill="' + color + '" rx="2" opacity="' + (i===data.length-1 ? '1':'0.5') + '"/>'; 
    if (v > 0) {
       svg += '<text x="' + (x + barW/2) + '" y="' + (y - 4) + '" fill="var(--text-main)" font-size="10" font-weight="700" font-family="Inter" text-anchor="middle" opacity="' + (i===data.length-1 ? '1':'0.7') + '">' + window.fmtK(v) + '</text>';
    }
  });
  return svg + '</svg>';
};

window._progressBar = function(current, target, color, label) {
  const pct = target > 0 ? Math.min(100, Math.round(current / target * 100)) : 0;
  return '<div style="margin-top:6px;margin-bottom:auto"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">' + label + '</span><span style="font-size:10.5px;font-weight:700;color:' + color + '">' + pct + '%</span></div><div style="height:6px;background:var(--bg-hover);border-radius:100px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:100px;transition:width .8s cubic-bezier(.16,1,.3,1)"></div></div></div>';
};

window._riskBar = function(n90, n120, n180) {
  const total = (n90 || 0) + (n120 || 0) + (n180 || 0);
  if (!total) return '<div class="kpi-footer"><div class="kpi-sub">No inactive customers</div></div>';
  const p90  = Math.round((n90  / total) * 100); const p120 = Math.round((n120 / total) * 100); const p180 = 100 - p90 - p120;
  return '<div style="margin-top:auto"><div style="display:flex;gap:4px;height:8px;border-radius:100px;"><div style="width:' + p90  + '%;background:#f97316;border-radius:100px;"></div><div style="width:' + p120 + '%;background:#ef4444;border-radius:100px;"></div><div style="width:' + p180 + '%;background:#991b1b;border-radius:100px;"></div></div><div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap"><span style="font-size:10px;color:#f97316;font-weight:700">● ' + n90  + ' <span style="color:var(--text-muted)">90d</span></span><span style="font-size:10px;color:#ef4444;font-weight:700">● ' + n120 + ' <span style="color:var(--text-muted)">120d</span></span><span style="font-size:10px;color:#fca5a5;font-weight:700">● ' + n180 + ' <span style="color:var(--text-muted)">180d+</span></span></div></div>';
};

// ═══════════════════════════════════════════════════════════
// renderKPIs — Completely updated per your new requirements
// ═══════════════════════════════════════════════════════════
window.renderKPIs = function(k, monthly) {
  k = k || {}; monthly = monthly || [];
  const fyData = {};

  monthly.forEach(function(r) {
    const fy = window.getRowFY(r);
    if (!fyData[fy]) fyData[fy] = { sqft: 0, rev: 0, months: new Set() };
    fyData[fy].sqft += Number(r['SQ FT.']) || ((Number(r['TOTAL SQM']) || 0) * 10.76391);
    fyData[fy].rev  += Number(r['NET REVENUE']) || 0;
    const sk = window.getSortKey(r);
    if (sk) fyData[fy].months.add(sk.slice(0, 7));
  });

  const sortedFys     = Object.keys(fyData).sort().reverse();
  const currentFy     = sortedFys[0] || 'N/A';
  const prevFy        = sortedFys[1] || null;
  const currYrSqft    = currentFy !== 'N/A' ? fyData[currentFy].sqft : 0;
  const prevYrSqft    = prevFy && fyData[prevFy] ? fyData[prevFy].sqft : 0;
  const currYrRev     = currentFy !== 'N/A' ? (fyData[currentFy].rev || 0) : 0;
  const yrGrowth      = prevYrSqft ? ((currYrSqft - prevYrSqft) / prevYrSqft * 100) : 0;
  const currYrSqm     = Math.round(currYrSqft / 10.76391);

  const curFyMoCount  = (currentFy !== 'N/A' && fyData[currentFy] && fyData[currentFy].months.size) ? fyData[currentFy].months.size : 1;
  const prevFyMoCount = (prevFy && fyData[prevFy] && fyData[prevFy].months.size) ? fyData[prevFy].months.size : 1;
  const currYrAvgSqft = Math.round(currYrSqft / curFyMoCount);
  const prevYrAvgSqft = prevFy ? Math.round(prevYrSqft / prevFyMoCount) : 0;
  const avgSqftGrowth = prevYrAvgSqft ? +((currYrAvgSqft - prevYrAvgSqft) / prevYrAvgSqft * 100).toFixed(1) : 0;

  const sortedM    = monthly.slice().sort((a, b) => window.getSortKey(b).localeCompare(window.getSortKey(a)));
  const currMoSqft = sortedM[0] ? (Number(sortedM[0]['SQ FT.']) || ((Number(sortedM[0]['TOTAL SQM']) || 0) * 10.76391)) : 0;
  const prevMoSqft = sortedM[1] ? (Number(sortedM[1]['SQ FT.']) || ((Number(sortedM[1]['TOTAL SQM']) || 0) * 10.76391)) : 0;
  const currMoSqm  = Math.round(currMoSqft / 10.76391);

  function _dlt(v) {
    if (v === null || v === undefined || isNaN(v)) return '';
    return v >= 0
      ? `<span class="kpi-delta up"><i class="ph ph-arrow-up"></i>${window.fmt.pct(v)}</span>`
      : `<span class="kpi-delta down"><i class="ph ph-arrow-down"></i>${window.fmt.pct(v)}</span>`;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function _donut(segs, lbl, sz) {
    sz = sz || 68;
    const R = sz * 0.34, CX = sz/2, CY = sz/2, C = 2 * Math.PI * R;
    const tot = segs.reduce((s, g) => s + (g.v || 0), 0) || 1;
    let off = C * 0.25, pth = '';
    segs.filter(g => g.v > 0).forEach(g => {
      const d = (g.v / tot) * C;
      pth += `<circle cx="${CX.toFixed(1)}" cy="${CY.toFixed(1)}" r="${R.toFixed(1)}" fill="none" stroke="${g.c}" stroke-width="8" stroke-dasharray="${d.toFixed(2)} ${(C-d).toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" stroke-linecap="butt"/>`;
      off -= d;
    });
    const fs = Math.max(9, sz * 0.14).toFixed(0);
    return `<svg width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}" style="flex-shrink:0;overflow:visible">
      <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="var(--bg-hover)" stroke-width="8"/>
      ${pth}
      <text x="${CX}" y="${CY+1}" text-anchor="middle" dominant-baseline="central"
        fill="var(--text-main)" font-size="${fs}" font-weight="800" font-family="Inter,sans-serif">${lbl}</text>
    </svg>`;
  }

  function _bar(val, max, color, h) {
    const pct = max > 0 ? Math.min(100, (val/max)*100).toFixed(1) : '0';
    return `<div style="height:${h||5}px;background:var(--bg-hover);border-radius:100px;overflow:hidden;margin-top:3px;">
      <div style="height:100%;width:${pct}%;background:${color};border-radius:100px;transition:width .85s cubic-bezier(.16,1,.3,1)"></div>
    </div>`;
  }

  function _sep() {
    return '<div style="height:1px;background:var(--border);margin:5px 0;flex-shrink:0;"></div>';
  }

  function _kv(label, value, color) {
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:1px 0;">
      <span style="font-size:10.5px;color:var(--text-muted);font-weight:600;">${label}</span>
      <span style="font-size:11px;font-weight:700;color:${color || 'var(--text-sub)'};">${value}</span>
    </div>`;
  }

  // ── Card 4 data ───────────────────────────────────────────────────────────
  const totalC  = k.totalCustomers  || 0;
  const c30     = k.cust30d         || 0;
  const c60     = k.cust60d         || 0;
  const cActive = k.activeCustomers || 0;
  const c90p    = k.cust90Plus      || 0;
  const c31_60  = Math.max(0, c60 - c30);
  const c61_90  = Math.max(0, cActive - c60);

  const custDonutSvg = _donut([
    {v:c30,    c:'#10b981'},
    {v:c31_60, c:'#38bdf8'},
    {v:c61_90, c:'#f59e0b'},
    {v:c90p,   c:'#ef4444'}
  ], window.fmt.short(totalC), 80);

  function cRow(clr, lbl, cnt) {
    const pct = totalC > 0 ? ((cnt/totalC)*100).toFixed(1) : '0.0';
    return `<div style="padding:1px 0;">
      <div style="display:flex;align-items:center;gap:6px;">
        <div style="width:7px;height:7px;border-radius:50%;background:${clr};flex-shrink:0;"></div>
        <span style="font-size:10.5px;color:var(--text-muted);font-weight:600;flex:1;">${lbl}</span>
        <span style="font-size:12px;font-weight:800;color:var(--text-main);">${window.fmt.num(cnt)}</span>
        <span style="font-size:9.5px;color:${clr};font-weight:700;min-width:34px;text-align:right;">${pct}%</span>
      </div>
      ${_bar(cnt, totalC, clr, 4)}
    </div>`;
  }

  // ── Card 5 data ───────────────────────────────────────────────────────────
  const c80All    = k.cust80Count         || 0;
  const c80Cur    = k.cust80CountCurMonth || 0;
  const c80AllPct = totalC > 0 ? ((c80All/totalC)*100).toFixed(1) : '0';
  const c80CurPct = c30     > 0 ? ((c80Cur/c30)*100).toFixed(1)    : '0';

  // ── Card 6 data ───────────────────────────────────────────────────────────
  const totOs = k.totOs        || 0;
  const osB45 = k.osBelow45Amt || 0;
  const osA45 = k.os45Amt      || 0;
  const os90  = k.os90Amt      || 0;

  const osDonutSvg = _donut([
    {v:osB45, c:'#10b981'},
    {v:osA45, c:'#f59e0b'},
    {v:os90,  c:'#ef4444'}
  ], '₹', 80);

  function osRow(clr, lbl, cnt, amt) {
    const pct = totOs > 0 ? ((amt/totOs)*100).toFixed(0) : '0';
    return `<div style="padding:1px 0;">
      <div style="display:flex;align-items:center;gap:6px;">
        <div style="width:7px;height:7px;border-radius:2px;background:${clr};flex-shrink:0;"></div>
        <span style="font-size:10.5px;color:var(--text-muted);font-weight:600;flex:1;">${lbl} <span style="color:${clr};font-size:10px;">(${cnt})</span></span>
        <span style="font-size:11.5px;font-weight:800;color:var(--text-main);">₹${window.fmt.short(amt)}</span>
        <span style="font-size:9.5px;color:${clr};font-weight:700;min-width:28px;text-align:right;">${pct}%</span>
      </div>
      ${_bar(amt, totOs, clr, 4)}
    </div>`;
  }

  const kpiGrid = document.getElementById('kpi-grid');
  if (!kpiGrid) return;
  if (window.App.charts.custDonut) { try { window.App.charts.custDonut.destroy(); } catch(e) {} window.App.charts.custDonut = null; }

  kpiGrid.innerHTML =

  // ── Card 1 — YTD SQ FT ────────────────────────────────────────────────────
  `<div class="kpi-card" style="--kpi-color:#10b981;">
    <div class="kpi-header-row" style="justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:9px;min-width:0;">
        <div class="kpi-icon" style="color:#10b981;"><i class="ph ph-ruler"></i></div>
        <div class="kpi-label">YTD SQ FT (${currentFy})</div>
      </div>
      ${_dlt(yrGrowth)}
    </div>
    <div style="height:80px; margin-bottom:6px; display:flex; flex-direction:column; justify-content:center;">
      <div class="kpi-value" style="font-size:28px;line-height:1;">${window.fmt.short(currYrSqft)}</div>
      <div style="font-size:10.5px;color:var(--text-muted);font-weight:600;margin-top:2px;">${window.fmt.num(currYrSqft)} sqft</div>
    </div>
    <div style="margin-top:auto;margin-bottom:6px;">
      <div style="display:flex;justify-content:space-between;font-size:10px;font-weight:700;margin-bottom:4px;">
        <span style="color:var(--text-muted);">vs ${prevFy || 'prev yr'} (${window.fmt.short(prevYrSqft)})</span>
        <span style="color:${yrGrowth>=0?'#10b981':'#ef4444'}">${window.fmt.pct(yrGrowth)}</span>
      </div>
      ${_bar(Math.min(currYrSqft, Math.max(prevYrSqft, currYrSqft, 1)), Math.max(prevYrSqft, currYrSqft, 1), '#10b981', 7)}
    </div>
    <div>
      ${_sep()}
      <div style="display:flex;flex-direction:column;gap:4px;">
        ${_kv('Months tracked', curFyMoCount + ' of 12', 'var(--text-sub)')}
        ${_kv('Prev FY total', window.fmt.short(prevYrSqft) + ' sqft', 'var(--text-muted)')}
      </div>
    </div>
  </div>`

  // ── Card 2 — MTD SALE SQ FT ───────────────────────────────────────────────
  + `<div class="kpi-card" style="--kpi-color:var(--brand-primary);">
    <div class="kpi-header-row" style="justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:9px;min-width:0;">
        <div class="kpi-icon" style="color:var(--brand-primary);"><i class="ph ph-calendar"></i></div>
        <div class="kpi-label">MTD SALE SQ FT</div>
      </div>
      ${_dlt(k.momGrowth)}
    </div>
    <div style="height:80px; margin-bottom:6px; display:flex; flex-direction:column; justify-content:center;">
      <div style="display:flex;align-items:baseline;gap:8px;">
        <div class="kpi-value" style="font-size:28px;line-height:1;">${window.fmt.short(currMoSqft)}</div>
        <div style="font-size:10px;color:var(--text-faint);font-weight:600;">${k.currentMonth || 'N/A'}</div>
      </div>
      <div style="font-size:10.5px;color:var(--text-muted);font-weight:600;margin-top:2px;">${window.fmt.num(currMoSqft)} sqft</div>
    </div>
    <div style="margin-top:auto;margin-bottom:6px;">
      ${window._sparklineBar(k.last6MonthsTrend || [], 'var(--brand-primary)')}
    </div>
    <div>
      ${_sep()}
      <div style="display:flex;flex-direction:column;gap:4px;">
        ${_kv('MTD Revenue', '₹' + window.fmt.short(k.currentMonthRev || 0), 'var(--brand-primary)')}
        ${_kv('Prev month', window.fmt.short(prevMoSqft) + ' sqft', 'var(--text-muted)')}
      </div>
    </div>
  </div>`

  // ── Card 3 — CURR YR AVG SQ FT / MO ──────────────────────────────────────
  + `<div class="kpi-card" style="--kpi-color:#8b5cf6;">
    <div class="kpi-header-row" style="justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:9px;min-width:0;">
        <div class="kpi-icon" style="color:#8b5cf6;"><i class="ph ph-chart-line"></i></div>
        <div class="kpi-label">CURR YR AVG / MO</div>
      </div>
      ${_dlt(avgSqftGrowth)}
    </div>
    <div style="height:80px; margin-bottom:6px; display:flex; flex-direction:column; justify-content:center;">
      <div style="display:flex;align-items:baseline;gap:8px;">
        <div class="kpi-value" style="font-size:28px;line-height:1;">${window.fmt.short(currYrAvgSqft)}</div>
        <div style="font-size:10px;color:var(--text-faint);font-weight:600;">vs prev yr avg</div>
      </div>
      <div style="font-size:10.5px;color:var(--text-muted);font-weight:600;margin-top:2px;">${window.fmt.num(currYrAvgSqft)} sqft avg / month</div>
    </div>
    <div style="margin-top:auto;margin-bottom:6px;">
      ${window._sparklineBar((k.yearlyAvgTrend || []).slice(-5), '#8b5cf6')}
    </div>
    <div>
      ${_sep()}
      <div style="display:flex;flex-direction:column;gap:4px;">
        ${_kv('Prev yr avg/mo', window.fmt.short(prevYrAvgSqft) + ' sqft', 'var(--text-muted)')}
        ${_kv('Months elapsed', curFyMoCount + ' this FY', 'var(--text-sub)')}
      </div>
    </div>
  </div>`

  // ── Card 4 — TOTAL CUSTOMERS ───────────────────────────────────────────────
  + `<div class="kpi-card" style="--kpi-color:#ec4899;">
    <div class="kpi-header-row" style="justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:9px;min-width:0;">
        <div class="kpi-icon" style="color:#ec4899;"><i class="ph ph-users"></i></div>
        <div class="kpi-label">TOTAL CUSTOMERS</div>
      </div>
      <span style="display:inline-flex;align-items:center;gap:4px;background:rgba(16,185,129,0.12);color:#10b981;padding:3px 8px;border-radius:100px;font-size:10px;font-weight:700;white-space:nowrap;"><i class="ph ph-crown"></i>${window.fmt.num(k.loyalCustomers || 0)} loyal</span>
    </div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px;">
      ${custDonutSvg}
      <div>
        <div class="kpi-value" style="font-size:28px;line-height:1;">${window.fmt.num(totalC)}</div>
        <div style="font-size:10.5px;color:var(--text-muted);font-weight:600;margin-top:2px;">total accounts</div>
      </div>
    </div>
    <div style="border-top:1px solid var(--border);padding-top:8px;display:flex;flex-direction:column;gap:1px;margin-top:auto;">
      ${cRow('#10b981', '0–30d &nbsp;Active',  c30)}
      ${cRow('#38bdf8', '31–60d',               c31_60)}
      ${cRow('#f59e0b', '61–90d',               c61_90)}
      ${cRow('#ef4444', '90d+&nbsp;Inactive',   c90p)}
    </div>
  </div>`

  // ── Card 5 — 80% VOLUME CONTRIBUTORS ─────────────────────────────────────
  + `<div class="kpi-card" style="--kpi-color:#f59e0b;">
    <div class="kpi-header-row">
      <div class="kpi-icon" style="color:#f59e0b;"><i class="ph ph-star"></i></div>
      <div class="kpi-label">80% VOLUME CONTRIBUTORS</div>
    </div>
    
    <div style="display:flex; gap:10px; margin-top:7px; margin-bottom:8px; flex:1;">
      
      <div style="flex:1; background:var(--bg-elevated); border:1px solid var(--border); border-radius:12px; padding:12px; display:flex; flex-direction:column; justify-content:space-between;">
        <div style="font-size:9.5px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; color:var(--brand-primary); margin-bottom:6px; display:flex; align-items:center; gap:4px;">
          <i class="ph ph-calendar-check"></i> THIS MONTH
        </div>
        <div style="font-size:26px; font-weight:800; color:${c80Cur>0?'var(--brand-primary)':'var(--text-muted)'}; line-height:1; margin-bottom:4px;">
          ${c80Cur > 0 ? window.fmt.num(c80Cur) : (c30 === 0 ? '—' : 'N/A')}
        </div>
        <div style="font-size:10.5px; color:var(--text-muted); font-weight:600; margin-bottom:12px;">
          of <strong style="color:var(--text-main)">${window.fmt.num(c30)}</strong> active
        </div>
        <div style="margin-top:auto;">
          <div style="display:flex; justify-content:space-between; font-size:10px; font-weight:800; color:var(--brand-primary); margin-bottom:4px;">
            <span>SHARE</span>
            <span>${c80Cur > 0 ? c80CurPct + '%' : '0%'}</span>
          </div>
          ${c80Cur > 0
            ? _bar(c80Cur, Math.max(c30,1), 'var(--brand-primary)', 4)
            : `<div style="height:4px;background:var(--bg-hover);border-radius:100px;opacity:0.3;margin-top:3px;"></div>`}
        </div>
      </div>

      <div style="flex:1; background:var(--bg-elevated); border:1px solid var(--border); border-radius:12px; padding:12px; display:flex; flex-direction:column; justify-content:space-between;">
        <div style="font-size:9.5px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; color:#f59e0b; margin-bottom:6px; display:flex; align-items:center; gap:4px;">
          <i class="ph ph-chart-pie"></i> ALL TIME
        </div>
        <div style="font-size:26px; font-weight:800; color:#f59e0b; line-height:1; margin-bottom:4px;">
          ${window.fmt.num(c80All)}
        </div>
        <div style="font-size:10.5px; color:var(--text-muted); font-weight:600; margin-bottom:12px;">
          of <strong style="color:var(--text-main)">${window.fmt.num(totalC)}</strong> total
        </div>
        <div style="margin-top:auto;">
          <div style="display:flex; justify-content:space-between; font-size:10px; font-weight:800; color:#f59e0b; margin-bottom:4px;">
            <span>SHARE</span>
            <span>${c80AllPct}%</span>
          </div>
          ${_bar(c80All, Math.max(totalC,1), '#f59e0b', 4)}
        </div>
      </div>

    </div>
    
    <div style="text-align:center; padding-top:6px; margin-top:auto;">
      <span style="font-size:10px; color:var(--text-faint); font-weight:600;">
        <i class="ph ph-lightning" style="color:var(--accent4); margin-right:3px;"></i>Pareto 80/20 Principle
      </span>
    </div>
  </div>`

  // ── Card 6 — TOTAL OUTSTANDING ────────────────────────────────────────────
  + `<div class="kpi-card" style="--kpi-color:#ef4444;">
    <div class="kpi-header-row" style="justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:9px;min-width:0;">
        <div class="kpi-icon" style="color:#ef4444;"><i class="ph ph-currency-inr"></i></div>
        <div class="kpi-label">TOTAL OUTSTANDING</div>
      </div>
      <span style="display:inline-flex;align-items:center;gap:4px;background:rgba(239,68,68,0.12);color:#ef4444;padding:3px 8px;border-radius:100px;font-size:10px;font-weight:700;white-space:nowrap;"><i class="ph ph-users"></i>${window.fmt.num(k.totDebtors||0)} debtors</span>
    </div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px;">
      ${osDonutSvg}
      <div>
        <div class="kpi-value" style="font-size:28px;line-height:1;white-space:nowrap;">₹${window.fmt.short(totOs)}</div>
        <div style="font-size:10.5px;color:var(--text-muted);font-weight:600;margin-top:2px;">${window.fmt.num(totOs)} absolute</div>
      </div>
    </div>
    <div style="border-top:1px solid var(--border);padding-top:4px;display:flex;flex-direction:column;gap:1px;margin-top:auto;">
      ${osRow('#10b981', 'Below 45d', k.osBelow45Count||0, osB45)}
      ${osRow('#f59e0b', 'Above 45d', k.os45Count||0,     osA45)}
      ${osRow('#ef4444', '90+ Days',  k.os90Count||0,     os90)}
    </div>
  </div>`;
};

window.renderMonthlyChart = function(rows) {
  if (typeof Chart === 'undefined') return;
  if (!rows || !Array.isArray(rows)) rows = [];
  const ctx = document.getElementById('chart-monthly'); if (!ctx) return;
  
  const filtered = rows.filter(function(r) {
    function _chk(val, fArr) { if (!fArr || fArr === 'All') return true; if (Array.isArray(fArr)) { if (fArr.length === 0 || fArr.indexOf('All') !== -1) return true; return fArr.indexOf(val) !== -1; } return val === fArr; }
    if (!_chk(window.getRowFY(r), window.App.filters.fy)) return false;
    if (!_chk(String(r['QUARTER'] || ''), window.App.filters.quarter)) return false;
    if (!_chk(String(r['MONTH YEAR'] || '').trim(), window.App.filters.month)) return false;
    return true;
  }).sort(function(a, b) { return window.getSortKey(a).localeCompare(window.getSortKey(b)); }); 

  const labels = [], sqftData = [];
  filtered.forEach(function(r) { 
    labels.push(window.getAxisLabel(r)); 
    sqftData.push(Number(r['SQ FT.']) || ((Number(r['TOTAL SQM']) || 0) * 10.76391)); 
  });
  
  if (window.App.charts.monthly) {
      window.App.charts.monthly.data.labels = labels; 
      window.App.charts.monthly.data.datasets[0].data = sqftData; 
      window.App.charts.monthly.options.scales.x.ticks.color = window.tc();
      window.App.charts.monthly.options.scales.y.ticks.color = window.tc();
      window.App.charts.monthly.update('none');
  } else {
      window.App.charts.monthly = new Chart(ctx, {
        type: 'line', 
        data: { labels: labels, datasets: [
          { label: 'SQ FT', data: sqftData, yAxisID: 'y', borderColor: '#4f46e5', backgroundColor: 'rgba(79,70,229,0.15)', tension: 0.45, pointRadius: 4, pointHoverRadius: 7, pointBackgroundColor: '#4f46e5', fill: true, borderWidth: 3 }
        ]},
        options: window._cDefaults({ layout: { padding: { top: 25 } }, scales: {
          x: { ticks: { color: window.tc(), font: { size: 14, weight: 700 }, maxRotation: 60, minRotation: 45, autoSkip: false, callback: function(val, idx) { return this.getLabelForValue(val); } }, grid: { display: false, drawBorder: false } },
          y:  { position: 'left',  ticks: { color: window.tc(), font: { size: 14, weight: 700 }, callback: function(v) { return window.fmtK(v); } }, grid: { color: window.gc(), drawBorder: false } }
        }}),
        plugins: [{
          id: 'customLabelsMonthly',
          afterDatasetsDraw: function(chart) {
            var ctx = chart.ctx;
            chart.data.datasets.forEach(function(dataset, i) {
              var meta = chart.getDatasetMeta(i);
              meta.data.forEach(function(bar, index) {
                var val = dataset.data[index];
                if (!val) return;
                ctx.fillStyle = window.tc();
                ctx.font = 'bold 11px "Inter", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(window.fmt.short(val), bar.x, bar.y - 8);
              });
            });
          }
        }]
      });
  }
};

window.renderStateChart = function(rows) {
  if (typeof Chart === 'undefined') return;
  if (!rows || !Array.isArray(rows)) rows = [];
  const ctx = document.getElementById('chart-state'); if (!ctx) return;
  
  const sorted = rows.slice().sort(function(a, b) { return (Number(b['SQ FT.']) || 0) - (Number(a['SQ FT.']) || 0); }).slice(0, 10);
  const labels = [], data = [];
  sorted.forEach(function(r) { labels.push(r['STATE'] || 'Unknown'); data.push(Number(r['SQ FT.']) || 0); });
  
  if (window.App.charts.state) {
      window.App.charts.state.data.labels = labels; 
      window.App.charts.state.data.datasets[0].data = data; 
      window.App.charts.state.options.scales.x.ticks.color = window.tc();
      window.App.charts.state.options.scales.y.ticks.color = window.tc();
      window.App.charts.state.update('none');
  } else {
      const g = ctx.getContext('2d').createLinearGradient(0, 0, 400, 0); g.addColorStop(0, '#4f46e5'); g.addColorStop(1, '#8b5cf6');
      window.App.charts.state = new Chart(ctx, {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'SQ FT', data: data, backgroundColor: g, hoverBackgroundColor: '#6366f1', borderRadius: { topRight: 6, bottomRight: 6, topLeft: 0, bottomLeft: 0 } }] },
        options: window._cDefaults({ indexAxis: 'y', layout: { padding: { right: 40 } }, scales: {
          x: { ticks: { color: window.tc(), font: { size: 13, weight: 700 }, callback: function(v) { return window.fmtK(v); } }, grid: { color: window.gc(), drawBorder: false } },
          y: { ticks: { color: window.tc(), font: { size: 12, weight: 700 } }, grid: { display: false, drawBorder: false } }
        }}),
        plugins: [{
          id: 'customLabels',
          afterDatasetsDraw: function(chart) {
            var ctx = chart.ctx;
            chart.data.datasets.forEach(function(dataset, i) {
              var meta = chart.getDatasetMeta(i);
              meta.data.forEach(function(bar, index) {
                var val = dataset.data[index];
                if (!val) return;
                ctx.fillStyle = window.tc();
                ctx.font = 'bold 12px "Inter", sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(window.fmt.short(val), bar.x + 6, bar.y);
              });
            });
          }
        }]
      });
  }
};

window.renderQoQChart = function(monthly) {
  if (typeof Chart === 'undefined') return;
  if (!monthly || !Array.isArray(monthly)) monthly = [];
  const ctx = document.getElementById('chart-fy'); if (!ctx) return;
  const qMap = {};
  monthly.forEach(function(r) {
    const fy = window.getRowFY(r); 
    
    let q = '';
    let mStr = String(r['MONTH YEAR'] || '').trim().substring(0,3).toUpperCase();
    let mIdx = window.MN.indexOf(mStr);
    if (mIdx !== -1) {
        if (mIdx >= 3 && mIdx <= 5) q = 'Q1';
        else if (mIdx >= 6 && mIdx <= 8) q = 'Q2';
        else if (mIdx >= 9 && mIdx <= 11) q = 'Q3';
        else q = 'Q4';
    } else {
        let qStr = String(r['QUARTER'] || '').trim().toUpperCase();
        const match = qStr.match(/Q[- ]?(\d)/);
        q = match ? 'Q' + match[1] : 'Q1';
    }

    if (!fy || !q) return;
    const sqft = Number(r['SQ FT.']) || ((Number(r['TOTAL SQM']) || 0) * 10.76391);
    const yr2 = fy.replace('FY ', '').split('-')[0]; 
    const lbl = q + ' \'' + yr2; 
    const sortKey = fy + q; 
    if (!qMap[sortKey]) qMap[sortKey] = { sqft: 0, label: lbl };
    qMap[sortKey].sqft += sqft;
  });
  const sortedKeys   = Object.keys(qMap).sort();
  const sortedLabels = sortedKeys.map(function(k) { return qMap[k].label; });
  const sortedData   = sortedKeys.map(function(k) { return qMap[k].sqft; });

  if (window.App.charts.fy) {
      window.App.charts.fy.data.labels = sortedLabels; 
      window.App.charts.fy.data.datasets[0].data = sortedData; 
      window.App.charts.fy.options.scales.x.ticks.color = window.tc();
      window.App.charts.fy.options.scales.y.ticks.color = window.tc();
      window.App.charts.fy.update('none');
  } else {
      window.App.charts.fy = new Chart(ctx, {
        type: 'bar', 
        data: { labels: sortedLabels, datasets: [{
          label: 'SQ FT', data: sortedData, yAxisID: 'y', backgroundColor: '#10b981', hoverBackgroundColor: '#059669', borderRadius: 6
        }]},
        options: window._cDefaults({ layout: { padding: { top: 25 } }, scales: {
          x: { ticks: { color: window.tc(), font: { size: 14, weight: 700 }, maxRotation: 45, minRotation: 30, autoSkip: true, maxTicksLimit: 20 }, grid: { display: false, drawBorder: false } },
          y: { position: 'left', ticks: { color: window.tc(), font: { size: 14, weight: 700 }, callback: function(v) { return window.fmtK(v) + ' sqft'; } }, grid: { color: window.gc(), drawBorder: false } }
        }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(ctx) { return ' SQ FT: ' + window.fmt.num(ctx.raw); } } } }}),
        plugins: [{
          id: 'customLabelsQoq',
          afterDatasetsDraw: function(chart) {
            var ctx = chart.ctx;
            chart.data.datasets.forEach(function(dataset, i) {
              var meta = chart.getDatasetMeta(i);
              meta.data.forEach(function(bar, index) {
                var val = dataset.data[index];
                if (!val) return;
                ctx.fillStyle = window.tc();
                ctx.font = 'bold 11px "Inter", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(window.fmt.short(val), bar.x, bar.y - 6);
              });
            });
          }
        }]
      });
  }
};

window._activeDrop = null;
document.addEventListener('click', function(e) { 
  if (!e.target.closest('.ms-wrap')) { 
    document.querySelectorAll('.ms-wrap').forEach(w => w.classList.remove('open')); 
    window._activeDrop = null; 
  } 
});

window.toggleFilterDrop = function(key, e) {
  e.stopPropagation(); 
  const wrap = document.getElementById('wrap-' + key); 
  if (!wrap) return;
  const isOpen = wrap.classList.contains('open'); 
  document.querySelectorAll('.ms-wrap').forEach(w => w.classList.remove('open'));
  if (!isOpen) { wrap.classList.add('open'); window._activeDrop = key; } else { window._activeDrop = null; }
};

window._updateMsLabel = function(key) {
  let arr = window.App.filters[key]; 
  if (!Array.isArray(arr)) arr = [arr || 'All'];
  const lbl = document.getElementById('ms-lbl-' + key); 
  if (!lbl) return;
  if (arr.length === 0 || arr.includes('All')) { 
    lbl.textContent = 'All ' + key.charAt(0).toUpperCase() + key.slice(1) + 's'; 
  } else if (arr.length === 1) { 
    if (key === 'quarter') { lbl.textContent = arr[0].split('|').join(' ').replace('Q', 'Q-'); } 
    else { lbl.textContent = arr[0]; } 
  } else { 
    lbl.textContent = arr.length + ' Selected'; 
  }
};

window._buildCheckboxes = function(key, optionsArray) {
  const drop = document.getElementById('ms-drop-' + key); 
  if (!drop) return; 
  drop.innerHTML = '';
  let currentArr = window.App.filters[key];
  if (!Array.isArray(currentArr)) currentArr = [currentArr || 'All'];
  
  optionsArray.forEach(function(opt) {
    let val = opt, txt = opt;
    if (key === 'quarter' && opt !== 'All') { val = opt; txt = opt.split('|').join(' ').replace('Q', 'Q-'); }
    const isChecked = currentArr.includes('All') ? (val === 'All') : currentArr.includes(val);
    const div = document.createElement('div'); div.className = 'ms-item'; div.innerHTML = '<input type="checkbox" class="ms-checkbox" value="' + val + '" ' + (isChecked ? 'checked' : '') + '> <span style="white-space:nowrap;">' + txt + '</span>';
    div.onclick = function(e) {
      e.stopPropagation(); 
      if (e.target.tagName !== 'INPUT') { const cb = div.querySelector('input'); cb.checked = !cb.checked; }
      const cb = div.querySelector('input');
      if (val === 'All' && cb.checked) { drop.querySelectorAll('input').forEach(i => { if(i.value !== 'All') i.checked = false; }); } 
      else if (val !== 'All' && cb.checked) { const allCb = drop.querySelector('input[value="All"]'); if (allCb) allCb.checked = false; }
      let checkedVals = []; drop.querySelectorAll('input:checked').forEach(i => checkedVals.push(i.value));
      if (checkedVals.length === 0) { const allCb = drop.querySelector('input[value="All"]'); if (allCb) allCb.checked = true; checkedVals = ['All']; }
      window.App.filters[key] = checkedVals; 
      window._updateMsLabel(key);
    };
    drop.appendChild(div);
  });
  window._updateMsLabel(key);
};

window.populateFilters = function(opts) {
  opts = opts || {}; window.App.filterOptions = opts;
  ['fy', 'quarter', 'month', 'zone', 'state', 'hod'].forEach(function(k) {
    let optionsArray = [];
    if (k === 'quarter') {
      optionsArray.push('All');
      (opts.fy || []).forEach(function(f) { if (f === 'All') return; (opts.quarter || []).forEach(function(q) { if (q === 'All') return; optionsArray.push(f + '|' + q); }); });
    } else { optionsArray = opts[k] || ['All']; }
    window._buildCheckboxes(k, optionsArray);
  });
};

window.applyMultiFilters = function() {
   document.querySelectorAll('.ms-wrap').forEach(w => w.classList.remove('open'));
   const fp = document.getElementById('filter-panel');
   if (fp) fp.classList.add('hidden');
   
   for (let k in window.App.filters) {
     if (k === '_v' || k === '_scope') continue;
     let val = window.App.filters[k];
     if (Array.isArray(val)) {
       if (val.includes('All') || val.length === 0) window.App.filters[k] = 'All';
       else if (val.length === 1) window.App.filters[k] = val[0];
     }
   }
   
   window.App.data.overview = null;
   if (window.loadPage) window.loadPage(window.App.currentPage);
};

window.resetFilters = function() {
   ['fy', 'quarter', 'month', 'zone', 'state', 'hod'].forEach(function(k) { window.App.filters[k] = 'All'; });
   if (window.populateFilters) window.populateFilters(window.App.filterOptions);
   const fp = document.getElementById('filter-panel');
   if (fp) fp.classList.add('hidden');
   window.App.data.overview = null;
   if (window.loadPage) window.loadPage(window.App.currentPage);
};

window.loadOverview = async function(useCache) {
  try {
    if (useCache && window.App.data.overview) {
      if(window.renderKPIs) window.renderKPIs(window.App.data.overview.kpis || {}, window.App.data.overview.monthly || []); 
      if(window.renderMonthlyChart) window.renderMonthlyChart(window.App.data.overview.monthly || []); 
      if(window.renderStateChart) window.renderStateChart(window.App.data.overview.states || []); 
      if(window.renderQoQChart) window.renderQoQChart(window.App.data.overview.monthly || []); 
      return;
    }
    const [kpis, overview] = await Promise.all([ window.api('getKPIs'), window.api('getOverviewData') ]);
    window.App.data.overview = { kpis: kpis, monthly: overview.monthly, states: overview.states };
    
    if(window.renderKPIs) window.renderKPIs(kpis || {}, overview.monthly || []); 
    if(window.renderMonthlyChart) window.renderMonthlyChart(overview.monthly || []); 
    if(window.renderStateChart) window.renderStateChart(overview.states || []); 
    if(window.renderQoQChart) window.renderQoQChart(overview.monthly || []);
    
    const el = document.getElementById('last-updated-val');
    if (el && kpis && kpis.lastUpdated) { try { el.textContent = new Date(kpis.lastUpdated).toLocaleString('en-IN'); el.style.display = ''; } catch(e) { el.textContent = kpis.lastUpdated; } }
  } catch(e) { window.toast('Overview load failed: ' + e.message, 'error', 8000); }
};

window.navigateCustomReport = function(idx, name) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  
  const navItem = document.querySelector(`.nav-item[data-page="custom-report-${idx}"]`);
  if (navItem) navItem.classList.add('active');
  
  const page = document.getElementById('page-custom-report');
  if (page) page.classList.add('active');
  
  const pt = document.getElementById('page-title');
  if (pt) pt.textContent = name;
  
  const ct = document.getElementById('custom-report-title');
  if (ct) ct.innerHTML = `<i class="ph ph-table"></i> ${name}`;
  
  window.App.currentPage = `custom-report-${idx}`;
  
  if (window.innerWidth <= 900) {
    const sb = document.getElementById('sidebar');
    if (sb) sb.classList.remove('open');
  }
  
  window.loadCustomReport(idx);
};


window.loadCustomReport = async function(idx) {
  var rep = window.App.customReports[idx];
  if (!rep) return;
  var tbody = document.getElementById('tbl-custom-report-body');
  var thead = document.getElementById('th-custom-report-head');
  var tfoot = document.getElementById('tf-custom-report-foot');
  if (tbody) tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:40px;" class="muted"><i class="ph ph-spinner spin text-lg"></i><br>Fetching live data...</td></tr>';
  if (thead) thead.innerHTML = '';
  if (tfoot) tfoot.innerHTML = '';
  try {
    var data = await window.api('getCustomReport', { options: { sheetId: rep.id, sheetName: rep.sheet } });
    if (!data || !data.length) throw new Error('No data found');
    window._pivotRaw = data;
    window._pivotRep = rep;
    window._pivotSortDir = 'asc';
    window._pivotHiddenCols = new Set();
    window._pivotHiddenRows = new Set();
    window._pivotHeatmap = false;
    window._pivotDataBars = false;
    window._pivotTranspose = false;
    window._pivotShowRank = false;
    window._pivotPage = 0;
    window._pivotView = 'table';
    window.renderPivotTable();
  } catch(e) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="10" style="color:var(--danger);padding:40px;text-align:center;"><i class="ph ph-warning"></i> ' + e.message + '</td></tr>';
  }
};

/* ═══ CORE PIVOT RENDERING ENGINE ═══ */
window.renderPivotTable = function() {
  var data = window._pivotRaw, rep = window._pivotRep;
  if (!data || !rep) return;
  var tbody = document.getElementById('tbl-custom-report-body');
  var thead = document.getElementById('th-custom-report-head');
  var tfoot = document.getElementById('tf-custom-report-foot');
  var metricsList = rep.metrics.split(',').map(function(s){return s.trim();}).filter(Boolean);
  var rowDimsList = rep.rowDim.split(',').map(function(s){return s.trim();}).filter(Boolean);
  var colDim = rep.colDim;
  var rules = []; try { rules = JSON.parse(rep.rules || '[]'); } catch(e) {}
  var aggMethod = document.getElementById('pivot-agg-method').value || 'sum';
  var sortCol = document.getElementById('pivot-sort-col').value || '';
  var sortDir = window._pivotSortDir || 'asc';
  var hiddenCols = window._pivotHiddenCols || new Set();
  var hiddenRows = window._pivotHiddenRows || new Set();
  var displayMode = document.getElementById('pivot-display-mode').value || 'raw';
  var numFormat = document.getElementById('pivot-num-format').value || 'auto';
  var showHeatmap = window._pivotHeatmap || false;
  var showDataBars = window._pivotDataBars || false;
  var isTransposed = window._pivotTranspose || false;
  var showRank = window._pivotShowRank || false;
  var topNPanel = document.getElementById('pivot-topn-panel');
  var topNActive = topNPanel && topNPanel.style.display !== 'none';
  var topNType = (document.getElementById('pivot-topn-type') || {}).value || 'top';
  var topNCount = parseInt((document.getElementById('pivot-topn-count') || {}).value) || 5;
  var topNMetric = (document.getElementById('pivot-topn-metric') || {}).value || '';

  var headers = data[0];
  var rIdxs = [];
  rowDimsList.forEach(function(rd) {
    for (var x=0;x<headers.length;x++) { if (headers[x].toLowerCase()===rd.toLowerCase()) { rIdxs.push({name:rd, idx:x}); break; } }
  });
  var cIdx = -1;
  for (var x=0;x<headers.length;x++) { if (headers[x].toLowerCase()===colDim.toLowerCase()) { cIdx=x; break; } }
  var mIdxs = [];
  metricsList.forEach(function(m) {
    for (var x=0;x<headers.length;x++) { if (headers[x].toLowerCase()===m.toLowerCase()) { mIdxs.push({name:m, idx:x}); break; } }
  });
  if (rIdxs.length===0||cIdx===-1||mIdxs.length===0) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="10" style="color:var(--danger);padding:40px;text-align:center;">Column mapping error. Check settings.</td></tr>';
    return;
  }

  var rowsMap = new Map(); var colsSet = new Set(); window._pivotDetail = {};
  for (var i=1; i<data.length; i++) {
    var row = data[i]; if (!row) continue;
    var rVals = rIdxs.map(function(r){return String(row[r.idx]||'').trim();});
    var rKey = rVals.join('||');
    var cVal = String(row[cIdx]||'').trim();
    if (!rVals[0]) continue;
    if (cVal) colsSet.add(cVal);
    if (!rowsMap.has(rKey)) rowsMap.set(rKey, {_vals:rVals, _data:{}, total:{}});
    var rd = rowsMap.get(rKey);
    if (cVal) {
      if (!rd._data[cVal]) rd._data[cVal] = {};
      mIdxs.forEach(function(m) {
        var val = parseFloat(String(row[m.idx]).replace(/,/g,'')) || 0;
        if (!rd._data[cVal][m.name]) rd._data[cVal][m.name] = [];
        rd._data[cVal][m.name].push(val);
        if (!rd.total[m.name]) rd.total[m.name] = [];
        rd.total[m.name].push(val);
      });
      var dk = rKey + '|||' + cVal;
      if (!window._pivotDetail[dk]) window._pivotDetail[dk] = [];
      window._pivotDetail[dk].push(row);
    }
  }

  function doAgg(arr) {
    if (!arr||arr.length===0) return 0;
    var s=0; for(var j=0;j<arr.length;j++) s+=arr[j];
    if (aggMethod==='sum') return s;
    if (aggMethod==='avg') return s/arr.length;
    if (aggMethod==='count') return arr.length;
    if (aggMethod==='max') return Math.max.apply(null,arr);
    if (aggMethod==='min') return Math.min.apply(null,arr);
    return s;
  }
  function numFmt(v) {
    if (numFormat==='int') return Math.round(v).toLocaleString('en-IN');
    if (numFormat==='dec1') return v.toLocaleString('en-IN',{minimumFractionDigits:1,maximumFractionDigits:1});
    if (numFormat==='dec2') return v.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
    return v.toLocaleString('en-IN',{maximumFractionDigits:2});
  }

  var colsList = Array.from(colsSet).sort().filter(function(c){return !hiddenCols.has(c);});
  var colTotals={}, grandTotal={};
  rowsMap.forEach(function(rd2) {
    colsList.forEach(function(c) {
      if (!colTotals[c]) colTotals[c]={};
      mIdxs.forEach(function(m) { var v=doAgg((rd2._data[c]||{})[m.name]||[]); colTotals[c][m.name]=(colTotals[c][m.name]||0)+v; });
    });
    mIdxs.forEach(function(m) { var v=doAgg(rd2.total[m.name]||[]); grandTotal[m.name]=(grandTotal[m.name]||0)+v; });
  });

  var allVals=[]; rowsMap.forEach(function(rd2){colsList.forEach(function(c){mIdxs.forEach(function(m){allVals.push(doAgg((rd2._data[c]||{})[m.name]||[]));});});});
  var heatMax=allVals.length?Math.max.apply(null,allVals):1; if(heatMax===0) heatMax=1;

  function heatColor(v) { if(!v) return ''; var r=Math.min(1,Math.max(0,v/heatMax)); return 'background:rgba(56,'+Math.round(140+r*80)+','+Math.round(80+r*60)+','+(0.1+r*0.35)+');'; }
  function makeBar(v) { if(!v) return ''; var p=Math.min(100,v/heatMax*100); return '<div style="position:absolute;left:0;bottom:0;height:3px;width:'+p+'%;background:var(--brand-primary);border-radius:0 2px 0 0;opacity:0.5;"></div>'; }

  // Populate dropdowns
  var sortSel=document.getElementById('pivot-sort-col'); var ps=sortSel.value;
  sortSel.innerHTML='<option value="">Sort by...</option>';
  rIdxs.forEach(function(r){sortSel.innerHTML+='<option value="row:'+r.name+'"'+(ps==='row:'+r.name?' selected':'')+'>'+r.name+'</option>';});
  mIdxs.forEach(function(m){sortSel.innerHTML+='<option value="metric:'+m.name+':total"'+(ps==='metric:'+m.name+':total'?' selected':'')+'>'+m.name+' (Total)</option>';});
  colsList.forEach(function(c){mIdxs.forEach(function(m){var v='metric:'+m.name+':'+c;sortSel.innerHTML+='<option value="'+v+'"'+(ps===v?' selected':'')+'>'+c+' > '+m.name+'</option>';});});

  var topNMS=document.getElementById('pivot-topn-metric');
  if(topNMS){var pv=topNMS.value;topNMS.innerHTML='';mIdxs.forEach(function(m){topNMS.innerHTML+='<option value="'+m.name+'"'+(pv===m.name?' selected':'')+'>'+m.name+'</option>';});}

  // Filter panels
  var allCols=Array.from(colsSet).sort();
  var fP=document.getElementById('pivot-col-filter-pills');
  if(fP) fP.innerHTML=allCols.map(function(c){var ch=!hiddenCols.has(c);return '<label style="display:flex;align-items:center;gap:3px;background:'+(ch?'var(--surface2)':'var(--bg)')+';padding:3px 8px;border-radius:100px;font-size:10px;border:1px solid var(--border);cursor:pointer;opacity:'+(ch?'1':'0.4')+';"><input type="checkbox"'+(ch?' checked':'')+' onchange="window.togglePivotCol(\''+c+'\',this.checked)"> '+c+'</label>';}).join('');

  var allRK=Array.from(rowsMap.keys()).sort();
  var rP=document.getElementById('pivot-row-filter-pills');
  if(rP) rP.innerHTML=allRK.map(function(rk){var l=rowsMap.get(rk)._vals[0];var ch=!hiddenRows.has(rk);return '<label class="row-pill" data-label="'+l.toLowerCase()+'" style="display:flex;align-items:center;gap:3px;background:'+(ch?'var(--surface2)':'var(--bg)')+';padding:3px 8px;border-radius:100px;font-size:10px;border:1px solid var(--border);cursor:pointer;opacity:'+(ch?'1':'0.4')+';"><input type="checkbox"'+(ch?' checked':'')+' onchange="window.togglePivotRow(\''+rk.replace(/'/g,"\\'")+'\',this.checked)"> '+l+'</label>';}).join('');

  // Sorting
  var sortedKeys=allRK.filter(function(k){return !hiddenRows.has(k);});
  if(sortCol) {
    if(sortCol.indexOf('row:')===0) {
      var dn=sortCol.replace('row:',''); var di=-1; for(var x=0;x<rIdxs.length;x++){if(rIdxs[x].name===dn){di=x;break;}}
      sortedKeys.sort(function(a,b){var aV=rowsMap.get(a)._vals[di]||'';var bV=rowsMap.get(b)._vals[di]||'';return sortDir==='asc'?aV.localeCompare(bV):bV.localeCompare(aV);});
    } else if(sortCol.indexOf('metric:')===0) {
      var sp=sortCol.split(':');var mn=sp[1];var cn=sp.slice(2).join(':');
      sortedKeys.sort(function(a,b){var aD=rowsMap.get(a),bD=rowsMap.get(b);var aV2=cn==='total'?doAgg(aD.total[mn]||[]):doAgg((aD._data[cn]||{})[mn]||[]);var bV2=cn==='total'?doAgg(bD.total[mn]||[]):doAgg((bD._data[cn]||{})[mn]||[]);return sortDir==='asc'?aV2-bV2:bV2-aV2;});
    }
  } else { sortedKeys.sort(); }

  var topNSet=new Set();
  if(topNActive&&topNMetric){var ranked=sortedKeys.map(function(k){return{k:k,v:doAgg(rowsMap.get(k).total[topNMetric]||[])};});ranked.sort(function(a,b){return topNType==='top'?b.v-a.v:a.v-b.v;});ranked.slice(0,topNCount).forEach(function(r){topNSet.add(r.k);});}

  function evalRule(val,rule){var n=parseFloat(val),t=parseFloat(rule.target);if(isNaN(n)||isNaN(t))return false;if(rule.operator==='>')return n>t;if(rule.operator==='<')return n<t;if(rule.operator==='=')return n===t;if(rule.operator==='>=')return n>=t;if(rule.operator==='<=')return n<=t;if(rule.operator==='!=')return n!==t;return false;}
  function dispVal(raw,rd2,cn2,mn2){
    if(displayMode==='raw') return raw;
    var rt=doAgg(rd2.total[mn2]||[]);
    if(displayMode==='pct_row') return rt?(raw/rt*100):0;
    if(displayMode==='pct_col') return (colTotals[cn2]||{})[mn2]?(raw/colTotals[cn2][mn2]*100):0;
    if(displayMode==='pct_grand') return grandTotal[mn2]?(raw/grandTotal[mn2]*100):0;
    return raw;
  }
  var isPct=displayMode!=='raw';
  function fmtD(v){return isPct?v.toFixed(1)+'%':numFmt(v);}

  // ═══ KPI CARDS ═══
  var kpiDiv=document.getElementById('pivot-kpi-cards');
  if(kpiDiv){
    var kH='';
    var kpiColors=['#6366f1','#06b6d4','#f59e0b','#10b981','#ef4444'];
    mIdxs.forEach(function(m,mi){
      var gt=grandTotal[m.name]||0;var av=sortedKeys.length?(gt/sortedKeys.length):0;
      var maxV=0;sortedKeys.forEach(function(k){var v=doAgg(rowsMap.get(k).total[m.name]||[]);if(v>maxV)maxV=v;});
      var col=kpiColors[mi%kpiColors.length];
      kH+='<div class="pivot-kpi-card"><div class="kpi-label">'+m.name+'</div><div class="kpi-value" style="color:'+col+'">'+numFmt(gt)+'</div><div class="kpi-sub">\u03BC '+numFmt(av)+' \u00B7 Max '+numFmt(maxV)+' \u00B7 '+sortedKeys.length+' items</div><div class="kpi-bar" style="width:100%;background:'+col+';opacity:0.3;"></div></div>';
    });
    kpiDiv.innerHTML=kH;kpiDiv.style.display='flex';
  }

  // ═══ PAGINATION ═══
  var pageSize=document.getElementById('pivot-page-size').value;
  var totalRows=sortedKeys.length;
  var totalPages=1;
  var pagedKeys=sortedKeys;
  if(pageSize!=='all'){
    var ps2=parseInt(pageSize);
    totalPages=Math.ceil(totalRows/ps2)||1;
    if(window._pivotPage>=totalPages) window._pivotPage=totalPages-1;
    if(window._pivotPage<0) window._pivotPage=0;
    var start=window._pivotPage*ps2;
    pagedKeys=sortedKeys.slice(start,start+ps2);
  }
  var pgInfo=document.getElementById('pivot-page-info');
  if(pgInfo) pgInfo.textContent='Page '+(window._pivotPage+1)+' of '+totalPages;

  // ═══ CHART VIEW ═══
  var chartView=document.getElementById('pivot-chart-view');
  var tableView=document.getElementById('pivot-table-view');
  if(window._pivotView==='chart'){
    if(chartView) chartView.style.display='block';
    if(tableView) tableView.style.display='none';
    var fb=document.getElementById('pivot-chart-fallback');
    if(fb){
      var chartMetric=mIdxs[0].name;
      var chartData=sortedKeys.map(function(k){return{label:rowsMap.get(k)._vals[0],value:doAgg(rowsMap.get(k).total[chartMetric]||[])};});
      chartData.sort(function(a,b){return b.value-a.value;});
      var cMax=chartData.length?chartData[0].value:1; if(cMax===0)cMax=1;
      var barColors=['#6366f1','#818cf8','#a5b4fc','#c7d2fe','#e0e7ff'];
      fb.innerHTML='<div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:8px;">'+chartMetric+' by '+rIdxs[0].name+' (sorted)</div>'+
        chartData.slice(0,30).map(function(d,di){
          var pct=Math.max(1,d.value/cMax*100);
          var col=barColors[di%barColors.length];
          return '<div class="pivot-chart-bar-wrap"><div class="pivot-chart-bar-label">'+d.label+'</div><div class="pivot-chart-bar" style="width:'+pct+'%;background:'+col+';"></div><div class="pivot-chart-bar-val">'+numFmt(d.value)+'</div></div>';
        }).join('');
    }
  } else {
    if(chartView) chartView.style.display='none';
    if(tableView) tableView.style.display='';
  }

  // ═══ TABLE VIEW ═══
  if(!isTransposed) {
    var th='<tr>';
    if(showRank) th+='<th rowspan="2" style="width:40px;text-align:center;background:var(--bg-elevated);border-right:1px solid var(--border);">#</th>';
    rIdxs.forEach(function(r,ri){var sk=ri===0?'position:sticky;left:'+(showRank?'40px':'0')+';z-index:10;box-shadow:2px 0 5px rgba(0,0,0,.05);':'';th+='<th rowspan="2" class="pivot-sort-header" data-sort="row:'+r.name+'" onclick="window.pivotSortByHeader(this)" style="min-width:'+(ri===0?'180px':'100px')+';background:var(--bg-elevated);'+sk+'border-right:1px solid var(--border);cursor:pointer;user-select:none;">'+r.name+' <i class="ph ph-caret-up-down" style="font-size:9px;opacity:.4;"></i></th>';});
    colsList.forEach(function(c){th+='<th colspan="'+mIdxs.length+'" style="text-align:center;border-right:1px solid var(--border);">'+c+'</th>';});
    th+='<th colspan="'+mIdxs.length+'" style="text-align:center;background:rgba(255,255,255,.02);">TOTAL</th></tr><tr>';
    colsList.forEach(function(c){mIdxs.forEach(function(m,mi){th+='<th class="pivot-sort-header" data-sort="metric:'+m.name+':'+c+'" onclick="window.pivotSortByHeader(this)" style="text-align:right;font-size:10px;cursor:pointer;user-select:none;'+(mi===0?'border-left:1px solid var(--border);':'')+'">'+m.name+' <i class="ph ph-caret-up-down" style="font-size:8px;opacity:.3;"></i></th>';});});
    mIdxs.forEach(function(m,mi){th+='<th class="pivot-sort-header" data-sort="metric:'+m.name+':total" onclick="window.pivotSortByHeader(this)" style="text-align:right;font-size:10px;background:rgba(255,255,255,.02);cursor:pointer;user-select:none;'+(mi===0?'border-left:1px solid var(--border);':'')+'">'+m.name+' <i class="ph ph-caret-up-down" style="font-size:8px;opacity:.3;"></i></th>';});
    th+='</tr>';

    var tb='';var gT={};
    pagedKeys.forEach(function(rKey,rowIdx){
      var rd3=rowsMap.get(rKey);var hl=topNSet.has(rKey);
      var globalIdx=sortedKeys.indexOf(rKey)+1;
      tb+='<tr class="custom-report-row" style="'+(hl?'border-left:3px solid var(--brand-primary);':'')+'">';
      if(showRank) tb+='<td style="text-align:center;font-size:11px;color:var(--text-muted);background:var(--surface);border-right:1px solid var(--border);">'+globalIdx+'</td>';
      rd3._vals.forEach(function(v,vi){var sk=vi===0?'position:sticky;left:'+(showRank?'40px':'0')+';z-index:9;box-shadow:2px 0 5px rgba(0,0,0,.05);':'';var badge=hl&&vi===0?' <i class="ph ph-trophy" style="color:var(--warning);font-size:10px;"></i>':'';tb+='<td style="font-weight:'+(vi===0?'600':'400')+';background:var(--surface);'+sk+'border-right:1px solid var(--border);white-space:nowrap;">'+v+badge+'</td>';});
      colsList.forEach(function(c){var cd=rd3._data[c]||{};mIdxs.forEach(function(m,mi){
        var raw=doAgg(cd[m.name]||[]);var val=dispVal(raw,rd3,c,m.name);
        var cs='';if(rules.length>0){for(var ri2=0;ri2<rules.length;ri2++){if(rules[ri2].metric===m.name&&evalRule(raw,rules[ri2])){cs='color:'+rules[ri2].color+';font-weight:600;';break;}}}else if(m.name.toLowerCase().indexOf('stock')!==-1||m.name.toLowerCase().indexOf('closing')!==-1){cs=raw>0?'color:var(--green);font-weight:600;':'color:var(--text-muted);';}
        var bg=showHeatmap?heatColor(raw):'';var br=showDataBars?makeBar(raw):'';
        var dkey=rKey+'|||'+c;
        tb+='<td style="text-align:right;position:relative;'+(mi===0?'border-left:1px solid var(--border);':'')+bg+'cursor:pointer;" onclick="window.pivotDrillDown(\''+dkey.replace(/'/g,"\\'")+'\')" title="Click for detail"><span style="'+cs+'">'+fmtD(val)+'</span>'+br+'</td>';
        var gk=c+'||'+m.name;gT[gk]=(gT[gk]||0)+raw;
      });});
      mIdxs.forEach(function(m,mi){var raw=doAgg(rd3.total[m.name]||[]);tb+='<td style="text-align:right;font-weight:700;background:rgba(255,255,255,.02);'+(mi===0?'border-left:1px solid var(--border);':'')+'">'+fmtD(dispVal(raw,rd3,'_t',m.name))+'</td>';var gk='G||'+m.name;gT[gk]=(gT[gk]||0)+raw;});
      tb+='</tr>';
    });

    var tf='<tr>';
    if(showRank) tf+='<td style="border-top:2px solid var(--border);background:var(--surface);"></td>';
    rIdxs.forEach(function(r2,ri2){var sk=ri2===0?'position:sticky;left:'+(showRank?'40px':'0')+';z-index:10;box-shadow:2px 0 5px rgba(0,0,0,.05);':'';tf+='<td style="font-weight:800;background:var(--surface);'+sk+'border-right:1px solid var(--border);border-top:2px solid var(--border);">'+(ri2===0?'GRAND TOTAL':'')+'</td>';});
    colsList.forEach(function(c){mIdxs.forEach(function(m,mi){var v=gT[c+'||'+m.name]||0;tf+='<td style="text-align:right;font-weight:800;border-top:2px solid var(--border);'+(mi===0?'border-left:1px solid var(--border);':'')+'">'+numFmt(v)+'</td>';});});
    mIdxs.forEach(function(m,mi){var v=gT['G||'+m.name]||0;tf+='<td style="text-align:right;font-weight:800;background:rgba(255,255,255,.02);border-top:2px solid var(--border);'+(mi===0?'border-left:1px solid var(--border);':'')+'">'+numFmt(v)+'</td>';});
    tf+='</tr>';
    thead.innerHTML=th; tbody.innerHTML=tb; if(tfoot) tfoot.innerHTML=tf;
  } else {
    var th2='<tr><th style="min-width:160px;position:sticky;left:0;z-index:10;background:var(--bg-elevated);border-right:1px solid var(--border);">'+colDim+'</th>';
    pagedKeys.forEach(function(rKey){th2+='<th colspan="'+mIdxs.length+'" style="text-align:center;border-right:1px solid var(--border);">'+rowsMap.get(rKey)._vals[0]+'</th>';});
    th2+='</tr><tr><th style="position:sticky;left:0;z-index:10;background:var(--bg-elevated);border-right:1px solid var(--border);"></th>';
    pagedKeys.forEach(function(){mIdxs.forEach(function(m,mi){th2+='<th style="text-align:right;font-size:10px;'+(mi===0?'border-left:1px solid var(--border);':'')+'">'+m.name+'</th>';});});
    th2+='</tr>';
    var tb2='';
    colsList.forEach(function(c){tb2+='<tr class="custom-report-row"><td style="font-weight:600;background:var(--surface);position:sticky;left:0;z-index:9;border-right:1px solid var(--border);white-space:nowrap;">'+c+'</td>';
      pagedKeys.forEach(function(rKey){var rd3=rowsMap.get(rKey);var cd=rd3._data[c]||{};mIdxs.forEach(function(m,mi){
        var raw=doAgg(cd[m.name]||[]);var val=dispVal(raw,rd3,c,m.name);var cs='';if(rules.length>0){for(var ri3=0;ri3<rules.length;ri3++){if(rules[ri3].metric===m.name&&evalRule(raw,rules[ri3])){cs='color:'+rules[ri3].color+';font-weight:600;';break;}}}
        var bg=showHeatmap?heatColor(raw):'';
        tb2+='<td style="text-align:right;'+(mi===0?'border-left:1px solid var(--border);':'')+bg+'"><span style="'+cs+'">'+fmtD(val)+'</span></td>';
      });});
      tb2+='</tr>';});
    thead.innerHTML=th2; tbody.innerHTML=tb2; if(tfoot) tfoot.innerHTML='';
  }

  var sBar=document.getElementById('pivot-summary-bar');
  if(sBar){var sh='';mIdxs.forEach(function(m){var gt=grandTotal[m.name]||0;var av=sortedKeys.length?(gt/sortedKeys.length):0;sh+='<span><strong>'+m.name+':</strong> \u03A3 '+numFmt(gt)+' \u00B7 \u03BC '+numFmt(av)+' \u00B7 n='+sortedKeys.length+'</span>';});sBar.innerHTML=sh;sBar.style.display='flex';}
  var sr=document.getElementById('pivot-status-rows'),si=document.getElementById('pivot-status-info');
  if(sr) sr.textContent=sortedKeys.length+' rows \u00B7 '+colsList.length+' columns \u00B7 '+mIdxs.length+' metrics'+(pageSize!=='all'?' \u00B7 Showing '+(window._pivotPage*parseInt(pageSize)+1)+'-'+Math.min((window._pivotPage+1)*parseInt(pageSize),totalRows):'');
  var sp2=[aggMethod.toUpperCase()];if(displayMode!=='raw')sp2.push(displayMode.replace('pct_','% of '));if(showHeatmap)sp2.push('Heatmap');if(showDataBars)sp2.push('Bars');if(isTransposed)sp2.push('Transposed');if(showRank)sp2.push('Rank');if(sortCol)sp2.push('Sorted');
  if(si) si.textContent=sp2.join(' \u00B7 ');
};

/* ═══ TOOLBAR ACTIONS ═══ */
window.togglePivotSortDir=function(){window._pivotSortDir=window._pivotSortDir==='asc'?'desc':'asc';var ic=document.getElementById('pivot-sort-icon');if(ic)ic.className=window._pivotSortDir==='asc'?'ph ph-sort-ascending':'ph ph-sort-descending';window.renderPivotTable();};
window.pivotSortByHeader=function(th){var sv=th.dataset.sort;var ss=document.getElementById('pivot-sort-col');if(ss.value===sv){window.togglePivotSortDir();}else{ss.value=sv;window._pivotSortDir='asc';document.getElementById('pivot-sort-icon').className='ph ph-sort-ascending';window.renderPivotTable();}};
window.openPivotColFilter=function(){var p=document.getElementById('pivot-col-filter-panel');if(p)p.style.display=p.style.display==='none'?'flex':'none';};
window.openPivotRowFilter=function(){var p=document.getElementById('pivot-row-filter-panel');if(p)p.style.display=p.style.display==='none'?'flex':'none';};
window.togglePivotCol=function(cn,vis){if(!window._pivotHiddenCols)window._pivotHiddenCols=new Set();vis?window._pivotHiddenCols.delete(cn):window._pivotHiddenCols.add(cn);window.renderPivotTable();};
window.togglePivotRow=function(rk,vis){if(!window._pivotHiddenRows)window._pivotHiddenRows=new Set();vis?window._pivotHiddenRows.delete(rk):window._pivotHiddenRows.add(rk);window.renderPivotTable();};
window.togglePivotHeatmap=function(){window._pivotHeatmap=!window._pivotHeatmap;var b=document.getElementById('pivot-heatmap-btn');if(b)b.style.background=window._pivotHeatmap?'var(--brand-muted)':'';window.renderPivotTable();};
window.togglePivotDataBars=function(){window._pivotDataBars=!window._pivotDataBars;var b=document.getElementById('pivot-databars-btn');if(b)b.style.background=window._pivotDataBars?'var(--brand-muted)':'';window.renderPivotTable();};
window.togglePivotTranspose=function(){window._pivotTranspose=!window._pivotTranspose;window.renderPivotTable();};
window.togglePivotTopN=function(){var p=document.getElementById('pivot-topn-panel');if(p)p.style.display=p.style.display==='none'?'flex':'none';};
window.togglePivotRank=function(){window._pivotShowRank=!window._pivotShowRank;var b=document.getElementById('pivot-rank-btn');if(b)b.style.background=window._pivotShowRank?'var(--brand-muted)':'';window.renderPivotTable();};

window.setPivotView=function(view){
  window._pivotView=view;
  document.querySelectorAll('.pivot-view-tab').forEach(function(t){t.classList.toggle('active',t.dataset.view===view);});
  window.renderPivotTable();
};

window.pivotPrevPage=function(){if(window._pivotPage>0){window._pivotPage--;window.renderPivotTable();}};
window.pivotNextPage=function(){window._pivotPage++;window.renderPivotTable();};

window.pivotSelectAllCols=function(show){
  if(!window._pivotHiddenCols) window._pivotHiddenCols=new Set();
  if(show){window._pivotHiddenCols.clear();}else{
    var data=window._pivotRaw;if(!data) return;
    // hide all
    Array.from(document.querySelectorAll('#pivot-col-filter-pills input')).forEach(function(cb){
      var label=cb.parentElement.textContent.trim();
      window._pivotHiddenCols.add(label);
    });
  }
  window.renderPivotTable();
};
window.pivotSelectAllRows=function(show){
  if(!window._pivotHiddenRows) window._pivotHiddenRows=new Set();
  if(show){window._pivotHiddenRows.clear();}else{
    Array.from(document.querySelectorAll('#pivot-row-filter-pills input')).forEach(function(cb){
      var rk=cb.getAttribute('onchange').match(/togglePivotRow\('([^']+)'/);
      if(rk&&rk[1]) window._pivotHiddenRows.add(rk[1]);
    });
  }
  window.renderPivotTable();
};
window.filterRowPills=function(q){
  var pills=document.querySelectorAll('.row-pill');
  q=q.toLowerCase();
  pills.forEach(function(p){p.style.display=p.dataset.label.indexOf(q)!==-1?'':'none';});
};

window.pivotDrillDown=function(key){
  var rows=window._pivotDetail[key];if(!rows||!rows.length)return;
  var panel=document.getElementById('pivot-drilldown');var dH=document.getElementById('drilldown-head');var dB=document.getElementById('drilldown-body');var dT=document.getElementById('drilldown-title');
  var hdrs=window._pivotRaw[0];var parts=key.split('|||');
  dT.innerHTML='<i class="ph ph-magnifying-glass-plus"></i> '+parts[0].replace(/\|\|/g,' \u2192 ')+' \u00D7 '+parts[1]+' ('+rows.length+' rows)';
  dH.innerHTML='<tr>'+hdrs.map(function(h){return '<th style="font-size:11px;">'+h+'</th>';}).join('')+'</tr>';
  dB.innerHTML=rows.map(function(r){return '<tr>'+hdrs.map(function(_,j){return '<td style="font-size:12px;">'+(r[j]||'')+'</td>';}).join('')+'</tr>';}).join('');
  panel.style.display='block';panel.scrollIntoView({behavior:'smooth',block:'nearest'});
};

document.addEventListener('DOMContentLoaded',function(){
  ['pivot-agg-method','pivot-sort-col','pivot-display-mode','pivot-num-format'].forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener('change',function(){window.renderPivotTable();});});
});
window.filterCustomReport=function(query){var q=query.toLowerCase();document.querySelectorAll('.custom-report-row').forEach(function(row){var match=false;for(var i=0;i<row.cells.length;i++){if(row.cells[i].textContent.toLowerCase().indexOf(q)!==-1){match=true;break;}}row.style.display=match?'':'none';});};
document.addEventListener("DOMContentLoaded",function(){if(window.loadOverview&&window.App.currentPage==='overview'){window.loadOverview(true);}});
