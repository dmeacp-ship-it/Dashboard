window._normalizeState = function(st) {
  if (!st) return 'Unknown';
  var s = String(st).trim();
  if (/AP.*TEL/i.test(s)) return 'AP & TELANGANA';
  if (/GUA?JARAT/i.test(s)) return 'GUJARAT';
  if (s === 'WB' || s === 'WEST BENGAL') return 'WEST BENGAL';
  if (s === 'J&K' || /JAMMU/i.test(s)) return 'J&K';
  if (s === 'ORISSA' || s === 'ODISHA') return 'ODISHA';
  if (/TRI\s*CITY/i.test(s)) return 'TRICITY';
  return s;
};

window._normalizeHOD = function(h) {
  if (!h) return 'Unknown';
  var str = String(h).trim();
  if (/DINESH.*GOTHI/i.test(str)) return 'DINESH PRABHUBHAI GOTHI';
  if (/BHARAT LAL GURJAR/i.test(str) && !/CG/i.test(str)) return 'BHARAT LAL GURJAR';
  if (/SAHIL MEHRA/i.test(str)) return 'SAHIL MEHRA';
  if (/MUNIR AHMAD SHAH/i.test(str)) return 'MUNIR AHMAD SHAH';
  if (/PRADIPTA BANERJEE.*NE/i.test(str)) return 'PRADIPTA BANERJEE - NE';
  return str;
};

window._getMonthSortVal = function(k) {
  if (!k) return 0;
  var parts = String(k).split('_');
  if (!parts[0] || !parts[1]) return 0;
  var fyMatch = parts[0].match(/(\d{2})[-_](\d{2})/);
  if (!fyMatch) return 0;
  var startYr = parseInt(fyMatch[1], 10);
  var endYr = parseInt(fyMatch[2], 10);
  var moStr = parts[1].substring(0, 3).toUpperCase();
  var mn = window.MN || ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  var moIdx = mn.indexOf(moStr);
  if (moIdx === -1) return 0;
  var calYear = moIdx >= 3 ? (2000 + startYr) : (2000 + endYr);
  var calMonth = moIdx + 1;
  return calYear * 100 + calMonth;
};

window.setHodTargetFY = function(fy) {
  window.hodTargetFY = fy;
  window.loadHodTargets(1);
};

window.setTargetFY = function(fy) {
  window.targetFY = fy;
  window.loadTargets(1);
};

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

    const compBtns = document.querySelectorAll('#page-hodtargets .comp-toggles .btn');
    if (compBtns.length === 3) {
        compBtns[0].className = 'btn btn-sm ' + (window.comparisonMode === 'none' ? 'btn-primary' : 'btn-ghost');
        compBtns[1].className = 'btn btn-sm ' + (window.comparisonMode === 'pop' ? 'btn-primary' : 'btn-ghost');
        compBtns[2].className = 'btn btn-sm ' + (window.comparisonMode === 'yoy' ? 'btn-primary' : 'btn-ghost');
    }

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
            let normH = window._normalizeHOD(r.HOD);
            let normS = window._normalizeState(r.STATE);
            let key = normH + '||' + normS;
            if (!hodMap[key]) hodMap[key] = { STATE: normS, HOD: normH, YEARLY: {}, QUARTERLY: {}, MONTHLY: {} };
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
                if (r[dataKey][k] && r[dataKey][k].a > 0) allKeys.add(k); 
            });
        });

        let sortedKeys = Array.from(allKeys);
        if(window.hodTargetView === 'year' || window.hodTargetView === 'quarter') {
            sortedKeys.sort().reverse();
        } else {
            sortedKeys.sort(function(a, b) {
                return window._getMonthSortVal(b) - window._getMonthSortVal(a);
            });
        }

        const latestPeriod = sortedKeys[0] || 'N/A';
        let displayCols = sortedKeys;

        if (window.comparisonMode !== 'none') {
            const baseIdx = window._getCompBaseIndex('hodtarget-comp-period', window.hodTargetView, sortedKeys);
            const offsetCols = sortedKeys.slice(baseIdx);
            if (window.comparisonMode === 'pop') {
                if (offsetCols.length >= 2) displayCols = [offsetCols[0], offsetCols[1]];
                else displayCols = offsetCols;
            } else if (window.comparisonMode === 'yoy') {
                displayCols = [];
                let cur = offsetCols[0];
                while (cur && sortedKeys.includes(cur)) {
                    displayCols.push(cur);
                    const prevYear = cur.replace(/FY (\d+)-(\d+)/, (_, y1, y2) => `FY ${parseInt(y1)-1}-${parseInt(y2)-1}`);
                    if (prevYear === cur || !sortedKeys.includes(prevYear)) break;
                    cur = prevYear;
                }
            }
        } else {
            window._getCompBaseIndex('hodtarget-comp-period', window.hodTargetView, []);
            const selFY = (window.hodTargetFY && window.hodTargetFY !== 'All') ? window.hodTargetFY : (window.App.filters && window.App.filters.fy);
            if (selFY && selFY !== 'All') {
                const allowedFYs = Array.isArray(selFY) ? selFY : [selFY];
                if (!allowedFYs.includes('All') && allowedFYs.length > 0) {
                    displayCols = displayCols.filter(k => allowedFYs.some(fy => k.startsWith(fy)));
                }
            }
            const monthFilter = window.App.filters && window.App.filters.month;
            if (monthFilter && monthFilter !== 'All') {
                const allowedMonths = Array.isArray(monthFilter) ? monthFilter : [monthFilter];
                if (!allowedMonths.includes('All') && allowedMonths.length > 0) {
                    displayCols = displayCols.filter(k => {
                        const mStr = k.split('_')[1];
                        return allowedMonths.some(m => k.endsWith(m) || (mStr && m.toUpperCase().includes(mStr.toUpperCase())));
                    });
                }
            }
        }

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
            r._latestA = (r[dataKey] && r[dataKey][latestPeriod]) ? (r[dataKey][latestPeriod].a || 0) : 0;
        });
        hodRows.sort((a,b) => {
            let sCmp = (a.STATE || '').trim().localeCompare((b.STATE || '').trim());
            if (sCmp !== 0) return sCmp;

            let hA = (a.HOD_NAME || a['HOD NAME'] || a.HOD || '').trim();
            let hB = (b.HOD_NAME || b['HOD NAME'] || b.HOD || '').trim();
            let hCmp = hA.localeCompare(hB);
            if (hCmp !== 0) return hCmp;

            let diffA = (b._latestA || 0) - (a._latestA || 0);
            if (diffA !== 0) return diffA;
            return (b._maxA || 0) - (a._maxA || 0);
        });

        if (window.tableSortRules['hodtargets'] && window.tableSortRules['hodtargets'].length > 0) {
          hodRows = window.applyMultiSort(hodRows, 'hodtargets');
        }

        const exportAll = window.App.exportAll === 'hodtargets';
        const ps = exportAll ? (hodRows.length || 1) : 50;
        const totalPages = Math.ceil(hodRows.length / ps) || 1;
        if (page > totalPages) page = totalPages;
        if (exportAll) page = 1;
        const displayRows = hodRows.slice((page - 1) * ps, page * ps);

        window._renderHodTargetTable(displayRows, displayCols, thead, tbody, dataKey, page, ps, latestPeriod);

        window._renderPagination({ page: page, totalPages: totalPages, total: hodRows.length }, 'setHodTargetPage', 'pagination-hodtargets');
    } catch(e) {
        tbody.innerHTML = window._errorRow(5, e.message);
    }
};

window.selectedHodCompareRows = new Set();
window.hodCompareActive = false;
window.selectedTargetCompareRows = new Set();
window.targetCompareActive = false;

window.toggleHodTargetCompare = function() {
    window.hodCompareActive = !window.hodCompareActive;
    const btn = document.getElementById('btn-compare-hodtargets');
    if (btn) {
        btn.className = window.hodCompareActive ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost';
    }
    if (!window.hodCompareActive) {
        window.selectedHodCompareRows.clear();
    }
    window._updateHodCompareBadge();
    window.loadHodTargets(window.hodTargetPage || 1);
};

