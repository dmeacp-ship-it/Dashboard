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

const { fetchAll, getSalesRowCount, supaFetch } = require('./supabase');

const STATE_TO_ZONE = {};

// hod_name -> HOD territory (the source sheets' HOD_STATE column).
//
// HOD_STATE is an attribute of the HOD, not of the individual sale: verified
// against the RAW DATA sheets, 31 of 32 HODs carry exactly one value (labels
// are territories, e.g. 'AP & TELEGANA', 'TRI CITY & HIMACHAL', 'HEAD OFFICE').
// Resolving it once by hod_name -- rather than adding a column to every
// aggregate view -- lets every existing vw_*/mv_* view and both RPCs stay
// untouched, since they all already group by hod_name. It also covers
// FY 24-25, whose sheet has no HOD_STATE column at all.
//
// Populated from vw_hod_state (db/migrations/08_create_hod_state_view.sql).
// Until that migration and a data sync have run the map stays empty and every
// lookup falls back to the row's own billing state, so this degrades safely.
const HOD_TO_STATE = {};
let _hodStateAt = 0;
let _hodStateOk = false;
const HOD_STATE_TTL_MS = 10 * 60 * 1000;
// Negative cache. Before migration 08 is applied vw_hod_state 404s on every
// call, and this loader runs once per authenticated request -- including each
// tick of the sync polling loop, which fires up to 400 times. Without a retry
// floor that becomes a request storm against Supabase on top of the sync's own
// uploads. Short enough that the map still picks itself up automatically once
// the migration lands.
const HOD_STATE_RETRY_MS = 60 * 1000;

// Loads (and refreshes) the hod_name -> territory map. Best-effort: any
// failure leaves the previous map in place rather than blanking the dashboard.
async function loadHodStates(force) {
  const ttl = _hodStateOk ? HOD_STATE_TTL_MS : HOD_STATE_RETRY_MS;
  if (!force && _hodStateAt && (Date.now() - _hodStateAt) < ttl) return HOD_TO_STATE;
  // Stamped up front, not on success: a failure has to back off too, otherwise
  // every request retries a call that is known to be failing.
  _hodStateAt = Date.now();
  try {
    const rows = await fetchAll('vw_hod_state', '?select=hod_name,hod_state');
    if (rows && rows.length) {
      Object.keys(HOD_TO_STATE).forEach(function (k) { delete HOD_TO_STATE[k]; });
      rows.forEach(function (r) {
        const h = String(r.hod_name || '').trim();
        const st = String(r.hod_state || '').trim();
        // One HOD legitimately spans two labels (e.g. a state + HEAD OFFICE);
        // first value wins so a HOD never flickers between rows.
        if (h && st && !HOD_TO_STATE[h]) HOD_TO_STATE[h] = st;
      });
      _hodStateOk = true;
    }
  } catch (e) {
    // vw_hod_state missing (migration 08 not applied yet) -> keep falling back.
  }
  return HOD_TO_STATE;
}

const { cached } = require('./cache.service');
const { DB_TABLES, ROLES, SQFT_PER_SQM } = require('../config');
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
function _sqm(r)   { const v = _num(_s(r, 'total_sqm')); return v || _num(_s(r, 'sq_ft')) / SQFT_PER_SQM; }
function _sqft(r)  { const v = _num(_s(r, 'sq_ft'));     return v || _num(_s(r, 'total_sqm')) * SQFT_PER_SQM; }
function _txns(r)  { return _num(_s(r, 'txn_count') || _s(r, 'transaction_count')); }
function _qty(r)   { return _num(_s(r, 'quantity')) || _num(_s(r, 'total_qty')); }
function _days(r)  { return _num(_s(r, 'days_since_last_purchase')); }
function _prev6(r) { return _num(_s(r, 'prev_6m_sqm')); }
function _last6(r) { return _num(_s(r, 'last_6m_sqm')); }
function _rev(r)   { return _num(_s(r, 'net_revenue')) || _num(_s(r, 'revenue')); }
function _thick(r) { return _s(r, 'thickness') || '-'; }
function _fy(r)    { return _s(r, 'fy_year'); }
function _zone(r)  { return _s(r, 'zone') || STATE_TO_ZONE[_rawState(r)] || 'Unknown'; }
// The billing/shipping state as it arrives from the sheet's STATE column.
// Only the zone lookup still needs it; nothing user-facing shows it.
function _rawState(r) { return _s(r, 'state') || 'Unknown'; }
// The state shown everywhere in the dashboard: the HOD's territory. Resolved
// by hod_name so it works against the aggregate views, which never carried a
// hod_state column; falls back to the row's own value, then to billing state.
function _state(r) {
  const h = _s(r, 'hod_name');
  return (h && HOD_TO_STATE[h]) || _s(r, 'hod_state') || _s(r, 'state') || 'Unknown';
}
function _city(r)  { return _s(r, 'city') || 'Unknown'; }
function _hod(r)   { return _s(r, 'hod_name') || 'Unknown'; }
function _prevHod(r) { return _s(r, 'prev_hod_name') || '-'; }
function _brand(r) { return _s(r, 'brand') || 'Unknown'; }
function _finish(r){ return _s(r, 'finish') || 'Unknown'; }
function _colorCode(r) { return _s(r, 'color_code') || '-'; }
function _billNo(r) { return _s(r, 'bill_number_sap') || '-'; }
function _projectPct(r) { return _num(_s(r, 'project_pct')); }
function _projectSalesPerson(r) { return _s(r, 'project_sales_person') || '-'; }
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

// Normalises a filter value to an array of concrete values, or null when the
// filter is absent / 'All' (mirrors _matches semantics).
function _vals(val) {
  if (!val || val === 'All') return null;
  if (Array.isArray(val)) {
    if (val.length === 0 || val.indexOf('All') !== -1) return null;
    return val;
  }
  return [val];
}

// Client FY 'FY 24-25' -> DB fy_year 'FY-24-25'. Returns null if unparseable
// so the caller can skip the push-down and rely on _rowMatches alone.
function _fyToDb(v) {
  const m = String(v || '').match(/(\d{2})[-\s_]+(\d{2})/);
  return m ? 'FY-' + m[1] + '-' + m[2] : null;
}

// Client month 'Apr-24' -> ilike pattern 'Apr*24' (DB stores raw strings like
// 'Apr- 24'). Both pieces are validated so no PostgREST metacharacters leak in.
function _moToPattern(v) {
  const p = String(v || '').trim().replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  if (p.length < 2) return null;
  const mon = p[0].substring(0, 3);
  if (!/^[A-Za-z]{3}$/.test(mon)) return null;
  let y = p[p.length - 1];
  if (y.length === 4) y = y.slice(2);
  if (!/^\d{2}$/.test(y)) return null;
  return mon + '*' + y;
}

// Builds the PostgREST query string for a filter set. Time filters (fy,
// quarter, month) are pushed down server-side — verified against live data:
// every view's fy_year/quarter agree with the values _rowMatches derives, so
// this only ever narrows to the same row set. _rowMatches still runs
// client-side as the exact-semantics safety net. Callers whose views lack
// time columns, or that deliberately fetch all periods, exclude 'fy'/'quarter'.
function _q(f, exclude) {
  f = f || {};
  exclude = exclude || [];
  if (process.env.DISABLE_TIME_PUSHDOWN === '1') exclude = exclude.concat(['month', 'fy', 'quarter']);
  const p = [];
  const orGroups = [];
  function addFilter(col, val) {
    if (!val || val === 'All') return;
    if (Array.isArray(val)) {
      if (val.length === 0 || val.indexOf('All') !== -1) return;
      p.push(col + '=in.(' + val.map(encodeURIComponent).join(',') + ')');
    } else {
      p.push(col + '=eq.' + encodeURIComponent(val));
    }
  }
  if (exclude.indexOf('month') === -1) {
    const months = _vals(f.month);
    if (months) {
      const pats = months.map(_moToPattern);
      if (pats.every(Boolean)) {
        orGroups.push(pats.map(function (x) { return 'month_year.ilike.' + x; }));
      }
    }
  }
  if (exclude.indexOf('fy') === -1) {
    const fys = _vals(f.fy);
    if (fys) {
      const dbFys = fys.map(_fyToDb);
      if (dbFys.every(Boolean)) addFilter('fy_year', dbFys.length === 1 ? dbFys[0] : dbFys);
    }
  }
  if (exclude.indexOf('quarter') === -1) {
    const qtrs = _vals(f.quarter);
    if (qtrs) {
      // Plain 'Q1' matches any FY; combo 'FY 24-25|Q1' pins both columns.
      const conds = qtrs.map(function (v) {
        const s = String(v);
        if (s.indexOf('|') !== -1) {
          const fy = _fyToDb(s.split('|')[0]);
          const qm = s.split('|')[1].match(/(\d)/);
          return (fy && qm) ? 'and(fy_year.eq.' + fy + ',quarter.like.*Q-' + qm[1] + ')' : null;
        }
        const qm = s.match(/Q[^\d]*(\d)/i);
        return qm ? 'quarter.like.*Q-' + qm[1] : null;
      });
      if (conds.every(Boolean)) orGroups.push(conds);
    }
  }
  if (exclude.indexOf('zone') === -1) addFilter('zone', f.zone);
  // Territory selection -> hod_name. PostgREST ANDs repeated column filters,
  // so this intersects naturally with any explicit HOD filter below.
  if (exclude.indexOf('state') === -1) {
    const stHods = _hodsForStates(_vals(f.state));
    if (stHods) p.push('hod_name=in.(' + stHods.map(encodeURIComponent).join(',') + ')');
  }
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
    const scHods = _hodsForStates(scope.allowed_states);
    p.push(scHods
      ? 'hod_name=in.(' + scHods.map(encodeURIComponent).join(',') + ')'
      : 'state=in.(' + scope.allowed_states.map(encodeURIComponent).join(',') + ')');
  }
  // PostgREST allows one top-level or=; multiple groups get wrapped in and=().
  if (orGroups.length === 1) {
    p.push('or=(' + orGroups[0].join(',') + ')');
  } else if (orGroups.length > 1) {
    p.push('and=(' + orGroups.map(function (g) { return 'or(' + g.join(',') + ')'; }).join(',') + ')');
  }
  return p.length ? '?' + p.join('&') : '';
}

