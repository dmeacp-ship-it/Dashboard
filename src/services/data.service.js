/**
 * src/services/data.service.js
 *
 * Faithful 1:1 port of the DataService IIFE from the Google Apps Script
 * Service.gs. Aggregation logic, field extractors, RFM scoring, pareto cuts,
 * filter handling and output shapes are preserved exactly so the front-end
 * renders identically.
 *
 * GAS mappings:
 *   _fetch(endpoint, qs)   -> fetchAll(endpoint, qs)   (count-aware paging)
 *   _cached(key, fn)       -> cached(key, fn)          (async, versioned)
 *   PropertiesService      -> process.env / supabase.getSalesRowCount()
 */

const { fetchAll, getSalesRowCount } = require('./supabase');

const STATE_TO_ZONE = {};

const { cached } = require('./cache.service');
const { DB_TABLES, ROLES } = require('../config');
const { fetchSheetData, fetchSheetHeaders, fetchSheetTabs } = require('./sync.service');

// ── numeric / string helpers ───────────────────────────────────────────────
function _num(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  return Number(String(v).replace(/,/g, '').trim()) || 0;
}
function _s(r, col) {
  const v = r[col] || r[col.toUpperCase()] || r[col.toLowerCase()];
  return v != null ? String(v).trim() : '';
}

// ── field extractors ────────────────────────────────────────────────────────
function _sqm(r)   { const v = _num(_s(r, 'total_sqm')); return v || _num(_s(r, 'sq_ft')) / 10.76391; }
function _sqft(r)  { const v = _num(_s(r, 'sq_ft'));     return v || _num(_s(r, 'total_sqm')) * 10.76391; }
function _txns(r)  { return _num(_s(r, 'txn_count') || _s(r, 'transaction_count')); }
function _qty(r)   { return _num(_s(r, 'quantity')); }
function _days(r)  { return _num(_s(r, 'days_since_last_purchase')); }
function _prev6(r) { return _num(_s(r, 'prev_6m_sqm')); }
function _last6(r) { return _num(_s(r, 'last_6m_sqm')); }
function _rev(r)   { return _num(_s(r, 'net_revenue')) || _num(_s(r, 'revenue')); }
function _thick(r) { return _s(r, 'thickness') || '-'; }
function _fy(r)    { return _s(r, 'fy_year'); }
function _zone(r)  { return _s(r, 'zone') || STATE_TO_ZONE[_state(r)] || 'Unknown'; }
function _state(r) { return _s(r, 'state') || 'Unknown'; }
function _hod(r)   { return _s(r, 'hod_name') || 'Unknown'; }
function _brand(r) { return _s(r, 'brand') || 'Unknown'; }
function _finish(r){ return _s(r, 'finish') || 'Unknown'; }
function _pt(r)    { return _s(r, 'product_type') || 'Unknown'; }
function _sku(r)   { return _s(r, 'sku_type').toUpperCase(); }
function _custName(r) { return _s(r, 'customer_name') || _s(r, 'customer_code'); }
function _lastDate(r) { return _s(r, 'last_purchase_date') || '-'; }

function _mo(r) {
  const raw = _s(r, 'month_year');
  if (!raw || raw.indexOf('#NAME') !== -1 || raw === 'N/A') return '';
  const p = raw.replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  if (p.length >= 2) {
    let mStr = p[0].substring(0, 3);
    mStr = mStr.charAt(0).toUpperCase() + mStr.slice(1).toLowerCase();
    let yStr = p[p.length - 1];
    if (yStr.length === 4) yStr = yStr.slice(2);
    return mStr + '-' + yStr;
  }
  return raw;
}

function _qtr(r) {
  const moStr = _mo(r);
  if (moStr) {
    const mStr = moStr.substring(0, 3).toUpperCase();
    const MN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const mIdx = MN.indexOf(mStr);
    if (mIdx !== -1) {
      if (mIdx >= 3 && mIdx <= 5) return 'Q1';
      if (mIdx >= 6 && mIdx <= 8) return 'Q2';
      if (mIdx >= 9 && mIdx <= 11) return 'Q3';
      return 'Q4';
    }
  }
  const raw = String(_s(r, 'quarter')).toUpperCase();
  const match = raw.match(/Q.*?(\d)/);
  return match ? 'Q' + match[1] : 'Q1';
}

function _normFy(v) {
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/(\d{2})[-\s_]+(\d{2})/);
  return m ? 'FY ' + m[1] + '-' + m[2] : null;
}

function _mSk(m) {
  if (!m) return '0000-00';
  const mn = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const p = m.trim().replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  if (p.length < 2) return m;
  const moIdx = mn.indexOf(p[0].toUpperCase());
  if (moIdx === -1) return m;
  let yr = p[1];
  if (yr.length === 2) yr = '20' + yr;
  return yr + '-' + String(moIdx + 1).padStart(2, '0');
}

function _robustFy(r) {
  const m = _mo(r);
  if (m) {
    const sk = _mSk(m);
    if (sk && sk.length >= 7) {
      const yr = parseInt(sk.slice(0, 4), 10);
      const mo = parseInt(sk.slice(5, 7), 10);
      if (!isNaN(yr) && !isNaN(mo)) {
        return mo >= 4
          ? 'FY ' + String(yr).slice(2) + '-' + String(yr + 1).slice(2)
          : 'FY ' + String(yr - 1).slice(2) + '-' + String(yr).slice(2);
      }
    }
  }
  const qStr = String(_s(r, 'quarter')).trim();
  const qMatch = qStr.match(/(\d{2})[-\s_]+(\d{2})/);
  if (qMatch) return 'FY ' + qMatch[1] + '-' + qMatch[2];
  return _normFy(_fy(r));
}

function _stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return String(obj);
  if (Array.isArray(obj)) return '[' + obj.map(_stableStringify).join(',') + ']';
  const clone = Object.assign({}, obj);
  delete clone._v;
  const keys = Object.keys(clone).sort();
  const parts = [];
  for (let i = 0; i < keys.length; i++) parts.push(keys[i] + ':' + _stableStringify(clone[keys[i]]));
  return '{' + parts.join(',') + '}';
}

function _matches(val, filterVal) {
  if (!filterVal || filterVal === 'All') return true;
  if (Array.isArray(filterVal)) {
    if (filterVal.length === 0 || filterVal.indexOf('All') !== -1) return true;
    return filterVal.indexOf(val) !== -1;
  }
  return val === filterVal;
}

function _rowMatches(r, f) {
  if (!f) return true;
  const hasTime = r.month_year !== undefined || r.fy_year !== undefined || r.quarter !== undefined;
  if (hasTime) {
    if (f.fy && f.fy !== 'All') {
      if (!_matches(_robustFy(r), f.fy)) return false;
    }
    if (f.quarter && f.quarter !== 'All') {
      let qVals = Array.isArray(f.quarter) ? f.quarter : [f.quarter];
      if (qVals.length > 0 && !qVals.includes('All')) {
        const rFy = _robustFy(r);
        const rQ = _qtr(r);
        const combined = rFy + '|' + rQ;
        let matched = false;
        for (let i = 0; i < qVals.length; i++) {
          if (qVals[i].includes('|')) {
            if (qVals[i] === combined) matched = true;
          } else {
            if (qVals[i] === rQ) matched = true;
          }
        }
        if (!matched) return false;
      }
    }
    if (f.month && f.month !== 'All') {
      if (!_matches(_mo(r), f.month)) return false;
    }
  }
  if (f.state && f.state !== 'All') {
    if (!_matches(_state(r), f.state)) return false;
  }
  if (f.zone && f.zone !== 'All') {
    if (!_matches(_zone(r), f.zone)) return false;
  }
  if (f.hod && f.hod !== 'All') {
    if (!_matches(_hod(r), f.hod)) return false;
  }
  return true;
}

function _q(f, exclude) {
  f = f || {};
  exclude = exclude || [];
  const p = [];
  function addFilter(col, val) {
    if (!val || val === 'All') return;
    if (Array.isArray(val)) {
      if (val.length === 0 || val.indexOf('All') !== -1) return;
      p.push(col + '=in.(' + val.map(encodeURIComponent).join(',') + ')');
    } else {
      p.push(col + '=eq.' + encodeURIComponent(val));
    }
  }
  if (exclude.indexOf('month') === -1) addFilter('month_year', f.month);
  if (exclude.indexOf('zone') === -1) addFilter('zone', f.zone);
  if (exclude.indexOf('state') === -1) addFilter('state', f.state);
  if (exclude.indexOf('hod') === -1) addFilter('hod_name', f.hod);

  const scope = f._scope || {};
  if (scope.hod_name) p.push('hod_name=eq.' + encodeURIComponent(scope.hod_name));
  if (scope.allowed_hods && scope.allowed_hods.length) {
    p.push('hod_name=in.(' + scope.allowed_hods.map(encodeURIComponent).join(',') + ')');
  }
  if (exclude.indexOf('zone') === -1 && scope.allowed_zones && scope.allowed_zones.length) {
    p.push('zone=in.(' + scope.allowed_zones.map(encodeURIComponent).join(',') + ')');
  }
  if (scope.allowed_states && scope.allowed_states.length) {
    p.push('state=in.(' + scope.allowed_states.map(encodeURIComponent).join(',') + ')');
  }
  return p.length ? '?' + p.join('&') : '';
}