window.toggleTargetCompare = function() {
    window.targetCompareActive = !window.targetCompareActive;
    const btn = document.getElementById('btn-compare-targets');
    if (btn) {
        btn.className = window.targetCompareActive ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost';
    }
    if (!window.targetCompareActive) {
        window.selectedTargetCompareRows.clear();
    }
    window._updateTargetCompareBadge();
    window.loadTargets(window.targetPage || 1);
};

window.toggleHodSelection = function(key, checked) {
    if (checked) {
        window.selectedHodCompareRows.add(key);
    } else {
        window.selectedHodCompareRows.delete(key);
    }
    window._updateHodCompareBadge();
    const rowEl = document.querySelector(`tr[data-hod-key="${encodeURIComponent(key)}"]`);
    if (rowEl) {
        if (checked) rowEl.classList.add('row-selected-compare');
        else rowEl.classList.remove('row-selected-compare');
    }
};

window.toggleAllHodSelection = function(checked) {
    const tableData = window.App.lastTableData['hodtargets'] || [];
    tableData.forEach(r => {
        const key = (r.HOD || '') + '||' + (r.STATE || '');
        if (checked) window.selectedHodCompareRows.add(key);
        else window.selectedHodCompareRows.delete(key);
    });
    window._updateHodCompareBadge();
    window.loadHodTargets(window.hodTargetPage || 1);
};

window._updateHodCompareBadge = function() {
    const badge = document.getElementById('badge-compare-hodtargets');
    const count = window.selectedHodCompareRows.size;
    if (badge) {
        badge.textContent = count;
        badge.style.display = (window.hodCompareActive && count > 0) ? 'inline-flex' : 'none';
    }
    window._renderCompareFloatingBar('hodtargets', count);
};

window.toggleTargetSelection = function(key, checked) {
    if (checked) {
        window.selectedTargetCompareRows.add(key);
    } else {
        window.selectedTargetCompareRows.delete(key);
    }
    window._updateTargetCompareBadge();
    const rowEl = document.querySelector(`tr[data-target-key="${encodeURIComponent(key)}"]`);
    if (rowEl) {
        if (checked) rowEl.classList.add('row-selected-compare');
        else rowEl.classList.remove('row-selected-compare');
    }
};

window.toggleAllTargetSelection = function(checked) {
    const tableData = window.App.lastTableData['targets'] || [];
    tableData.forEach(r => {
        const key = (r.EMPLOYEE || '') + '||' + (r.HOD || '') + '||' + (r.STATE || '');
        if (checked) window.selectedTargetCompareRows.add(key);
        else window.selectedTargetCompareRows.delete(key);
    });
    window._updateTargetCompareBadge();
    window.loadTargets(window.targetPage || 1);
};

window._updateTargetCompareBadge = function() {
    const badge = document.getElementById('badge-compare-targets');
    const count = window.selectedTargetCompareRows.size;
    if (badge) {
        badge.textContent = count;
        badge.style.display = (window.targetCompareActive && count > 0) ? 'inline-flex' : 'none';
    }
    window._renderCompareFloatingBar('targets', count);
};

