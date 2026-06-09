// ===========================================================
// JAVASCRIPT — Front-end Logic (Part 2/3)
// Targets, HOD, and Customer Table Loaders
// ===========================================================

window.setHodTargetView = function(v, btn) {
  window.hodTargetView = v;
  document.querySelectorAll('#hodtarget-toggles .btn').forEach(function(b) {
    b.className = 'btn btn-sm btn-ghost';
  });
  if (btn) btn.className = 'btn btn-sm btn-primary';
  window.loadHodTargets(1);
};

window.setHodTargetPage = function(p) {
  window.hodTargetPage = p;
  window.loadHodTargets(p);
};

window.loadHodTargets = async function(page = 1) {
    const tbody = document.getElementById('tbl-targets-hod-body');
    const thead = document.getElementById('tbl-targets-hod-head');
    if (!tbody || !thead) return;
    tbody.innerHTML = window._loadingRow(5);

    let pagContainer = document.getElementById('pagination-hodtargets');
    if(!pagContainer) {
        const wrap = document.querySelector('#page-hodtargets .table-card');
        pagContainer = document.createElement('div');
        pagContainer.id = 'pagination-hodtargets';
        wrap.appendChild(pagContainer);
    }

    try {
        const rawData = await window.api('getExecutiveTargets');
        let rows = rawData || [];
        const sq = (window.searchQueries['hodtargets'] || '').toLowerCase();
        const dataKey = window.hodTargetView === 'year' ? 'YEARLY' : window.hodTargetView === 'quarter' ? 'QUARTERLY' : 'MONTHLY';

        let hodMap = {};
        rows.forEach(r => {
            let key = r.HOD + '||' + r.STATE;
            if (!hodMap[key]) hodMap[key] = { STATE: r.STATE, HOD: r.HOD, YEARLY: {}, QUARTERLY: {}, MONTHLY: {} };
            ['YEARLY', 'QUARTERLY', 'MONTHLY'].forEach(dk => {
                if (r[dk]) {
                    Object.keys(r[dk]).forEach(pk => {
                        if (!hodMap[key][dk][pk]) hodMap[key][dk][pk] = { t: 0, a: 0 };
                        hodMap[key][dk][pk].t += r[dk][pk].t || 0;
                        hodMap[key][dk][pk].a += r[dk][pk].a || 0;
                    });
                }
            });
        });

        let hodRows = Object.values(hodMap);

        if (sq) {
            hodRows = hodRows.filter(r => (r.STATE || '').toLowerCase().indexOf(sq) !== -1 || (r.HOD || '').toLowerCase().indexOf(sq) !== -1);
        }

        let allKeys = new Set();
        hodRows.forEach(r => {
            Object.keys(r[dataKey] || {}).forEach(k => { 
                if(r[dataKey][k].a > 0) allKeys.add(k); 
            });
        });

        let sortedKeys = Array.from(allKeys);
        if(window.hodTargetView === 'year' || window.hodTargetView === 'quarter') {
            sortedKeys.sort().reverse();
        } else {
            sortedKeys.sort(function(a,b) {
                let pA = a.split('_'), pB = b.split('_');
                if(pA[0] !== pB[0]) return pB[0].localeCompare(pA[0]);
                let m1 = pA[1] ? pA[1].substring(0,3).toUpperCase() : '';
                let m2 = pB[1] ? pB[1].substring(0,3).toUpperCase() : '';
                let vA = window.MN.indexOf(m1), vB = window.MN.indexOf(m2);
                vA = vA < 3 ? vA + 12 : vA; vB = vB < 3 ? vB + 12 : vB;
                return vB - vA;
            });
        }
        const displayCols = sortedKeys.slice(0, 4);
        const latestPeriod = displayCols[0] || 'N/A';

        let totalTarget = 0, totalAchv = 0;
        hodRows.forEach(r => {
            if(r[dataKey] && r[dataKey][latestPeriod]) {
                totalTarget += r[dataKey][latestPeriod].t || 0;
                totalAchv += r[dataKey][latestPeriod].a || 0;
            }
        });
        const overallPct = totalTarget > 0 ? ((totalAchv / totalTarget) * 100).toFixed(1) : (totalAchv > 0 ? 100.0 : 0.0);
        let pctColor = overallPct < 50 ? 'var(--danger)' : overallPct < 80 ? 'var(--accent4)' : 'var(--accent3)';

        const kg = document.getElementById('hod-targets-kpi-grid');
        if (kg) {
            kg.innerHTML =
              '<div class="kpi-card stagger-1" style="--kpi-color:var(--brand-primary)">'
            + '<div class="kpi-header-row"><div class="kpi-icon" style="color:var(--brand-primary)"><i class="ph ph-target"></i></div><div class="kpi-label">LATEST TARGET (' + latestPeriod.replace('_', ' ') + ')</div></div>'
            + '<div class="kpi-value" style="font-size:24px;">' + window.fmt.num(totalTarget) + '</div>'
            + '<div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:auto;">target assigned</div>'
            + '</div>'
            + '<div class="kpi-card stagger-1" style="--kpi-color:' + pctColor + '">'
            + '<div class="kpi-header-row"><div class="kpi-icon" style="color:' + pctColor + '"><i class="ph ph-trend-up"></i></div><div class="kpi-label">LATEST ACHIEVEMENT</div></div>'
            + '<div class="kpi-value" style="font-size:24px;color:' + pctColor + '">' + window.fmt.num(totalAchv) + '</div>'
            + '<div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:auto;">actual generated</div>'
            + '</div>'
            + '<div class="kpi-card stagger-1" style="--kpi-color:' + pctColor + '">'
            + '<div class="kpi-header-row"><div class="kpi-icon" style="color:' + pctColor + '"><i class="ph ph-percent"></i></div><div class="kpi-label">OVERALL ACHIEVEMENT %</div></div>'
            + '<div class="kpi-value" style="font-size:24px;color:' + pctColor + '">' + overallPct + '%</div>'
            + '<div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:auto;">conversion rate</div>'
            + '</div>'
            + '<div class="kpi-card stagger-1" style="--kpi-color:#ec4899">'
            + '<div class="kpi-header-row"><div class="kpi-icon" style="color:#ec4899"><i class="ph ph-users-three"></i></div><div class="kpi-label">TOTAL HODs</div></div>'
            + '<div class="kpi-value" style="font-size:24px;">' + hodRows.length + '</div>'
            + '<div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:auto;">matching current filters</div>'
            + '</div>';
        }

        hodRows.forEach(r => {
            let maxA = 0;
            if(r[dataKey]) Object.values(r[dataKey]).forEach(v => { if(v.a > maxA) maxA = v.a; });
            r._maxA = maxA;
        });
        hodRows.sort((a,b) => {
            let sCmp = (a.STATE||'').localeCompare(b.STATE||'');
            if (sCmp !== 0) return sCmp;
            return (b._maxA || 0) - (a._maxA || 0);
        });

        const ps = 50;
        const totalPages = Math.ceil(hodRows.length / ps) || 1;
        if (page > totalPages) page = totalPages;
        const displayRows = hodRows.slice((page - 1) * ps, page * ps);

        window._renderHodTargetTable(displayRows, displayCols, thead, tbody, dataKey, page, ps);

        window._renderPagination({ page: page, totalPages: totalPages, total: hodRows.length }, 'setHodTargetPage', 'pagination-hodtargets');
    } catch(e) {
        tbody.innerHTML = window._errorRow(5, e.message);
    }
};