// Optional relations (RPCs / views) that may not exist in a deployment.
// Remember misses for the life of the instance so every cache miss doesn't
// repay a failed probe round-trip before hitting the fallback.
const _missingRelations = {};
async function _tryFetchAll(rel, qs) {
  if (_missingRelations[rel]) return null;
  try {
    return await fetchAll(rel, qs);
  } catch (e) {
    const msg = String((e && e.message) || '');
    if (/PGRST20\d|42703|42P01|42883|does not exist|Supabase 404/.test(msg)) {
      _missingRelations[rel] = true;
    }
    return null;
  }
}

// POSTs an RPC with JSON params and returns the parsed jsonb result, or null
// when the function is missing/failing/slow (memoized like _tryFetchAll for
// the "missing" case) so the caller can fall back. Functions return jsonb — a
// single value — so PostgREST's max-rows cap never truncates them.
//
// Bounded to RPC_TIMEOUT_MS client-side: an unindexed aggregate query can run
// far longer under Postgres's own statement_timeout than is safe to wait on
// (observed live: ~87s on an unfiltered getTopSKUs, well past Vercel's 60s
// function limit) — bailing out early lets the JS fallback path run instead.
const RPC_TIMEOUT_MS = 8000;
async function _tryRpc(fn, params) {
  const key = 'rpc/' + fn;
  if (_missingRelations[key]) return null;
  try {
    return await supaFetch('/rest/v1/rpc/' + fn, 'post', params || {}, RPC_TIMEOUT_MS);
  } catch (e) {
    const msg = String((e && e.message) || '');
    if (/PGRST20\d|42883|42P01|does not exist|error 404/.test(msg)) _missingRelations[key] = true;
    return null;
  }
}

// The UI's state picker now lists HOD territories, but no view or RPC has a
// territory column -- they all key on hod_name. So a territory selection is
// translated into the set of HODs sitting in those territories and applied as
// a hod_name filter instead. Returns null when the selection can't be narrowed
// (map not loaded yet), which leaves the query unfiltered rather than empty.
function _hodsForStates(vals) {
  if (!vals || !vals.length) return null;
  const want = {};
  vals.forEach(function (v) { want[String(v).trim().toLowerCase()] = 1; });
  const hods = Object.keys(HOD_TO_STATE).filter(function (h) {
    return want[String(HOD_TO_STATE[h]).trim().toLowerCase()];
  });
  return hods.length ? hods : null;
}

// Intersects two hod_name lists; either side may be null meaning "unrestricted".
function _intersectHods(a, b) {
  if (!a) return b;
  if (!b) return a;
  const inB = {};
  b.forEach(function (h) { inB[h] = 1; });
  const out = a.filter(function (h) { return inB[h]; });
  return out.length ? out : ['__none__'];
}

// Translates a filter set into the shared RPC filter contract
// (db/perf_phase2.sql). Returns null when a value can't be translated —
// callers then use the fetch-and-aggregate fallback path.
function _rpcTimeGeoParams(f) {
  f = f || {};
  const p = {
    p_fy: null, p_q: null, p_fyq_fy: null, p_fyq_q: null,
    p_zone: null, p_state: null, p_hod: null,
    p_zone2: null, p_state2: null, p_hod2: null
  };
  const fys = _vals(f.fy);
  if (fys) {
    const d = fys.map(_fyToDb);
    if (!d.every(Boolean)) return null;
    p.p_fy = d;
  }
  const qtrs = _vals(f.quarter);
  if (qtrs) {
    const plain = [], pairFy = [], pairQ = [];
    for (const v of qtrs.map(String)) {
      if (v.indexOf('|') !== -1) {
        const fy = _fyToDb(v.split('|')[0]);
        const m = v.split('|')[1].match(/(\d)/);
        if (!fy || !m) return null;
        pairFy.push(fy); pairQ.push('Q-' + m[1]);
      } else {
        const m = v.match(/Q[^\d]*(\d)/i);
        if (!m) return null;
        plain.push('Q-' + m[1]);
      }
    }
    if (plain.length) p.p_q = plain;
    if (pairFy.length) { p.p_fyq_fy = pairFy; p.p_fyq_q = pairQ; }
  }
  const zones = _vals(f.zone); if (zones) p.p_zone = zones;
  // Territories are resolved to HODs (see _hodsForStates); the RPCs' p_state
  // slots stay null because mv_* has no territory column.
  const stHods = _hodsForStates(_vals(f.state));
  const hods = _vals(f.hod);
  p.p_hod = _intersectHods(hods || null, stHods);
  const scope = f._scope || {};
  if (scope.hod_name) p.p_hod2 = [scope.hod_name];
  if (scope.allowed_hods && scope.allowed_hods.length) p.p_hod2 = scope.allowed_hods;
  if (scope.allowed_zones && scope.allowed_zones.length) p.p_zone2 = scope.allowed_zones;
  if (scope.allowed_states && scope.allowed_states.length) {
    const scHods = _hodsForStates(scope.allowed_states);
    if (scHods) p.p_hod2 = _intersectHods(p.p_hod2, scHods);
    else p.p_state2 = scope.allowed_states;
  }
  return p;
}

// A non-concurrent REFRESH MATERIALIZED VIEW takes an AccessExclusiveLock, so
// every read of that snapshot blocks until the refresh finishes.
// refresh_dashboard_views() walks nine snapshots in turn (it runs after each
// sync), and without a bound the dashboard simply waits — observed live at
// 25 minutes for one getFilterOptions call, which the browser reports as
// "Dashboard failed to load data". The plain vw_* view reads sales_data
// instead and is unaffected, so a blocked snapshot must not be fatal.
// Deliberately generous. An mv_ snapshot is a stored copy of its vw_ view, so
// it is always the faster of the two EXCEPT while a refresh holds its lock --
// which means bailing out early and falling back to the plain view makes a
// merely-loaded database slower, not faster. This only needs to catch a real
// lock stall, so it sits well above normal paging time.
const MV_PROBE_TIMEOUT_MS = 20000;
// For optional probes whose fallback is FASTER than the probe itself (the
// filter-option chain ends at mv_filter_options, ~0.6s, while
// vw_filter_options_distinct was measured past 20s), give up quickly.
const PROBE_TIMEOUT_MS = 6000;
// Once a snapshot is seen blocked, skip probing it for this long rather than
// making every subsequent request pay the timeout again. Short, so the
// snapshot comes back into use on its own once the refresh completes.
const MV_BLOCKED_TTL_MS = 60 * 1000;
// Deadline for the optional Retail/Projects split card.
const SPLIT_TIMEOUT_MS = 8000;
const _mvBlockedAt = {};

// Runs an optional fast-path probe under a deadline. Every caller of this has
// a slower but dependable fallback, so waiting indefinitely on the probe only
// ever turns "slower" into "broken". Returns null on timeout; the request is
// left running server-side, we simply stop waiting on it.
async function _deadline(promise, ms) {
  let timer;
  const res = await Promise.race([
    promise,
    new Promise(function (resolve) {
      timer = setTimeout(function () { resolve('__timeout__'); }, ms);
    })
  ]);
  clearTimeout(timer);
  return res === '__timeout__' ? null : res;
}

async function _probe(rel, qs, ms) {
  return _deadline(_tryFetchAll(rel, qs), ms);
}