async function _fetchOutstanding(f) {
  let qs = '';
  const scope = (f && f._scope) || {};
  const parts = [];
  if (scope.hod_name) parts.push('hod_name=eq.' + encodeURIComponent(scope.hod_name));
  if (scope.allowed_hods && scope.allowed_hods.length) {
    parts.push('hod_name=in.(' + scope.allowed_hods.map(encodeURIComponent).join(',') + ')');
  }
  if (scope.allowed_zones && scope.allowed_zones.length) {
    parts.push('zone=in.(' + scope.allowed_zones.map(encodeURIComponent).join(',') + ')');
  }
  if (scope.allowed_states && scope.allowed_states.length) {
    parts.push('state=in.(' + scope.allowed_states.map(encodeURIComponent).join(',') + ')');
  }
  function addF(col, val) {
    if (!val || val === 'All') return;
    if (Array.isArray(val)) {
      if (val.length === 0 || val.indexOf('All') !== -1) return;
      parts.push(col + '=in.(' + val.map(encodeURIComponent).join(',') + ')');
    } else {
      parts.push(col + '=eq.' + encodeURIComponent(val));
    }
  }
  addF('state', f && f.state);
  addF('zone', f && f.zone);
  addF('hod_name', f && f.hod);
  if (parts.length) qs = '?' + parts.join('&');
  return fetchAll('vw_outstanding_hod', qs);
}

function _paginate(arr, opts) {
  if (opts && opts.search) {
    const sq = String(opts.search).toLowerCase();
    arr = arr.filter(function (row) {
      for (let k in row) {
        if (k.indexOf('_') === 0) continue;
        if (row[k] != null && String(row[k]).toLowerCase().indexOf(sq) !== -1) return true;
      }
      return false;
    });
  }
  const page = Math.max(1, parseInt((opts && opts.page) || 1));
  const ps = Math.max(1, parseInt((opts && opts.pageSize) || 25));
  return {
    items: arr.slice((page - 1) * ps, page * ps),
    total: arr.length,
    page: page,
    pageSize: ps,
    totalPages: Math.ceil(arr.length / ps)
  };
}

function _computeRFM(rows) {
  const len = rows.length;
  if (!len) return rows;
  rows.forEach(function (r) {
    r['SQ FT.'] = _sqft(r);
    r['TOTAL SQM'] = _sqm(r);
    r['DAYS SINCE LAST PURCHASE'] = _days(r);
    r['TRANSACTION COUNT'] = _txns(r);
    r['CUSTOMER NAME'] = _custName(r);
    r['STATE'] = _state(r);
    r['HOD NAME'] = _hod(r);
  });
  rows.sort(function (a, b) { return a['DAYS SINCE LAST PURCHASE'] - b['DAYS SINCE LAST PURCHASE']; });
  rows.forEach(function (r, i) { r._rR = i; });
  rows.sort(function (a, b) { return b['TRANSACTION COUNT'] - a['TRANSACTION COUNT']; });
  rows.forEach(function (r, i) { r._fR = i; });
  rows.sort(function (a, b) { return b['TOTAL SQM'] - a['TOTAL SQM']; });
  rows.forEach(function (r, i) {
    const rs = Math.max(1, Math.min(5, 5 - Math.floor((r._rR / len) * 5)));
    const fs = Math.max(1, Math.min(5, 5 - Math.floor((r._fR / len) * 5)));
    const ms = Math.max(1, Math.min(5, 5 - Math.floor((i / len) * 5)));
    r['R SCORE'] = rs;
    r['F SCORE'] = fs;
    r['M SCORE'] = ms;
    r['RFM TOTAL'] = rs + fs + ms;
    r['FREQUENCY'] = r['TRANSACTION COUNT'];
    r['RECENCY (DAYS)'] = r['DAYS SINCE LAST PURCHASE'];
    r['SEGMENT'] =
      (rs >= 4 && fs >= 4 && ms >= 4) ? 'Champions' :
      (rs >= 3 && (fs >= 3 || ms >= 3)) ? 'Loyal' :
      (rs <= 2 && fs <= 2 && ms <= 2) ? 'Lost' :
      (rs <= 2 && (fs >= 3 || ms >= 3)) ? 'At Risk' : 'Hibernating';
  });
  return rows;
}

// ════════════════════════════════════════════════════════════════════════════
// PUBLIC METHODS
// ════════════════════════════════════════════════════════════════════════════

async function getFilterOptions(userProfile) {
  const role = userProfile ? userProfile.role : 'super_admin';
  const scope = { role: role };
  if (role === ROLES.HOD) scope.allowed_hods = (userProfile.allowed_hods && userProfile.allowed_hods.length) ? userProfile.allowed_hods : ['__none__'];
  else if (role === ROLES.ZONAL_HEAD) scope.allowed_zones = (userProfile.allowed_zones && userProfile.allowed_zones.length) ? userProfile.allowed_zones : ['__none__'];
  else if (role === ROLES.STATE_MANAGER || role === ROLES.VIEWER) scope.allowed_states = userProfile.allowed_states || null;

  const cacheKey = 'filterOptions_' + role + '_' +
    ((scope.allowed_hods || scope.allowed_zones || scope.allowed_states || []).join('|'));
  return cached(cacheKey, async function () {
    const scopeFilter = { _scope: scope };

    let rows;
    try {
      rows = await fetchAll('rpc/get_filter_options', _q(scopeFilter).replace('?', ''));
    } catch (e) {
      try { rows = await fetchAll('vw_filter_options_distinct', _q(scopeFilter)); } catch (err) { /* noop */ }
    }

    if (!rows || rows.length === 0) {
      const baseQ = _q(scopeFilter);
      const sep = baseQ.indexOf('?') > -1 ? '&' : '?';
      rows = await fetchAll('vw_filter_options', baseQ + sep + 'select=fy_year,quarter,month_year,zone,state,hod_name');
    }

    rows.forEach(function(r) {
      if (r.state && r.zone) STATE_TO_ZONE[r.state] = r.zone;
    });

    const uniq = function (arr) {
      return ['All'].concat(
        arr.filter(Boolean).map(String).map(function (s) { return s.trim(); })
          .filter(function (s) { return s && s.indexOf('#NAME?') === -1 && s.indexOf('N/A') === -1; })
          .filter(function (v, i, a) { return a.indexOf(v) === i; })
          .sort()
      );
    };
    const months = rows.map(function (r) { return _mo(r); }).filter(Boolean)
      .filter(function (s) { return String(s).indexOf('#NAME?') === -1 && String(s).indexOf('N/A') === -1; })
      .filter(function (v, i, a) { return a.indexOf(v) === i; })
      .sort(function (a, b) { return _mSk(a).localeCompare(_mSk(b)); });

    return {
      fy: uniq(rows.map(function (r) { return _robustFy(r); })),
      quarter: uniq(rows.map(function (r) { return _qtr(r); })),
      month: ['All'].concat(months),
      state: uniq(rows.map(function (r) { return _state(r); })),
      zone: uniq(rows.map(function (r) { return _zone(r); })),
      hod: uniq(rows.map(function (r) { return _hod(r); }))
    };
  });
}