window._renderHodTargetTable = function(displayRows, displayCols, thead, tbody, dataKey, page, pageSize) {
    window.App.lastTableData['hodtargets'] = displayRows;

    const stickyN   = 'position:sticky;left:0;z-index:3;background:var(--brand-primary);width:40px;padding:8px 12px;';
    const stickyST  = 'position:sticky;left:40px;z-index:3;background:var(--brand-primary);min-width:120px;padding:8px 12px;';
    const stickyHOD = 'position:sticky;left:160px;z-index:3;background:var(--brand-primary);min-width:200px;max-width:200px;border-right:1px solid rgba(255,255,255,0.2);padding:8px 12px;';

    const stickyRowN   = 'position:sticky;left:0;z-index:1;background:var(--bg-card);width:40px;padding:6px 12px;';
    const stickyRowST  = 'position:sticky;left:40px;z-index:1;background:var(--bg-card);min-width:120px;padding:6px 12px;';
    const stickyRowHOD = 'position:sticky;left:160px;z-index:1;background:var(--bg-card);min-width:200px;max-width:200px;border-right:1px solid var(--border);padding:6px 12px;';

    thead.innerHTML = '<tr>'
        + '<th style="' + stickyN + '">#</th>'
        + '<th style="' + stickyST + '">State</th>'
        + '<th style="' + stickyHOD + '">HOD Name</th>'
        + displayCols.map(c => window._targetTh(c.replace('_', ' '), c === displayCols[0], c === displayCols[0] ? 'LATEST' : '')).join('')
        + '</tr>';

    if (!displayRows.length) { tbody.innerHTML = window._emptyRow(displayCols.length + 3, 'No target data found.'); return; }

    let htmlStr = '';
    displayRows.forEach((r, i) => {
        const idx = ((page - 1) * pageSize) + i + 1;
        let html = '<td style="' + stickyRowN + '">' + idx + '</td>'
        + '<td style="font-weight:600;color:var(--text-main);white-space:nowrap;' + stickyRowST + '">' + (r.STATE || '-') + '</td>'
        + '<td style="color:var(--text-main);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' + stickyRowHOD + '" title="'+(r.HOD||'-')+'">' + (r.HOD || '-') + '</td>';
        
        displayCols.forEach(c => {
            const obj = (r[dataKey] || {})[c] || {t:0, a:0};
            html += window._targetTd(obj.t, obj.a);
        });
        htmlStr += '<tr>' + html + '</tr>';
    });
    tbody.innerHTML = htmlStr;
};

// -- EXECUTIVE TARGETS --
window.setTargetView = function(v, btn) {
  window.targetView = v;
  document.querySelectorAll('#target-toggles .btn').forEach(function(b) {
    b.className = 'btn btn-sm btn-ghost';
  });
  if (btn) btn.className = 'btn btn-sm btn-primary';
  window.loadTargets(1);
};

window.setTargetPage = function(p) {
  window.targetPage = p;
  window.loadTargets(p);
};

window.loadTargets = async function(page = 1) {
  const tbody = document.getElementById('tbl-targets-body');
  const thead = document.getElementById('tbl-targets-head');
  if (!tbody || !thead) return;
  
  tbody.innerHTML = window._loadingRow(8);
  
  let pagContainer = document.getElementById('pagination-targets');
  if(!pagContainer) {
      const wrap = document.querySelector('#page-targets .table-card:last-child');
      if(wrap) {
        pagContainer = document.createElement('div');
        pagContainer.id = 'pagination-targets';
        wrap.appendChild(pagContainer);
      }
  }

  try {
    const rawData = await window.api('getExecutiveTargets');
    let rows = rawData || [];
    
    const sq = (window.searchQueries['targets'] || '').toLowerCase();
    if (sq) {
      rows = rows.filter(function(r) {
        return (r.EMPLOYEE || '').toLowerCase().indexOf(sq) !== -1 ||
               (r.STATE || '').toLowerCase().indexOf(sq) !== -1 ||
               (r.HOD || '').toLowerCase().indexOf(sq) !== -1;
      });
    }

    const dataKey = window.targetView === 'year' ? 'YEARLY' : window.targetView === 'quarter' ? 'QUARTERLY' : 'MONTHLY';

    let allKeys = new Set();
    rows.forEach(function(r) {
      Object.keys(r[dataKey] || {}).forEach(function(k) { 
         if(r[dataKey][k].a > 0) allKeys.add(k); 
      });
    });
    
    let sortedKeys = Array.from(allKeys);
    if(window.targetView === 'year' || window.targetView === 'quarter') {
       sortedKeys.sort().reverse();
    } else {
       sortedKeys.sort(function(a,b) {
         let pA = a.split('_'), pB = b.split('_');
         if(pA[0] !== pB[0]) return pB[0].localeCompare(pA[0]);
         let m1 = pA[1] ? pA[1].substring(0,3).toUpperCase() : '';
         let m2 = pB[1] ? pB[1].substring(0,3).toUpperCase() : '';
         let vA = window.MN.indexOf(m1), vB = window.MN.indexOf(m2);
         vA = vA < 3 ? vA + 12 : vA;
         vB = vB < 3 ? vB + 12 : vB;
         return vB - vA;
       });
    }
    
    const displayCols = sortedKeys.slice(0, 4);
    const latestPeriod = displayCols[0] || 'N/A';

    let totalTarget = 0, totalAchv = 0;
    rows.forEach(r => {
       if(r[dataKey] && r[dataKey][latestPeriod]) {
           totalTarget += r[dataKey][latestPeriod].t || 0;
           totalAchv += r[dataKey][latestPeriod].a || 0;
       }
    });
    
    const overallPct = totalTarget > 0 ? ((totalAchv / totalTarget) * 100).toFixed(1) : (totalAchv > 0 ? 100.0 : 0.0);
    let pctColor = overallPct < 50 ? 'var(--danger)' : overallPct < 80 ? 'var(--accent4)' : 'var(--accent3)';

    const kpiGrid = document.getElementById('targets-kpi-grid');
    if (kpiGrid) {
       kpiGrid.innerHTML = 
          '<div class="kpi-card stagger-1" style="--kpi-color:var(--brand-primary)">'
        + '<div class="kpi-header-row"><div class="kpi-icon" style="color:var(--brand-primary)"><i class="ph ph-target"></i></div><div class="kpi-label">LATEST TARGET (' + latestPeriod.replace('_', ' ') + ')</div></div>'
        + '<div class="kpi-value" style="font-size:24px;">' + window.fmt.num(totalTarget) + '</div>'
        + '<div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:auto;">target assigned</div>'
        + '</div>'
        + '<div class="kpi-card stagger-1" style="--kpi-color:' + pctColor + '">'
        + '<div class="kpi-header-row"><div class="kpi-icon" style="color:' + pctColor + '"><i class="ph ph-trend-up"></i></div><div class="kpi-label">LATEST ACHIEVEMENT</div></div>'
        + '<div class="kpi-value" style="font-size:24px;color:' + pctColor + '">' + window.fmt.num(totalAchv) + '</div>'
        + '<div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:auto;">actual generated</div>'
        + '</div>'
        + '<div class="kpi-card stagger-1" style="--kpi-color:' + pctColor + '">'
        + '<div class="kpi-header-row"><div class="kpi-icon" style="color:' + pctColor + '"><i class="ph ph-percent"></i></div><div class="kpi-label">OVERALL ACHIEVEMENT %</div></div>'
        + '<div class="kpi-value" style="font-size:24px;color:' + pctColor + '">' + overallPct + '%</div>'
        + '<div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:auto;">conversion rate</div>'
        + '</div>'
        + '<div class="kpi-card stagger-1" style="--kpi-color:#ec4899">'
        + '<div class="kpi-header-row"><div class="kpi-icon" style="color:#ec4899"><i class="ph ph-users"></i></div><div class="kpi-label">TOTAL EXECUTIVES</div></div>'
        + '<div class="kpi-value" style="font-size:24px;">' + rows.length + '</div>'
        + '<div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:auto;">matching current filters</div>'
        + '</div>';
    }

    rows.forEach(r => {
        let maxA = 0;
        if(r[dataKey]) {
            Object.values(r[dataKey]).forEach(v => { if(v.a > maxA) maxA = v.a; });
        }
        r._maxA = maxA;
    });

    rows.sort(function(a,b) {
        let sCmp = (a.STATE||'').localeCompare(b.STATE||'');
        if (sCmp !== 0) return sCmp;
        let hCmp = (a.HOD||'').localeCompare(b.HOD||'');
        if (hCmp !== 0) return hCmp;
        return (b._maxA || 0) - (a._maxA || 0);
    });

    const ps = 50;
    const totalPages = Math.ceil(rows.length / ps) || 1;
    if (page > totalPages) page = totalPages;
    const displayRows = rows.slice((page - 1) * ps, page * ps);

    window._renderTargetTable(displayRows, displayCols, thead, tbody, dataKey, page, ps);
    
    window._renderPagination({
      page: page,
      totalPages: totalPages,
      total: rows.length
    }, 'setTargetPage', 'pagination-targets');

  } catch(e) {
    tbody.innerHTML = window._errorRow(8, e.message);
  }
};