// Prefers the materialized snapshot (mv_*) of a dashboard view when the
// db/perf_materialized_views.sql migration has been applied; falls back to
// the plain view transparently when it is missing, failing, or locked.
async function _fetchAgg(view, qs) {
  const mv = 'mv_' + view.slice(3);
  const blockedAt = _mvBlockedAt[mv];
  const skip = blockedAt && (Date.now() - blockedAt) < MV_BLOCKED_TTL_MS;
  if (!_missingRelations[mv] && !skip) {
    const rows = await _probe(mv, qs, MV_PROBE_TIMEOUT_MS);
    if (!rows) _mvBlockedAt[mv] = Date.now();
    else { delete _mvBlockedAt[mv]; return rows; }
  }
  return fetchAll(view, qs);
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
    const scHods = _hodsForStates(scope.allowed_states);
    parts.push(scHods
      ? 'hod_name=in.(' + scHods.map(encodeURIComponent).join(',') + ')'
      : 'state=in.(' + scope.allowed_states.map(encodeURIComponent).join(',') + ')');
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
  const stHodsO = _hodsForStates(_vals(f && f.state));
  if (stHodsO) addF('hod_name', stHodsO); else addF('state', f && f.state);
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

  const cacheKey = 'filterOptions_v2_' + role + '_' +
    ((scope.allowed_hods || scope.allowed_zones || scope.allowed_states || []).join('|'));
  return cached(cacheKey, async function () {
    await loadHodStates();
    const scopeFilter = { _scope: scope };

    let rows = await _probe('rpc/get_filter_options', _q(scopeFilter).replace('?', ''), PROBE_TIMEOUT_MS);
    if (!rows || rows.length === 0) rows = await _probe('vw_filter_options_distinct', _q(scopeFilter), PROBE_TIMEOUT_MS);

    if (!rows || rows.length === 0) {
      const baseQ = _q(scopeFilter);
      const sep = baseQ.indexOf('?') > -1 ? '&' : '?';
      rows = await _fetchAgg('vw_filter_options', baseQ + sep + 'select=fy_year,quarter,month_year,zone,state,hod_name');
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

    // Distinct zone/state/hod triples so the UI can cascade the geo pickers
    // (pick a zone -> only its states, pick a state -> only its HODs).
    const seenGeo = {}, geo = [];
    rows.forEach(function (r) {
      const z = String(_zone(r) || '').trim();
      const s = String(_state(r) || '').trim();
      const h = String(_hod(r) || '').trim();
      const bad = function (v) { return !v || v.indexOf('#NAME?') > -1 || v.indexOf('N/A') > -1; };
      if (bad(z) && bad(s) && bad(h)) return;
      const key = z + '' + s + '' + h;
      if (seenGeo[key]) return;
      seenGeo[key] = 1;
      geo.push({ zone: z, state: s, hod: h });
    });

    return {
      fy: uniq(rows.map(function (r) { return _robustFy(r); })),
      quarter: uniq(rows.map(function (r) { return _qtr(r); })),
      month: ['All'].concat(months),
      state: uniq(rows.map(function (r) { return _state(r); })),
      zone: uniq(rows.map(function (r) { return _zone(r); })),
      hod: uniq(rows.map(function (r) { return _hod(r); })),
      geo: geo
    };
  });
}

async function getKPIs(f) {
  return cached('kpis_v10_' + _stableStringify(f), async function () {
    // Wide fetch on purpose: MoM/YoY trend maps need every period.
    const geoQ = _q(f, ['month', 'fy', 'quarter']);
    const geo = await _fetchAgg('vw_monthly_agg', geoQ);

    const filt = geo.filter(function (r) { return _rowMatches(r, f); });
    let totalSQM = 0, totalRev = 0;
    filt.forEach(function (r) { totalSQM += _sqm(r); totalRev += _rev(r); });

    const mMap = {}, fyMap = {};
    const fGeo = Object.assign({}, f, { fy: 'All', quarter: 'All', month: 'All' });

    geo.filter(function (r) { return _rowMatches(r, fGeo); }).forEach(function (r) {
      const sqm = _sqm(r); const rev = _rev(r); const qty = _qty(r);
      const m = _mo(r); if (m) mMap[m] = { sqm: (mMap[m] ? mMap[m].sqm + sqm : sqm), rev: (mMap[m] ? mMap[m].rev + rev : rev), qty: (mMap[m] ? mMap[m].qty + qty : qty) };
      const fy = _robustFy(r); if (fy) fyMap[fy] = { sqm: (fyMap[fy] ? fyMap[fy].sqm + sqm : sqm), rev: (fyMap[fy] ? fyMap[fy].rev + rev : rev) };
    });

    const sortedM = Object.keys(mMap).sort(function (a, b) { return _mSk(b).localeCompare(_mSk(a)); });
    const curM = (f && f.month && f.month !== 'All' && !Array.isArray(f.month)) ? f.month : sortedM[0];
    const cIdx = Math.max(0, sortedM.indexOf(curM));

    const curSqft = (mMap[sortedM[cIdx]] ? mMap[sortedM[cIdx]].sqm : 0) * SQFT_PER_SQM;
    const prevSqft = (mMap[sortedM[cIdx + 1]] ? mMap[sortedM[cIdx + 1]].sqm : 0) * SQFT_PER_SQM;
    const momG = prevSqft ? ((curSqft - prevSqft) / prevSqft * 100) : 0;

    const curRev = (mMap[sortedM[cIdx]] ? mMap[sortedM[cIdx]].rev : 0);
    const prevRev = (mMap[sortedM[cIdx + 1]] ? mMap[sortedM[cIdx + 1]].rev : 0);
    const momRevG = prevRev ? ((curRev - prevRev) / prevRev * 100) : 0;
    const curQty = (mMap[sortedM[cIdx]] ? mMap[sortedM[cIdx]].qty : 0);

    const sortedF = Object.keys(fyMap).filter(function (k) { return k && k.indexOf('FY ') === 0; }).sort(function (a, b) { return b.localeCompare(a); });
    const curF = (f && f.fy && f.fy !== 'All' && !Array.isArray(f.fy)) ? _normFy(f.fy) : sortedF[0];
    const fIdx = Math.max(0, sortedF.indexOf(curF));
    const prevFy = sortedF[fIdx + 1] || null;
    const curFySqft = (fyMap[sortedF[fIdx]] ? fyMap[sortedF[fIdx]].sqm : 0) * SQFT_PER_SQM;
    const prevFySqft = (fyMap[sortedF[fIdx + 1]] ? fyMap[sortedF[fIdx + 1]].sqm : 0) * SQFT_PER_SQM;
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
      return Math.round((mMap[m] ? mMap[m].sqm : 0) * SQFT_PER_SQM);
    });
    const yearlyAvgsTrend = sortedF.slice().reverse().map(function (fy) {
      const fyMos = [];
      geo.forEach(function (r) {
        if (_robustFy(r) === fy) { const m = _mo(r); if (m && fyMos.indexOf(m) === -1) fyMos.push(m); }
      });
      const moCount = Math.max(1, fyMos.length);
      const tSqft = (fyMap[fy] ? fyMap[fy].sqm : 0) * SQFT_PER_SQM;
      return Math.round(tSqft / moCount);
    });

    const custQ = _q(f, ['month', 'fy', 'quarter']); // customer views have no time columns
    let custs = await _tryFetchAll('vw_customer_kpi_counts', custQ);
    if (!custs) {
      const qsLight = custQ + (custQ.indexOf('?') > -1 ? '&' : '?') + 'select=days_since_last_purchase,customer_name,total_sqm,sq_ft,hod_name,state,zone';
      custs = await _fetchAgg('vw_customer_summary', qsLight);
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

    // Sales Type Split (Retail vs Projects)
    let retailSqm = 0, projectSqm = 0;
    let retailQty = 0, projectQty = 0;
    // Same split narrowed to the current month, so the card can show how the
    // latest month leans against the FY-to-date mix above it.
    const splitMoKey = sortedM[cIdx] || curM || '';
    let retailSqmMo = 0, projectSqmMo = 0;
    let retailQtyMo = 0, projectQtyMo = 0;
    try {
      // Bounded: this card is optional, but vw_sales_type_agg is the one
      // dashboard view with no mv_ snapshot, so it reads sales_data directly
      // and was measured hanging past 30s. The catch below only covers errors
      // -- without a deadline a slow view takes the whole dashboard down.
      // Apply db/migrations/10_create_sales_type_snapshot.sql to make it fast.
      const splitRows = (await _deadline(_fetchAgg('vw_sales_type_agg', geoQ), SPLIT_TIMEOUT_MS)) || [];
      // Scoped to one financial year, the same curF the YTD/YoY cards use:
      // the explicit FY filter when one is set, otherwise the latest FY in the
      // data. geoQ is deliberately wide (no fy/quarter/month restriction) so
      // the trend maps above can see every period, which left this card
      // summing every year at once.
      splitRows.filter(function (r) {
        return _rowMatches(r, f) && (!curF || _robustFy(r) === curF);
      }).forEach(function (r) {
        const isCurMo = splitMoKey && _mo(r) === splitMoKey;
        if (r.sales_type === 'Projects') {
          projectSqm += _sqm(r);
          projectQty += _qty(r);
          if (isCurMo) { projectSqmMo += _sqm(r); projectQtyMo += _qty(r); }
        } else {
          retailSqm += _sqm(r);
          retailQty += _qty(r);
          if (isCurMo) { retailSqmMo += _sqm(r); retailQtyMo += _qty(r); }
        }
      });
    } catch (e) {
      // view doesn't exist yet, return 0s until user creates it
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
      totalSqft: Math.round(totalSQM * SQFT_PER_SQM),
      totalSQM: +totalSQM.toFixed(2),
      totalRevenue: Math.round(totalRev),
      currentYearAvgSqft: Math.round(curFyAvgSqft) || 0,
      prevYearAvgSqft: Math.round(prevFyAvgSqft) || 0,
      avgSqftGrowth: +avgSqftGrowth.toFixed(1),
      yearlyAvgTrend: yearlyAvgsTrend,
      totalCustomers: custs.length,
      activeCustomers: active,
      loyalCustomers: loyalC,
      retailSqft: Math.round(retailSqm * SQFT_PER_SQM),
      projectSqft: Math.round(projectSqm * SQFT_PER_SQM),
      retailQty: retailQty,
      projectQty: projectQty,
      retailSqftMonth: Math.round(retailSqmMo * SQFT_PER_SQM),
      projectSqftMonth: Math.round(projectSqmMo * SQFT_PER_SQM),
      retailQtyMonth: retailQtyMo,
      projectQtyMonth: projectQtyMo,
      salesTypeMonth: splitMoKey,
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
      currentMonthQty: Math.round(curQty),
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

function _toMacroZone(zStr, sStr) {
  const z = String(zStr || '').trim().toUpperCase();
  const s = String(sStr || '').trim().toUpperCase();
  if (z.indexOf('WEST') !== -1 || s.indexOf('GUJARAT') !== -1 || s.indexOf('MAHARASHTRA') !== -1 || s.indexOf('MUMBAI') !== -1 || s.indexOf('GOA') !== -1) return 'WEST';
  if (z.indexOf('SOUTH') !== -1 || s.indexOf('TAMIL') !== -1 || s.indexOf('KARNATAKA') !== -1 || s.indexOf('KERALA') !== -1 || s.indexOf('ANDHRA') !== -1 || s.indexOf('TELANGANA') !== -1 || s.indexOf('AP') !== -1) return 'SOUTH';
  if (z.indexOf('EAST') !== -1 || s.indexOf('BENGAL') !== -1 || s.indexOf('BIHAR') !== -1 || s.indexOf('ODISHA') !== -1 || s.indexOf('ORISSA') !== -1 || s.indexOf('ASSAM') !== -1 || s.indexOf('JHARKHAND') !== -1) return 'EAST';
  if (z.indexOf('CENTRAL') !== -1 || s.indexOf('MADHYA') !== -1 || s.indexOf('CHHATTISGARH') !== -1 || s.indexOf('MP') !== -1) return 'CENTRAL';
  if (z.indexOf('NORTH') !== -1 || s.indexOf('DELHI') !== -1 || s.indexOf('RAJASTHAN') !== -1 || s.indexOf('PUNJAB') !== -1 || s.indexOf('HARYANA') !== -1 || s.indexOf('UP') !== -1 || s.indexOf('UTTAR') !== -1 || s.indexOf('UTTARAKHAND') !== -1 || s.indexOf('JAMMU') !== -1 || s.indexOf('HIMACHAL') !== -1) return 'NORTH';
  return 'CENTRAL';
}

async function getOverviewData(f) {
  return cached('overview_batched_v5_' + _stableStringify(f), async function () {
    const widestQ = _q(f, ['month', 'fy']);
    const rows = await _fetchAgg('vw_monthly_agg', widestQ);

    const fForMonthly = Object.assign({}, f, { month: 'All' });
    const fForState = Object.assign({}, f, { state: 'All' });
    const fForZone = Object.assign({}, f, { zone: 'All', state: 'All' });

    const monthlyMap = {};
    const stateMap = {};
    const zoneMap = {};

    const allFys = new Set();
    const fyMonths = {};

    rows.forEach(function (r) {
      const fy = _robustFy(r);
      const m = _mo(r);
      const sq = _sqm(r);
      const rev = _rev(r);

      if (fy) {
        allFys.add(fy);
        if (m) {
          const mPrefix = m.slice(0, 3).toUpperCase();
          if (!fyMonths[fy]) fyMonths[fy] = new Set();
          fyMonths[fy].add(mPrefix);
        }
      }

      if (_rowMatches(r, fForMonthly)) {
        if (m) {
          if (!monthlyMap[m]) monthlyMap[m] = { 'MONTH YEAR': m, 'FY YEAR': fy, 'QUARTER': _qtr(r), 'TOTAL SQM': 0, 'NET REVENUE': 0 };
          monthlyMap[m]['TOTAL SQM'] += sq;
          monthlyMap[m]['NET REVENUE'] += rev;
        }
      }
      if (_rowMatches(r, fForState)) {
        const s = _state(r);
        if (!stateMap[s]) stateMap[s] = { STATE: s, ZONE: _toMacroZone(_zone(r), s), 'TOTAL SQM': 0, 'NET REVENUE': 0, byFY: {}, byMo: {} };
        stateMap[s]['TOTAL SQM'] += sq;
        stateMap[s]['NET REVENUE'] += rev;
        if (fy) {
          stateMap[s].byFY[fy] = (stateMap[s].byFY[fy] || 0) + (sq * SQFT_PER_SQM);
          if (m) {
            if (!stateMap[s].byMo[fy]) stateMap[s].byMo[fy] = {};
            const mPrefix = m.slice(0, 3).toUpperCase();
            stateMap[s].byMo[fy][mPrefix] = (stateMap[s].byMo[fy][mPrefix] || 0) + (sq * SQFT_PER_SQM);
          }
        }
      }
      if (_rowMatches(r, fForZone)) {
        const z = _toMacroZone(_zone(r), _state(r));
        if (!zoneMap[z]) zoneMap[z] = { ZONE: z, 'TOTAL SQM': 0, 'NET REVENUE': 0, byFY: {}, byMo: {} };
        zoneMap[z]['TOTAL SQM'] += sq;
        zoneMap[z]['NET REVENUE'] += rev;
        if (fy) {
          zoneMap[z].byFY[fy] = (zoneMap[z].byFY[fy] || 0) + (sq * SQFT_PER_SQM);
          if (m) {
            if (!zoneMap[z].byMo[fy]) zoneMap[z].byMo[fy] = {};
            const mPrefix = m.slice(0, 3).toUpperCase();
            zoneMap[z].byMo[fy][mPrefix] = (zoneMap[z].byMo[fy][mPrefix] || 0) + (sq * SQFT_PER_SQM);
          }
        }
      }
    });

    const sortedFys = Array.from(allFys).filter(function(k) { return k && k.indexOf('FY ') === 0; }).sort().reverse();
    const curFy = (f && f.fy && f.fy !== 'All' && !Array.isArray(f.fy)) ? _normFy(f.fy) : (sortedFys[0] || 'FY 26-27');
    const fIdx = Math.max(0, sortedFys.indexOf(curFy));
    const prevFy = sortedFys[fIdx + 1] || null;
    const elapsedMonths = (curFy && fyMonths[curFy]) ? Array.from(fyMonths[curFy]) : ['APR', 'MAY', 'JUN', 'JUL', 'AUG'];

    const monthly = Object.values(monthlyMap).map(function (r) {
      r['SORT KEY'] = r['_SK'] = _mSk(r['MONTH YEAR']);
      r['_LABEL'] = r['MONTH YEAR'];
      r['_FY'] = r['FY YEAR'];
      r['SQ FT.'] = r['TOTAL SQM'] * SQFT_PER_SQM;
      return r;
    }).sort(function (a, b) { return a['SORT KEY'].localeCompare(b['SORT KEY']); });

    const states = Object.values(stateMap)
      .map(function (r) { return Object.assign({}, r, { 'SQ FT.': r['TOTAL SQM'] * SQFT_PER_SQM }); })
      .sort(function (a, b) { return b['TOTAL SQM'] - a['TOTAL SQM']; });

    const zones = Object.values(zoneMap).map(function (r) {
      r['SQ FT.'] = r['TOTAL SQM'] * SQFT_PER_SQM;
      let cYtd = 0, pYtd = 0;
      elapsedMonths.forEach(function(m) {
        cYtd += (r.byMo && r.byMo[curFy] && r.byMo[curFy][m]) || 0;
        if (prevFy) {
          pYtd += (r.byMo && r.byMo[prevFy] && r.byMo[prevFy][m]) || 0;
        }
      });
      r.curYtd = cYtd;
      r.prevYtd = pYtd;
      r.yoy = pYtd > 0 ? ((cYtd - pYtd) / pYtd * 100) : null;
      r.curFy = curFy;
      r.prevFy = prevFy;
      return r;
    }).sort(function (a, b) { return (b.curYtd || b['TOTAL SQM']) - (a.curYtd || a['TOTAL SQM']); });

    return { monthly: monthly, states: states, zones: zones, curFy: curFy, prevFy: prevFy };
  });
}

async function getMonthlySummary(f) { return (await getOverviewData(f)).monthly; }
async function getStateSummary(f) { return (await getOverviewData(f)).states; }

async function getHODQoQ(f) {
  return cached('hod_qoq_' + _stableStringify(f), async function () {
    const q = _q(f, ['month']);
    const rows = (await _fetchAgg('vw_hod_agg', q)).filter(function (r) { return _rowMatches(r, f); });
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
        TOTAL_SQFT: Math.round(h.T * SQFT_PER_SQM),
        NET_REVENUE: Math.round(h.NET_REVENUE),
        Q1_SQFT: Math.round(h.Q1 * SQFT_PER_SQM),
        Q2_SQFT: Math.round(h.Q2 * SQFT_PER_SQM),
        Q3_SQFT: Math.round(h.Q3 * SQFT_PER_SQM),
        Q4_SQFT: Math.round(h.Q4 * SQFT_PER_SQM)
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
    const q = _q(f, ['month', 'fy', 'quarter']); // all-FY view: never time-restrict

    const rows = (await _fetchAgg('vw_hod_agg', q)).filter(function (r) { return _rowMatches(r, scopeF); });
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
        TOTAL_SQFT: Math.round(h.T * SQFT_PER_SQM),
        NET_REVENUE: Math.round(h.NET_REVENUE),
        Q1_SQFT: Math.round(h.Q1 * SQFT_PER_SQM),
        Q2_SQFT: Math.round(h.Q2 * SQFT_PER_SQM),
        Q3_SQFT: Math.round(h.Q3 * SQFT_PER_SQM),
        Q4_SQFT: Math.round(h.Q4 * SQFT_PER_SQM)
      };
    });
  });
}

async function getHODMonthlySummary(f) {
  return cached('hod_monthly_' + _stableStringify(f), async function () {
    const q = _q(f, ['month']);
    const rows = (await _fetchAgg('vw_monthly_agg', q)).filter(function (r) { return _rowMatches(r, f); });
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
    const rows = (await _fetchAgg('vw_customer_sale_agg', q)).filter(function (r) { return _rowMatches(r, f); });
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
        TOTAL_SQFT: Math.round(c.T * SQFT_PER_SQM),
        NET_REVENUE: Math.round(c.NET_REVENUE),
        Q1_SQFT: Math.round(c.Q1 * SQFT_PER_SQM),
        Q2_SQFT: Math.round(c.Q2 * SQFT_PER_SQM),
        Q3_SQFT: Math.round(c.Q3 * SQFT_PER_SQM),
        Q4_SQFT: Math.round(c.Q4 * SQFT_PER_SQM)
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
    const q = _q(f, ['month', 'zone', 'fy', 'quarter']); // all-FY view: never time-restrict
    const rows = (await _fetchAgg('vw_customer_sale_agg', q)).filter(function (r) { return _rowMatches(r, scopeF); });
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
        TOTAL_SQFT: Math.round(c.T * SQFT_PER_SQM),
        NET_REVENUE: Math.round(c.NET_REVENUE),
        Q1_SQFT: Math.round(c.Q1 * SQFT_PER_SQM),
        Q2_SQFT: Math.round(c.Q2 * SQFT_PER_SQM),
        Q3_SQFT: Math.round(c.Q3 * SQFT_PER_SQM),
        Q4_SQFT: Math.round(c.Q4 * SQFT_PER_SQM)
      };
    });
  });
}