async function getKPIs(f) {
  return cached('kpis_v3_' + _stableStringify(f), async function () {
    const geoQ = _q(f, ['month']);
    const geo = await fetchAll('vw_monthly_agg', geoQ);

    const filt = geo.filter(function (r) { return _rowMatches(r, f); });
    let totalSQM = 0, totalRev = 0;
    filt.forEach(function (r) { totalSQM += _sqm(r); totalRev += _rev(r); });

    const mMap = {}, fyMap = {};
    const fGeo = Object.assign({}, f, { fy: 'All', quarter: 'All', month: 'All' });

    geo.filter(function (r) { return _rowMatches(r, fGeo); }).forEach(function (r) {
      const sqm = _sqm(r); const rev = _rev(r);
      const m = _mo(r); if (m) mMap[m] = { sqm: (mMap[m] ? mMap[m].sqm + sqm : sqm), rev: (mMap[m] ? mMap[m].rev + rev : rev) };
      const fy = _robustFy(r); if (fy) fyMap[fy] = { sqm: (fyMap[fy] ? fyMap[fy].sqm + sqm : sqm), rev: (fyMap[fy] ? fyMap[fy].rev + rev : rev) };
    });

    const sortedM = Object.keys(mMap).sort(function (a, b) { return _mSk(b).localeCompare(_mSk(a)); });
    const curM = (f && f.month && f.month !== 'All' && !Array.isArray(f.month)) ? f.month : sortedM[0];
    const cIdx = Math.max(0, sortedM.indexOf(curM));

    const curSqft = (mMap[sortedM[cIdx]] ? mMap[sortedM[cIdx]].sqm : 0) * 10.76391;
    const prevSqft = (mMap[sortedM[cIdx + 1]] ? mMap[sortedM[cIdx + 1]].sqm : 0) * 10.76391;
    const momG = prevSqft ? ((curSqft - prevSqft) / prevSqft * 100) : 0;

    const curRev = (mMap[sortedM[cIdx]] ? mMap[sortedM[cIdx]].rev : 0);
    const prevRev = (mMap[sortedM[cIdx + 1]] ? mMap[sortedM[cIdx + 1]].rev : 0);
    const momRevG = prevRev ? ((curRev - prevRev) / prevRev * 100) : 0;

    const sortedF = Object.keys(fyMap).filter(function (k) { return k && k.indexOf('FY ') === 0; }).sort(function (a, b) { return b.localeCompare(a); });
    const curF = (f && f.fy && f.fy !== 'All' && !Array.isArray(f.fy)) ? _normFy(f.fy) : sortedF[0];
    const fIdx = Math.max(0, sortedF.indexOf(curF));
    const prevFy = sortedF[fIdx + 1] || null;
    const curFySqft = (fyMap[sortedF[fIdx]] ? fyMap[sortedF[fIdx]].sqm : 0) * 10.76391;
    const prevFySqft = (fyMap[sortedF[fIdx + 1]] ? fyMap[sortedF[fIdx + 1]].sqm : 0) * 10.76391;
    const yoyG = prevFySqft ? ((curFySqft - prevFySqft) / prevFySqft * 100) : 0;

    const curFyMonthsList = [];
    const prevFyMonthsList = [];
    geo.forEach(function (r) {
      const rFy = _robustFy(r);
      if (rFy === curF) { const m = _mo(r); if (m && curFyMonthsList.indexOf(m) === -1) curFyMonthsList.push(m); }
      if (prevFy && rFy === prevFy) { const m = _mo(r); if (m && prevFyMonthsList.indexOf(m) === -1) prevFyMonthsList.push(m); }
    });

    const curFyMonthCount = curFyMonthsList.length > 0 ? curFyMonthsList.length : 1;
    const prevFyMonthCount = prevFyMonthsList.length > 0 ? prevFyMonthsList.length : 1;
    const curFyAvgSqft = curFySqft / curFyMonthCount;
    const prevFyAvgSqft = prevFySqft / prevFyMonthCount;
    const avgSqftGrowth = prevFyAvgSqft ? ((curFyAvgSqft - prevFyAvgSqft) / prevFyAvgSqft * 100) : 0;

    const last6MoTrend = sortedM.slice(0, 6).reverse().map(function (m) {
      return Math.round((mMap[m] ? mMap[m].sqm : 0) * 10.76391);
    });
    const yearlyAvgsTrend = sortedF.slice().reverse().map(function (fy) {
      const fyMos = [];
      geo.forEach(function (r) {
        if (_robustFy(r) === fy) { const m = _mo(r); if (m && fyMos.indexOf(m) === -1) fyMos.push(m); }
      });
      const moCount = Math.max(1, fyMos.length);
      const tSqft = (fyMap[fy] ? fyMap[fy].sqm : 0) * 10.76391;
      return Math.round(tSqft / moCount);
    });

    const custQ = _q(f, ['month']);
    let custs = [];
    try {
      custs = await fetchAll('vw_customer_kpi_counts', custQ);
    } catch (e) {
      const qsLight = custQ + (custQ.indexOf('?') > -1 ? '&' : '?') + 'select=days_since_last_purchase,customer_name,total_sqm,sq_ft';
      custs = await fetchAll('vw_customer_summary', qsLight);
    }

    custs = custs.filter(function (r) { return _rowMatches(r, f); });

    const rfmCusts = _computeRFM(custs.map(function (r) { return Object.assign({}, r); }));
    const loyalC = rfmCusts.filter(function (c) { return c['SEGMENT'] === 'Loyal' || c['SEGMENT'] === 'Champions'; }).length;

    const active = custs.filter(function (c) { const d = _days(c); return d >= 0 && d <= 90; }).length;
    const cust30d = custs.filter(function (c) { const d = _days(c); return d >= 0 && d <= 30; }).length;
    const cust60d = custs.filter(function (c) { const d = _days(c); return d >= 0 && d <= 60; }).length;
    const cust90Plus = custs.filter(function (c) { const d = _days(c); return d > 90; }).length;

    // Pareto 80% (all-time)
    const sortedCusts = custs.map(function (c) { return { sqm: _sqm(c) }; }).sort(function (a, b) { return b.sqm - a.sqm; });
    const totSqmAllCusts = sortedCusts.reduce(function (sum, c) { return sum + c.sqm; }, 0);
    const target80 = totSqmAllCusts * 0.8;
    let runningSqm = 0;
    let cust80Count = 0;
    for (let i = 0; i < sortedCusts.length; i++) {
      runningSqm += sortedCusts[i].sqm;
      cust80Count++;
      if (runningSqm >= target80) break;
    }

    // Pareto 80% (current month — 30d active customers only)
    const curMo30Custs = custs.filter(function (c) { const d = _days(c); return d >= 0 && d <= 30; });
    const sortedCurMo = curMo30Custs.map(function (c) { return { sqm: _sqm(c) }; }).sort(function (a, b) { return b.sqm - a.sqm; });
    const totSqmCurMo = sortedCurMo.reduce(function (s, c) { return s + c.sqm; }, 0);
    let cust80CountCurMonth = 0;
    if (totSqmCurMo > 0) {
      const tgt80CurMo = totSqmCurMo * 0.8;
      let runCurMo = 0;
      for (let i = 0; i < sortedCurMo.length; i++) {
        runCurMo += sortedCurMo[i].sqm;
        cust80CountCurMonth++;
        if (runCurMo >= tgt80CurMo) break;
      }
    }

    // Outstanding
    const osRows = await _fetchOutstanding(f);
    let totOs = 0, totDebtors = 0, os90Amt = 0, os90Count = 0, os45Amt = 0, os45Count = 0, osBelow45Amt = 0, osBelow45Count = 0;
    osRows.forEach(function (r) {
      const outAmt = _num(_s(r, 'current_outstanding'));
      const below45 = _num(_s(r, 'below_45_days'));
      const above45 = _num(_s(r, 'above_45_days'));
      const days90 = _num(_s(r, 'days_90_plus'));
      totOs += outAmt;
      if (outAmt > 0) totDebtors++;
      if (days90 > 0) { os90Amt += days90; os90Count++; }
      if (above45 > 0) { os45Amt += above45; os45Count++; }
      if (below45 > 0) { osBelow45Amt += below45; osBelow45Count++; }
    });

    return {
      totalSqft: Math.round(totalSQM * 10.76391),
      totalSQM: +totalSQM.toFixed(2),
      totalRevenue: Math.round(totalRev),
      currentYearAvgSqft: Math.round(curFyAvgSqft) || 0,
      prevYearAvgSqft: Math.round(prevFyAvgSqft) || 0,
      avgSqftGrowth: +avgSqftGrowth.toFixed(1),
      yearlyAvgTrend: yearlyAvgsTrend,
      totalCustomers: custs.length,
      activeCustomers: active,
      loyalCustomers: loyalC,
      cust30d: cust30d,
      cust60d: cust60d,
      cust90Plus: cust90Plus,
      cust80Count: cust80Count,
      cust80CountCurMonth: cust80CountCurMonth,
      totOs: totOs,
      totDebtors: totDebtors,
      os90Amt: os90Amt,
      os90Count: os90Count,
      os45Amt: os45Amt,
      os45Count: os45Count,
      osBelow45Amt: osBelow45Amt,
      osBelow45Count: osBelow45Count,
      currentMonthSqft: Math.round(curSqft),
      prevMonthSqft: Math.round(prevSqft),
      currentMonthRev: Math.round(curRev),
      last6MonthsTrend: last6MoTrend,
      momGrowth: +momG.toFixed(1),
      momRevGrowth: +momRevG.toFixed(1),
      yoyGrowth: +yoyG.toFixed(1),
      currentMonth: sortedM[cIdx] || '',
      lastUpdated: new Date().toISOString(),
      totalRawRows: await getSalesRowCount()
    };
  });
}

async function getOverviewData(f) {
  return cached('overview_batched_' + _stableStringify(f), async function () {
    const widestQ = _q(f, ['month']);
    const rows = await fetchAll('vw_monthly_agg', widestQ);

    const fForMonthly = Object.assign({}, f, { month: 'All' });
    const fForState = Object.assign({}, f, { state: 'All' });

    const monthlyMap = {};
    const stateMap = {};

    rows.forEach(function (r) {
      if (_rowMatches(r, fForMonthly)) {
        const m = _mo(r); if (!m) return;
        if (!monthlyMap[m]) monthlyMap[m] = { 'MONTH YEAR': m, 'FY YEAR': _robustFy(r), 'QUARTER': _qtr(r), 'TOTAL SQM': 0, 'NET REVENUE': 0 };
        monthlyMap[m]['TOTAL SQM'] += _sqm(r);
        monthlyMap[m]['NET REVENUE'] += _rev(r);
      }
      if (_rowMatches(r, fForState)) {
        const s = _state(r);
        if (!stateMap[s]) stateMap[s] = { STATE: s, ZONE: _zone(r), 'TOTAL SQM': 0, 'NET REVENUE': 0 };
        stateMap[s]['TOTAL SQM'] += _sqm(r);
        stateMap[s]['NET REVENUE'] += _rev(r);
      }
    });

    const monthly = Object.values(monthlyMap).map(function (r) {
      r['SORT KEY'] = r['_SK'] = _mSk(r['MONTH YEAR']);
      r['_LABEL'] = r['MONTH YEAR'];
      r['_FY'] = r['FY YEAR'];
      r['SQ FT.'] = r['TOTAL SQM'] * 10.76391;
      return r;
    }).sort(function (a, b) { return a['SORT KEY'].localeCompare(b['SORT KEY']); });

    const states = Object.values(stateMap)
      .map(function (r) { return Object.assign({}, r, { 'SQ FT.': r['TOTAL SQM'] * 10.76391 }); })
      .sort(function (a, b) { return b['TOTAL SQM'] - a['TOTAL SQM']; });

    return { monthly: monthly, states: states };
  });
}

async function getMonthlySummary(f) { return (await getOverviewData(f)).monthly; }
async function getStateSummary(f) { return (await getOverviewData(f)).states; }