window._targetTh = function(label, isCurrent, suffix) {
  const s = (isCurrent ? 'color:var(--brand-primary);background:var(--brand-muted);' : '')
    + 'white-space:nowrap;min-width:210px;padding:8px 12px;';
  return '<th style="' + s + '">'
    + (isCurrent ? '<span style="color:var(--brand-primary);margin-right:4px">●</span>' : '')
    + label
    + (isCurrent && suffix ? '<br><span style="font-size:9px;opacity:0.7;font-weight:700;letter-spacing:0.04em;">(' + suffix + ')</span>' : '')
    + '</th>';
};

window._renderTargetTable = function(displayRows, displayCols, thead, tbody, dataKey, page, pageSize) {
  window.App.lastTableData['targets'] = displayRows;

  const stickyN   = 'position:sticky;left:0;z-index:3;background:var(--brand-primary);width:40px;padding:8px 12px;';
  const stickyST  = 'position:sticky;left:40px;z-index:3;background:var(--brand-primary);min-width:120px;padding:8px 12px;';
  const stickyHOD = 'position:sticky;left:160px;z-index:3;background:var(--brand-primary);min-width:150px;max-width:150px;padding:8px 12px;';
  const stickyEMP = 'position:sticky;left:310px;z-index:3;background:var(--brand-primary);min-width:170px;max-width:170px;border-right:1px solid rgba(255,255,255,0.2);padding:8px 12px;';

  const stickyRowN   = 'position:sticky;left:0;z-index:1;background:var(--bg-card);width:40px;padding:6px 12px;';
  const stickyRowST  = 'position:sticky;left:40px;z-index:1;background:var(--bg-card);min-width:120px;padding:6px 12px;';
  const stickyRowHOD = 'position:sticky;left:160px;z-index:1;background:var(--bg-card);min-width:150px;max-width:150px;padding:6px 12px;';
  const stickyRowEMP = 'position:sticky;left:310px;z-index:1;background:var(--bg-card);min-width:170px;max-width:170px;border-right:1px solid var(--border);padding:6px 12px;';

  thead.innerHTML = '<tr>'
    + '<th style="' + stickyN + '">#</th>'
    + '<th style="' + stickyST + '">State</th>'
    + '<th style="' + stickyHOD + '">HOD Name</th>'
    + '<th style="' + stickyEMP + '">Executive Name</th>'
    + displayCols.map(function(c, i) { return window._targetTh(c.replace('_', ' '), i === 0, i === 0 ? 'LATEST' : ''); }).join('')
    + '</tr>';

  if (!displayRows.length) {
     tbody.innerHTML = window._emptyRow(displayCols.length + 4, 'No target data found matching your criteria.'); 
     return; 
  }
  
  let htmlStr = '';
  displayRows.forEach(function(r, i) {
    const idx = ((page - 1) * pageSize) + i + 1;
    let html = '<td style="' + stickyRowN + '">' + idx + '</td>'
      + '<td style="font-weight:600;color:var(--text-main);white-space:nowrap;' + stickyRowST + '">' + (r.STATE || '-') + '</td>'
      + '<td style="color:var(--text-main);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' + stickyRowHOD + '" title="'+(r.HOD||'-')+'">' + (r.HOD || '-') + '</td>'
      + '<td style="color:var(--text-sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' + stickyRowEMP + '" title="'+(r.EMPLOYEE||'-')+'">' + (r.EMPLOYEE || '-') + '</td>';
      
    displayCols.forEach(function(c) {
       const obj = (r[dataKey] || {})[c] || {t:0, a:0};
       html += window._targetTd(obj.t, obj.a);
    });
    
    htmlStr += '<tr>' + html + '</tr>';
  });
  tbody.innerHTML = htmlStr;
};

window._targetTd = function(target, achv) {
   target = target || 0; achv = achv || 0;
   const pct = target > 0 ? ((achv / target) * 100).toFixed(1) : (achv > 0 ? 100.0 : 0.0);
   
   let bg = 'rgba(16, 185, 129, 0.15)'; 
   let border = 'rgba(16, 185, 129, 0.3)';
   let c = '#10b981'; 
   if(pct < 50) {
       bg = 'rgba(239, 68, 68, 0.15)'; 
       border = 'rgba(239, 68, 68, 0.3)';
       c = '#ef4444'; 
   } else if(pct < 80) {
       bg = 'rgba(245, 158, 11, 0.15)'; 
       border = 'rgba(245, 158, 11, 0.3)';
       c = '#f59e0b'; 
   }
   
   let html = '<td style="min-width:180px; padding:12px 16px; vertical-align:middle;">';
   if(target === 0 && achv === 0) {
       html += '<div style="color:var(--text-faint);text-align:center;font-size:14px;font-weight:600;">—</div></td>';
       return html;
   }
   
   html += '<div style="display:flex; align-items:flex-end; justify-content:space-between; margin-bottom:8px;">';
   html += '<div style="font-size:13.5px; font-weight:800; color:var(--text-main); white-space:nowrap;" title="' + window.fmt.num(achv) + ' Achieved / ' + window.fmt.num(target) + ' Target">' + window.fmt.short(achv) + ' <span style="color:var(--text-muted); font-size:11.5px; font-weight:600;">/ ' + window.fmt.short(target) + '</span></div>';
   html += '<div style="font-size:12px; font-weight:800; color:' + c + ';">' + pct + '%</div>';
   html += '</div>';
   html += '<div style="height:6px; background:var(--bg-hover); border-radius:100px; overflow:hidden;">';
   html += '<div style="height:100%; width:' + Math.min(pct, 100) + '%; background:' + c + '; border-radius:100px;"></div>';
   html += '</div></td>';
   return html;
};

// ══════════════════════════════════════════════════════════
// HOD PERFORMANCE — YEAR / QUARTER / MONTH TOGGLE
// ══════════════════════════════════════════════════════════

window.comparisonMode = 'none';

window.setComparisonMode = function(mode, btn) {
  window.comparisonMode = mode;
  document.querySelectorAll('.comp-toggles .btn').forEach(function(b) {
    b.className = 'btn btn-sm btn-ghost';
  });
  if (btn) btn.className = 'btn btn-sm btn-primary';
  
  if (document.getElementById('page-hodqoq').classList.contains('active')) {
    window.loadHODQoQ();
  }
  if (document.getElementById('page-custqoq').classList.contains('active')) {
    window.loadCustSale(window.custSalePage || 1);
  }
  if (document.getElementById('page-product').classList.contains('active')) {
    if (typeof window.loadTimeWiseSales === 'function') window.loadTimeWiseSales();
  }
  if (document.getElementById('page-hodsku').classList.contains('active')) {
    if (typeof window.loadHodSkuSales === 'function') window.loadHodSkuSales();
  }
};

window._getCompBaseIndex = function(selId, viewType, optionsArray, getValFn) {
  const sel = document.getElementById(selId);
  if (!sel) return 0;
  if (window.comparisonMode === 'none' || optionsArray.length === 0) {
    sel.style.display = 'none';
    return 0;
  }
  
  sel.style.display = 'inline-block';
  if (sel.dataset.view !== viewType || sel.options.length === 0) {
    sel.innerHTML = optionsArray.map(function(opt) {
      const v = getValFn ? getValFn(opt) : opt;
      const l = typeof opt === 'object' ? opt.label : opt;
      return '<option value="' + v + '">Base: ' + l + '</option>';
    }).join('');
    sel.dataset.view = viewType;
    sel.value = getValFn ? getValFn(optionsArray[0]) : optionsArray[0];
  }
  
  if (sel.value) {
    let idx = optionsArray.findIndex(function(opt) { return (getValFn ? getValFn(opt) : opt) === sel.value; });
    return idx === -1 ? 0 : idx;
  }
  return 0;
};

window._currentQuarter = function() {
  const m = new Date().getMonth() + 1;
  if (m >= 4 && m <= 6)   return 'Q1';
  if (m >= 7 && m <= 9)   return 'Q2';
  if (m >= 10 && m <= 12) return 'Q3';
  return 'Q4';
};