async function getCustomerMonthlySummary(f) {
  return cached('cust_monthly_' + _stableStringify(f), async function () {
    const q = _q(f, ['month', 'zone']);
    const rows = (await _fetchAgg('vw_customer_sale_agg', q)).filter(function (r) { return _rowMatches(r, f); });
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

// ── Person-wise sale (Executive / Project) ──────────────────────────────────
// Both tables are the same three period views over the same row shape, keyed
// on sales_person; only the backing view differs. Executive reads
// vw_executive_sale_agg (all sales), Project reads vw_project_sale_agg, which
// is restricted to sales_type = 'Projects' — and because the sync rewrites
// sales_person to PROJECT_SALES_PERSON on the projects part of a split row,
// grouping by sales_person there yields the project sales people.
// See db/migrations/09 and 12.
function _person(r) { return _s(r, 'sales_person') || 'Unassigned'; }

// QoQ: current-period quarters, one row per state/HOD/person.
function _personQoQ(view, cacheKey) {
  return async function (f) {
    return cached(cacheKey + '_qoq_' + _stableStringify(f), async function () {
      const q = _q(f, ['month', 'zone']);
      const rows = (await _fetchAgg(view, q)).filter(function (r) { return _rowMatches(r, f); });
      const map = {};
      rows.forEach(function (r) {
        const e = _person(r); const st = _state(r); const h = _hod(r);
        const key = st + '||' + h + '||' + e;
        if (!map[key]) map[key] = { STATE: st, HOD: h, EXECUTIVE: e, T: 0, Q1: 0, Q2: 0, Q3: 0, Q4: 0, NET_REVENUE: 0 };
        const sq = _sqm(r); const rev = _rev(r);
        map[key].T += sq; map[key].NET_REVENUE += rev;
        const qt = _qtr(r);
        if (qt.indexOf('1') !== -1) map[key].Q1 += sq;
        if (qt.indexOf('2') !== -1) map[key].Q2 += sq;
        if (qt.indexOf('3') !== -1) map[key].Q3 += sq;
        if (qt.indexOf('4') !== -1) map[key].Q4 += sq;
      });
      return Object.values(map).map(function (c) {
        return {
          STATE: c.STATE, HOD: c.HOD, EXECUTIVE: c.EXECUTIVE,
          TOTAL_SQFT: Math.round(c.T * SQFT_PER_SQM),
          NET_REVENUE: Math.round(c.NET_REVENUE),
          Q1_SQFT: Math.round(c.Q1 * SQFT_PER_SQM),
          Q2_SQFT: Math.round(c.Q2 * SQFT_PER_SQM),
          Q3_SQFT: Math.round(c.Q3 * SQFT_PER_SQM),
          Q4_SQFT: Math.round(c.Q4 * SQFT_PER_SQM)
        };
      }).sort(function (a, b) { return b.TOTAL_SQFT - a.TOTAL_SQFT; });
    });
  };
}

// All-FY: one row per state/HOD/person/FY, quarters within each FY.
function _personAllFY(view, cacheKey) {
  return async function (f) {
    const scopeF = {
      _scope: (f && f._scope) || {},
      zone: (f && f.zone && f.zone !== 'All') ? f.zone : 'All',
      state: (f && f.state && f.state !== 'All') ? f.state : 'All',
      hod: (f && f.hod && f.hod !== 'All') ? f.hod : 'All'
    };
    return cached(cacheKey + '_all_fy_' + _stableStringify(scopeF), async function () {
      const q = _q(f, ['month', 'zone', 'fy', 'quarter']); // all-FY view: never time-restrict
      const rows = (await _fetchAgg(view, q)).filter(function (r) { return _rowMatches(r, scopeF); });
      const map = {};
      rows.forEach(function (r) {
        const e = _person(r); const st = _state(r); const h = _hod(r); const fy = _robustFy(r);
        if (!e || e === 'Unassigned' || !fy) return;
        const key = st + '||' + h + '||' + e + '||' + fy;
        if (!map[key]) map[key] = { STATE: st, HOD: h, EXECUTIVE: e, FY: fy, T: 0, Q1: 0, Q2: 0, Q3: 0, Q4: 0, NET_REVENUE: 0 };
        const sq = _sqm(r); const rev = _rev(r);
        map[key].T += sq; map[key].NET_REVENUE += rev;
        const qt = _qtr(r);
        if (qt.indexOf('1') !== -1) map[key].Q1 += sq;
        if (qt.indexOf('2') !== -1) map[key].Q2 += sq;
        if (qt.indexOf('3') !== -1) map[key].Q3 += sq;
        if (qt.indexOf('4') !== -1) map[key].Q4 += sq;
      });
      return Object.values(map).map(function (c) {
        return {
          STATE: c.STATE, HOD: c.HOD, EXECUTIVE: c.EXECUTIVE, FY: c.FY,
          TOTAL_SQFT: Math.round(c.T * SQFT_PER_SQM),
          NET_REVENUE: Math.round(c.NET_REVENUE),
          Q1_SQFT: Math.round(c.Q1 * SQFT_PER_SQM),
          Q2_SQFT: Math.round(c.Q2 * SQFT_PER_SQM),
          Q3_SQFT: Math.round(c.Q3 * SQFT_PER_SQM),
          Q4_SQFT: Math.round(c.Q4 * SQFT_PER_SQM)
        };
      });
    });
  };
}

// Monthly: one row per state/HOD/person/month.
function _personMonthly(view, cacheKey) {
  return async function (f) {
    return cached(cacheKey + '_monthly_' + _stableStringify(f), async function () {
      const q = _q(f, ['month', 'zone']);
      const rows = (await _fetchAgg(view, q)).filter(function (r) { return _rowMatches(r, f); });
      const map = {};
      rows.forEach(function (r) {
        const e = _person(r); const st = _state(r); const h = _hod(r); const mo = _mo(r);
        if (!e || e === 'Unassigned' || !mo) return;
        const key = st + '||' + h + '||' + e + '||' + mo;
        if (!map[key]) map[key] = { STATE: st, HOD: h, EXECUTIVE: e, MONTH: mo, SORT_KEY: _mSk(mo), SQM: 0, SQFT: 0, NET_REVENUE: 0 };
        map[key].SQM += _sqm(r); map[key].SQFT += _sqft(r); map[key].NET_REVENUE += _rev(r);
      });
      return Object.values(map).map(function (r) {
        return {
          STATE: r.STATE, HOD: r.HOD, EXECUTIVE: r.EXECUTIVE, MONTH: r.MONTH, SORT_KEY: r.SORT_KEY,
          TOTAL_SQFT: Math.round(r.SQFT), TOTAL_SQM: +r.SQM.toFixed(2), NET_REVENUE: Math.round(r.NET_REVENUE)
        };
      }).sort(function (a, b) {
        const sk = b.SORT_KEY.localeCompare(a.SORT_KEY);
        if (sk !== 0) return sk;
        return a.EXECUTIVE.localeCompare(b.EXECUTIVE);
      });
    });
  };
}

const getExecutiveQoQ           = _personQoQ('vw_executive_sale_agg', 'exec');
const getExecutiveAllFYSummary  = _personAllFY('vw_executive_sale_agg', 'exec');
const getExecutiveMonthlySummary = _personMonthly('vw_executive_sale_agg', 'exec');

const getProjectQoQ             = _personQoQ('vw_project_sale_agg', 'proj');
const getProjectAllFYSummary    = _personAllFY('vw_project_sale_agg', 'proj');
const getProjectMonthlySummary  = _personMonthly('vw_project_sale_agg', 'proj');

async function getSkuTypeQoQ(f) {
  return cached('sku_type_qoq_' + _stableStringify(f), async function () {
    const q = _q(f, ['month']);
    const rows = (await _fetchAgg('vw_sku_type_sale_agg', q)).filter(function (r) { return _rowMatches(r, f); });
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
        TOTAL_SQFT: Math.round(c.T * SQFT_PER_SQM),
        NET_REVENUE: Math.round(c.NET_REVENUE),
        Q1_SQFT: Math.round(c.Q1 * SQFT_PER_SQM),
        Q2_SQFT: Math.round(c.Q2 * SQFT_PER_SQM),
        Q3_SQFT: Math.round(c.Q3 * SQFT_PER_SQM),
        Q4_SQFT: Math.round(c.Q4 * SQFT_PER_SQM)
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
    const q = _q(f, ['month', 'fy', 'quarter']); // all-FY view: never time-restrict
    const rows = (await _fetchAgg('vw_sku_type_sale_agg', q)).filter(function (r) { return _rowMatches(r, scopeF); });
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
        TOTAL_SQFT: Math.round(c.T * SQFT_PER_SQM),
        NET_REVENUE: Math.round(c.NET_REVENUE),
        Q1_SQFT: Math.round(c.Q1 * SQFT_PER_SQM),
        Q2_SQFT: Math.round(c.Q2 * SQFT_PER_SQM),
        Q3_SQFT: Math.round(c.Q3 * SQFT_PER_SQM),
        Q4_SQFT: Math.round(c.Q4 * SQFT_PER_SQM)
      };
    });
  });
}