async function getHODQoQ(f) {
  return cached('hod_qoq_' + _stableStringify(f), async function () {
    const q = _q(f, ['month']);
    const rows = (await fetchAll('vw_hod_agg', q)).filter(function (r) { return _rowMatches(r, f); });
    const map = {};
    rows.forEach(function (r) {
      const h = _hod(r); const st = _state(r); const key = h + '||' + st;
      if (!map[key]) map[key] = { HOD: h, STATE: st, T: 0, Q1: 0, Q2: 0, Q3: 0, Q4: 0, NET_REVENUE: 0 };
      const s = _sqm(r); const rev = _rev(r);
      map[key].T += s; map[key].NET_REVENUE += rev;
      const qt = _qtr(r);
      if (qt.indexOf('1') !== -1) map[key].Q1 += s;
      if (qt.indexOf('2') !== -1) map[key].Q2 += s;
      if (qt.indexOf('3') !== -1) map[key].Q3 += s;
      if (qt.indexOf('4') !== -1) map[key].Q4 += s;
    });
    return Object.values(map).map(function (h) {
      return {
        HOD: h.HOD, STATE: h.STATE,
        TOTAL_SQFT: Math.round(h.T * 10.76391),
        NET_REVENUE: Math.round(h.NET_REVENUE),
        Q1_SQFT: Math.round(h.Q1 * 10.76391),
        Q2_SQFT: Math.round(h.Q2 * 10.76391),
        Q3_SQFT: Math.round(h.Q3 * 10.76391),
        Q4_SQFT: Math.round(h.Q4 * 10.76391)
      };
    }).sort(function (a, b) { return b.TOTAL_SQFT - a.TOTAL_SQFT; });
  });
}

async function getHODAllFYSummary(f) {
  const scopeF = {
    _scope: (f && f._scope) || {},
    zone: (f && f.zone && f.zone !== 'All') ? f.zone : 'All',
    state: (f && f.state && f.state !== 'All') ? f.state : 'All',
    hod: (f && f.hod && f.hod !== 'All') ? f.hod : 'All'
  };
  return cached('hod_all_fy_' + _stableStringify(scopeF), async function () {
    const q = _q(f, ['month']);
    const rows = (await fetchAll('vw_hod_agg', q)).filter(function (r) { return _rowMatches(r, scopeF); });
    const map = {};
    rows.forEach(function (r) {
      const h = _hod(r); const st = _state(r); const fy = _robustFy(r);
      if (!h || h === 'Unknown' || !fy) return;
      const key = h + '||' + st + '||' + fy;
      if (!map[key]) map[key] = { HOD: h, STATE: st, FY: fy, T: 0, Q1: 0, Q2: 0, Q3: 0, Q4: 0, NET_REVENUE: 0 };
      const s = _sqm(r); const rev = _rev(r);
      map[key].T += s; map[key].NET_REVENUE += rev;
      const qt = _qtr(r);
      if (qt.indexOf('1') !== -1) map[key].Q1 += s;
      if (qt.indexOf('2') !== -1) map[key].Q2 += s;
      if (qt.indexOf('3') !== -1) map[key].Q3 += s;
      if (qt.indexOf('4') !== -1) map[key].Q4 += s;
    });
    return Object.values(map).map(function (h) {
      return {
        HOD: h.HOD, STATE: h.STATE, FY: h.FY,
        TOTAL_SQFT: Math.round(h.T * 10.76391),
        NET_REVENUE: Math.round(h.NET_REVENUE),
        Q1_SQFT: Math.round(h.Q1 * 10.76391),
        Q2_SQFT: Math.round(h.Q2 * 10.76391),
        Q3_SQFT: Math.round(h.Q3 * 10.76391),
        Q4_SQFT: Math.round(h.Q4 * 10.76391)
      };
    });
  });
}

async function getHODMonthlySummary(f) {
  return cached('hod_monthly_' + _stableStringify(f), async function () {
    const q = _q(f, ['month']);
    const rows = (await fetchAll('vw_monthly_agg', q)).filter(function (r) { return _rowMatches(r, f); });
    const map = {};
    rows.forEach(function (r) {
      const h = _hod(r); const st = _state(r); const mo = _mo(r);
      if (!h || h === 'Unknown' || !mo) return;
      const key = h + '||' + st + '||' + mo;
      if (!map[key]) map[key] = { HOD: h, STATE: st, MONTH: mo, SORT_KEY: _mSk(mo), SQM: 0, SQFT: 0, NET_REVENUE: 0 };
      map[key].SQM += _sqm(r); map[key].SQFT += _sqft(r); map[key].NET_REVENUE += _rev(r);
    });
    return Object.values(map).map(function (r) {
      return {
        HOD: r.HOD, STATE: r.STATE, MONTH: r.MONTH, SORT_KEY: r.SORT_KEY,
        TOTAL_SQFT: Math.round(r.SQFT), TOTAL_SQM: +r.SQM.toFixed(2), NET_REVENUE: Math.round(r.NET_REVENUE)
      };
    }).sort(function (a, b) {
      const sk = b.SORT_KEY.localeCompare(a.SORT_KEY);
      if (sk !== 0) return sk;
      return a.HOD.localeCompare(b.HOD);
    });
  });
}

async function getCustomerQoQ(f) {
  return cached('cust_qoq_' + _stableStringify(f), async function () {
    const q = _q(f, ['month', 'zone']);
    const rows = (await fetchAll('vw_customer_sale_agg', q)).filter(function (r) { return _rowMatches(r, f); });
    const map = {};
    rows.forEach(function (r) {
      const c = _s(r, 'customer_name') || 'Unknown'; const st = _state(r); const h = _hod(r);
      const key = st + '||' + h + '||' + c;
      if (!map[key]) map[key] = { STATE: st, HOD: h, CUSTOMER: c, T: 0, Q1: 0, Q2: 0, Q3: 0, Q4: 0, NET_REVENUE: 0 };
      const s = _sqm(r); const rev = _rev(r);
      map[key].T += s; map[key].NET_REVENUE += rev;
      const qt = _qtr(r);
      if (qt.indexOf('1') !== -1) map[key].Q1 += s;
      if (qt.indexOf('2') !== -1) map[key].Q2 += s;
      if (qt.indexOf('3') !== -1) map[key].Q3 += s;
      if (qt.indexOf('4') !== -1) map[key].Q4 += s;
    });
    return Object.values(map).map(function (c) {
      return {
        STATE: c.STATE, HOD: c.HOD, CUSTOMER: c.CUSTOMER,
        TOTAL_SQFT: Math.round(c.T * 10.76391),
        NET_REVENUE: Math.round(c.NET_REVENUE),
        Q1_SQFT: Math.round(c.Q1 * 10.76391),
        Q2_SQFT: Math.round(c.Q2 * 10.76391),
        Q3_SQFT: Math.round(c.Q3 * 10.76391),
        Q4_SQFT: Math.round(c.Q4 * 10.76391)
      };
    }).sort(function (a, b) { return b.TOTAL_SQFT - a.TOTAL_SQFT; });
  });
}

async function getCustomerAllFYSummary(f) {
  const scopeF = {
    _scope: (f && f._scope) || {},
    zone: (f && f.zone && f.zone !== 'All') ? f.zone : 'All',
    state: (f && f.state && f.state !== 'All') ? f.state : 'All',
    hod: (f && f.hod && f.hod !== 'All') ? f.hod : 'All'
  };
  return cached('cust_all_fy_' + _stableStringify(scopeF), async function () {
    const q = _q(f, ['month', 'zone']);
    const rows = (await fetchAll('vw_customer_sale_agg', q)).filter(function (r) { return _rowMatches(r, scopeF); });
    const map = {};
    rows.forEach(function (r) {
      const c = _s(r, 'customer_name') || 'Unknown'; const st = _state(r); const h = _hod(r); const fy = _robustFy(r);
      if (!c || c === 'Unknown' || !fy) return;
      const key = st + '||' + h + '||' + c + '||' + fy;
      if (!map[key]) map[key] = { STATE: st, HOD: h, CUSTOMER: c, FY: fy, T: 0, Q1: 0, Q2: 0, Q3: 0, Q4: 0, NET_REVENUE: 0 };
      const s = _sqm(r); const rev = _rev(r);
      map[key].T += s; map[key].NET_REVENUE += rev;
      const qt = _qtr(r);
      if (qt.indexOf('1') !== -1) map[key].Q1 += s;
      if (qt.indexOf('2') !== -1) map[key].Q2 += s;
      if (qt.indexOf('3') !== -1) map[key].Q3 += s;
      if (qt.indexOf('4') !== -1) map[key].Q4 += s;
    });
    return Object.values(map).map(function (c) {
      return {
        STATE: c.STATE, HOD: c.HOD, CUSTOMER: c.CUSTOMER, FY: c.FY,
        TOTAL_SQFT: Math.round(c.T * 10.76391),
        NET_REVENUE: Math.round(c.NET_REVENUE),
        Q1_SQFT: Math.round(c.Q1 * 10.76391),
        Q2_SQFT: Math.round(c.Q2 * 10.76391),
        Q3_SQFT: Math.round(c.Q3 * 10.76391),
        Q4_SQFT: Math.round(c.Q4 * 10.76391)
      };
    });
  });
}