window._currentFY = function() {
  const d = new Date(), y = d.getFullYear(), m = d.getMonth() + 1;
  return m >= 4
    ? 'FY ' + String(y).slice(2)     + '-' + String(y + 1).slice(2)
    : 'FY ' + String(y - 1).slice(2) + '-' + String(y).slice(2);
};

window.setHodView = function(v, btn) {
  window.hodView = v;
  document.querySelectorAll('#page-hodqoq .btn-group .btn').forEach(function(b) {
    b.className = 'btn btn-sm btn-ghost';
  });
  if (btn) btn.className = 'btn btn-sm btn-primary';
  window.loadHODQoQ();
};

window._renderHodToggles = function() {
  const tbar = document.querySelector('#page-hodqoq .table-toolbar');
  if (!tbar) return;
  const old = document.getElementById('hod-toggles');
  if (old) old.innerHTML =
    '<button class="btn btn-sm ' + (window.hodView === 'month'   ? 'btn-primary' : 'btn-ghost') + '" onclick="window.setHodView(\'month\',this)">Month</button>'
  + '<button class="btn btn-sm ' + (window.hodView === 'quarter' ? 'btn-primary' : 'btn-ghost') + '" onclick="window.setHodView(\'quarter\',this)">Quarter</button>'
  + '<button class="btn btn-sm ' + (window.hodView === 'year'    ? 'btn-primary' : 'btn-ghost') + '" onclick="window.setHodView(\'year\',this)">Year</button>';
};

window.loadHODQoQ = async function() {
  window._renderHodToggles();
  const tbody = document.getElementById('tbl-hodqoq-body');
  const thead = document.getElementById('tbl-hodqoq-head');
  if (!tbody || !thead) return;
  tbody.innerHTML = window._loadingRow(6);
  try {
    if (window.hodView === 'year')       await window._loadHODByYear(tbody, thead);
    else if (window.hodView === 'month') await window._loadHODByMonth(tbody, thead);
    else                                  await window._loadHODByQuarter(tbody, thead);
  } catch(e) {
    tbody.innerHTML = window._errorRow(6, e.message);
  }
};

window._hodTh = function(label, isCurrent, suffix, hasVariance) {
  const s = (isCurrent ? 'color:var(--brand-primary);background:var(--brand-muted);' : '')
    + 'white-space:nowrap;min-width:110px;padding:12px 14px;text-align:right;';
  let html = '<th style="' + s + '">'
    + (isCurrent ? '<span style="color:var(--brand-primary);margin-right:4px">●</span>' : '')
    + label
    + (isCurrent && suffix ? '<br><span style="font-size:10px;opacity:0.7;font-weight:600">(' + suffix + ')</span>' : '')
    + '</th>';
  return html;
};

window._hodTd = function(rawVal, isCurrent, rawPrevVal) {
  const v1 = parseFloat(rawVal) || 0;
  let valStr = v1 !== 0 ? window.fmt.num(v1) : '<span style="color:var(--text-faint)">—</span>';
  
  if (rawPrevVal !== undefined) {
      const v2 = parseFloat(rawPrevVal) || 0;
      let pctHtml = '';
      if (v1 === 0 && v2 === 0) {
          pctHtml = '<span style="color:var(--text-muted); font-size:11.5px; font-weight:700;">0.0%</span>';
      } else if (v2 === 0 && v1 > 0) {
          pctHtml = '<span style="color:var(--accent3); font-size:11.5px; font-weight:700;">↑ 100.0%</span>';
      } else if (v1 === 0 && v2 > 0) {
          pctHtml = '<span style="color:var(--danger); font-size:11.5px; font-weight:700;">↓ 100.0%</span>';
      } else {
          const pct = (((v1 - v2) / v2) * 100).toFixed(1);
          let color = pct > 0 ? 'var(--accent3)' : (pct < 0 ? 'var(--danger)' : 'var(--text-muted)');
          let arrow = pct > 0 ? '↑ ' : (pct < 0 ? '↓ ' : '');
          pctHtml = '<span style="color:' + color + '; font-size:11.5px; font-weight:700;">' + arrow + Math.abs(pct) + '%</span>';
      }
      
      let inner = '<div>' + valStr + '</div>';
      inner += '<div style="margin-top:2px;">' + pctHtml + '</div>';
      
      return '<td style="padding:12px 14px;min-width:110px;vertical-align:top;text-align:right;' + (isCurrent ? 'font-weight:700;background:var(--brand-muted);color:var(--text-main)' : '') + '">' + inner + '</td>';
  }
  
  return '<td style="padding:12px 14px;min-width:110px;vertical-align:top;text-align:right;' + (isCurrent ? 'font-weight:700;background:var(--brand-muted);color:var(--text-main)' : '') + '">' + valStr + '</td>';
};

window._loadHODByMonth = async function(tbody, thead) {
  const months = (window.App.filterOptions.month || []).filter(function(m) { return m !== 'All'; });
  if (!months.length) { tbody.innerHTML = window._emptyRow(4, 'No month data available.'); return; }

  const recent = months.slice().reverse();
  tbody.innerHTML = window._loadingRow(recent.length + 3);

  const stickyN   = 'position:sticky;left:0;z-index:3;background:var(--brand-primary);width:44px;padding:8px 12px;';
  const stickyHOD = 'position:sticky;left:44px;z-index:3;background:var(--brand-primary);min-width:160px;max-width:160px;padding:8px 12px;';
  const stickyST  = 'position:sticky;left:204px;z-index:3;background:var(--brand-primary);min-width:110px;border-right:1px solid var(--border);padding:8px 12px;';
  
  const stickyRowN   = 'position:sticky;left:0;z-index:1;background:var(--bg-card);width:44px;padding:6px 12px;';
  const stickyRowHOD = 'position:sticky;left:44px;z-index:1;background:var(--bg-card);min-width:160px;max-width:160px;padding:6px 12px;';
  const stickyRowST  = 'position:sticky;left:204px;z-index:1;background:var(--bg-card);min-width:110px;border-right:1px solid var(--border);padding:6px 12px;';

  try {
    const rows = await window.api('getHODMonthlySummary', {
      filters: Object.assign({}, window.App.filters, { quarter: 'All', fy: 'All' })
    });

    if (!rows || !rows.length) {
      tbody.innerHTML = window._emptyRow(recent.length + 3, 'No monthly HOD data.');
      return;
    }

    const hodMap = {};
    const sq = (window.searchQueries['hodqoq'] || '').toLowerCase();
    rows.forEach(function(r) {
      const key = (r.HOD || '') + '||' + (r.STATE || '');
      if (sq && (r.HOD||'').toLowerCase().indexOf(sq) === -1 && (r.STATE||'').toLowerCase().indexOf(sq) === -1) return;
      if (!hodMap[key]) hodMap[key] = { HOD: r.HOD || '-', STATE: r.STATE || '-' };
      if (recent.indexOf(r.MONTH) !== -1) hodMap[key][r.MONTH] = r.TOTAL_SQFT || 0;
    });

    let sorted = Object.values(hodMap).sort(function(a, b) {
      return (b[recent[0]] || 0) - (a[recent[0]] || 0);
    });
    
    window.App.lastTableData['hodqoq'] = sorted;

    const baseIdx = window._getCompBaseIndex('hod-comp-period', 'month', recent);
    const offsetRecent = recent.slice(baseIdx);

    let displayMonths = offsetRecent;
    if (window.comparisonMode === 'pop') {
        displayMonths = offsetRecent.slice(0, 2);
    } else if (window.comparisonMode === 'yoy') {
        displayMonths = [];
        let currM = offsetRecent[0];
        while (currM && recent.indexOf(currM) !== -1) {
            displayMonths.push(currM);
            currM = currM.replace(/\d+$/, function(yr) { return parseInt(yr) - 1; });
        }
    }

    if (window.comparisonMode !== 'none' && displayMonths.length >= 2) {
        sorted = sorted.filter(function(r) { 
            return Math.abs(parseFloat(r[displayMonths[0]]) || 0) > 0.001 || Math.abs(parseFloat(r[displayMonths[1]]) || 0) > 0.001; 
        });
    }

    thead.innerHTML = '<tr>'
      + '<th style="' + stickyN + '">#</th>'
      + '<th style="' + stickyHOD + '">HOD Name</th>'
      + '<th style="' + stickyST + '">State</th>'
      + displayMonths.map(function(m, i) { 
          let sub = '';
          if (i === 0) sub = 'latest';
          else if (window.comparisonMode === 'pop') sub = 'prev';
          else if (window.comparisonMode === 'yoy') sub = i + ' yr ago';
          const hasVar = (window.comparisonMode !== 'none' && i + 1 < displayMonths.length);
          return window._hodTh(m, i === 0, sub, hasVar); 
        }).join('')
      + '</tr>';

    if (!sorted.length) { tbody.innerHTML = window._emptyRow(displayMonths.length + 3, 'No data found.'); return; }
    
    let htmlStr = '';
    sorted.forEach(function(r, i) {
      let html = '<td style="' + stickyRowN + '">' + (i+1) + '</td>'
        + '<td style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' + stickyRowHOD + ';color:var(--text-main)">' + r.HOD + '</td>'
        + '<td style="color:var(--text-muted);white-space:nowrap;' + stickyRowST + '">' + r.STATE + '</td>'
        + displayMonths.map(function(m, mi) {
            const val = r[m] || 0;
            let prevVal;
            if (window.comparisonMode !== 'none' && (mi + 1 < displayMonths.length)) {
                prevVal = r[displayMonths[mi + 1]] || 0;
            }
            return window._hodTd(val, mi === 0, prevVal);
          }).join('');
      htmlStr += '<tr>' + html + '</tr>';
    });
    tbody.innerHTML = htmlStr;

  } catch(e) {
    tbody.innerHTML = window._emptyRow(recent.length + 3, 'Error: ' + e.message);
    window.toast('Month view error: ' + e.message, 'error', 6000);
  }
};