async function getSkuTypeMonthlySummary(f) {
  return cached('sku_type_monthly_' + _stableStringify(f), async function () {
    const q = _q(f, ['month']);
    const rows = (await _fetchAgg('vw_sku_type_sale_agg', q)).filter(function (r) { return _rowMatches(r, f); });
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

// ── Person-name matching (target sheet -> sales data) ───────────────────────
// The two sources spell the same people differently, so an exact-only join
// leaves 78 of 268 employees at zero achievement -- and those hold the largest
// targets, which drags the reported figure to a third of reality.
//
// Matching runs in order, and the ORDER IS LOAD-BEARING: 'GANESH KUMAR' is
// within edit distance 2 of 'MANISH KUMAR', so fuzzy alone would credit one
// person's sales to another. Token-subset resolves him correctly to
// 'GANESH KUMAR SINGH' first. Any step producing more than one candidate is
// treated as no match rather than guessing.
//
// Every row reports how it matched (MATCHED_BY) so a non-exact join can be
// audited rather than trusted blindly.

function _lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

const _nameKey    = function (v) { return String(v || '').toUpperCase().replace(/\s+/g, ' ').trim(); };
const _nameTokens = function (v) { return _nameKey(v).replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 1; }); };
const _nameTight  = function (v) { return _nameKey(v).replace(/[^A-Z]/g, ''); };

// Builds a resolver over the sales-side names. Returns
// { key, via } for a target name, or null when nothing safe matches.
function _personMatcher(salesKeys) {
  const exact = {};
  salesKeys.forEach(function (k) { exact[k] = k; });
  const prepared = salesKeys.map(function (k) {
    return { key: k, tokens: _nameTokens(k), tight: _nameTight(k) };
  });
  const cache = {};

  return function (rawName) {
    const k = _nameKey(rawName);
    if (!k) return null;
    if (cache[k] !== undefined) return cache[k];

    let res = null;
    if (exact[k]) {
      res = { key: exact[k], via: 'exact' };
    } else {
      // token-subset: every token of the shorter name appears in the longer
      const ut = _nameTokens(k);
      if (ut.length >= 2) {
        const hits = prepared.filter(function (p) {
          if (p.tokens.length < 2) return false;
          const short = ut.length <= p.tokens.length ? ut : p.tokens;
          const long = ut.length <= p.tokens.length ? p.tokens : ut;
          return short.every(function (w) { return long.indexOf(w) !== -1; });
        });
        if (hits.length === 1) res = { key: hits[0].key, via: 'token' };
      }
      // fuzzy: tight edit distance, unique candidate only
      if (!res) {
        const ut2 = _nameTight(k);
        const thresh = Math.max(1, Math.floor(ut2.length * 0.15));
        const hits = prepared
          .map(function (p) { return { key: p.key, d: _lev(ut2, p.tight) }; })
          .filter(function (x) { return x.d <= thresh; });
        if (hits.length === 1) res = { key: hits[0].key, via: 'fuzzy' };
      }
    }
    cache[k] = res;
    return res;
  };
}

// ── Target vs Achievement ───────────────────────────────────────────────────
// Targets come from the TARGET_DATA sheet only (target_master). Achievement is
// NOT the sheet's Achivement column -- it is recomputed from actual sales, so
// the two sides can never drift apart.
//
// Matching, as specified:
//   * a target row finds its sales by Employee Name -> sales_person
//   * no match means zero achievement; sales are never borrowed from anyone
//     else, because several employees share a state and crediting a whole
//     state's volume to each of them would multiply the real figure
//   * the HOD shown is the CURRENT one from the sales data, not the sheet's.
//     When the employee has no sales to read it from, the sheet's HOD is used
//     if it exists in the sales data at all, and failing that the state's
//     dominant HOD -- this is the "if HOD doesn't match, match their State"
//     fallback, and it only ever decides the label, never the number.

const _Q_OF_MONTH = {
  JAN: 'Q4', FEB: 'Q4', MAR: 'Q4',
  APR: 'Q1', MAY: 'Q1', JUN: 'Q1',
  JUL: 'Q2', AUG: 'Q2', SEP: 'Q2',
  OCT: 'Q3', NOV: 'Q3', DEC: 'Q3'
};
const _MON_TITLE = {
  JAN: 'Jan', FEB: 'Feb', MAR: 'Mar', APR: 'Apr', MAY: 'May', JUN: 'Jun',
  JUL: 'Jul', AUG: 'Aug', SEP: 'Sep', OCT: 'Oct', NOV: 'Nov', DEC: 'Dec'
};

// target_master stores the month bare ('APR'), so the calendar year has to come
// from the financial year: Apr-Dec sit in the first half, Jan-Mar in the second.
// 'FY 26-27' + 'APR' -> 'Apr-26';  'FY 26-27' + 'JAN' -> 'Jan-27'.
function _targetMonthKey(fy, mon3) {
  const m = String(fy || '').match(/(\d{2})[-\s_]+(\d{2})/);
  const t = _MON_TITLE[mon3];
  if (!m || !t) return null;
  return t + '-' + (['JAN', 'FEB', 'MAR'].indexOf(mon3) !== -1 ? m[2] : m[1]);
}

function _mon3(v) {
  const s = String(v || '').trim().toUpperCase();
  return s.length >= 3 ? s.slice(0, 3) : '';
}

async function getTargetVsAchievement(f, opts) {
  opts = opts || {};
  return cached('tgt_actual_v1_' + _stableStringify(f) + '_' + _stableStringify(opts), async function () {
    // Every sales read below is deliberately WIDE. The time filters are dropped
    // because this table is a period series that shows every period whatever
    // month/FY/quarter is selected. The geography/HOD selection is dropped
    // because it must not reach the HOD resolution: with only one HOD's sales
    // in hand, every other target employee falls through to the "dominant HOD
    // of their state" fallback and lands on the selected HOD, which then
    // reports that HOD's employees and target several times over. Who an
    // employee's HOD is cannot depend on what the viewer happens to be looking
    // at, so the selection is applied afterwards, to the resolved label (see
    // the narrowing step below). _scope is left untouched, so the role
    // restrictions still bound every fetch.
    const fWide = Object.assign({}, f, { zone: 'All', state: 'All', hod: 'All' });
    const wideMatch = Object.assign({}, fWide, { fy: 'All', quarter: 'All', month: 'All' });

    // ── actual sales, person-wise ───────────────────────────────────────────
    const salesRows = (await _fetchAgg('vw_executive_sale_agg', _q(fWide, ['month', 'fy', 'quarter'])))
      .filter(function (r) { return _rowMatches(r, wideMatch); });

    const byPerson = {};      // EMP -> { MONTHLY:{}, QUARTERLY:{}, YEARLY:{} }
    const personHodSqft = {}; // EMP -> { hod: sqft }  (pick the dominant one)
    const personStateSqft = {}; // EMP -> { state: sqft }  (label only, same rule)
    const personName = {};    // EMP -> the sales data's own spelling of the name
    const stateHodSqft = {};  // STATE -> { hod: sqft }
    const hodStateSqft = {};  // HOD -> { state: sqft }  (state as the sales data has it)
    const hodZoneSqft = {};   // HOD -> { zone: sqft }   (only used to resolve a zone filter)
    const byHodSales = {};    // HOD -> { MONTHLY:{}, QUARTERLY:{}, YEARLY:{} } -- ALL of the HOD's sales
    const salesHods = {};
    const byEmployee = (opts.groupBy || 'hod') === 'employee';

    salesRows.forEach(function (r) {
      const emp = String(_s(r, 'sales_person') || '').trim().toUpperCase();
      const hod = _hod(r);
      const st = String(_s(r, 'state') || '').trim().toUpperCase();
      const sqft = _sqft(r);
      const mo = _mo(r);
      const fy = _robustFy(r);
      const q = _Q_OF_MONTH[_mon3(mo)];

      if (hod && hod !== 'Unknown') salesHods[hod] = true;
      if (hod && st) {
        (stateHodSqft[st] = stateHodSqft[st] || {})[hod] = (stateHodSqft[st][hod] || 0) + sqft;
        (hodStateSqft[hod] = hodStateSqft[hod] || {})[st] = (hodStateSqft[hod][st] || 0) + sqft;
      }
      if (hod) {
        const zn = String(_s(r, 'zone') || '').trim().toUpperCase();
        if (zn) (hodZoneSqft[hod] = hodZoneSqft[hod] || {})[zn] = (hodZoneSqft[hod][zn] || 0) + sqft;
      }
      if (!emp) return;
      if (hod) { (personHodSqft[emp] = personHodSqft[emp] || {})[hod] = (personHodSqft[emp][hod] || 0) + sqft; }
      if (st) { (personStateSqft[emp] = personStateSqft[emp] || {})[st] = (personStateSqft[emp][st] || 0) + sqft; }
      if (!personName[emp]) personName[emp] = String(_s(r, 'sales_person') || '').trim();

      const b = byPerson[emp] = byPerson[emp] || { MONTHLY: {}, QUARTERLY: {}, YEARLY: {} };
      if (mo) b.MONTHLY[mo] = (b.MONTHLY[mo] || 0) + sqft;
      if (fy) {
        b.YEARLY[fy] = (b.YEARLY[fy] || 0) + sqft;
        if (q) { const k = fy + '_' + q; b.QUARTERLY[k] = (b.QUARTERLY[k] || 0) + sqft; }
      }

      // HOD-level achievement is built separately from vw_sales_type_agg
      // below, because it has to exclude project sales and this view carries
      // no sales_type.
    });

    // A HOD's achievement is their whole team's RETAIL sales -- including
    // salespeople who have no target row at all, so it reconciles with the
    // rest of the dashboard, but excluding project business, which is measured
    // separately on the Project Sales page. vw_sales_type_agg is the only
    // aggregate carrying sales_type; it is snapshot-backed (migration 10) so
    // this stays fast.
    (await _fetchAgg('vw_sales_type_agg', _q(fWide, ['month', 'fy', 'quarter'])))
      .filter(function (r) {
        return String(_s(r, 'sales_type')).trim().toLowerCase() !== 'projects'
          && _rowMatches(r, wideMatch);
      })
      .forEach(function (r) {
        const hod = _hod(r);
        if (!hod || hod === 'Unknown') return;
        const sqft = _sqft(r);
        const mo = _mo(r);
        const fy = _robustFy(r);
        const q = _Q_OF_MONTH[_mon3(mo)];
        const hb = byHodSales[hod] = byHodSales[hod] || { MONTHLY: {}, QUARTERLY: {}, YEARLY: {} };
        if (mo) hb.MONTHLY[mo] = (hb.MONTHLY[mo] || 0) + sqft;
        if (fy) {
          hb.YEARLY[fy] = (hb.YEARLY[fy] || 0) + sqft;
          if (q) { const k = fy + '_' + q; hb.QUARTERLY[k] = (hb.QUARTERLY[k] || 0) + sqft; }
        }
      });

    // A HOD's achievement above is retail-only. vw_executive_sale_agg carries no
    // sales_type, so the person-wise totals still include project business and
    // the executive rows would not add up to their HOD's. vw_project_sale_agg
    // is the same shape limited to projects, so subtracting it person-by-person
    // puts both levels on the same (retail) basis. Only fetched for the
    // Executive Target vs Sales page -- the HOD page never reads these numbers.
    if (byEmployee) {
      (await _fetchAgg('vw_project_sale_agg', _q(fWide, ['month', 'fy', 'quarter'])))
        .filter(function (r) { return _rowMatches(r, wideMatch); })
        .forEach(function (r) {
          const emp = String(_s(r, 'sales_person') || '').trim().toUpperCase();
          const b = byPerson[emp];
          if (!b) return;
          const sqft = _sqft(r);
          const mo = _mo(r);
          const fy = _robustFy(r);
          const q = _Q_OF_MONTH[_mon3(mo)];
          const cut = function (bucket, k) {
            if (!k || !bucket[k]) return;
            bucket[k] = Math.max(0, bucket[k] - sqft);
          };
          cut(b.MONTHLY, mo);
          cut(b.YEARLY, fy);
          if (fy && q) cut(b.QUARTERLY, fy + '_' + q);
        });
    }

    // Resolve each target employee onto a sales-side name (see _personMatcher).
    const resolve = _personMatcher(Object.keys(byPerson));

    const dominant = function (m) {
      if (!m) return null;
      let best = null, bestV = -1;
      Object.keys(m).forEach(function (k) { if (m[k] > bestV) { bestV = m[k]; best = k; } });
      return best;
    };

    // ── targets, from the sheet only ────────────────────────────────────────
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
      const scHods = _hodsForStates(scope.allowed_states);
      parts.push(scHods
        ? 'hod_name=in.(' + scHods.map(encodeURIComponent).join(',') + ')'
        : 'state=in.(' + scope.allowed_states.map(encodeURIComponent).join(',') + ')');
    }
    if (parts.length) qs = '?' + parts.join('&');
    const tRows = await fetchAll(DB_TABLES.TARGETS || 'target_master', qs);

    // ── one row per employee ────────────────────────────────────────────────
    const map = {};
    tRows.forEach(function (r) {
      const empRaw = _s(r, 'employee_name') || 'Unknown';
      const emp = empRaw.trim().toUpperCase();
      const st = (_s(r, 'state') || '').trim().toUpperCase();
      const sheetHod = _s(r, 'hod_name') || '';
      const fy = _normFy(_s(r, 'fy_year')) || _s(r, 'fy_year');
      const mon3 = _mon3(_s(r, 'month_name'));
      const q = _Q_OF_MONTH[mon3];
      const moKey = _targetMonthKey(fy, mon3);
      const t = _num(r.target_sqft);

      const hit = resolve(empRaw);
      const salesKey = hit && hit.key;
      if (!map[emp]) {
        const sales = salesKey ? byPerson[salesKey] : null;
        // Current HOD: the employee's own sales first, then the sheet's HOD if
        // it exists in sales at all, then the state's dominant HOD.
        const hod = dominant(salesKey ? personHodSqft[salesKey] : null)
          || (salesHods[sheetHod] ? sheetHod : null)
          || dominant(stateHodSqft[st])
          || sheetHod || 'Unknown';
        map[emp] = {
          EMPLOYEE: empRaw, HOD: hod, STATE: _s(r, 'state') || 'Unknown',
          MATCHED: !!sales,
          MATCHED_BY: hit ? hit.via : 'none',
          MATCHED_TO: salesKey || null,
          HOD_SOURCE: dominant(salesKey ? personHodSqft[salesKey] : null) ? 'sales'
            : (salesHods[sheetHod] ? 'sheet' : (dominant(stateHodSqft[st]) ? 'state' : 'sheet-unmatched')),
          YEARLY: {}, QUARTERLY: {}, MONTHLY: {}
        };
      }
      const row = map[emp];
      const sales = salesKey ? byPerson[salesKey] : null;

      if (fy) {
        if (!row.YEARLY[fy]) row.YEARLY[fy] = { t: 0, a: (sales && sales.YEARLY[fy]) || 0 };
        row.YEARLY[fy].t += t;
        if (q) {
          const qk = fy + '_' + q;
          if (!row.QUARTERLY[qk]) row.QUARTERLY[qk] = { t: 0, a: (sales && sales.QUARTERLY[qk]) || 0 };
          row.QUARTERLY[qk].t += t;
        }
      }
      if (moKey) {
        if (!row.MONTHLY[moKey]) row.MONTHLY[moKey] = { t: 0, a: (sales && sales.MONTHLY[moKey]) || 0 };
        row.MONTHLY[moKey].t += t;
      }
    });

    let out = Object.values(map);

    // ── geography / HOD narrowing ───────────────────────────────────────────
    // The selection is applied HERE, to each row's resolved HOD, rather than to
    // the fetches above (see fWide). Doing it in the fetch corrupted the
    // resolution itself: filtering to one HOD made every other target employee
    // resolve onto that HOD through the state fallback, so the page showed 42
    // employees and ten times the real target for a HOD that has 6.
    //
    // It cannot be applied to the target sheet read either -- the sheet's own
    // hod_name is the unreliable column this function exists to work around
    // ('DINESH PRABHUBHAI GOTHI' where sales say 'DINESH P GOTHI') -- so it is
    // resolved into a set of HOD names first, and the rows are matched to that.
    //
    // A State selection is a HOD territory (HOD_TO_STATE), and a Zone selection
    // is read off the sales data the same way every other label here is. Filters
    // intersect, matching the AND that _q applies on the query side.
    const _upper = function (v) { return String(v == null ? '' : v).trim().toUpperCase(); };
    const selections = [];

    const fHods = _vals(f.hod);
    if (fHods) selections.push(fHods.map(_upper));

    const fStates = _vals(f.state);
    if (fStates) {
      const viaTerritory = _hodsForStates(fStates);
      selections.push(viaTerritory
        ? viaTerritory.map(_upper)
        // No territory mapping for this value: fall back to the HODs actually
        // selling in those states, which is what _rowMatches would have kept.
        : Object.keys(hodStateSqft)
            .filter(function (h) { return fStates.map(_upper).indexOf(_upper(dominant(hodStateSqft[h]))) !== -1; })
            .map(_upper));
    }

    const fZones = _vals(f.zone);
    if (fZones) {
      selections.push(Object.keys(hodZoneSqft)
        .filter(function (h) { return fZones.map(_upper).indexOf(_upper(dominant(hodZoneSqft[h]))) !== -1; })
        .map(_upper));
    }

    // Used by every place that can put a HOD on the page, including the two
    // passes below that top the list up straight from the (wide) sales data.
    const inSelection = function (hodName) {
      if (!selections.length) return true;
      const h = _upper(hodName);
      return selections.every(function (set) { return set.indexOf(h) !== -1; });
    };

    out = out.filter(function (r) { return inSelection(r.HOD); });

    // Executive Target vs Sales, mirroring what the HOD roll-up below does for
    // HODs: a period the targets never mentioned still shows if there were
    // sales in it, and an executive who sells without carrying a target row at
    // all appears at a zero target rather than silently vanishing. Without
    // this the page would disagree with Executive Sales.
    if (byEmployee) {
      // The target sheet spells the same person more than one way in places
      // ('MOHIT KUMAR' and 'MOHIT KUMAR SINGH'), so two rows can resolve to a
      // single sales person. Left apart they would each be credited that
      // person's full sales and the page would overstate achievement. Merge
      // them: the targets add up, the sales are counted once.
      const seen = {};
      const merged = [];
      out.forEach(function (r) {
        const key = r.MATCHED_TO;
        const prev = key && seen[key];
        if (!prev) { if (key) seen[key] = r; merged.push(r); return; }
        ['YEARLY', 'QUARTERLY', 'MONTHLY'].forEach(function (grp) {
          Object.keys(r[grp]).forEach(function (k) {
            if (!prev[grp][k]) prev[grp][k] = { t: 0, a: r[grp][k].a };
            prev[grp][k].t += r[grp][k].t;
          });
        });
        // Show the spelling the sales data itself agrees with.
        if (prev.MATCHED_BY !== 'exact' && r.MATCHED_BY === 'exact') {
          prev.EMPLOYEE = r.EMPLOYEE;
          prev.MATCHED_BY = r.MATCHED_BY;
        }
        prev.ALIASES = (prev.ALIASES || []).concat(r.EMPLOYEE);
      });
      out = merged;

      const claimed = {};
      out.forEach(function (r) {
        if (!r.MATCHED_TO) return;
        claimed[r.MATCHED_TO] = true;
        const sales = byPerson[r.MATCHED_TO];
        ['YEARLY', 'QUARTERLY', 'MONTHLY'].forEach(function (grp) {
          Object.keys(sales[grp]).forEach(function (k) {
            if (!r[grp][k]) r[grp][k] = { t: 0, a: 0 };
            r[grp][k].a = sales[grp][k];
          });
        });
      });
      Object.keys(byPerson).forEach(function (key) {
        if (claimed[key]) return;
        const sales = byPerson[key];
        const hod = dominant(personHodSqft[key]) || 'Unknown';
        if (!inSelection(hod)) return;
        const row = {
          EMPLOYEE: personName[key] || key, HOD: hod,
          STATE: HOD_TO_STATE[hod] || dominant(personStateSqft[key]) || 'Unknown',
          MATCHED: true, MATCHED_BY: 'sales-only', MATCHED_TO: key,
          HOD_SOURCE: 'sales', NO_TARGET: true,
          YEARLY: {}, QUARTERLY: {}, MONTHLY: {}
        };
        ['YEARLY', 'QUARTERLY', 'MONTHLY'].forEach(function (grp) {
          Object.keys(sales[grp]).forEach(function (k) { row[grp][k] = { t: 0, a: sales[grp][k] }; });
        });
        out.push(row);
      });
    }

    // Roll employees up to their (current) HOD. Default for the HOD Target vs
    // Sales page; pass groupBy:'employee' for the per-person breakdown.
    if (!byEmployee) {
      const byHod = {};
      out.forEach(function (r) {
        const h = r.HOD || 'Unknown';
        if (!byHod[h]) {
          byHod[h] = {
            HOD: h,
            // Always from the sales data, never the target sheet: the HOD's
            // territory as the rest of the dashboard shows it, falling back to
            // the state they actually sell most in. The sheet's State column is
            // deliberately not consulted -- it disagrees with sales in places.
            STATE: HOD_TO_STATE[h] || dominant(hodStateSqft[h]) || '-',
            EMPLOYEES: 0, MATCHED_EMPLOYEES: 0,
            YEARLY: {}, QUARTERLY: {}, MONTHLY: {}
          };
        }
        const g = byHod[h];
        g.EMPLOYEES += 1;
        if (r.MATCHED) g.MATCHED_EMPLOYEES += 1;
        // Targets roll up from the employees; achievement does not (see above).
        ['YEARLY', 'QUARTERLY', 'MONTHLY'].forEach(function (grp) {
          Object.keys(r[grp]).forEach(function (k) {
            if (!g[grp][k]) g[grp][k] = { t: 0, a: 0 };
            g[grp][k].t += r[grp][k].t;
          });
        });
      });

      // A HOD can have sales but no target row at all (EKANSHU KHURANA,
      // KIRAN KUMAR, NAGMANI SINGH, SATISH GURJAR). Leaving them out would
      // make the page disagree with HOD Sales, so they appear with a zero
      // target rather than silently vanishing.
      Object.keys(byHodSales).forEach(function (h) {
        if (byHod[h] || !inSelection(h)) return;
        byHod[h] = {
          HOD: h,
          STATE: HOD_TO_STATE[h] || dominant(hodStateSqft[h]) || '-',
          EMPLOYEES: 0, MATCHED_EMPLOYEES: 0,
          YEARLY: {}, QUARTERLY: {}, MONTHLY: {}
        };
      });

      // Achievement comes from the HOD's own sales, and brings in periods the
      // targets never mentioned so a month with sales but no target still shows.
      Object.keys(byHod).forEach(function (h) {
        const g = byHod[h];
        const hs = byHodSales[h];
        if (!hs) return;
        ['YEARLY', 'QUARTERLY', 'MONTHLY'].forEach(function (grp) {
          Object.keys(hs[grp]).forEach(function (k) {
            if (!g[grp][k]) g[grp][k] = { t: 0, a: 0 };
            g[grp][k].a = hs[grp][k];
          });
        });
      });
      out = Object.values(byHod);
    }

    return out.map(function (r) {
      ['YEARLY', 'QUARTERLY', 'MONTHLY'].forEach(function (g) {
        Object.keys(r[g]).forEach(function (k) {
          r[g][k].t = Math.round(r[g][k].t);
          r[g][k].a = Math.round(r[g][k].a);
        });
      });
      return r;
    }).sort(function (a, b) {
      const h = String(a.HOD).localeCompare(String(b.HOD));
      return h !== 0 ? h : String(a.EMPLOYEE || '').localeCompare(String(b.EMPLOYEE || ''));
    });
  });
}