window._renderCompareFloatingBar = function(type, count) {
    let barId = 'compare-float-bar-' + type;
    let bar = document.getElementById(barId);
    const containerId = type === 'hodtargets' ? 'page-hodtargets' : 'page-targets';
    const container = document.querySelector(`#${containerId} .table-card`);
    if (!container) return;

    if (count < 2) {
        if (bar) bar.remove();
        return;
    }

    if (!bar) {
        bar = document.createElement('div');
        bar.id = barId;
        bar.className = 'compare-float-bar';
        container.appendChild(bar);
    }

    const titleText = type === 'hodtargets' ? 'HODs' : 'Executives';
    bar.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px;">
            <i class="ph ph-scales" style="font-size:18px; color:var(--brand-primary);"></i>
            <span style="font-weight:700; font-size:13px; color:var(--text-main);">${count} ${titleText} Selected</span>
        </div>
        <div style="display:flex; gap:8px;">
            <button class="btn btn-primary btn-sm" onclick="window.openCompareModal('${type}')">
                <i class="ph ph-chart-bar-horizontal"></i> Compare Side-by-Side
            </button>
            <button class="btn btn-ghost btn-sm" onclick="window.clearCompareSelection('${type}')">Clear</button>
        </div>
    `;
};

window.clearCompareSelection = function(type) {
    if (type === 'hodtargets') {
        window.selectedHodCompareRows.clear();
        window._updateHodCompareBadge();
        window.loadHodTargets(window.hodTargetPage || 1);
    } else {
        window.selectedTargetCompareRows.clear();
        window._updateTargetCompareBadge();
        window.loadTargets(window.targetPage || 1);
    }
};

window._renderHodTargetTable = function(displayRows, displayCols, thead, tbody, dataKey, page, pageSize, latestPeriod) {
    window.App.lastTableData['hodtargets'] = displayRows;

    const stickyN   = 'position:sticky;left:0;top:0;z-index:15;background:var(--brand-primary);width:44px;min-width:44px;max-width:44px;padding:6px 8px;box-sizing:border-box;';
    const stickyST  = 'position:sticky;left:44px;top:0;z-index:15;background:var(--brand-primary);min-width:120px;max-width:120px;padding:6px 8px;box-sizing:border-box;';
    const stickyHOD = 'position:sticky;left:164px;top:0;z-index:15;background:var(--brand-primary);min-width:170px;max-width:170px;padding:6px 8px;box-sizing:border-box;';

    const stickyRowN   = 'position:sticky;left:0;z-index:5;background:var(--bg-card);width:44px;min-width:44px;max-width:44px;padding:4px 8px;box-sizing:border-box;';
    const stickyRowST  = 'position:sticky;left:44px;z-index:5;background:var(--bg-card);min-width:120px;max-width:120px;padding:4px 8px;box-sizing:border-box;';
    const stickyRowHOD = 'position:sticky;left:164px;z-index:5;background:var(--bg-card);min-width:170px;max-width:170px;padding:4px 8px;box-sizing:border-box;';

    const isCompare = window.hodCompareActive;
    const allSelected = displayRows.length > 0 && displayRows.every(r => window.selectedHodCompareRows.has((r.HOD || '') + '||' + (r.STATE || '')));

    thead.innerHTML = '<tr>'
        + '<th style="' + stickyN + '">' + (isCompare ? '<input type="checkbox" class="ms-checkbox" ' + (allSelected ? 'checked' : '') + ' onchange="window.toggleAllHodSelection(this.checked)">' : '#') + '</th>'
        + '<th style="' + stickyST + '" class="sortable-th" onclick="window.toggleHeaderSort(\'hodtargets\', \'STATE\', \'loadHodTargets\')">State ' + window._getSortIndicator('hodtargets', 'STATE') + '</th>'
        + '<th style="' + stickyHOD + '" class="sortable-th" onclick="window.toggleHeaderSort(\'hodtargets\', \'HOD\', \'loadHodTargets\')">HOD Name ' + window._getSortIndicator('hodtargets', 'HOD') + '</th>'
        + displayCols.map((c, i) => {
            let sub = '';
            if (window.comparisonMode !== 'none') {
                if (i === 0) sub = (c === latestPeriod ? 'CURRENT' : 'BASE');
                else if (window.comparisonMode === 'pop') sub = 'PREV';
                else if (window.comparisonMode === 'yoy') sub = i + ' YR AGO';
            } else {
                if (c === latestPeriod) sub = 'LATEST';
            }
            const hasVar = (window.comparisonMode !== 'none' && i + 1 < displayCols.length);
            return window._targetTh(c.replace('_', ' '), i === 0, sub, hasVar);
        }).join('')
        + '</tr>';

    if (!displayRows.length) { tbody.innerHTML = window._emptyRow(displayCols.length + 3, 'No target data found.'); return; }

    let htmlStr = '';
    displayRows.forEach((r, i) => {
        const idx = ((page - 1) * pageSize) + i + 1;
        const key = (r.HOD || '') + '||' + (r.STATE || '');
        const isSelected = window.selectedHodCompareRows.has(key);
        const rowClass = isSelected ? 'row-selected-compare' : '';

        let firstColContent = idx;
        if (isCompare) {
            firstColContent = `<input type="checkbox" class="ms-checkbox" ${isSelected ? 'checked' : ''} onchange="window.toggleHodSelection('${encodeURIComponent(key)}', this.checked)">`;
        }

        let html = '<td style="' + stickyRowN + '">' + firstColContent + '</td>'
        + '<td style="font-weight:600;color:var(--text-main);white-space:nowrap;' + stickyRowST + '">' + window.esc(r.STATE || '-') + '</td>'
        + '<td style="color:var(--text-main);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' + stickyRowHOD + '" title="'+window.esc(r.HOD||'-')+'">' + window.esc(r.HOD || '-') + '</td>';
        
        displayCols.forEach((c, colIdx) => {
            const obj = (r[dataKey] || {})[c] || {t:0, a:0};
            let prevObj;
            if (window.comparisonMode !== 'none' && colIdx + 1 < displayCols.length) {
                const prevC = displayCols[colIdx + 1];
                prevObj = (r[dataKey] || {})[prevC] || {t:0, a:0};
            }
            html += window._targetTd(obj.t, obj.a, prevObj ? prevObj.t : undefined, prevObj ? prevObj.a : undefined);
        });
        htmlStr += `<tr class="${rowClass}" data-hod-key="${encodeURIComponent(key)}">${html}</tr>`;
    });
    tbody.innerHTML = htmlStr;
    window._updateHodCompareBadge();
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
  
  const compBtns = document.querySelectorAll('#page-targets .comp-toggles .btn');
  if (compBtns.length === 3) {
      compBtns[0].className = 'btn btn-sm ' + (window.comparisonMode === 'none' ? 'btn-primary' : 'btn-ghost');
      compBtns[1].className = 'btn btn-sm ' + (window.comparisonMode === 'pop' ? 'btn-primary' : 'btn-ghost');
      compBtns[2].className = 'btn btn-sm ' + (window.comparisonMode === 'yoy' ? 'btn-primary' : 'btn-ghost');
  }

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
         if (r[dataKey][k] && r[dataKey][k].a > 0) allKeys.add(k); 
      });
    });
    
    let sortedKeys = Array.from(allKeys);
    if(window.targetView === 'year' || window.targetView === 'quarter') {
       sortedKeys.sort().reverse();
    } else {
       sortedKeys.sort(function(a, b) {
         return window._getMonthSortVal(b) - window._getMonthSortVal(a);
       });
    }
    
    const latestPeriod = sortedKeys[0] || 'N/A';
    let displayCols = sortedKeys;

    if (window.comparisonMode !== 'none') {
        const baseIdx = window._getCompBaseIndex('target-comp-period', window.targetView, sortedKeys);
        const offsetCols = sortedKeys.slice(baseIdx);
        if (window.comparisonMode === 'pop') {
            if (offsetCols.length >= 2) displayCols = [offsetCols[0], offsetCols[1]];
            else displayCols = offsetCols;
        } else if (window.comparisonMode === 'yoy') {
            displayCols = [];
            let cur = offsetCols[0];
            while (cur && sortedKeys.includes(cur)) {
                displayCols.push(cur);
                const prevYear = cur.replace(/FY (\d+)-(\d+)/, (_, y1, y2) => `FY ${parseInt(y1)-1}-${parseInt(y2)-1}`);
                if (prevYear === cur || !sortedKeys.includes(prevYear)) break;
                cur = prevYear;
            }
        }
    } else {
        window._getCompBaseIndex('target-comp-period', window.targetView, []);
        const selFY = (window.targetFY && window.targetFY !== 'All') ? window.targetFY : (window.App.filters && window.App.filters.fy);
        if (selFY && selFY !== 'All') {
            const allowedFYs = Array.isArray(selFY) ? selFY : [selFY];
            if (!allowedFYs.includes('All') && allowedFYs.length > 0) {
                displayCols = displayCols.filter(k => allowedFYs.some(fy => k.startsWith(fy)));
            }
        }
        const monthFilter = window.App.filters && window.App.filters.month;
        if (monthFilter && monthFilter !== 'All') {
            const allowedMonths = Array.isArray(monthFilter) ? monthFilter : [monthFilter];
            if (!allowedMonths.includes('All') && allowedMonths.length > 0) {
                displayCols = displayCols.filter(k => {
                    const mStr = k.split('_')[1];
                    return allowedMonths.some(m => k.endsWith(m) || (mStr && m.toUpperCase().includes(mStr.toUpperCase())));
                });
            }
        }
    }

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
        + '<div class="kpi-header-row"><div class="kpi-icon" style="color:#ec4899"><i class="ph ph-user-circle-gear"></i></div><div class="kpi-label">TOTAL EXECUTIVES</div></div>'
        + '<div class="kpi-value" style="font-size:24px;">' + rows.length + '</div>'
        + '<div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:auto;">matching current filters</div>'
        + '</div>';
    }

    rows.forEach(function(r) {
      r.STATE = window._normalizeState(r.STATE);
      r.HOD = window._normalizeHOD(r.HOD);
    });

    rows.forEach(r => {
        let maxA = 0;
        if(r[dataKey]) {
            Object.values(r[dataKey]).forEach(v => { if(v.a > maxA) maxA = v.a; });
        }
        r._maxA = maxA;
        r._latestA = (r[dataKey] && r[dataKey][latestPeriod]) ? (r[dataKey][latestPeriod].a || 0) : 0;
    });

    rows.sort(function(a,b) {
        let sCmp = (a.STATE || '').trim().localeCompare((b.STATE || '').trim());
        if (sCmp !== 0) return sCmp;

        let nameA = (a.EXECUTIVE || a.HOD || a.HOD_NAME || '').trim();
        let nameB = (b.EXECUTIVE || b.HOD || b.HOD_NAME || '').trim();
        let hCmp = nameA.localeCompare(nameB);
        if (hCmp !== 0) return hCmp;

        let diffA = (b._latestA || 0) - (a._latestA || 0);
        if (diffA !== 0) return diffA;
        return (b._maxA || 0) - (a._maxA || 0);
    });

    if (window.tableSortRules['targets'] && window.tableSortRules['targets'].length > 0) {
      rows = window.applyMultiSort(rows, 'targets');
    }

    const exportAll = window.App.exportAll === 'targets';
    const ps = exportAll ? (rows.length || 1) : 50;
    const totalPages = Math.ceil(rows.length / ps) || 1;
    if (page > totalPages) page = totalPages;
    if (exportAll) page = 1;
    const displayRows = rows.slice((page - 1) * ps, page * ps);

    window._renderTargetTable(displayRows, displayCols, thead, tbody, dataKey, page, ps, latestPeriod);
    
    window._renderPagination({
      page: page,
      totalPages: totalPages,
      total: rows.length
    }, 'setTargetPage', 'pagination-targets');

  } catch(e) {
    tbody.innerHTML = window._errorRow(8, e.message);
  }
};

window._targetTh = function(label, isCurrent, suffix, hasVar) {
  const s = (isCurrent ? 'color:var(--brand-primary);background:var(--brand-muted);' : '')
    + 'white-space:nowrap;min-width:130px;padding:8px 10px;font-size:11.5px;text-align:center;';
  let badgeHtml = '';
  if (suffix) {
    let bg = isCurrent ? 'var(--brand-primary)' : 'rgba(107, 114, 128, 0.12)';
    let fg = isCurrent ? '#ffffff' : 'var(--text-muted)';
    badgeHtml = '<br><span style="font-size:9px;font-weight:700;letter-spacing:0.04em;background:' + bg + ';color:' + fg + ';padding:2px 6px;border-radius:4px;display:inline-block;margin-top:3px;">' + suffix + '</span>';
  }
  return '<th style="' + s + '">'
    + (isCurrent ? '<span style="color:var(--brand-primary);margin-right:4px">●</span>' : '')
    + label
    + badgeHtml
    + '</th>';
};

window._renderTargetTable = function(displayRows, displayCols, thead, tbody, dataKey, page, pageSize, latestPeriod) {
  window.App.lastTableData['targets'] = displayRows;
  const stickyN   = 'position:sticky;left:0;top:0;z-index:15;background:var(--brand-primary);width:44px;min-width:44px;max-width:44px;padding:6px 8px;box-sizing:border-box;';
  const stickyST  = 'position:sticky;left:44px;top:0;z-index:15;background:var(--brand-primary);min-width:110px;max-width:110px;padding:6px 8px;box-sizing:border-box;';
  const stickyHOD = 'position:sticky;left:154px;top:0;z-index:15;background:var(--brand-primary);min-width:140px;max-width:140px;padding:6px 8px;box-sizing:border-box;';
  const stickyEMP = 'position:sticky;left:294px;top:0;z-index:15;background:var(--brand-primary);min-width:150px;max-width:150px;padding:6px 8px;box-sizing:border-box;';

  const stickyRowN   = 'position:sticky;left:0;z-index:5;background:var(--bg-card);width:44px;min-width:44px;max-width:44px;padding:4px 8px;box-sizing:border-box;';
  const stickyRowST  = 'position:sticky;left:44px;z-index:5;background:var(--bg-card);min-width:110px;max-width:110px;padding:4px 8px;box-sizing:border-box;';
  const stickyRowHOD = 'position:sticky;left:154px;z-index:5;background:var(--bg-card);min-width:140px;max-width:140px;padding:4px 8px;box-sizing:border-box;';
  const stickyRowEMP = 'position:sticky;left:294px;z-index:5;background:var(--bg-card);min-width:150px;max-width:150px;padding:4px 8px;box-sizing:border-box;';

  thead.innerHTML = '<tr>'
    + '<th style="' + stickyN + '">#</th>'
    + '<th style="' + stickyST + '" class="sortable-th" onclick="window.toggleHeaderSort(\'targets\', \'STATE\', \'loadTargets\')">State ' + window._getSortIndicator('targets', 'STATE') + '</th>'
    + '<th style="' + stickyHOD + '" class="sortable-th" onclick="window.toggleHeaderSort(\'targets\', \'HOD\', \'loadTargets\')">HOD Name ' + window._getSortIndicator('targets', 'HOD') + '</th>'
    + '<th style="' + stickyEMP + '" class="sortable-th" onclick="window.toggleHeaderSort(\'targets\', \'EMPLOYEE\', \'loadTargets\')">Executive Name ' + window._getSortIndicator('targets', 'EMPLOYEE') + '</th>'
    + displayCols.map(function(c, i) {
        let sub = '';
        if (window.comparisonMode !== 'none') {
            if (i === 0) sub = (c === latestPeriod ? 'CURRENT' : 'BASE');
            else if (window.comparisonMode === 'pop') sub = 'PREV';
            else if (window.comparisonMode === 'yoy') sub = i + ' YR AGO';
        } else {
            if (c === latestPeriod) sub = 'LATEST';
        }
        const hasVar = (window.comparisonMode !== 'none' && i + 1 < displayCols.length);
        return window._targetTh(c.replace('_', ' '), (c === latestPeriod || i === 0), sub, hasVar);
    }).join('')
    + '</tr>';

  if (!displayRows.length) {
     tbody.innerHTML = window._emptyRow(displayCols.length + 4, 'No target data found matching your criteria.'); 
     return; 
  }
  
  let htmlStr = '';
  displayRows.forEach(function(r, i) {
    const idx = ((page - 1) * pageSize) + i + 1;
    let html = '<td style="' + stickyRowN + '">' + idx + '</td>'
      + '<td style="font-weight:600;color:var(--text-main);white-space:nowrap;' + stickyRowST + '">' + window.esc(r.STATE || '-') + '</td>'
      + '<td style="color:var(--text-main);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' + stickyRowHOD + '" title="'+window.esc(r.HOD||'-')+'">' + window.esc(r.HOD || '-') + '</td>'
      + '<td style="color:var(--text-sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' + stickyRowEMP + '" title="'+window.esc(r.EMPLOYEE||'-')+'">' + window.esc(r.EMPLOYEE || '-') + '</td>';
      
    displayCols.forEach(function(c, colIdx) {
       const obj = (r[dataKey] || {})[c] || {t:0, a:0};
       let prevObj;
       if (window.comparisonMode !== 'none' && colIdx + 1 < displayCols.length) {
           const prevC = displayCols[colIdx + 1];
           prevObj = (r[dataKey] || {})[prevC] || {t:0, a:0};
       }
       html += window._targetTd(obj.t, obj.a, prevObj ? prevObj.t : undefined, prevObj ? prevObj.a : undefined);
    });
    
    htmlStr += '<tr>' + html + '</tr>';
  });
  tbody.innerHTML = htmlStr;
};

window.openCompareModal = function(type) {
    const modal = document.getElementById('compare-modal');
    const body = document.getElementById('compare-modal-body');
    const titleEl = document.getElementById('compare-modal-title');
    const subEl = document.getElementById('compare-modal-sub');
    if (!modal || !body) return;

    const isHod = (type === 'hodtargets');
    const selectedKeys = isHod ? window.selectedHodCompareRows : window.selectedTargetCompareRows;
    const allData = window.App.lastTableData[type] || [];

    const selectedRows = allData.filter(r => {
        const key = isHod ? ((r.HOD || '') + '||' + (r.STATE || '')) : ((r.EMPLOYEE || '') + '||' + (r.HOD || '') + '||' + (r.STATE || ''));
        return selectedKeys.has(key);
    });

    if (selectedRows.length < 2) {
        window.toast('Please select at least 2 items to compare.', 'info');
        return;
    }

    const titleText = isHod ? 'HOD Performance Comparison' : 'Executive Targets Comparison';
    if (titleEl) titleEl.textContent = titleText;
    if (subEl) subEl.textContent = `Comparing ${selectedRows.length} selected ${isHod ? 'HODs' : 'Executives'} side-by-side`;

    const dataKey = isHod 
        ? (window.hodTargetView === 'year' ? 'YEARLY' : window.hodTargetView === 'quarter' ? 'QUARTERLY' : 'MONTHLY')
        : (window.targetView === 'year' ? 'YEARLY' : window.targetView === 'quarter' ? 'QUARTERLY' : 'MONTHLY');

    // Collect all unique period keys across selected rows
    let periodKeys = new Set();
    selectedRows.forEach(r => {
        Object.keys(r[dataKey] || {}).forEach(k => {
            if (r[dataKey][k] && (r[dataKey][k].t > 0 || r[dataKey][k].a > 0)) periodKeys.add(k);
        });
    });
    let sortedPeriods = Array.from(periodKeys);
    sortedPeriods.sort(function(a, b) {
        return window._getMonthSortVal ? (window._getMonthSortVal(b) - window._getMonthSortVal(a)) : b.localeCompare(a);
    });

    const latestPeriod = sortedPeriods[0] || 'N/A';

    // Summary calculations
    let totalTargetSum = 0, totalAchvSum = 0;
    selectedRows.forEach(r => {
        const itemLatest = (r[dataKey] || {})[latestPeriod] || {t:0, a:0};
        totalTargetSum += itemLatest.t || 0;
        totalAchvSum += itemLatest.a || 0;
    });
    const avgConversion = totalTargetSum > 0 ? ((totalAchvSum / totalTargetSum) * 100).toFixed(1) : 0;

    // Render HTML
    let html = '';

    // 1. KPI Cards Row
    html += `
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:12px;">
            <div class="kpi-card" style="--kpi-color:var(--brand-primary); padding:14px;">
                <div class="kpi-label">COMPARING</div>
                <div class="kpi-value" style="font-size:22px;">${selectedRows.length} ${isHod ? 'HODs' : 'Executives'}</div>
                <div class="kpi-sub">Period: ${latestPeriod.replace('_', ' ')}</div>
            </div>
            <div class="kpi-card" style="--kpi-color:var(--accent); padding:14px;">
                <div class="kpi-label">TOTAL TARGET</div>
                <div class="kpi-value" style="font-size:22px;">₹${window.fmt.num(totalTargetSum)}</div>
                <div class="kpi-sub">Across selected</div>
            </div>
            <div class="kpi-card" style="--kpi-color:var(--accent3); padding:14px;">
                <div class="kpi-label">TOTAL ACHIEVED</div>
                <div class="kpi-value" style="font-size:22px; color:var(--accent3);">₹${window.fmt.num(totalAchvSum)}</div>
                <div class="kpi-sub">Actual generated</div>
            </div>
            <div class="kpi-card" style="--kpi-color:${avgConversion < 50 ? 'var(--danger)' : avgConversion < 80 ? 'var(--accent4)' : 'var(--accent3)'}; padding:14px;">
                <div class="kpi-label">GROUP CONVERSION</div>
                <div class="kpi-value" style="font-size:22px;">${avgConversion}%</div>
                <div class="kpi-sub">Average completion</div>
            </div>
        </div>
    `;

    // 2. Side-by-Side Cards
    html += `<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap:16px;">`;
    selectedRows.forEach(r => {
        const name = isHod ? (r.HOD || 'Unknown') : (r.EMPLOYEE || 'Unknown');
        const subInfo = isHod ? (r.STATE || '-') : (`HOD: ${r.HOD || '-'} (${r.STATE || '-'})`);
        const latest = (r[dataKey] || {})[latestPeriod] || {t:0, a:0};
        const target = latest.t || 0;
        const achv = latest.a || 0;
        const pct = target > 0 ? ((achv / target) * 100).toFixed(1) : (achv > 0 ? 100 : 0);
        let color = '#10b981';
        if (pct < 50) color = '#ef4444';
        else if (pct < 80) color = '#f59e0b';

        html += `
            <div class="table-card" style="padding:16px; border-top:3px solid ${color}; display:flex; flex-direction:column; gap:12px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div>
                        <div style="font-size:15px; font-weight:800; color:var(--text-main);">${window.esc(name)}</div>
                        <div style="font-size:11.5px; color:var(--text-muted); font-weight:500; margin-top:2px;">${window.esc(subInfo)}</div>
                    </div>
                    <span class="badge" style="background:${color}22; color:${color}; border-color:${color}44; font-size:12px;">${pct}%</span>
                </div>

                <div style="background:var(--bg-elevated); padding:10px 12px; border-radius:12px; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="font-size:10px; color:var(--text-muted); font-weight:700; text-transform:uppercase;">Achievement</div>
                        <div style="font-size:16px; font-weight:800; color:var(--text-main);">₹${window.fmt.num(achv)}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:10px; color:var(--text-muted); font-weight:700; text-transform:uppercase;">Target</div>
                        <div style="font-size:14px; font-weight:700; color:var(--text-sub);">₹${window.fmt.num(target)}</div>
                    </div>
                </div>

                <!-- Progress Bar -->
                <div>
                    <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text-muted); font-weight:600; margin-bottom:4px;">
                        <span>Progress</span>
                        <span>${pct}%</span>
                    </div>
                    <div style="width:100%; height:6px; background:var(--bg-hover); border-radius:100px; overflow:hidden;">
                        <div style="width:${Math.min(pct, 100)}%; height:100%; background:${color}; border-radius:100px;"></div>
                    </div>
                </div>

                <!-- Recent Periods Table -->
                <div style="margin-top:4px;">
                    <div style="font-size:10.5px; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:6px;">History (${sortedPeriods.slice(0, 5).length} Periods)</div>
                    <table style="width:100%; font-size:11px;">
                        <tbody>
                            ${sortedPeriods.slice(0, 5).map(p => {
                                const pObj = (r[dataKey] || {})[p] || {t:0, a:0};
                                const pPct = pObj.t > 0 ? ((pObj.a / pObj.t) * 100).toFixed(1) : (pObj.a > 0 ? 100 : 0);
                                let pCol = '#10b981';
                                if (pPct < 50) pCol = '#ef4444';
                                else if (pPct < 80) pCol = '#f59e0b';
                                return `
                                    <tr style="border-bottom:1px solid var(--border);">
                                        <td style="padding:4px 0; color:var(--text-muted); font-weight:600;">${p.replace('_', ' ')}</td>
                                        <td style="padding:4px 0; text-align:right; font-weight:700; color:var(--text-main);">₹${window.fmt.short(pObj.a)}</td>
                                        <td style="padding:4px 0; text-align:right; color:var(--text-muted);">/ ₹${window.fmt.short(pObj.t)}</td>
                                        <td style="padding:4px 0; text-align:right; font-weight:700; color:${pCol}; width:45px;">${pPct}%</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    });
    html += `</div>`;

    // 3. Matrix Table Comparison
    html += `
        <div class="table-card" style="padding:16px;">
            <div style="font-size:12px; font-weight:800; color:var(--text-main); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:12px; display:flex; align-items:center; gap:6px;">
                <i class="ph ph-table"></i> Detailed Period Breakdown
            </div>
            <div style="overflow-x:auto;">
                <table style="width:100%; font-size:12px; border-collapse:collapse;">
                    <thead>
                        <tr style="background:var(--brand-primary); color:#fff;">
                            <th style="padding:8px 12px; text-align:left;">Entity</th>
                            ${sortedPeriods.map(p => `<th style="padding:8px 12px; text-align:right;">${p.replace('_', ' ')}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${selectedRows.map(r => {
                            const name = isHod ? (r.HOD || 'Unknown') : (r.EMPLOYEE || 'Unknown');
                            return `
                                <tr style="border-bottom:1px solid var(--border);">
                                    <td style="padding:8px 12px; font-weight:700; color:var(--text-main); white-space:nowrap;">${window.esc(name)}</td>
                                    ${sortedPeriods.map(p => {
                                        const pObj = (r[dataKey] || {})[p] || {t:0, a:0};
                                        const pPct = pObj.t > 0 ? ((pObj.a / pObj.t) * 100).toFixed(1) : (pObj.a > 0 ? 100 : 0);
                                        let pCol = '#10b981';
                                        if (pPct < 50) pCol = '#ef4444';
                                        else if (pPct < 80) pCol = '#f59e0b';
                                        if (pObj.t === 0 && pObj.a === 0) return `<td style="padding:8px 12px; text-align:right; color:var(--text-faint);">—</td>`;
                                        return `
                                            <td style="padding:8px 12px; text-align:right;">
                                                <div style="font-weight:700; color:var(--text-main);">₹${window.fmt.short(pObj.a)}</div>
                                                <div style="font-size:10px; color:var(--text-muted);">/ ₹${window.fmt.short(pObj.t)} <span style="color:${pCol}; font-weight:700;">${pPct}%</span></div>
                                            </td>
                                        `;
                                    }).join('')}
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    body.innerHTML = html;
    modal.classList.add('show');
};

window.closeCompareModal = function() {
    const modal = document.getElementById('compare-modal');
    if (modal) modal.classList.remove('show');
};

window.targetDensityMode = 'simple';

window.setTargetDensity = function(mode, btn) {
   window.targetDensityMode = mode;
   document.querySelectorAll('.btn-density-simple').forEach(b => {
     b.className = (mode === 'simple') ? 'btn btn-sm btn-primary btn-density-simple' : 'btn btn-sm btn-ghost btn-density-simple';
   });
   document.querySelectorAll('.btn-density-detailed').forEach(b => {
     b.className = (mode === 'detailed') ? 'btn btn-sm btn-primary btn-density-detailed' : 'btn btn-sm btn-ghost btn-density-detailed';
   });
   if (typeof window.loadHodTargets === 'function') window.loadHodTargets(window.hodTargetPage || 1);
   if (typeof window.loadTargets === 'function') window.loadTargets(window.targetPage || 1);
};

window._targetTd = function(target, achv, prevTarget, prevAchv) {
   target = target || 0; achv = achv || 0;
   const pct = target > 0 ? ((achv / target) * 100).toFixed(1) : (achv > 0 ? 100.0 : 0.0);
   
   let bgPill = 'rgba(16, 185, 129, 0.15)', fgPill = '#10b981';
   if (pct < 50) { bgPill = 'rgba(239, 68, 68, 0.15)'; fgPill = '#ef4444'; }
   else if (pct < 80) { bgPill = 'rgba(245, 158, 11, 0.15)'; fgPill = '#f59e0b'; }
   
   const targetFmt = '₹' + window.fmt.num(target);
   const achvFmt   = '₹' + window.fmt.num(achv);
   const ttBody = `<div style="display:flex;flex-direction:column;gap:6px;margin-top:4px;">`
     + `<div style="display:flex;justify-content:space-between;gap:16px;"><span style="color:var(--text-muted);font-weight:600;">Target Assigned:</span><span style="font-weight:800;color:var(--text-main);">${targetFmt}</span></div>`
     + `<div style="display:flex;justify-content:space-between;gap:16px;"><span style="color:var(--text-muted);font-weight:600;">Actual Generated:</span><span style="font-weight:800;color:var(--text-main);">${achvFmt}</span></div>`
     + `<div style="display:flex;justify-content:space-between;gap:16px;padding-top:4px;border-top:1px solid var(--border);"><span style="color:var(--text-muted);font-weight:600;">Conversion Rate:</span><span style="background:${bgPill};color:${fgPill};padding:2px 8px;border-radius:6px;font-weight:800;font-size:11px;">${pct}%</span></div>`
     + `</div>`;

   const escTitle = 'Target vs Achievement';
   const escBody  = ttBody.replace(/"/g, '&quot;');

   let html = `<td style="min-width:125px; padding:7px 10px; vertical-align:middle; text-align:center; border-right:1px solid var(--border-light);" onmouseenter="window.showRowTooltip(event, '${escTitle}', '${escBody}')" onmouseleave="window.hideRowTooltip()">`;
   
   if (target === 0 && achv === 0 && (prevAchv === undefined || prevAchv === 0)) {
       html += '<div style="color:var(--text-faint);text-align:center;font-size:13px;">—</div></td>';
       return html;
   }
   
   let varHtml = '';
   if (prevAchv !== undefined) {
       const prevA = parseFloat(prevAchv) || 0;
       if (achv === 0 && prevA === 0) {
           varHtml = '<span style="color:var(--text-muted); font-size:10.5px; font-weight:700;">0.0%</span>';
       } else if (prevA === 0 && achv > 0) {
           varHtml = '<span style="color:var(--accent3); font-size:10.5px; font-weight:700;">↑ 100.0%</span>';
       } else if (achv === 0 && prevA > 0) {
           varHtml = '<span style="color:var(--danger); font-size:10.5px; font-weight:700;">↓ 100.0%</span>';
       } else {
           const diffPct = ((achv - prevA) / prevA * 100).toFixed(1);
           let varColor = diffPct > 0 ? 'var(--accent3)' : diffPct < 0 ? 'var(--danger)' : 'var(--text-muted)';
           let arrow = diffPct > 0 ? '↑ ' : diffPct < 0 ? '↓ ' : '';
           varHtml = `<span style="color:${varColor}; font-size:10.5px; font-weight:700;">${arrow}${Math.abs(diffPct)}%</span>`;
       }
   }

   const isDetailed = window.targetDensityMode === 'detailed';

   html += `<div style="display:flex; flex-direction:column; align-items:center; gap:2px;">`;
   html += `<div style="font-size:14px; font-weight:800; color:var(--text-main); line-height:1.1;">${window.fmt.short(achv)}</div>`;
   
   if (isDetailed) {
     html += `<div style="display:flex; align-items:center; gap:4px; font-size:11px; color:var(--text-muted); font-weight:500;">`;
     html += `<span>/ ${window.fmt.short(target)}</span>`;
     html += `<span style="background:${bgPill}; color:${fgPill}; padding:1px 5px; border-radius:4px; font-size:10.5px; font-weight:700;">${pct}%</span>`;
     html += `</div>`;
   } else {
     // Simple Mode (Clean & uncluttered): Show Achievement + Colored Badge + Micro Progress Bar
     const clampedPct = Math.min(100, Math.max(0, parseFloat(pct) || 0));
     html += `<div style="display:flex; align-items:center; gap:4px; margin-top:1px;">`;
     html += `<span style="background:${bgPill}; color:${fgPill}; padding:1px 6px; border-radius:4px; font-size:10.5px; font-weight:700;">${pct}%</span>`;
     html += `</div>`;
     html += `<div style="width:40px; height:3px; background:rgba(156,163,175,0.2); border-radius:3px; overflow:hidden; margin-top:2px;">`;
     html += `<div style="width:${clampedPct}%; height:100%; background:${fgPill}; border-radius:3px;"></div>`;
     html += `</div>`;
   }

   if (varHtml) {
       html += `<div style="margin-top:1px;">${varHtml}</div>`;
   }
   html += `</div></td>`;
   return html;
};

// ══════════════════════════════════════════════════════════
// ADVANCED MULTI-LEVEL SORTING LOGIC
// ══════════════════════════════════════════════════════════

window.tableSortRules = {}; // e.g., { 'hodqoq': [{ field: 'STATE', dir: 'asc' }, { field: 'Q1_SQFT', dir: 'desc' }] }

window.applyMultiSort = function(data, tableId) {
  const rules = window.tableSortRules[tableId];
  if (!rules || !rules.length) return data; // No custom rules, return as-is
  
  return data.sort(function(a, b) {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      let valA = a[rule.field];
      let valB = b[rule.field];
      
      // Handle null/undefined
      if (valA === undefined || valA === null) valA = '';
      if (valB === undefined || valB === null) valB = '';
      
      let cmp = 0;
      
      // Determine if string or numeric comparison
      const isNumA = !isNaN(parseFloat(valA)) && isFinite(valA);
      const isNumB = !isNaN(parseFloat(valB)) && isFinite(valB);
      
      if (isNumA && isNumB) {
        cmp = parseFloat(valA) - parseFloat(valB);
      } else {
        cmp = String(valA).localeCompare(String(valB));
      }
      
      if (cmp !== 0) {
        return rule.dir === 'asc' ? cmp : -cmp;
      }
    }
    return 0; // All rules tied
  });
};

window.activeSortTableId = null;
window.activeSortRefreshFn = null;
window.activeSortFields = [];

window.openSortModal = function(tableId, theadId, refreshFn) {
  window.activeSortTableId = tableId;
  window.activeSortRefreshFn = refreshFn;
  
  // Extract fields from table header dynamically
  window.activeSortFields = [];
  const thead = document.getElementById(theadId);
  if (thead) {
    const ths = thead.querySelectorAll('th');
    ths.forEach((th, i) => {
      // Skip the "#" column (usually index 0)
      if (th.innerText.trim() === '#' || i === 0) return;
      
      let rawText = th.innerText.replace('●', '').split('\n')[0].trim(); // Get main text, ignoring suffixes
      if (rawText) {
        // Special case: For year/quarter columns, the key in data is usually exactly the header text or derived from it.
        // E.g., 'FY-26-27 Q1' is keyed as 'FY 26-27_Q1'. Let's map it back.
        let key = rawText.replace('FY-', 'FY ');
        if (key.includes(' Q')) key = key.replace(' ', '_');
        
        // For generic columns like "HOD Name", the data key is "HOD".
        if (rawText.toUpperCase() === 'HOD NAME') key = 'HOD';
        if (rawText.toUpperCase() === 'STATE') key = 'STATE';
        if (rawText.toUpperCase() === 'EXECUTIVE NAME') key = 'EMPLOYEE';
        
        window.activeSortFields.push({ label: rawText, key: key });
      }
    });
  }

  const container = document.getElementById('sort-rules-container');
  container.innerHTML = '';
  
  const existingRules = window.tableSortRules[tableId] || [];
  if (existingRules.length > 0) {
    existingRules.forEach(r => window.addSortRuleRow(r.field, r.dir));
  } else {
    window.addSortRuleRow(); // Add one empty row by default
  }

  const modal = document.getElementById('advanced-sort-modal');
  modal.style.display = 'flex';
};

window.addSortRuleRow = function(selectedField = '', selectedDir = 'asc') {
  const container = document.getElementById('sort-rules-container');
  const row = document.createElement('div');
  row.className = 'sort-rule-row';
  row.style.display = 'flex';
  row.style.gap = '8px';
  row.style.alignItems = 'center';
  
  let optionsHtml = '<option value="" disabled selected>Select Column...</option>';
  window.activeSortFields.forEach(f => {
    optionsHtml += `<option value="${f.key}" ${f.key === selectedField ? 'selected' : ''}>${f.label}</option>`;
  });
  
  row.innerHTML = `
    <select class="form-select sort-field-select" style="flex:1;">${optionsHtml}</select>
    <select class="form-select sort-dir-select" style="width:130px;">
      <option value="asc" ${selectedDir === 'asc' ? 'selected' : ''}>Asc (A-Z, Low-High)</option>
      <option value="desc" ${selectedDir === 'desc' ? 'selected' : ''}>Desc (Z-A, High-Low)</option>
    </select>
    <button class="btn btn-ghost btn-sm" onclick="this.parentElement.remove()" style="padding:4px 8px; color:var(--danger);"><i class="ph ph-trash"></i></button>
  `;
  container.appendChild(row);
};

window.applySortModal = function() {
  const container = document.getElementById('sort-rules-container');
  const rows = container.querySelectorAll('.sort-rule-row');
  
  const rules = [];
  rows.forEach(r => {
    const field = r.querySelector('.sort-field-select').value;
    const dir = r.querySelector('.sort-dir-select').value;
    if (field) {
      rules.push({ field: field, dir: dir });
    }
  });
  
  window.tableSortRules[window.activeSortTableId] = rules;
  document.getElementById('advanced-sort-modal').style.display = 'none';
  
  if (window.activeSortRefreshFn) {
    window.activeSortRefreshFn();
  }
};

// ══════════════════════════════════════════════════════════
// HOD PERFORMANCE — YEAR / QUARTER / MONTH TOGGLE
// ══════════════════════════════════════════════════════════

window.comparisonMode = 'none';

window.setComparisonMode = function(mode, btn) {
  window.comparisonMode = mode;
  const parentToggles = btn ? btn.closest('.comp-toggles') : null;
  if (parentToggles) {
    parentToggles.querySelectorAll('.btn').forEach(function(b) {
      b.className = 'btn btn-sm btn-ghost';
    });
  } else {
    document.querySelectorAll('.comp-toggles .btn').forEach(function(b) {
      b.className = 'btn btn-sm btn-ghost';
    });
  }
  if (btn) btn.className = 'btn btn-sm btn-primary';
  
  if (document.getElementById('page-hodqoq') && document.getElementById('page-hodqoq').classList.contains('active')) {
    window.loadHODQoQ();
  }
  if (document.getElementById('page-custqoq') && document.getElementById('page-custqoq').classList.contains('active')) {
    window.loadCustSale(window.custSalePage || 1);
  }
  if (document.getElementById('page-product') && document.getElementById('page-product').classList.contains('active')) {
    if (typeof window.loadTimeWiseSales === 'function') window.loadTimeWiseSales();
  }
  if (document.getElementById('page-hodsku') && document.getElementById('page-hodsku').classList.contains('active')) {
    if (typeof window.loadHodSkuSales === 'function') window.loadHodSkuSales();
  }
  if (document.getElementById('page-hodtargets') && document.getElementById('page-hodtargets').classList.contains('active')) {
    if (typeof window.loadHodTargets === 'function') window.loadHodTargets(1);
  }
  if (document.getElementById('page-targets') && document.getElementById('page-targets').classList.contains('active')) {
    if (typeof window.loadTargets === 'function') window.loadTargets(1);
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
    + 'white-space:nowrap;min-width:130px;padding:10px 12px;text-align:right;';
  let html = '<th style="' + s + '">'
    + (isCurrent ? '<span style="color:var(--brand-primary);margin-right:4px">●</span>' : '')
    + label
    + (isCurrent && suffix ? '<br><span style="font-size:9.5px;opacity:0.75;font-weight:700">(' + suffix + ')</span>' : '')
    + '</th>';
  return html;
};

window._custTh = function(label, isCurrent, suffix, hasVariance) {
  const s = (isCurrent ? 'color:var(--brand-primary);background:var(--brand-muted);' : '')
    + 'white-space:nowrap;min-width:130px;padding:10px 12px;text-align:right;';
  let html = '<th style="' + s + '">'
    + (isCurrent ? '<span style="color:var(--brand-primary);margin-right:4px">●</span>' : '')
    + label
    + (isCurrent && suffix ? '<br><span style="font-size:9.5px;opacity:0.75;font-weight:700">(' + suffix + ')</span>' : '')
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

  const stickyN   = 'position:sticky;left:0;top:0;z-index:15;background:var(--brand-primary);width:44px;padding:8px 12px;';
  const stickyHOD = 'position:sticky;left:44px;top:0;z-index:15;background:var(--brand-primary);min-width:160px;max-width:160px;padding:8px 12px;';
  const stickyST  = 'position:sticky;left:204px;top:0;z-index:15;background:var(--brand-primary);min-width:110px;border-right:1px solid var(--border);padding:8px 12px;';
  
  const stickyRowN   = 'position:sticky;left:0;z-index:5;background:var(--bg-card);width:44px;padding:6px 12px;';
  const stickyRowHOD = 'position:sticky;left:44px;z-index:5;background:var(--bg-card);min-width:160px;max-width:160px;padding:6px 12px;';
  const stickyRowST  = 'position:sticky;left:204px;z-index:5;background:var(--bg-card);min-width:110px;border-right:1px solid var(--border);padding:6px 12px;';

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
    
    // Apply Advanced Multi-level Sorting
    if (window.tableSortRules['hodqoq'] && window.tableSortRules['hodqoq'].length > 0) {
      sorted = window.applyMultiSort(sorted, 'hodqoq');
    }
    
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
      + '<th style="' + stickyHOD + '" class="sortable-th" onclick="window.toggleHeaderSort(\'hodqoq\', \'HOD\', \'loadHODQoQ\')">HOD Name ' + window._getSortIndicator('hodqoq', 'HOD') + '</th>'
      + '<th style="' + stickyST + '" class="sortable-th" onclick="window.toggleHeaderSort(\'hodqoq\', \'STATE\', \'loadHODQoQ\')">State ' + window._getSortIndicator('hodqoq', 'STATE') + '</th>'
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
        + '<td style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' + stickyRowHOD + ';color:var(--text-main)">' + window.esc(r.HOD) + '</td>'
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
  
  // Apply Advanced Multi-level Sorting
  if (window.tableSortRules['hodqoq'] && window.tableSortRules['hodqoq'].length > 0) {
    sorted = window.applyMultiSort(sorted, 'hodqoq');
  }
  
  window.App.lastTableData['hodqoq'] = sorted;

  const stickyN   = 'position:sticky;left:0;top:0;z-index:15;background:var(--brand-primary);width:44px;padding:8px 12px;';
  const stickyHOD = 'position:sticky;left:44px;top:0;z-index:15;background:var(--brand-primary);min-width:160px;max-width:160px;padding:8px 12px;';
  const stickyST  = 'position:sticky;left:204px;top:0;z-index:15;background:var(--brand-primary);min-width:110px;border-right:1px solid var(--border);padding:8px 12px;';
  
  const stickyRowN   = 'position:sticky;left:0;z-index:5;background:var(--bg-card);width:44px;padding:6px 12px;';
  const stickyRowHOD = 'position:sticky;left:44px;z-index:5;background:var(--bg-card);min-width:160px;max-width:160px;padding:6px 12px;';
  const stickyRowST  = 'position:sticky;left:204px;z-index:5;background:var(--bg-card);min-width:110px;border-right:1px solid var(--border);padding:6px 12px;';

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
      + '<td style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-main);' + stickyRowHOD + '">' + window.esc(r.HOD) + '</td>'
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
  
  // Apply Advanced Multi-level Sorting
  if (window.tableSortRules['hodqoq'] && window.tableSortRules['hodqoq'].length > 0) {
    sorted = window.applyMultiSort(sorted, 'hodqoq');
  }
  
  window.App.lastTableData['hodqoq'] = sorted;

  const stickyN   = 'position:sticky;left:0;top:0;z-index:15;background:var(--brand-primary);width:44px;padding:8px 12px;';
  const stickyHOD = 'position:sticky;left:44px;top:0;z-index:15;background:var(--brand-primary);min-width:160px;max-width:160px;padding:8px 12px;';
  const stickyST  = 'position:sticky;left:204px;top:0;z-index:15;background:var(--brand-primary);min-width:110px;border-right:1px solid var(--border);padding:8px 12px;';
  
  const stickyRowN   = 'position:sticky;left:0;z-index:5;background:var(--bg-card);width:44px;padding:6px 12px;';
  const stickyRowHOD = 'position:sticky;left:44px;z-index:5;background:var(--bg-card);min-width:160px;max-width:160px;padding:6px 12px;';
  const stickyRowST  = 'position:sticky;left:204px;z-index:5;background:var(--bg-card);min-width:110px;border-right:1px solid var(--border);padding:6px 12px;';

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
    + '<th style="' + stickyHOD + '" class="sortable-th" onclick="window.toggleHeaderSort(\'hodqoq\', \'HOD\', \'loadHODQoQ\')">HOD Name ' + window._getSortIndicator('hodqoq', 'HOD') + '</th>'
    + '<th style="' + stickyST + '" class="sortable-th" onclick="window.toggleHeaderSort(\'hodqoq\', \'STATE\', \'loadHODQoQ\')">State ' + window._getSortIndicator('hodqoq', 'STATE') + '</th>'
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
      + '<td style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-main);' + stickyRowHOD + '">' + window.esc(r.HOD) + '</td>'
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
  
  const stickyST  = 'position:sticky;left:0;top:0;z-index:15;background:var(--brand-primary);min-width:100px;padding:8px 12px;';
  const stickyHOD = 'position:sticky;left:100px;top:0;z-index:15;background:var(--brand-primary);min-width:120px;padding:8px 12px;';
  const stickyC   = 'position:sticky;left:220px;top:0;z-index:15;background:var(--brand-primary);min-width:180px;max-width:180px;border-right:1px solid rgba(255,255,255,0.2);padding:8px 12px;';
  
  const stickyRowST  = 'position:sticky;left:0;z-index:5;background:var(--bg-card);min-width:100px;padding:6px 12px;';
  const stickyRowHOD = 'position:sticky;left:100px;z-index:5;background:var(--bg-card);min-width:120px;padding:6px 12px;';
  const stickyRowC   = 'position:sticky;left:220px;z-index:5;background:var(--bg-card);min-width:180px;max-width:180px;border-right:1px solid var(--border);padding:6px 12px;';

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
    
    if (window.tableSortRules['custqoq'] && window.tableSortRules['custqoq'].length > 0) {
      sorted = window.applyMultiSort(sorted, 'custqoq');
    }

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

    const exportAll = window.App.exportAll === 'custqoq';
    const ps = exportAll ? (sorted.length || 1) : 50, totalPages = Math.ceil(sorted.length / ps) || 1;
    if (exportAll) page = 1;
    const displayRows = sorted.slice((page-1)*ps, page*ps);
    window.App.lastTableData['custqoq'] = displayRows;

    thead.innerHTML = '<tr><th style="' + stickyST + '" class="sortable-th" onclick="window.toggleHeaderSort(\'custqoq\', \'ST\', \'loadCustSale\')">State ' + window._getSortIndicator('custqoq', 'ST') + '</th><th style="' + stickyHOD + '" class="sortable-th" onclick="window.toggleHeaderSort(\'custqoq\', \'HOD\', \'loadCustSale\')">HOD ' + window._getSortIndicator('custqoq', 'HOD') + '</th><th style="' + stickyC + '" class="sortable-th" onclick="window.toggleHeaderSort(\'custqoq\', \'C\', \'loadCustSale\')">Customer ' + window._getSortIndicator('custqoq', 'C') + '</th>'
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
      html += '<tr><td style="' + stickyRowST + '">' + window.esc(r.ST) + '</td><td style="' + stickyRowHOD + '">' + r.HOD + '</td><td style="' + stickyRowC + ';font-weight:700;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + window.esc(r.C) + '">' + window.esc(r.C) + '</td>'
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

  const stickyST  = 'position:sticky;left:0;top:0;z-index:15;background:var(--brand-primary);min-width:100px;padding:8px 12px;';
  const stickyHOD = 'position:sticky;left:100px;top:0;z-index:15;background:var(--brand-primary);min-width:120px;padding:8px 12px;';
  const stickyC   = 'position:sticky;left:220px;top:0;z-index:15;background:var(--brand-primary);min-width:180px;max-width:180px;border-right:1px solid rgba(255,255,255,0.2);padding:8px 12px;';

  const stickyRowST  = 'position:sticky;left:0;z-index:5;background:var(--bg-card);min-width:100px;padding:6px 12px;';
  const stickyRowHOD = 'position:sticky;left:100px;z-index:5;background:var(--bg-card);min-width:120px;padding:6px 12px;';
  const stickyRowC   = 'position:sticky;left:220px;z-index:5;background:var(--bg-card);min-width:180px;max-width:180px;border-right:1px solid var(--border);padding:6px 12px;';

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

    if (window.tableSortRules['custqoq'] && window.tableSortRules['custqoq'].length > 0) {
      sorted = window.applyMultiSort(sorted, 'custqoq');
    }

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

    const exportAll = window.App.exportAll === 'custqoq';
    const ps = exportAll ? (sorted.length || 1) : 50, totalPages = Math.ceil(sorted.length / ps) || 1;
    if (exportAll) page = 1;
    const displayRows = sorted.slice((page-1)*ps, page*ps);
    window.App.lastTableData['custqoq'] = displayRows;

    thead.innerHTML = '<tr><th style="' + stickyST + '" class="sortable-th" onclick="window.toggleHeaderSort(\'custqoq\', \'ST\', \'loadCustSale\')">State ' + window._getSortIndicator('custqoq', 'ST') + '</th><th style="' + stickyHOD + '" class="sortable-th" onclick="window.toggleHeaderSort(\'custqoq\', \'HOD\', \'loadCustSale\')">HOD ' + window._getSortIndicator('custqoq', 'HOD') + '</th><th style="' + stickyC + '" class="sortable-th" onclick="window.toggleHeaderSort(\'custqoq\', \'C\', \'loadCustSale\')">Customer ' + window._getSortIndicator('custqoq', 'C') + '</th>'
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
      html += '<tr><td style="' + stickyRowST + '">' + window.esc(r.ST) + '</td><td style="' + stickyRowHOD + '">' + r.HOD + '</td><td style="' + stickyRowC + ';font-weight:700;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + window.esc(r.C) + '">' + window.esc(r.C) + '</td>'
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
  const allFYs = allFYsRaw.slice().sort().reverse();
  
  const stickyST  = 'position:sticky;left:0;top:0;z-index:15;background:var(--brand-primary);min-width:100px;padding:8px 12px;';
  const stickyHOD = 'position:sticky;left:100px;top:0;z-index:15;background:var(--brand-primary);min-width:120px;padding:8px 12px;';
  const stickyC   = 'position:sticky;left:220px;top:0;z-index:15;background:var(--brand-primary);min-width:180px;max-width:180px;border-right:1px solid rgba(255,255,255,0.2);padding:8px 12px;';

  const stickyRowST  = 'position:sticky;left:0;z-index:5;background:var(--bg-card);min-width:100px;padding:6px 12px;';
  const stickyRowHOD = 'position:sticky;left:100px;z-index:5;background:var(--bg-card);min-width:120px;padding:6px 12px;';
  const stickyRowC   = 'position:sticky;left:220px;z-index:5;background:var(--bg-card);min-width:180px;max-width:180px;border-right:1px solid var(--border);padding:6px 12px;';

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
    
    if (window.tableSortRules['custqoq'] && window.tableSortRules['custqoq'].length > 0) {
      sorted = window.applyMultiSort(sorted, 'custqoq');
    }

    const baseIdx = window._getCompBaseIndex('cust-comp-period', 'year', allFYs);
    const offsetFYs = allFYs.slice(baseIdx);

    let displayFYs = offsetFYs;
    if (window.comparisonMode === 'pop' && offsetFYs.length >= 2) {
        displayFYs = [offsetFYs[0], offsetFYs[1]];
    } else if (window.comparisonMode === 'yoy') {
        displayFYs = offsetFYs;
    }

    thead.innerHTML = '<tr><th style="' + stickyST + '" class="sortable-th" onclick="window.toggleHeaderSort(\'custqoq\', \'ST\', \'loadCustSale\')">State ' + window._getSortIndicator('custqoq', 'ST') + '</th><th style="' + stickyHOD + '" class="sortable-th" onclick="window.toggleHeaderSort(\'custqoq\', \'HOD\', \'loadCustSale\')">HOD ' + window._getSortIndicator('custqoq', 'HOD') + '</th><th style="' + stickyC + '" class="sortable-th" onclick="window.toggleHeaderSort(\'custqoq\', \'C\', \'loadCustSale\')">Customer ' + window._getSortIndicator('custqoq', 'C') + '</th>'
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
      html += '<tr><td style="' + stickyRowST + '">' + window.esc(r.ST) + '</td><td style="' + stickyRowHOD + '">' + r.HOD + '</td><td style="' + stickyRowC + ';font-weight:700;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + window.esc(r.C) + '">' + window.esc(r.C) + '</td>'
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