async function getCustomerMonthlySummary(f) {
  return cached('cust_monthly_' + _stableStringify(f), async function () {
    const q = _q(f, ['month', 'zone']);
    const rows = (await fetchAll('vw_customer_sale_agg', q)).filter(function (r) { return _rowMatches(r, f); });
    const map = {};
    rows.forEach(function (r) {
      const c = _s(r, 'customer_name') || 'Unknown'; const st = _state(r); const h = _hod(r); const mo = _mo(r);
      if (!c || c === 'Unknown' || !mo) return;
      const key = st + '||' + h + '||' + c + '||' + mo;
      if (!map[key]) map[key] = { STATE: st, HOD: h, CUSTOMER: c, MONTH: mo, SORT_KEY: _mSk(mo), SQM: 0, SQFT: 0, NET_REVENUE: 0 };
      map[key].SQM += _sqm(r); map[key].SQFT += _sqft(r); map[key].NET_REVENUE += _rev(r);
    });
    return Object.values(map).map(function (r) {
      return {
        STATE: r.STATE, HOD: r.HOD, CUSTOMER: r.CUSTOMER, MONTH: r.MONTH, SORT_KEY: r.SORT_KEY,
        TOTAL_SQFT: Math.round(r.SQFT), TOTAL_SQM: +r.SQM.toFixed(2), NET_REVENUE: Math.round(r.NET_REVENUE)
      };
    }).sort(function (a, b) {
      const sk = b.SORT_KEY.localeCompare(a.SORT_KEY);
      if (sk !== 0) return sk;
      return a.CUSTOMER.localeCompare(b.CUSTOMER);
    });
  });
}

async function getSkuTypeQoQ(f) {
  return cached('sku_type_qoq_' + _stableStringify(f), async function () {
    const q = _q(f, ['month']);
    const rows = (await fetchAll('vw_sku_type_sale_agg', q)).filter(function (r) { return _rowMatches(r, f); });
    const map = {};
    rows.forEach(function (r) {
      const st = _state(r); const h = _hod(r); const sku = _s(r, 'sku_type') || 'Unknown';
      const key = st + '||' + h + '||' + sku;
      if (!map[key]) map[key] = { STATE: st, HOD: h, SKU_TYPE: sku, T: 0, Q1: 0, Q2: 0, Q3: 0, Q4: 0, NET_REVENUE: 0 };
      const s = _sqm(r); const rev = _rev(r);
      map[key].T += s; map[key].NET_REVENUE += rev;
      const qt = _qtr(r);
      if (qt.indexOf('1') !== -1) map[key].Q1 += s;
      if (qt.indexOf('2') !== -1) map[key].Q2 += s;
      if (qt.indexOf('3') !== -1) map[key].Q3 += s;
      if (qt.indexOf('4') !== -1) map[key].Q4 += s;
    });
    return Object.values(map).map(function (c) {
      return {
        STATE: c.STATE, HOD: c.HOD, SKU_TYPE: c.SKU_TYPE,
        TOTAL_SQFT: Math.round(c.T * 10.76391),
        NET_REVENUE: Math.round(c.NET_REVENUE),
        Q1_SQFT: Math.round(c.Q1 * 10.76391),
        Q2_SQFT: Math.round(c.Q2 * 10.76391),
        Q3_SQFT: Math.round(c.Q3 * 10.76391),
        Q4_SQFT: Math.round(c.Q4 * 10.76391)
      };
    }).sort(function (a, b) { return b.TOTAL_SQFT - a.TOTAL_SQFT; });
  });
}

async function getSkuTypeAllFYSummary(f) {
  const scopeF = {
    _scope: (f && f._scope) || {},
    zone: (f && f.zone && f.zone !== 'All') ? f.zone : 'All',
    state: (f && f.state && f.state !== 'All') ? f.state : 'All',
    hod: (f && f.hod && f.hod !== 'All') ? f.hod : 'All'
  };
  return cached('sku_type_all_fy_' + _stableStringify(scopeF), async function () {
    const q = _q(f, ['month']);
    const rows = (await fetchAll('vw_sku_type_sale_agg', q)).filter(function (r) { return _rowMatches(r, scopeF); });
    const map = {};
    rows.forEach(function (r) {
      const st = _state(r); const h = _hod(r); const sku = _s(r, 'sku_type') || 'Unknown'; const fy = _robustFy(r);
      if (!fy) return;
      const key = st + '||' + h + '||' + sku + '||' + fy;
      if (!map[key]) map[key] = { STATE: st, HOD: h, SKU_TYPE: sku, FY: fy, T: 0, Q1: 0, Q2: 0, Q3: 0, Q4: 0, NET_REVENUE: 0 };
      const s = _sqm(r); const rev = _rev(r);
      map[key].T += s; map[key].NET_REVENUE += rev;
      const qt = _qtr(r);
      if (qt.indexOf('1') !== -1) map[key].Q1 += s;
      if (qt.indexOf('2') !== -1) map[key].Q2 += s;
      if (qt.indexOf('3') !== -1) map[key].Q3 += s;
      if (qt.indexOf('4') !== -1) map[key].Q4 += s;
    });
    return Object.values(map).map(function (c) {
      return {
        STATE: c.STATE, HOD: c.HOD, SKU_TYPE: c.SKU_TYPE, FY: c.FY,
        TOTAL_SQFT: Math.round(c.T * 10.76391),
        NET_REVENUE: Math.round(c.NET_REVENUE),
        Q1_SQFT: Math.round(c.Q1 * 10.76391),
        Q2_SQFT: Math.round(c.Q2 * 10.76391),
        Q3_SQFT: Math.round(c.Q3 * 10.76391),
        Q4_SQFT: Math.round(c.Q4 * 10.76391)
      };
    });
  });
}

async function getSkuTypeMonthlySummary(f) {
  return cached('sku_type_monthly_' + _stableStringify(f), async function () {
    const q = _q(f, ['month']);
    const rows = (await fetchAll('vw_sku_type_sale_agg', q)).filter(function (r) { return _rowMatches(r, f); });
    const map = {};
    rows.forEach(function (r) {
      const st = _state(r); const h = _hod(r); const sku = _s(r, 'sku_type') || 'Unknown'; const mo = _mo(r);
      if (!mo) return;
      const key = st + '||' + h + '||' + sku + '||' + mo;
      if (!map[key]) map[key] = { STATE: st, HOD: h, SKU_TYPE: sku, MONTH: mo, SORT_KEY: _mSk(mo), SQM: 0, SQFT: 0, NET_REVENUE: 0 };
      map[key].SQM += _sqm(r); map[key].SQFT += _sqft(r); map[key].NET_REVENUE += _rev(r);
    });
    return Object.values(map).map(function (r) {
      return {
        STATE: r.STATE, HOD: r.HOD, SKU_TYPE: r.SKU_TYPE, MONTH: r.MONTH, SORT_KEY: r.SORT_KEY,
        TOTAL_SQFT: Math.round(r.SQFT), TOTAL_SQM: +r.SQM.toFixed(2), NET_REVENUE: Math.round(r.NET_REVENUE)
      };
    }).sort(function (a, b) {
      const sk = b.SORT_KEY.localeCompare(a.SORT_KEY);
      if (sk !== 0) return sk;
      return a.SKU_TYPE.localeCompare(b.SKU_TYPE);
    });
  });
}

async function getExecutiveTargets(f) {
  return cached('exec_targets_v2_' + _stableStringify(f), async function () {
    let qs = '';
    const scope = (f && f._scope) || {};
    const parts = [];
    if (scope.hod_name) parts.push('hod_name=eq.' + encodeURIComponent(scope.hod_name));
    if (scope.allowed_hods && scope.allowed_hods.length) {
      parts.push('hod_name=in.(' + scope.allowed_hods.map(encodeURIComponent).join(',') + ')');
    }
    if (scope.allowed_zones && scope.allowed_zones.length) {
      parts.push('zone=in.(' + scope.allowed_zones.map(encodeURIComponent).join(',') + ')');
    }
    if (scope.allowed_states && scope.allowed_states.length) {
      parts.push('state=in.(' + scope.allowed_states.map(encodeURIComponent).join(',') + ')');
    }
    function addF(col, val) {
      if (!val || val === 'All') return;
      if (Array.isArray(val)) {
        if (val.length === 0 || val.indexOf('All') !== -1) return;
        parts.push(col + '=in.(' + val.map(encodeURIComponent).join(',') + ')');
      } else {
        parts.push(col + '=eq.' + encodeURIComponent(val));
      }
    }
    addF('state', f && f.state);
    addF('zone', f && f.zone);
    addF('hod_name', f && f.hod);
    if (parts.length) qs = '?' + parts.join('&');
    const rows = await fetchAll(DB_TABLES.TARGETS || 'target_master', qs);

    const qMap = {
      JAN: 'Q4', FEB: 'Q4', MAR: 'Q4',
      APR: 'Q1', MAY: 'Q1', JUN: 'Q1',
      JUL: 'Q2', AUG: 'Q2', SEP: 'Q2',
      OCT: 'Q3', NOV: 'Q3', DEC: 'Q3'
    };
    const map = {};
    rows.forEach(function (r) {
      const emp = _s(r, 'employee_name') || 'Unknown';
      const hod = _s(r, 'hod_name') || 'Unknown';
      const st = _s(r, 'state') || 'Unknown';
      const fy = _s(r, 'fy_year');
      let mo = _s(r, 'month_name');
      if (mo && mo.length >= 3) mo = mo.substring(0, 3).toUpperCase();
      const qtr = qMap[mo] || 'Q1';

      const key = emp + '||' + hod + '||' + st;
      if (!map[key]) map[key] = { EMPLOYEE: emp, HOD: hod, STATE: st, YEARLY: {}, QUARTERLY: {}, MONTHLY: {} };

      const t = _num(r.target_sqft);
      const a = _num(r.achievement);

      if (fy) {
        if (!map[key].YEARLY[fy]) map[key].YEARLY[fy] = { t: 0, a: 0 };
        map[key].YEARLY[fy].t += t;
        map[key].YEARLY[fy].a += a;

        const qKey = fy + '_' + qtr;
        if (!map[key].QUARTERLY[qKey]) map[key].QUARTERLY[qKey] = { t: 0, a: 0 };
        map[key].QUARTERLY[qKey].t += t;
        map[key].QUARTERLY[qKey].a += a;

        if (mo) {
          const mKey = fy + '_' + mo;
          if (!map[key].MONTHLY[mKey]) map[key].MONTHLY[mKey] = { t: 0, a: 0 };
          map[key].MONTHLY[mKey].t += t;
          map[key].MONTHLY[mKey].a += a;
        }
      }
    });

    return Object.values(map);
  });
}