async function getExecutiveTargets(f, opts) {
  // The router calls this as (scopedFilters, opts) but the signature only took
  // `f`, so anything in `opts` was silently dropped. No caller sends opts today
  // (the Targets page filters FY client-side), so this is defensive: accept it,
  // and keep it in the cache key so a future opts-bearing caller can't read back
  // another selection's cached result.
  opts = opts || {};
  return cached('exec_targets_v4_' + _stableStringify(f) + '_' + _stableStringify(opts), async function () {
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
      const scHods = _hodsForStates(scope.allowed_states);
      parts.push(scHods
        ? 'hod_name=in.(' + scHods.map(encodeURIComponent).join(',') + ')'
        : 'state=in.(' + scope.allowed_states.map(encodeURIComponent).join(',') + ')');
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
    const stHodsT = _hodsForStates(_vals(f && f.state));
    if (stHodsT) addF('hod_name', stHodsT); else addF('state', f && f.state);
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
      const st = _state(r);
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
        STATE: _state(r),
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
    const q = _q(f, ['month', 'fy', 'quarter']); // vw_customer_summary has no time columns
    let rows = (await _fetchAgg('vw_customer_summary', q)).filter(function (r) { return _rowMatches(r, f); });
    
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
    const q = _q(f, ['month', 'fy', 'quarter']); // vw_customer_summary has no time columns
    const rows = (await _fetchAgg('vw_customer_summary', q))
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
    const q = _q(f, ['month', 'fy', 'quarter']); // vw_customer_summary has no time columns
    const rows = (await _fetchAgg('vw_customer_summary', q))
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
    const q = _q(f, ['month', 'fy', 'quarter']); // vw_customer_summary has no time columns
    const rows = (await _fetchAgg('vw_customer_summary', q)).filter(function (r) { return _rowMatches(r, f); });
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
    const q = _q(f, ['month', 'fy', 'quarter']); // vw_customer_summary has no time columns
    let rows = _computeRFM((await _fetchAgg('vw_customer_summary', q)).filter(function (r) { return _rowMatches(r, f); }));
    if (opts && opts.segment && opts.segment !== 'All') {
      rows = rows.filter(function (r) { return r['SEGMENT'] === opts.segment; });
    }
    return _paginate(rows.sort(function (a, b) { return b['RFM TOTAL'] - a['RFM TOTAL']; }), opts);
  });
}