window._loadHODByQuarter = async function(tbody, thead) {
  const allFYs = (window.App.filterOptions.fy || []).filter(function(f) { return f !== 'All'; });
  if (!allFYs.length) { tbody.innerHTML = window._emptyRow(6, 'No FY data available.'); return; }

  const curFY  = allFYs.slice().sort().reverse()[0];
  const curQ   = window._currentQuarter();
  const qNums  = ['Q1','Q2','Q3','Q4'];
  const qField = { Q1: 'Q1_SQFT', Q2: 'Q2_SQFT', Q3: 'Q3_SQFT', Q4: 'Q4_SQFT' };

  const sortedFYs = allFYs.slice().sort(function(a, b) {
    if (a === curFY) return -1; if (b === curFY) return 1;
    return b.localeCompare(a);
  });

  let fyDataList = [];
  try {
     fyDataList = await window.api('getHODAllFYSummary', {
        filters: Object.assign({}, window.App.filters, { quarter: 'All', month: 'All', fy: 'All' })
     });
  } catch(e) {}

  const fyData = {};
  sortedFYs.forEach(fy => fyData[fy] = {});
  
  (fyDataList || []).forEach(function(r) {
      if (fyData[r.FY]) {
          const k = (r.HOD || '') + '||' + (r.STATE || '');
          fyData[r.FY][k] = r;
      }
  });

  const cols = [];
  const curQIdx = qNums.indexOf(curQ);
  cols.push({ fy: curFY, q: curQ, key: curFY + '_' + curQ, label: curFY.replace('FY ','FY-') + ' ' + curQ, field: qField[curQ], current: true });
  for (let qi = curQIdx - 1; qi >= 0; qi--) {
    const q = qNums[qi];
    cols.push({ fy: curFY, q: q, key: curFY + '_' + q, label: curFY.replace('FY ','FY-') + ' ' + q, field: qField[q], current: false });
  }
  sortedFYs.filter(function(fy) { return fy !== curFY; }).forEach(function(fy) {
    ['Q4','Q3','Q2','Q1'].forEach(function(q) {
      cols.push({ fy: fy, q: q, key: fy + '_' + q, label: fy.replace('FY ','FY-') + ' ' + q, field: qField[q], current: false });
    });
  });

  const allKeys = {};
  const sq = (window.searchQueries['hodqoq'] || '').toLowerCase();
  sortedFYs.forEach(function(fy) {
    Object.keys(fyData[fy] || {}).forEach(function(k) {
      const r = fyData[fy][k];
      if (sq && (r.HOD||'').toLowerCase().indexOf(sq) === -1 && (r.STATE||'').toLowerCase().indexOf(sq) === -1) return;
      if (!allKeys[k]) {
        allKeys[k] = { HOD: r.HOD || '-', STATE: r.STATE || '-' };
      }
    });
  });

  let sorted = Object.keys(allKeys).map(function(k) {
    const entry = Object.assign({}, allKeys[k]);
    cols.forEach(function(col) {
      const row = (fyData[col.fy] || {})[k];
      entry[col.key] = row ? (row[col.field] || 0) : 0;
    });
    return entry;
  }).sort(function(a, b) {
    return (b[cols[0].key] || 0) - (a[cols[0].key] || 0);
  });
  
  window.App.lastTableData['hodqoq'] = sorted;

  const stickyN   = 'position:sticky;left:0;z-index:3;background:var(--brand-primary);width:44px;padding:8px 12px;';
  const stickyHOD = 'position:sticky;left:44px;z-index:3;background:var(--brand-primary);min-width:160px;max-width:160px;padding:8px 12px;';
  const stickyST  = 'position:sticky;left:204px;z-index:3;background:var(--brand-primary);min-width:110px;border-right:1px solid var(--border);padding:8px 12px;';
  
  const stickyRowN   = 'position:sticky;left:0;z-index:1;background:var(--bg-card);width:44px;padding:6px 12px;';
  const stickyRowHOD = 'position:sticky;left:44px;z-index:1;background:var(--bg-card);min-width:160px;max-width:160px;padding:6px 12px;';
  const stickyRowST  = 'position:sticky;left:204px;z-index:1;background:var(--bg-card);min-width:110px;border-right:1px solid var(--border);padding:6px 12px;';

  const baseIdx = window._getCompBaseIndex('hod-comp-period', 'quarter', cols, function(c) { return c.key; });
  const offsetCols = cols.slice(baseIdx);

  let displayCols = offsetCols;
  if (window.comparisonMode === 'pop' && offsetCols.length >= 2) {
      displayCols = [offsetCols[0], offsetCols[1]];
  } else if (window.comparisonMode === 'yoy' && offsetCols.length > 0) {
      displayCols = [];
      let currKey = offsetCols[0].key;
      while (currKey) {
          const colObj = cols.find(function(c) { return c.key === currKey; });
          if (!colObj) {
              displayCols.push({ key: currKey, label: currKey.replace('_', ' ').replace('FY ','FY-'), current: false });
          } else {
              displayCols.push(colObj);
          }
          const nextKey = currKey.replace(/FY (\d+)-(\d+)/, function(match, y1, y2) { return 'FY ' + (parseInt(y1) - 1) + '-' + (parseInt(y2) - 1); });
          if (!allFYs.includes(nextKey.split('_')[0])) break;
          currKey = nextKey;
      }
  }

  if (window.comparisonMode !== 'none' && displayCols.length >= 2) {
      sorted = sorted.filter(function(r) { 
          return Math.abs(parseFloat(r[displayCols[0].key]) || 0) > 0.001 || Math.abs(parseFloat(r[displayCols[1].key]) || 0) > 0.001; 
      });
  }

  thead.innerHTML = '<tr>'
    + '<th style="' + stickyN + '">#</th>'
    + '<th style="' + stickyHOD + '">HOD Name</th>'
    + '<th style="' + stickyST + '">State</th>'
    + displayCols.map(function(c, i) { 
        let sub = '';
        if (c.current) sub = 'current';
        else if (window.comparisonMode === 'pop') sub = 'prev';
        else if (window.comparisonMode === 'yoy' && i > 0) sub = i + ' yr ago';
        const hasVar = (window.comparisonMode !== 'none' && i + 1 < displayCols.length);
        return window._hodTh(c.label, c.current, sub, hasVar); 
      }).join('')
    + '</tr>';

  if (!sorted.length) { tbody.innerHTML = window._emptyRow(displayCols.length + 3, 'No data.'); return; }
  
  let htmlStr = '';
  sorted.forEach(function(r, i) {
    let html = '<td style="' + stickyRowN + '">' + (i + 1) + '</td>'
      + '<td style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-main);' + stickyRowHOD + '">' + r.HOD + '</td>'
      + '<td style="color:var(--text-muted);white-space:nowrap;' + stickyRowST + '">' + r.STATE + '</td>'
      + displayCols.map(function(c, mi) {
          const val = r[c.key] || 0;
          let prevVal;
          if (window.comparisonMode !== 'none' && (mi + 1 < displayCols.length)) {
              prevVal = r[displayCols[mi + 1].key] || 0;
          }
          return window._hodTd(val, c.current, prevVal);
        }).join('');
    htmlStr += '<tr>' + html + '</tr>';
  });
  tbody.innerHTML = htmlStr;
};