async function getOutstandingSummary(f) {
  return cached('outstanding_summary_v3_' + _stableStringify(f), async function () {
    const rows = await _fetchOutstanding(f);
    return rows.map(function (r) {
      return {
        HOD: _s(r, 'hod_name') || 'Unassigned',
        STATE: _s(r, 'state') || 'Unknown',
        ZONE: _s(r, 'zone') || 'Unknown',
        CUSTOMER_NAME: _s(r, 'customer_name') || _s(r, 'customer_code') || 'Unknown',
        CREDIT_LIMIT: _num(_s(r, 'credit_limit')),
        CURRENT_OUTSTANDING: _num(_s(r, 'current_outstanding')),
        BELOW_45: _num(_s(r, 'below_45_days')),
        ABOVE_45: _num(_s(r, 'above_45_days')),
        DAYS_90_PLUS: _num(_s(r, 'days_90_plus'))
      };
    })
      .filter(function (r) { return r.CURRENT_OUTSTANDING > 0; })
      .sort(function (a, b) {
        const hodCmp = (a.HOD || '').toUpperCase().localeCompare((b.HOD || '').toUpperCase());
        if (hodCmp !== 0) return hodCmp;
        const stCmp = (a.STATE || '').toUpperCase().localeCompare((b.STATE || '').toUpperCase());
        if (stCmp !== 0) return stCmp;
        return b.CURRENT_OUTSTANDING - a.CURRENT_OUTSTANDING;
      });
  });
}

async function getOutstandingHODSummary(f) { return getOutstandingSummary(f); }
async function getOutstandingStateSummary(f) { return getOutstandingSummary(f); }

async function getTopCustomers(f, opts) {
  return cached('topCust_' + _stableStringify(f) + '_' + _stableStringify(opts), async function () {
    const q = _q(f, ['month']);
    let rows = (await fetchAll('vw_customer_summary', q)).filter(function (r) { return _rowMatches(r, f); });
    
    if (opts && opts.activeDays) {
      rows = rows.filter(function (r) { return _days(r) <= opts.activeDays; });
    }

    const sm = { sqm: 'SQ FT.', quantity: 'SQ FT.', frequency: 'TRANSACTION COUNT', revenue: 'NET REVENUE' };
    rows.forEach(function (r) {
      r['SQ FT.'] = _sqft(r);
      r['TOTAL SQM'] = _sqm(r);
      r['TRANSACTION COUNT'] = _txns(r);
      r['CUSTOMER NAME'] = _custName(r);
      r['STATE'] = _state(r);
      r['LAST PURCHASE DATE'] = _lastDate(r);
      r['DAYS SINCE LAST PURCHASE'] = _days(r);
      r['NET REVENUE'] = _rev(r);
      r['HOD NAME'] = _hod(r);
    });
    const sf = sm[(opts && opts.sortBy) || 'sqm'] || 'SQ FT.';
    rows.sort(function (a, b) { return (b[sf] || 0) - (a[sf] || 0); });

    const totalCustomers = rows.length;

    if (opts && opts.pareto80) {
      const totSqm = rows.reduce(function (sum, r) { return sum + (r[sf] || 0); }, 0);
      const target80 = totSqm * 0.8;
      let run = 0; let cutIdx = rows.length;
      for (let i = 0; i < rows.length; i++) {
        run += (rows[i][sf] || 0);
        if (run >= target80) { cutIdx = i + 1; break; }
      }
      rows = rows.slice(0, cutIdx);
    }
    
    const paretoSqft = rows.reduce(function(s, r) { return s + (r['SQ FT.'] || 0); }, 0);

    const result = _paginate(rows, opts);
    result.totalCustomers = totalCustomers;
    result.paretoSqft = paretoSqft;
    return result;
  });
}

async function getInactiveCustomers(f, opts) {
  const minDays = (opts && opts.days) || 90;
  return cached('inactive_' + minDays + '_' + _stableStringify(f) + '_' + _stableStringify(opts), async function () {
    const q = _q(f, ['month']);
    const rows = (await fetchAll('vw_customer_summary', q))
      .filter(function (r) { return _rowMatches(r, f); })
      .filter(function (r) { return _days(r) >= minDays; });
    rows.forEach(function (r) {
      const d = _days(r);
      r['INACTIVE CATEGORY'] = d >= 180 ? 'Inactive 180+ Days' : d >= 120 ? 'Inactive 120-179 Days' : 'Inactive 90-119 Days';
      r['SQ FT.'] = _sqft(r);
      r['TRANSACTION COUNT'] = _txns(r);
      r['DAYS SINCE LAST PURCHASE'] = d;
      r['CUSTOMER NAME'] = _custName(r);
      r['STATE'] = _state(r);
      r['LAST PURCHASE DATE'] = _lastDate(r);
      r['HOD NAME'] = _hod(r);
    });
    return _paginate(rows.sort(function (a, b) { return (b['SQ FT.'] || 0) - (a['SQ FT.'] || 0); }), opts);
  });
}

async function getDecliningCustomers(f, opts) {
  return cached('declining_' + _stableStringify(f) + '_' + _stableStringify(opts), async function () {
    const q = _q(f, ['month']);
    const rows = (await fetchAll('vw_customer_summary', q))
      .filter(function (r) { return _rowMatches(r, f); })
      .filter(function (r) {
        const prev = _prev6(r), last = _last6(r);
        if (prev < 50) return false;
        const pct = ((last - prev) / prev) * 100;
        if (pct > -30) return false;
        r['DECLINE %'] = +pct.toFixed(1);
        r['SQM CHANGE'] = last - prev;
        r['PREV 6M SQM'] = prev;
        r['LAST 6M SQM'] = last;
        r['DECLINE CATEGORY'] = pct <= -70 ? 'Critical (70%+)' : pct <= -50 ? 'Severe (50-70%)' : 'Significant (30-50%)';
        r['CUSTOMER NAME'] = _custName(r);
        r['STATE'] = _state(r);
        r['HOD NAME'] = _hod(r);
        return true;
      }).sort(function (a, b) { return (a['DECLINE %'] || 0) - (b['DECLINE %'] || 0); });
    return _paginate(rows, opts);
  });
}

async function getLostHVCustomers(f, opts) {
  return cached('losthv_' + _stableStringify(f) + '_' + _stableStringify(opts), async function () {
    const q = _q(f, ['month']);
    const rows = (await fetchAll('vw_customer_summary', q)).filter(function (r) { return _rowMatches(r, f); });
    rows.forEach(function (r) {
      r['SQ FT.'] = _sqft(r);
      r['CUSTOMER NAME'] = _custName(r);
      r['STATE'] = _state(r);
      r['HOD NAME'] = _hod(r);
    });
    rows.sort(function (a, b) { return (b['SQ FT.'] || 0) - (a['SQ FT.'] || 0); });
    const top20 = rows.slice(0, Math.ceil(rows.length * 0.2)).filter(function (r) { return _last6(r) === 0; });
    top20.forEach(function (r, i) {
      r['SQM PERCENTILE'] = Math.round((1 - i / rows.length) * 100);
      r['DAYS INACTIVE'] = _days(r);
      r['LAST PURCHASE DATE'] = _lastDate(r);
    });
    return _paginate(top20.sort(function (a, b) { return (b['SQ FT.'] || 0) - (a['SQ FT.'] || 0); }), opts);
  });
}

async function getRFMData(f, opts) {
  return cached('rfmData_' + _stableStringify(f) + '_' + _stableStringify(opts), async function () {
    const q = _q(f, ['month']);
    let rows = _computeRFM((await fetchAll('vw_customer_summary', q)).filter(function (r) { return _rowMatches(r, f); }));
    if (opts && opts.segment && opts.segment !== 'All') {
      rows = rows.filter(function (r) { return r['SEGMENT'] === opts.segment; });
    }
    return _paginate(rows.sort(function (a, b) { return b['RFM TOTAL'] - a['RFM TOTAL']; }), opts);
  });
}

async function getRFMDistribution(f) {
  return cached('rfmDist_' + _stableStringify(f), async function () {
    const q = _q(f, ['month']);
    const dist = {};
    _computeRFM((await fetchAll('vw_customer_summary', q)).filter(function (r) { return _rowMatches(r, f); })).forEach(function (r) {
      const s = r['SEGMENT'];
      if (!dist[s]) dist[s] = { segment: s, count: 0, totalSqft: 0 };
      dist[s].count++;
      dist[s].totalSqft += r['SQ FT.'];
    });
    return Object.values(dist)
      .map(function (d) { return Object.assign({}, d, { totalSqft: Math.round(d.totalSqft) }); })
      .sort(function (a, b) { return b.totalSqft - a.totalSqft; });
  });
}