async function getRFMDistribution(f) {
  return cached('rfmDist_' + _stableStringify(f), async function () {
    const q = _q(f, ['month', 'fy', 'quarter']); // vw_customer_summary has no time columns
    const dist = {};
    _computeRFM((await _fetchAgg('vw_customer_summary', q)).filter(function (r) { return _rowMatches(r, f); })).forEach(function (r) {
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
    (await _fetchAgg('vw_brand_agg', q)).filter(function (r) { return _rowMatches(r, f); }).forEach(function (r) {
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
    (await _fetchAgg('vw_brand_agg', q)).filter(function (r) { return _rowMatches(r, f); }).forEach(function (r) {
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
    (await _fetchAgg('vw_brand_agg', q)).filter(function (r) { return _rowMatches(r, f); }).forEach(function (r) {
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
    const brands = (await _fetchAgg('vw_brand_agg', _q(f, ['month']))).filter(function (r) { return _rowMatches(r, f); })
      .map(function (r) { return _brand(r); })
      .filter(Boolean)
      .filter(function (v, i, a) { return a.indexOf(v) === i; })
      .sort();

    // Fast path: GROUP BY item in Postgres (db/perf_phase2.sql) instead of
    // downloading every mv_sku_agg row. Skipped when a month filter is active:
    // sku data has no month grain, so the legacy path returns nothing there.
    let sorted = null;
    if (!_vals(f.month)) {
      const rp = _rpcTimeGeoParams(f);
      if (rp) {
        const agg = await _tryRpc('api_top_skus', Object.assign({ p_brand: bF, p_sku_type: sF }, rp));
        if (agg) {
          sorted = agg.map(function (r) {
            const sqft = _sqft(r); const sqm = _sqm(r);
            return {
              ITEM_CODE: _s(r, 'item_code') || 'Unknown', ITEM_DESCRIPTION: _s(r, 'item_description'),
              BRAND: _brand(r), FINISH: _finish(r), SIZE: _s(r, 'size'),
              SKU_TYPE: _sku(r), THICKNESS: _thick(r),
              TOTAL_SQFT: Math.round(sqft), TOTAL_SQM: +sqm.toFixed(2),
              TOTAL_QTY: +_qty(r).toFixed(2), TXN_COUNT: _txns(r), NET_REVENUE: Math.round(_rev(r))
            };
          }).sort(function (a, b) { return b.TOTAL_SQFT - a.TOTAL_SQFT; });
        }
      }
    }

    if (!sorted) {
      let q = _q(f, ['month']);
      if (bF) q = (q ? q + '&' : '?') + 'brand=ilike.' + encodeURIComponent(bF);
      if (sF) q = (q ? q + '&' : '?') + 'sku_type=ilike.' + encodeURIComponent(sF);
      const rows = (await _fetchAgg('vw_sku_agg', q)).filter(function (r) { return _rowMatches(r, f); });
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
      sorted = Object.values(map)
        .map(function (s) { return Object.assign({}, s, { TOTAL_SQFT: Math.round(s.TOTAL_SQFT), TOTAL_SQM: +s.TOTAL_SQM.toFixed(2), TOTAL_QTY: +s.TOTAL_QTY.toFixed(2), NET_REVENUE: Math.round(s.NET_REVENUE) }); })
        .sort(function (a, b) { return b.TOTAL_SQFT - a.TOTAL_SQFT; });
    }
    
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
    // Fast path: GROUP BY size in Postgres (db/perf_phase2.sql). Same
    // month-filter caveat as getTopSKUs: sku data has no month grain.
    if (!_vals(f.month)) {
      const rp = _rpcTimeGeoParams(f);
      if (rp) {
        const agg = await _tryRpc('api_size_agg', rp);
        if (agg) {
          return agg.map(function (r) {
            return {
              SIZE: _s(r, 'size') || 'Unknown', THICKNESS: '-',
              TOTAL_SQFT: Math.round(_sqft(r)), NET_REVENUE: Math.round(_rev(r)), TXN_COUNT: _txns(r)
            };
          }).sort(function (a, b) { return b.TOTAL_SQFT - a.TOTAL_SQFT; });
        }
      }
    }

    const q = _q(f, ['month']); const map = {};
    (await _fetchAgg('vw_sku_agg', q)).filter(function (r) { return _rowMatches(r, f); }).forEach(function (r) {
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
    
    (await _fetchAgg('vw_brand_agg', q)).filter(function (r) { return _rowMatches(r, f); }).forEach(function (r) {
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
    
    (await _fetchAgg('vw_brand_agg', q)).filter(function (r) { return _rowMatches(r, f); }).forEach(function (r) {
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
    (await _fetchAgg('vw_brand_agg', q)).filter(function (r) { return _rowMatches(r, f); }).forEach(function (r) {
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
    // vw_brand_agg carries every dimension this endpoint groups by and sums
    // to identical totals as vw_sku_agg at a quarter of the rows (verified
    // live). It also has month_year, so month filters now return data (they
    // matched nothing against the month-less vw_sku_agg).
    const q = _q(f); const map = {};
    (await _fetchAgg('vw_brand_agg', q)).filter(function (r) { return _rowMatches(r, f); }).forEach(function (r) {
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
  loadHodStates,
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
  getExecutiveQoQ,
  getExecutiveAllFYSummary,
  getExecutiveMonthlySummary,
  getProjectQoQ,
  getProjectAllFYSummary,
  getProjectMonthlySummary,
  getSkuTypeQoQ,
  getSkuTypeAllFYSummary,
  getSkuTypeMonthlySummary,
  getExecutiveTargets,
  getTargetVsAchievement,
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