window._loadHODByYear = async function(tbody, thead) {
  const allFYs = (window.App.filterOptions.fy || []).filter(function(f) { return f !== 'All'; });
  if (!allFYs.length) { tbody.innerHTML = window._emptyRow(6, 'No FY data available.'); return; }

  const curFY = allFYs.slice().sort().reverse()[0];
  const sortedFYs = allFYs.slice().sort(function(a, b) {
    if (a === curFY) return -1; if (b === curFY) return 1;
    return b.localeCompare(a);
  });

  let fyDataList = [];
  try {
     fyDataList = await window.api('getHODAllFYSummary', {
        filters: Object.assign({}, window.App.filters, { quarter: 'All', month: 'All', fy: 'All' })
     });
  } catch(e) {}

  const fyData = {};
  sortedFYs.forEach(fy => fyData[fy] = {});
  
  (fyDataList || []).forEach(function(r) {
      if (fyData[r.FY]) {
          const k = (r.HOD || '') + '||' + (r.STATE || '');
          fyData[r.FY][k] = r;
      }
  });

  const allKeys = {};
  const sq = (window.searchQueries['hodqoq'] || '').toLowerCase();
  sortedFYs.forEach(function(fy) {
    Object.keys(fyData[fy] || {}).forEach(function(k) {
      const r = fyData[fy][k];
      if (sq && (r.HOD||'').toLowerCase().indexOf(sq) === -1 && (r.STATE||'').toLowerCase().indexOf(sq) === -1) return;
      if (!allKeys[k]) {
        allKeys[k] = { HOD: r.HOD || '-', STATE: r.STATE || '-' };
      }
    });
  });

  let sorted = Object.keys(allKeys).map(function(k) {
    const entry = Object.assign({}, allKeys[k]);
    sortedFYs.forEach(function(fy) {
      const row = (fyData[fy] || {})[k];
      entry[fy] = row ? (row.TOTAL_SQFT || 0) : 0;
    });
    return entry;
  }).sort(function(a, b) { return (b[curFY] || 0) - (a[curFY] || 0); });
  
  window.App.lastTableData['hodqoq'] = sorted;

  const stickyN   = 'position:sticky;left:0;z-index:3;background:var(--brand-primary);width:44px;padding:8px 12px;';
  const stickyHOD = 'position:sticky;left:44px;z-index:3;background:var(--brand-primary);min-width:160px;max-width:160px;padding:8px 12px;';
  const stickyST  = 'position:sticky;left:204px;z-index:3;background:var(--brand-primary);min-width:110px;border-right:1px solid var(--border);padding:8px 12px;';
  
  const stickyRowN   = 'position:sticky;left:0;z-index:1;background:var(--bg-card);width:44px;padding:6px 12px;';
  const stickyRowHOD = 'position:sticky;left:44px;z-index:1;background:var(--bg-card);min-width:160px;max-width:160px;padding:6px 12px;';
  const stickyRowST  = 'position:sticky;left:204px;z-index:1;background:var(--bg-card);min-width:110px;border-right:1px solid var(--border);padding:6px 12px;';

  const baseIdx = window._getCompBaseIndex('hod-comp-period', 'year', sortedFYs);
  const offsetFYs = sortedFYs.slice(baseIdx);

  let displayFYs = offsetFYs;
  if (window.comparisonMode === 'pop' && offsetFYs.length >= 2) {
      displayFYs = [offsetFYs[0], offsetFYs[1]];
  } else if (window.comparisonMode === 'yoy') {
      displayFYs = offsetFYs;
  }

  if (window.comparisonMode !== 'none' && displayFYs.length >= 2) {
      sorted = sorted.filter(function(r) { 
          return Math.abs(parseFloat(r[displayFYs[0]]) || 0) > 0.001 || Math.abs(parseFloat(r[displayFYs[1]]) || 0) > 0.001; 
      });
  }

  thead.innerHTML = '<tr>'
    + '<th style="' + stickyN + '">#</th>'
    + '<th style="' + stickyHOD + '">HOD Name</th>'
    + '<th style="' + stickyST + '">State</th>'
    + displayFYs.map(function(fy, i) { 
        let sub = '';
        if (fy === curFY) sub = 'current';
        else if (window.comparisonMode === 'pop' && i===1) sub = 'prev';
        else if (window.comparisonMode === 'yoy' && i > 0) sub = i + ' yr ago';
        const hasVar = (window.comparisonMode !== 'none' && i + 1 < displayFYs.length);
        return window._hodTh(fy, fy === curFY, sub, hasVar); 
      }).join('')
    + '</tr>';

  if (!sorted.length) { tbody.innerHTML = window._emptyRow(displayFYs.length + 3, 'No data.'); return; }
  
  let htmlStr = '';
  sorted.forEach(function(r, i) {
    let html = '<td style="' + stickyRowN + '">' + (i+1) + '</td>'
      + '<td style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-main);' + stickyRowHOD + '">' + r.HOD + '</td>'
      + '<td style="color:var(--text-muted);white-space:nowrap;' + stickyRowST + '">' + r.STATE + '</td>'
      + displayFYs.map(function(fy, mi) {
          const val = r[fy] || 0, isCur = fy === curFY;
          let prevVal;
          if (window.comparisonMode !== 'none' && (mi + 1 < displayFYs.length)) {
              prevVal = r[displayFYs[mi + 1]] || 0;
          }
          return window._hodTd(val, isCur, prevVal);
        }).join('');
    htmlStr += '<tr>' + html + '</tr>';
  });
  tbody.innerHTML = htmlStr;
};

// ══════════════════════════════════════════════════════════
// CUSTOMER WISE SALE LOADERS 
// ══════════════════════════════════════════════════════════

window.setCustView = function(v, btn) {
  window.custSaleView = v;
  document.querySelectorAll('#custqoq-toggles .btn').forEach(function(b) {
    b.className = 'btn btn-sm btn-ghost';
  });
  if (btn) btn.className = 'btn btn-sm btn-primary';
  window.loadCustSale(1);
};

window.setCustSalePage = function(p) {
  window.custSalePage = p;
  window.loadCustSale(p);
};

window.loadCustSale = async function(page = 1) {
  const tbody = document.getElementById('tbl-custqoq-body');
  const thead = document.getElementById('tbl-custqoq-head');
  if (!tbody || !thead) return;
  tbody.innerHTML = window._loadingRow(6);
  
  let pagContainer = document.getElementById('pagination-custqoq');
  if(!pagContainer) {
      const wrap = document.querySelector('#page-custqoq .table-card');
      if(wrap) {
        pagContainer = document.createElement('div');
        pagContainer.id = 'pagination-custqoq';
        wrap.appendChild(pagContainer);
      }
  }

  try {
    if (window.custSaleView === 'year')       await window._loadCustByYear(tbody, thead, page);
    else if (window.custSaleView === 'month') await window._loadCustByMonth(tbody, thead, page);
    else                               await window._loadCustByQuarter(tbody, thead, page);
  } catch(e) {
    tbody.innerHTML = window._errorRow(6, e.message);
  }
};

window._custTh = function(label, isCurrent, suffix, hasVariance) {
  const s = (isCurrent ? 'color:var(--brand-primary);background:var(--brand-muted);' : '')
    + 'white-space:nowrap;min-width:110px;padding:12px 14px;text-align:right;';
  let html = '<th style="' + s + '">'
    + (isCurrent ? '<span style="color:var(--brand-primary);margin-right:4px">●</span>' : '')
    + label
    + (isCurrent && suffix ? '<br><span style="font-size:10px;opacity:0.7;font-weight:600">(' + suffix + ')</span>' : '')
    + '</th>';
  return html;
};

window._custTd = window._hodTd;