async function getBrandSummary(f) {
  return cached('brand_' + _stableStringify(f), async function () {
    const q = _q(f, ['month']); const map = {};
    (await fetchAll('vw_brand_agg', q)).filter(function (r) { return _rowMatches(r, f); }).forEach(function (r) {
      const b = _brand(r);
      if (!map[b]) map[b] = { BRAND: b, TOTAL_SQFT: 0, TOTAL_SQM: 0, TOTAL_QTY: 0, TXN_COUNT: 0, STANDARD_COUNT: 0, REGULAR_COUNT: 0, NET_REVENUE: 0, finishes: {} };
      map[b].TOTAL_SQFT += _sqft(r); map[b].TOTAL_SQM += _sqm(r);
      map[b].TOTAL_QTY += _qty(r); map[b].TXN_COUNT += _txns(r);
      map[b].NET_REVENUE += _rev(r);
      const fn = _finish(r);
      if (fn) {
        if (!map[b].finishes[fn]) map[b].finishes[fn] = 0;
        map[b].finishes[fn] += _sqft(r);
      }
      if (_sku(r).indexOf('STANDARD') !== -1) map[b].STANDARD_COUNT += _txns(r);
      else map[b].REGULAR_COUNT += _txns(r);
    });
    return Object.values(map)
      .map(function (b) { return Object.assign({}, b, { TOTAL_SQFT: Math.round(b.TOTAL_SQFT), TOTAL_SQM: +b.TOTAL_SQM.toFixed(2), TOTAL_QTY: +b.TOTAL_QTY.toFixed(2), NET_REVENUE: Math.round(b.NET_REVENUE) }); })
      .sort(function (a, b) { return b.TOTAL_SQFT - a.TOTAL_SQFT; });
  });
}

async function getFinishSummary(f) {
  return cached('finish_' + _stableStringify(f), async function () {
    const q = _q(f, ['month']); const map = {};
    (await fetchAll('vw_brand_agg', q)).filter(function (r) { return _rowMatches(r, f); }).forEach(function (r) {
      const fn = _finish(r);
      if (!map[fn]) map[fn] = { FINISH: fn, TOTAL_SQFT: 0, TOTAL_SQM: 0, TXN_COUNT: 0, NET_REVENUE: 0 };
      map[fn].TOTAL_SQFT += _sqft(r); map[fn].TOTAL_SQM += _sqm(r); map[fn].TXN_COUNT += _txns(r);
      map[fn].NET_REVENUE += _rev(r);
    });
    return Object.values(map)
      .map(function (f2) { return Object.assign({}, f2, { TOTAL_SQFT: Math.round(f2.TOTAL_SQFT), TOTAL_SQM: +f2.TOTAL_SQM.toFixed(2), NET_REVENUE: Math.round(f2.NET_REVENUE) }); })
      .sort(function (a, b) { return b.TOTAL_SQFT - a.TOTAL_SQFT; });
  });
}

async function getProductTypeSummary(f) {
  return cached('prodType_' + _stableStringify(f), async function () {
    const q = _q(f, ['month']); const map = {};
    (await fetchAll('vw_brand_agg', q)).filter(function (r) { return _rowMatches(r, f); }).forEach(function (r) {
      const t = _pt(r);
      if (!map[t]) map[t] = { PRODUCT_TYPE: t, TOTAL_SQFT: 0, TOTAL_SQM: 0, TOTAL_QTY: 0, TXN_COUNT: 0, brandSqm: {}, NET_REVENUE: 0 };
      map[t].TOTAL_SQFT += _sqft(r); map[t].TOTAL_SQM += _sqm(r);
      map[t].TOTAL_QTY += _qty(r); map[t].TXN_COUNT += _txns(r);
      map[t].NET_REVENUE += _rev(r);
      const br = _brand(r);
      map[t].brandSqm[br] = (map[t].brandSqm[br] || 0) + _sqm(r);
    });
    return Object.values(map).map(function (p) {
      const top = Object.entries(p.brandSqm).sort(function (a, b) { return b[1] - a[1]; })[0];
      return {
        PRODUCT_TYPE: p.PRODUCT_TYPE, BRAND: top ? top[0] : '-',
        TOTAL_SQFT: Math.round(p.TOTAL_SQFT),
        TOTAL_SQM: +p.TOTAL_SQM.toFixed(2),
        TOTAL_QTY: +p.TOTAL_QTY.toFixed(2),
        TXN_COUNT: p.TXN_COUNT,
        NET_REVENUE: Math.round(p.NET_REVENUE),
        CUSTOMER_COUNT: 0
      };
    }).sort(function (a, b) { return b.TOTAL_SQFT - a.TOTAL_SQFT; });
  });
}

async function getTopSKUs(f, opts) {
  const bF = opts && opts.brand && opts.brand !== 'All' ? opts.brand.toUpperCase() : null;
  const sF = opts && opts.skuType && opts.skuType !== 'All' ? opts.skuType.toUpperCase() : null;
  return cached('topSKU_' + (bF || 'All') + '_' + (sF || 'All') + '_' + _stableStringify(f) + '_' + _stableStringify(opts), async function () {
    let q = _q(f, ['month']);
    if (bF) q = (q ? q + '&' : '?') + 'brand=ilike.' + encodeURIComponent(bF);
    if (sF) q = (q ? q + '&' : '?') + 'sku_type=ilike.' + encodeURIComponent(sF);
    const rows = (await fetchAll('vw_sku_agg', q)).filter(function (r) { return _rowMatches(r, f); });
    const brands = (await fetchAll('vw_brand_agg', _q(f, ['month']))).filter(function (r) { return _rowMatches(r, f); })
      .map(function (r) { return _brand(r); })
      .filter(Boolean)
      .filter(function (v, i, a) { return a.indexOf(v) === i; })
      .sort();
    const map = {};
    rows.forEach(function (r) {
      const code = _s(r, 'item_code') || 'Unknown';
      if (!map[code]) map[code] = {
        ITEM_CODE: code, ITEM_DESCRIPTION: _s(r, 'item_description'),
        BRAND: _brand(r), FINISH: _finish(r), SIZE: _s(r, 'size'),
        SKU_TYPE: _sku(r), THICKNESS: _thick(r),
        TOTAL_SQFT: 0, TOTAL_SQM: 0, TOTAL_QTY: 0, TXN_COUNT: 0, NET_REVENUE: 0
      };
      map[code].TOTAL_SQFT += _sqft(r); map[code].TOTAL_SQM += _sqm(r);
      map[code].TOTAL_QTY += _qty(r); map[code].TXN_COUNT += _txns(r);
      map[code].NET_REVENUE += _rev(r);
    });
    const sorted = Object.values(map)
      .map(function (s) { return Object.assign({}, s, { TOTAL_SQFT: Math.round(s.TOTAL_SQFT), TOTAL_SQM: +s.TOTAL_SQM.toFixed(2), TOTAL_QTY: +s.TOTAL_QTY.toFixed(2), NET_REVENUE: Math.round(s.NET_REVENUE) }); })
      .sort(function (a, b) { return b.TOTAL_SQFT - a.TOTAL_SQFT; });
    
    let finalRows = sorted;
    if (opts && opts.pareto80) {
      const totSqft = finalRows.reduce(function (sum, r) { return sum + r.TOTAL_SQFT; }, 0);
      const target80 = totSqft * 0.8;
      let run = 0; let cutIdx = finalRows.length;
      for (let i = 0; i < finalRows.length; i++) {
        run += finalRows[i].TOTAL_SQFT;
        if (run >= target80) { cutIdx = i + 1; break; }
      }
      finalRows = finalRows.slice(0, cutIdx);
    }
    
    const result = _paginate(finalRows, opts);
    result.brands = brands;
    return result;
  });
}

async function getDimensionalSummary(f) {
  return cached('dim_' + _stableStringify(f), async function () {
    const q = _q(f, ['month']); const map = {};
    (await fetchAll('vw_sku_agg', q)).filter(function (r) { return _rowMatches(r, f); }).forEach(function (r) {
      const size = _s(r, 'size') || 'Unknown';
      const thick = _thick(r) || 'Unknown';
      const key = size + '||' + thick;
      if (!map[key]) map[key] = { SIZE: size, THICKNESS: thick, TOTAL_SQFT: 0, NET_REVENUE: 0, TXN_COUNT: 0 };
      map[key].TOTAL_SQFT += _sqft(r);
      map[key].NET_REVENUE += _rev(r);
      map[key].TXN_COUNT += _txns(r);
    });
    return Object.values(map)
      .map(function (d) { return Object.assign({}, d, { TOTAL_SQFT: Math.round(d.TOTAL_SQFT), NET_REVENUE: Math.round(d.NET_REVENUE) }); })
      .sort(function (a, b) { return b.TOTAL_SQFT - a.TOTAL_SQFT; });
  });
}

async function getProductPivotSales(f, opts) {
  const timeGroup = opts && opts.timeGroup ? opts.timeGroup : 'quarter';
  const rowGroup = opts && opts.rowGroup ? opts.rowGroup : 'product_type';
  
  return cached('pivot_' + timeGroup + '_' + rowGroup + '_' + _stableStringify(f), async function () {
    const q = _q(f, []); 
    const dataByRow = {};
    const timeColsSet = new Set();
    
    (await fetchAll('vw_sku_agg', q)).filter(function (r) { return _rowMatches(r, f); }).forEach(function (r) {
      let tKey = 'Unknown';
      let tSortKey = '';
      if (timeGroup === 'month') {
        tKey = r['MONTH YEAR'] || r['month_year'] || _mo(r) || 'Unknown';
        tSortKey = _mSk(tKey) || tKey;
      } else if (timeGroup === 'quarter') {
        tKey = r['QUARTER'] || r['quarter'] || _qtr(r) || 'Unknown';
        tSortKey = tKey;
      } else if (timeGroup === 'year') {
        tKey = r['FY YEAR'] || r['fy_year'] || _robustFy(r) || 'Unknown';
        tSortKey = tKey;
      }
      
      const rKey = _s(r, rowGroup) || 'Unknown';
      
      if (!dataByRow[rKey]) dataByRow[rKey] = { CATEGORY: rKey, TOTAL_SQFT: 0 };
      if (!dataByRow[rKey][tKey]) dataByRow[rKey][tKey] = 0;
      
      const sqft = _sqft(r);
      dataByRow[rKey][tKey] += sqft;
      dataByRow[rKey].TOTAL_SQFT += sqft;
      
      if (tKey !== 'Unknown') timeColsSet.add(JSON.stringify({ key: tKey, sortKey: tSortKey }));
    });
    
    const timeCols = Array.from(timeColsSet).map(s => JSON.parse(s)).sort((a, b) => {
       if (a.sortKey < b.sortKey) return -1;
       if (a.sortKey > b.sortKey) return 1;
       return 0;
    }).map(x => x.key);
    
    const rows = Object.values(dataByRow).sort((a, b) => b.TOTAL_SQFT - a.TOTAL_SQFT).map(r => {
      const out = { CATEGORY: r.CATEGORY, TOTAL_SQFT: Math.round(r.TOTAL_SQFT) };
      timeCols.forEach(tc => { out[tc] = Math.round(r[tc] || 0); });
      return out;
    });
    
    return { columns: timeCols, rows: rows };
  });
}

async function getHodSkuPivotSales(f, opts) {
  const timeGroup = opts && opts.timeGroup ? opts.timeGroup : 'quarter';
  
  return cached('hodsku_' + timeGroup + '_' + _stableStringify(f), async function () {
    const q = _q(f, []); 
    const dataByRow = {};
    const timeColsSet = new Set();
    
    (await fetchAll('vw_sku_agg', q)).filter(function (r) { return _rowMatches(r, f); }).forEach(function (r) {
      let tKey = 'Unknown';
      let tSortKey = '';
      if (timeGroup === 'month') {
        tKey = r['MONTH YEAR'] || r['month_year'] || _mo(r) || 'Unknown';
        tSortKey = _mSk(tKey) || tKey;
      } else if (timeGroup === 'quarter') {
        tKey = r['QUARTER'] || r['quarter'] || _qtr(r) || 'Unknown';
        tSortKey = tKey;
      } else if (timeGroup === 'year') {
        tKey = r['FY YEAR'] || r['fy_year'] || _robustFy(r) || 'Unknown';
        tSortKey = tKey;
      }
      
      const hodKey = _hod(r);
      const skuKey = _sku(r);
      const combinedKey = hodKey + '|' + skuKey;
      
      if (!dataByRow[combinedKey]) dataByRow[combinedKey] = { HOD: hodKey, SKU: skuKey, TOTAL_SQFT: 0 };
      if (!dataByRow[combinedKey][tKey]) dataByRow[combinedKey][tKey] = 0;
      
      const sqft = _sqft(r);
      dataByRow[combinedKey][tKey] += sqft;
      dataByRow[combinedKey].TOTAL_SQFT += sqft;
      
      if (tKey !== 'Unknown') timeColsSet.add(JSON.stringify({ key: tKey, sortKey: tSortKey }));
    });
    
    const timeCols = Array.from(timeColsSet).map(s => JSON.parse(s)).sort((a, b) => {
       if (a.sortKey < b.sortKey) return -1;
       if (a.sortKey > b.sortKey) return 1;
       return 0;
    }).map(x => x.key);
    
    // Sort by HOD name then by TOTAL_SQFT descending
    const rows = Object.values(dataByRow).sort((a, b) => {
      if (a.HOD < b.HOD) return -1;
      if (a.HOD > b.HOD) return 1;
      return b.TOTAL_SQFT - a.TOTAL_SQFT;
    }).map(r => {
      const out = { HOD: r.HOD, SKU: r.SKU, TOTAL_SQFT: Math.round(r.TOTAL_SQFT) };
      timeCols.forEach(tc => { out[tc] = Math.round(r[tc] || 0); });
      return out;
    });
    
    return { columns: timeCols, rows: rows };
  });
}

async function getTimeWiseSales(f, opts) {
  const groupBy = opts && opts.groupBy ? opts.groupBy : 'month';
  return cached('time_' + groupBy + '_' + _stableStringify(f), async function () {
    const q = _q(f, ['month']); const map = {};
    (await fetchAll('vw_sku_agg', q)).filter(function (r) { return _rowMatches(r, f); }).forEach(function (r) {
      let key = 'Unknown';
      let sortKey = '';
      if (groupBy === 'month') {
        if (Object.keys(map).length === 0) console.log('vw_sku_agg row keys:', Object.keys(r));
        key = r['MONTH YEAR'] || r['month_year'] || _mo(r) || 'Unknown';
        sortKey = _mSk(key) || key;
      } else if (groupBy === 'quarter') {
        key = r['QUARTER'] || r['quarter'] || _qtr(r) || 'Unknown';
        sortKey = key;
      } else if (groupBy === 'year') {
        key = r['FY YEAR'] || r['fy_year'] || _robustFy(r) || 'Unknown';
        sortKey = key;
      }
      
      if (!map[key]) map[key] = { TIME_PERIOD: key, TOTAL_SQFT: 0, _SK: sortKey };
      map[key].TOTAL_SQFT += _sqft(r);
    });
    return Object.values(map)
      .map(function (c) { return Object.assign({}, c, { TOTAL_SQFT: Math.round(c.TOTAL_SQFT) }); })
      .sort(function (a, b) { 
        return (b._SK || '').localeCompare(a._SK || ''); 
      });
  });
}

async function getCategoricalPerformance(f, opts) {
  const groupBy = opts && opts.groupBy ? opts.groupBy : 'FINISH';
  return cached('cat_' + groupBy + '_' + _stableStringify(f), async function () {
    const q = _q(f, ['month']); const map = {};
    (await fetchAll('vw_sku_agg', q)).filter(function (r) { return _rowMatches(r, f); }).forEach(function (r) {
      let key = 'Unknown';
      if (groupBy === 'FINISH') key = _finish(r);
      else if (groupBy === 'THICKNESS TYPE') key = _thick(r);
      else if (groupBy === 'PRODUCT TYPE') key = _pt(r);
      else if (groupBy === 'SKU TYPE') key = _sku(r);
      
      if (!key) key = 'Unknown';

      if (!map[key]) map[key] = { CATEGORY: key, TOTAL_SQFT: 0, TOTAL_SQM: 0, TOTAL_QTY: 0, TXN_COUNT: 0, NET_REVENUE: 0 };
      map[key].TOTAL_SQFT += _sqft(r); map[key].TOTAL_SQM += _sqm(r);
      map[key].TOTAL_QTY += _qty(r); map[key].TXN_COUNT += _txns(r);
      map[key].NET_REVENUE += _rev(r);
    });
    return Object.values(map)
      .map(function (c) { return Object.assign({}, c, { TOTAL_SQFT: Math.round(c.TOTAL_SQFT), TOTAL_SQM: +c.TOTAL_SQM.toFixed(2), TOTAL_QTY: +c.TOTAL_QTY.toFixed(2), NET_REVENUE: Math.round(c.NET_REVENUE) }); })
      .sort(function (a, b) { return b.TOTAL_SQFT - a.TOTAL_SQFT; });
  });
}

async function getCustomReport(opts) {
  if (!opts || !opts.sheetId || !opts.sheetName) throw new Error('Missing sheetId or sheetName for custom report.');
  
  return cached('custom_report_' + opts.sheetId + '_' + opts.sheetName, async function() {
    const data = await fetchSheetData(opts.sheetId, opts.sheetName);
    if (!data || !data.headers || !data.rows) return [];
    
    // Combine headers and rows into a single 2D array for the frontend
    return [data.headers, ...data.rows];
  }, 600); // Cache for 10 minutes
}

async function getSheetHeaders(opts) {
  if (!opts || !opts.sheetId || !opts.sheetName) throw new Error('Missing sheetId or sheetName.');
  return cached('sheet_headers_' + opts.sheetId + '_' + opts.sheetName, async function() {
    return fetchSheetHeaders(opts.sheetId, opts.sheetName);
  }, 3600); // Cache for 1 hour
}

async function getSheetTabs(opts) {
  if (!opts || !opts.sheetId) throw new Error('Missing sheetId.');
  return cached('sheet_tabs_' + opts.sheetId, async function() {
    return fetchSheetTabs(opts.sheetId);
  }, 3600); // Cache for 1 hour
}

module.exports = {
  getFilterOptions,
  getKPIs,
  getOverviewData,
  getMonthlySummary,
  getStateSummary,
  getHODQoQ,
  getHODAllFYSummary,
  getHODMonthlySummary,
  getCustomerQoQ,
  getCustomerAllFYSummary,
  getCustomerMonthlySummary,
  getSkuTypeQoQ,
  getSkuTypeAllFYSummary,
  getSkuTypeMonthlySummary,
  getExecutiveTargets,
  getOutstandingSummary,
  getOutstandingHODSummary,
  getOutstandingStateSummary,
  getTopCustomers,
  getInactiveCustomers,
  getDecliningCustomers,
  getLostHVCustomers,
  getRFMData,
  getRFMDistribution,
  getBrandSummary,
  getFinishSummary,
  getProductTypeSummary,
  getTopSKUs,
  getDimensionalSummary,
  getCategoricalPerformance,
  getTimeWiseSales,
  getProductPivotSales,
  getHodSkuPivotSales,
  getCustomReport,
  getSheetHeaders,
  getSheetTabs
};