window._loadCustByMonth = async function(tbody, thead, page) {
  const months = (window.App.filterOptions.month || []).filter(m => m !== 'All');
  if (!months.length) { tbody.innerHTML = window._emptyRow(4, 'No month data.'); return; }
  const recent = months.slice().reverse();
  
  const stickyST  = 'position:sticky;left:0;z-index:3;background:var(--brand-primary);min-width:100px;padding:8px 12px;';
  const stickyHOD = 'position:sticky;left:100px;z-index:3;background:var(--brand-primary);min-width:120px;padding:8px 12px;';
  const stickyC   = 'position:sticky;left:220px;z-index:3;background:var(--brand-primary);min-width:180px;max-width:180px;border-right:1px solid rgba(255,255,255,0.2);padding:8px 12px;';
  
  const stickyRowST  = 'position:sticky;left:0;z-index:1;background:var(--bg-card);min-width:100px;padding:6px 12px;';
  const stickyRowHOD = 'position:sticky;left:100px;z-index:1;background:var(--bg-card);min-width:120px;padding:6px 12px;';
  const stickyRowC   = 'position:sticky;left:220px;z-index:1;background:var(--bg-card);min-width:180px;max-width:180px;border-right:1px solid var(--border);padding:6px 12px;';

  try {
    const rows = await window.api('getCustomerMonthlySummary', {
      filters: Object.assign({}, window.App.filters, { fy: 'All', quarter: 'All' })
    });
    const sq = (window.searchQueries['custqoq'] || '').toLowerCase();
    const map = {};
    rows.forEach(r => {
      const key = r.STATE + '||' + r.HOD + '||' + r.CUSTOMER;
      if (sq && key.toLowerCase().indexOf(sq) === -1) return;
      if (!map[key]) map[key] = { ST: r.STATE, HOD: r.HOD, C: r.CUSTOMER };
      if (recent.indexOf(r.MONTH) !== -1) map[key][r.MONTH] = r.TOTAL_SQFT;
    });

    let sorted = Object.values(map).sort((a,b) => (b[recent[0]]||0) - (a[recent[0]]||0));

    const baseIdx = window._getCompBaseIndex('cust-comp-period', 'month', recent);
    const offsetRecent = recent.slice(baseIdx);

    let displayMonths = offsetRecent;
    if (window.comparisonMode === 'pop') {
        displayMonths = offsetRecent.slice(0, 2);
    } else if (window.comparisonMode === 'yoy') {
        displayMonths = [];
        let currM = offsetRecent[0];
        while (currM && recent.indexOf(currM) !== -1) {
            displayMonths.push(currM);
            currM = currM.replace(/\d+$/, yr => parseInt(yr) - 1);
        }
    }

    if (window.comparisonMode !== 'none' && displayMonths.length >= 2) {
        sorted = sorted.filter(r => Math.abs(parseFloat(r[displayMonths[0]]) || 0) > 0.001 || Math.abs(parseFloat(r[displayMonths[1]]) || 0) > 0.001);
    }

    const ps = 50, totalPages = Math.ceil(sorted.length / ps) || 1;
    const displayRows = sorted.slice((page-1)*ps, page*ps);
    window.App.lastTableData['custqoq'] = displayRows;

    thead.innerHTML = '<tr><th style="' + stickyST + '">State</th><th style="' + stickyHOD + '">HOD</th><th style="' + stickyC + '">Customer</th>'
      + displayMonths.map((m, i) => {
          let sub = '';
          if (i === 0) sub = 'latest';
          else if (window.comparisonMode === 'pop') sub = 'prev';
          else if (window.comparisonMode === 'yoy') sub = i + ' yr ago';
          const hasVar = (window.comparisonMode !== 'none' && i + 1 < displayMonths.length);
          return window._custTh(m, i === 0, sub, hasVar);
      }).join('') + '</tr>';

    if (!sorted.length) { tbody.innerHTML = window._emptyRow(displayMonths.length + 3); return; }
    
    let html = '';
    displayRows.forEach(r => {
      html += '<tr><td style="' + stickyRowST + '">' + r.ST + '</td><td style="' + stickyRowHOD + '">' + r.HOD + '</td><td style="' + stickyRowC + ';font-weight:700;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + r.C + '">' + r.C + '</td>'
        + displayMonths.map((m, mi) => {
            const val = r[m] || 0;
            let prevVal;
            if (window.comparisonMode !== 'none' && (mi + 1 < displayMonths.length)) {
                prevVal = r[displayMonths[mi + 1]] || 0;
            }
            return window._custTd(val, mi === 0, prevVal);
        }).join('') + '</tr>';
    });
    tbody.innerHTML = html;
    window._renderPagination({ page: page, totalPages: totalPages, total: sorted.length }, 'setCustSalePage', 'pagination-custqoq');
  } catch(e) { tbody.innerHTML = window._errorRow(6, e.message); }
};

window._loadCustByQuarter = async function(tbody, thead, page) {
  const allFYsLocal = (window.App.filterOptions.fy || []).filter(f => f !== 'All');
  if (!allFYsLocal.length) { tbody.innerHTML = window._emptyRow(6, 'No FY data available.'); return; }

  const sortedFYsList = allFYsLocal.slice().sort().reverse();
  const curFY = sortedFYsList[0];
  const curQ  = window._currentQuarter();
  const qNums = ['Q1','Q2','Q3','Q4'];
  const qField = { Q1: 'Q1_SQFT', Q2: 'Q2_SQFT', Q3: 'Q3_SQFT', Q4: 'Q4_SQFT' };

  const stickyST  = 'position:sticky;left:0;z-index:3;background:var(--brand-primary);min-width:100px;padding:8px 12px;';
  const stickyHOD = 'position:sticky;left:100px;z-index:3;background:var(--brand-primary);min-width:120px;padding:8px 12px;';
  const stickyC   = 'position:sticky;left:220px;z-index:3;background:var(--brand-primary);min-width:180px;max-width:180px;border-right:1px solid rgba(255,255,255,0.2);padding:8px 12px;';

  const stickyRowST  = 'position:sticky;left:0;z-index:1;background:var(--bg-card);min-width:100px;padding:6px 12px;';
  const stickyRowHOD = 'position:sticky;left:100px;z-index:1;background:var(--bg-card);min-width:120px;padding:6px 12px;';
  const stickyRowC   = 'position:sticky;left:220px;z-index:1;background:var(--bg-card);min-width:180px;max-width:180px;border-right:1px solid var(--border);padding:6px 12px;';

  try {
    const dataList = await window.api('getCustomerAllFYSummary');
    const sq = (window.searchQueries['custqoq'] || '').toLowerCase();

    const fyData = {};
    sortedFYsList.forEach(fy => fyData[fy] = {});
    dataList.forEach(r => {
      if (fyData[r.FY]) {
        const k = r.STATE + '||' + r.HOD + '||' + r.CUSTOMER;
        if (!fyData[r.FY][k]) fyData[r.FY][k] = r;
        else {
          fyData[r.FY][k].Q1_SQFT = (fyData[r.FY][k].Q1_SQFT || 0) + (r.Q1_SQFT || 0);
          fyData[r.FY][k].Q2_SQFT = (fyData[r.FY][k].Q2_SQFT || 0) + (r.Q2_SQFT || 0);
          fyData[r.FY][k].Q3_SQFT = (fyData[r.FY][k].Q3_SQFT || 0) + (r.Q3_SQFT || 0);
          fyData[r.FY][k].Q4_SQFT = (fyData[r.FY][k].Q4_SQFT || 0) + (r.Q4_SQFT || 0);
        }
      }
    });

    const curQIdx = qNums.indexOf(curQ);
    const cols = [];
    cols.push({ fy: curFY, q: curQ, key: curFY + '_' + curQ, label: curFY.replace('FY ','FY-') + ' ' + curQ, field: qField[curQ], current: true });
    for (let qi = curQIdx - 1; qi >= 0; qi--) {
      const q = qNums[qi];
      cols.push({ fy: curFY, q, key: curFY + '_' + q, label: curFY.replace('FY ','FY-') + ' ' + q, field: qField[q], current: false });
    }
    sortedFYsList.filter(fy => fy !== curFY).forEach(fy => {
      ['Q4','Q3','Q2','Q1'].forEach(q => {
        cols.push({ fy, q, key: fy + '_' + q, label: fy.replace('FY ','FY-') + ' ' + q, field: qField[q], current: false });
      });
    });

    const allKeys = {};
    sortedFYsList.forEach(fy => {
      Object.keys(fyData[fy] || {}).forEach(k => {
        const r = fyData[fy][k];
        if (sq && k.toLowerCase().indexOf(sq) === -1) return;
        if (!allKeys[k]) allKeys[k] = { ST: r.STATE, HOD: r.HOD, C: r.CUSTOMER };
      });
    });

    let sorted = Object.keys(allKeys).map(k => {
      const entry = Object.assign({}, allKeys[k]);
      cols.forEach(c => {
        const row = (fyData[c.fy] || {})[k];
        entry[c.key] = row ? (row[c.field] || 0) : 0;
      });
      return entry;
    }).sort((a, b) => (b[cols[0].key] || 0) - (a[cols[0].key] || 0));

    const baseIdx = window._getCompBaseIndex('cust-comp-period', 'quarter', cols, c => c.key);
    const offsetCols = cols.slice(baseIdx);

    let displayCols = offsetCols;
    if (window.comparisonMode === 'pop' && offsetCols.length >= 2) {
        displayCols = [offsetCols[0], offsetCols[1]];
    } else if (window.comparisonMode === 'yoy' && offsetCols.length > 0) {
        displayCols = [];
        let currKey = offsetCols[0].key;
        while (currKey) {
            const colObj = cols.find(c => c.key === currKey);
            if (!colObj) {
                displayCols.push({ key: currKey, label: currKey.replace('_', ' ').replace('FY ','FY-'), current: false });
            } else {
                displayCols.push(colObj);
            }
            const nextKey = currKey.replace(/FY (\d+)-(\d+)/, (match, y1, y2) => 'FY ' + (parseInt(y1) - 1) + '-' + (parseInt(y2) - 1));
            if (!allFYsLocal.includes(nextKey.split('_')[0])) break;
            currKey = nextKey;
        }
    }

    if (window.comparisonMode !== 'none' && displayCols.length >= 2) {
        sorted = sorted.filter(r => Math.abs(parseFloat(r[displayCols[0].key]) || 0) > 0.001 || Math.abs(parseFloat(r[displayCols[1].key]) || 0) > 0.001);
    }

    const ps = 50, totalPages = Math.ceil(sorted.length / ps) || 1;
    const displayRows = sorted.slice((page-1)*ps, page*ps);
    window.App.lastTableData['custqoq'] = displayRows;

    thead.innerHTML = '<tr><th style="' + stickyST + '">State</th><th style="' + stickyHOD + '">HOD</th><th style="' + stickyC + '">Customer</th>'
      + displayCols.map((c, i) => {
          let sub = '';
          if (c.current) sub = 'current';
          else if (window.comparisonMode === 'pop') sub = 'prev';
          else if (window.comparisonMode === 'yoy' && i > 0) sub = i + ' yr ago';
          const hasVar = (window.comparisonMode !== 'none' && i + 1 < displayCols.length);
          return window._custTh(c.label, c.current, sub, hasVar);
      }).join('') + '</tr>';

    if (!sorted.length) { tbody.innerHTML = window._emptyRow(displayCols.length + 3, 'No data.'); return; }

    let html = '';
    displayRows.forEach(r => {
      html += '<tr><td style="' + stickyRowST + '">' + r.ST + '</td><td style="' + stickyRowHOD + '">' + r.HOD + '</td><td style="' + stickyRowC + ';font-weight:700;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + r.C + '">' + r.C + '</td>'
        + displayCols.map((c, mi) => {
            const val = r[c.key] || 0;
            let prevVal;
            if (window.comparisonMode !== 'none' && (mi + 1 < displayCols.length)) {
                prevVal = r[displayCols[mi + 1].key] || 0;
            }
            return window._custTd(val, c.current, prevVal);
        }).join('') + '</tr>';
    });
    tbody.innerHTML = html;
    window._renderPagination({ page: page, totalPages: totalPages, total: sorted.length }, 'setCustSalePage', 'pagination-custqoq');
  } catch(e) { tbody.innerHTML = window._errorRow(7, e.message); }
};

window._loadCustByYear = async function(tbody, thead, page) {
  const allFYsRaw = (window.App.filterOptions.fy || []).filter(f => f !== 'All');
  const curFY = allFYsRaw.slice().sort().reverse()[0];
  const allFYs = allFYsRaw.slice().sort().reverse().slice(0, 4);
  
  const stickyST  = 'position:sticky;left:0;z-index:3;background:var(--brand-primary);min-width:100px;padding:8px 12px;';
  const stickyHOD = 'position:sticky;left:100px;z-index:3;background:var(--brand-primary);min-width:120px;padding:8px 12px;';
  const stickyC   = 'position:sticky;left:220px;z-index:3;background:var(--brand-primary);min-width:180px;max-width:180px;border-right:1px solid rgba(255,255,255,0.2);padding:8px 12px;';

  const stickyRowST  = 'position:sticky;left:0;z-index:1;background:var(--bg-card);min-width:100px;padding:6px 12px;';
  const stickyRowHOD = 'position:sticky;left:100px;z-index:1;background:var(--bg-card);min-width:120px;padding:6px 12px;';
  const stickyRowC   = 'position:sticky;left:220px;z-index:1;background:var(--bg-card);min-width:180px;max-width:180px;border-right:1px solid var(--border);padding:6px 12px;';

  try {
    const dataList = await window.api('getCustomerAllFYSummary');
    const sq = (window.searchQueries['custqoq'] || '').toLowerCase();
    const map = {};
    dataList.forEach(r => {
      const key = r.STATE + '||' + r.HOD + '||' + r.CUSTOMER;
      if (sq && key.toLowerCase().indexOf(sq) === -1) return;
      if (!map[key]) map[key] = { ST: r.STATE, HOD: r.HOD, C: r.CUSTOMER };
      map[key][r.FY] = r.TOTAL_SQFT;
    });

    let sorted = Object.values(map).sort((a,b) => (b[curFY]||0) - (a[curFY]||0));

    const baseIdx = window._getCompBaseIndex('cust-comp-period', 'year', allFYs);
    const offsetFYs = allFYs.slice(baseIdx);

    let displayFYs = offsetFYs;
    if (window.comparisonMode === 'pop' && offsetFYs.length >= 2) {
        displayFYs = [offsetFYs[0], offsetFYs[1]];
    } else if (window.comparisonMode === 'yoy') {
        displayFYs = offsetFYs;
    }

    thead.innerHTML = '<tr><th style="' + stickyST + '">State</th><th style="' + stickyHOD + '">HOD</th><th style="' + stickyC + '">Customer</th>'
      + displayFYs.map((fy, i) => {
          let sub = '';
          if (fy === curFY) sub = 'current';
          else if (window.comparisonMode === 'pop' && i===1) sub = 'prev';
          else if (window.comparisonMode === 'yoy' && i > 0) sub = i + ' yr ago';
          const hasVar = (window.comparisonMode !== 'none' && i + 1 < displayFYs.length);
          return window._custTh(fy, fy === curFY, sub, hasVar);
      }).join('') + '</tr>';

    if (!displayRows.length) { tbody.innerHTML = window._emptyRow(displayFYs.length + 3); return; }
    
    let html = '';
    displayRows.forEach(r => {
      html += '<tr><td style="' + stickyRowST + '">' + r.ST + '</td><td style="' + stickyRowHOD + '">' + r.HOD + '</td><td style="' + stickyRowC + ';font-weight:700;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + r.C + '">' + r.C + '</td>'
        + displayFYs.map((fy, mi) => {
            const val = r[fy] || 0;
            let prevVal;
            if (window.comparisonMode !== 'none' && (mi + 1 < displayFYs.length)) {
                prevVal = r[displayFYs[mi + 1]] || 0;
            }
            return window._custTd(val, fy === curFY, prevVal);
        }).join('') + '</tr>';
    });
    tbody.innerHTML = html;
    window._renderPagination({ page: page, totalPages: totalPages, total: sorted.length }, 'setCustSalePage', 'pagination-custqoq');
  } catch(e) { tbody.innerHTML = window._errorRow(6, e.message); }
};