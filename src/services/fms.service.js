/**
 * src/services/fms.service.js
 *
 * Live read-only bridge to the "Virgo ACP OMS – FMS" Google Sheet.
 *
 * The FMS / OMS Apps-Script app keeps its operational data (orders, DO products,
 * production plan, dispatch, stock, etc.) in tabs of a single workbook. This
 * service reads those tabs live via the same Google service account the
 * Dashboard already uses for sync, so the integrated tables always reflect the
 * sheet without any copy into Supabase.
 *
 *  - getFmsTable(opts)   -> one tab, with server-side search + pagination
 *  - listFmsTables()     -> menu metadata for the front-end
 *
 * Reads are cached in-memory per tab (TTL_MS) so repeated navigation / paging
 * doesn't hammer the Sheets API. Cache is process-local (fine for both the
 * local Express server and a warm serverless instance).
 */

const { google } = require('googleapis');
let _supa = null;
function _supaFetch() { if (!_supa) _supa = require('./supabase').supaFetch; return _supa; }

// Workbook id — overridable via env if the sheet is ever moved/cloned.
const FMS_SHEET_ID =
  process.env.FMS_SHEET_ID || '1wpaZwEqW6AHGYqz-4Lm0CEoMQbWIefTa12wMQ_87K_8';

// friendly key -> { tab (real sheet name), label (UI), icon (phosphor) }
const FMS_TABLES = {
  orders:      { tab: 'ORDER RESPONSES', label: 'Orders',          icon: 'ph-clipboard-text' },
  do:          { tab: 'DO PRODUCTS',     label: 'DO Products',      icon: 'ph-package' },
  prodplan:    { tab: 'PRODUCTION PLAN', label: 'Production Plan',  icon: 'ph-factory' },
  dispatch:    { tab: 'DISPATCH LOGS',   label: 'Dispatch Logs',   icon: 'ph-truck' },
  suborders:   { tab: 'SUB ORDERS',      label: 'Sub Orders',      icon: 'ph-arrows-split' },
  stockmaster: { tab: 'STOCK MASTER',    label: 'Stock Master',    icon: 'ph-stack' },
  stockledger: { tab: 'STOCK LEDGER',    label: 'Stock Ledger',    icon: 'ph-list-numbers' },
  customers:   { tab: 'CUSTOMER MASTER', label: 'Customer Master', icon: 'ph-address-book' },
  items:       { tab: 'ITEM MASTER',     label: 'Item Master',     icon: 'ph-cube' }
};

const TTL_MS = 60 * 1000;            // live-ish: 60s freshness window
const MAX_ROWS = 20000;              // safety cap on rows held in memory per tab
const _cache = new Map();            // tab name -> { headers, rows, fetchedAt }

let _auth = null;
function _getAuth() {
  if (_auth) return _auth;
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!keyJson) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON missing — share the FMS sheet (read access) ' +
      'with the service account email and set the credential.'
    );
  }
  _auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(keyJson),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  return _auth;
}

// Loads one tab's values. headers = row 1; rows = non-empty data rows,
// each normalised to the header width. Cached for TTL_MS unless force=true.
async function _loadTab(tabName, force) {
  const hit = _cache.get(tabName);
  if (!force && hit && Date.now() - hit.fetchedAt < TTL_MS) return hit;

  const auth = _getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  let values = [];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: FMS_SHEET_ID,
      range: tabName,
      valueRenderOption: 'FORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING'
    });
    values = res.data.values || [];
  } catch (e) {
    throw new Error('Could not read FMS tab "' + tabName + '": ' + e.message);
  }

  const headers = (values[0] || []).map((h) => String(h == null ? '' : h).trim());
  const width = headers.length;

  const rows = [];
  for (let i = 1; i < values.length && rows.length < MAX_ROWS; i++) {
    const r = values[i] || [];
    let hasData = false;
    const out = new Array(width);
    for (let j = 0; j < width; j++) {
      const c = r[j];
      const v = c == null ? '' : String(c);
      if (v.trim() !== '') hasData = true;
      out[j] = v;
    }
    if (hasData) rows.push(out);
  }

  const result = { headers, rows, fetchedAt: Date.now() };
  _cache.set(tabName, result);
  return result;
}

/**
 * getFmsTable(opts)
 *   opts.tab       friendly key (see FMS_TABLES)        [required]
 *   opts.search    case-insensitive across all columns  [optional]
 *   opts.page      1-based page                          [default 1]
 *   opts.pageSize  rows per page (1..500)               [default 50]
 *   opts.force     bypass cache and re-read the sheet    [optional]
 */
async function getFmsTable(opts) {
  opts = opts || {};
  const def = FMS_TABLES[opts.tab];
  if (!def) throw new Error('Unknown FMS table: ' + opts.tab);

  const data = await _loadTab(def.tab, opts.force === true);

  const search = String(opts.search || '').trim().toLowerCase();
  let rows = data.rows;
  if (search) {
    rows = rows.filter((r) => {
      for (let j = 0; j < r.length; j++) {
        if (String(r[j]).toLowerCase().indexOf(search) !== -1) return true;
      }
      return false;
    });
  }

  const grandTotal = data.rows.length;
  const total = rows.length;
  const pageSize = Math.min(Math.max(parseInt(opts.pageSize, 10) || 50, 1), 500);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  let page = Math.max(parseInt(opts.page, 10) || 1, 1);
  if (page > pages) page = pages;
  const start = (page - 1) * pageSize;
  const slice = rows.slice(start, start + pageSize);

  return {
    tab: opts.tab,
    label: def.label,
    sheetTab: def.tab,
    icon: def.icon,
    headers: data.headers,
    rows: slice,
    total: total,
    grandTotal: grandTotal,
    page: page,
    pageSize: pageSize,
    pages: pages,
    fetchedAt: data.fetchedAt
  };
}

function listFmsTables() {
  return Object.keys(FMS_TABLES).map((k) => ({
    key: k,
    label: FMS_TABLES[k].label,
    tab: FMS_TABLES[k].tab,
    icon: FMS_TABLES[k].icon
  }));
}

// ════════════════════════════════════════════════════════════════════════════
//  ORDER-CENTRIC MAPPERS  (faithful read-only port of the FMS/OMS app)
// ════════════════════════════════════════════════════════════════════════════

function _num(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/[₹,\s]/g, ''));
  return isFinite(n) ? n : 0;
}
function _s(v) { return v == null ? '' : String(v).trim(); }

// header name -> column index, built once per sheet read
function _hindex(headers) {
  const m = {};
  headers.forEach((h, i) => { m[String(h).trim().toUpperCase()] = i; });
  return (name) => { const i = m[String(name).trim().toUpperCase()]; return i === undefined ? -1 : i; };
}

// ORDER RESPONSES row -> order object (mirrors _rowToObj from the GAS app)
function _mapOrder(row, gi) {
  const g = (name) => { const i = gi(name); return i === -1 ? '' : (row[i] == null ? '' : row[i]); };
  const custName2 = _s(g('CUSTOMER NAME (2)'));
  const custName1 = _s(g('CUSTOMER NAME (1)'));
  const dealerName = _s(g('NEW DEALER/PARTY NAME'));
  const dealerParty = _s(g('DEALER/PARTY'));
  return {
    orderNo: _s(g('ORDER NUMBER')),
    timestamp: _s(g('TIMESTAMP')),
    seName: _s(g('SALES EXECUTIVE NAME')),
    dealerName: dealerName,
    partyPerson: _s(g('PARTY PERSON NAME')),
    mobile: _s(g('MOBILE NUMBER')),
    email: _s(g('EMAIL ADDRESS')),
    address: _s(g('FULL DELIVERY ADDRESS')),
    freight: _s(g('FREIGHT CHARGE')),
    orderDetail: _s(g('DEALER ORDER DETAIL')),
    deliveryDate: _s(g('DELIVERY REQUIRED ON')),
    remarks: _s(g('REMARKS')),
    paymentTerm: _s(g('PAYMENT TERM')),
    quantityOrdered: _num(g('QUANTITY ORDERED')),
    orderRef: _s(g('ORDER REF')),
    custName1: custName1,
    orderTypeForm: _s(g('TYPE OF ORDER (FORM)')),
    orderType: _s(g('ORDER TYPE')),
    estValue: _num(g('ESTIMATED VALUE (₹)')),
    status: _s(g('APPROVAL STATUS')),
    outstanding: _num(g('OUTSTANDING AMT (₹)')),
    creditLimit: _num(g('CREDIT LIMIT (₹)')),
    utilPct: _s(g('UTILISATION %')),
    autoEligible: _s(g('AUTO ELIGIBLE')),
    crrBy: _s(g('CRR PROCESSED BY')),
    crrDate: _s(g('CRR PROCESSED DATE')),
    accBy: _s(g('ACCOUNTS ACTION BY')),
    accDate: _s(g('ACCOUNTS ACTION DATE')),
    finalRemarks: _s(g('FINAL REMARKS')),
    parentOrder: _s(g('PARENT ORDER NO')),
    createdBy: _s(g('CREATED BY')),
    branchName: _s(g('BRANCH NAME')),
    holdDate: _s(g('HOLD DATE')),
    rejectedDate: _s(g('REJECTED DATE')),
    approvedDate: _s(g('APPROVED DATE')),
    dispatchStatus: _s(g('DISPATCH STATUS')),
    dispatchDate: _s(g('DISPATCH DATE')),
    dispatchBill: _s(g('LATEST BILL URL')),
    dispatchedQty: _num(g('DISPATCHED QTY')),
    plantStatus: _s(g('PLANT STATUS')),
    plantRemarks: _s(g('PLANT REMARKS')),
    specialRemarks: _s(g('SPECIAL REMARKS')),
    // DO generation date is stamped into FINAL REMARKS as [DO_GEN_DATE:...]
    doGenDate: (function (rem) { const m = String(rem || '').match(/\[DO_GEN_DATE:([^\]]+)\]/); return m ? m[1] : ''; })(g('FINAL REMARKS')),
    customerName: custName2 || custName1 || dealerName || dealerParty || '—'
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  HOD RESOLUTION
//
//  An FMS order carries no HOD, so it is derived. Measured coverage over 7817
//  live orders:
//
//    customer name -> current-FY latest sale   6321   81%
//    customer name -> outstanding snapshot     7530   96%
//    both, current-FY first                    7551   97%   <- used here
//    sales exec    -> target_master            2573   33%
//
//  Current-FY-latest is preferred because a customer can be reassigned between
//  HODs; a flat snapshot would silently restate history. It is checked first,
//  then the customer-master snapshot fills in customers who have not yet
//  transacted this financial year (only 452 of 2136 had, four months in).
//  Sales-exec remains as a last resort — it is weak (target_master lists 83
//  employees against 262 distinct executives in FMS) but costs nothing.
//
//  Note: at the time of writing, zero customers had conflicting HODs, so the
//  three sources agree wherever they overlap. The ordering matters only once a
//  reassignment actually happens.
// ════════════════════════════════════════════════════════════════════════════

// Normalises a name for matching: case, whitespace runs and trailing
// punctuation vary between the sheet and the DB.
function _norm(s) { return String(s == null ? '' : s).trim().toUpperCase().replace(/\s+/g, ' '); }
function _normCust(s) { return _norm(s).replace(/[.,]/g, ''); }

// Indian financial year starting in April -> the DB's 'FY-26-27' form.
function _currentFyDb(now) {
  const d = now || new Date();
  const start = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
  return 'FY-' + String(start).slice(2) + '-' + String(start + 1).slice(2);
}

const _MON3 = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
// 'Apr- 26' -> '2026-04', so months sort chronologically as strings.
function _monthKey(my) {
  const p = String(my || '').replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  if (p.length < 2) return '0000-00';
  const i = _MON3.indexOf(p[0].slice(0, 3).toUpperCase());
  if (i < 0) return '0000-00';
  let yr = p[p.length - 1];
  if (yr.length === 2) yr = '20' + yr;
  return yr + '-' + String(i + 1).padStart(2, '0');
}

// A branch-to-branch movement has no customer, so it can never carry a customer
// HOD. Labelling it is honest; leaving it blank reads as missing data.
function _isBranchParty(name) { return /-BRANCH$/.test(_normCust(name)); }

// outstanding_master stores the literal 'Unassigned' for customers with no HOD
// on record — 1159 of its 1230 FMS matches were this placeholder. Accepting it
// would report 99% coverage while showing users a word that carries no
// information. Treated as a miss so resolution falls through to the next
// source, which is worth ~1100 additional real values.
const _PLACEHOLDER_HOD = /^(unassigned|unknown|n\/?a|none|-{1,2})$/i;
function _realHod(v) {
  const s = String(v == null ? '' : v).trim();
  return (!s || _PLACEHOLDER_HOD.test(s)) ? '' : s;
}

let _hodMaps = null, _hodMapsTs = 0;

async function _buildHodMaps(force) {
  if (!force && _hodMaps && Date.now() - _hodMapsTs < 5 * 60000) return _hodMaps;

  const fy = _currentFyDb();
  const byCustFy = {};   // customer -> { key, hod } latest month this FY
  const byCustSnap = {}; // customer -> hod (customer master snapshot)
  const byExec = {};     // sales executive -> hod

  const fetchAll = require('./supabase').fetchAll;

  // 1. current-FY latest sale per customer
  try {
    const rows = await fetchAll('vw_customer_sale_agg',
      '?fy_year=eq.' + encodeURIComponent(fy) + '&select=customer_name,hod_name,month_year');
    (rows || []).forEach(function (r) {
      const c = _normCust(r.customer_name);
      if (!c || !r.hod_name) return;
      const k = _monthKey(r.month_year);
      if (!byCustFy[c] || k > byCustFy[c].k) byCustFy[c] = { k: k, hod: String(r.hod_name).trim() };
    });
  } catch (e) { /* fall through to the snapshot */ }

  // 2. customer master snapshot
  try {
    const rows = await fetchAll('vw_outstanding_hod', '?select=customer_name,hod_name');
    (rows || []).forEach(function (r) {
      const c = _normCust(r.customer_name);
      if (c && r.hod_name && !byCustSnap[c]) byCustSnap[c] = String(r.hod_name).trim();
    });
  } catch (e) { /* fall through to sales exec */ }

  // 3. sales executive (weak, last resort)
  try {
    const rows = await _supaFetch()('/rest/v1/target_master?select=employee_name,hod_name');
    (rows || []).forEach(function (r) {
      const k = _norm(r.employee_name);
      if (k && r.hod_name) byExec[k] = String(r.hod_name).trim();
    });
  } catch (e) { /* leave empty → HOD shows as — */ }

  _hodMaps = { fy: fy, byCustFy: byCustFy, byCustSnap: byCustSnap, byExec: byExec };
  _hodMapsTs = Date.now();
  return _hodMaps;
}

/**
 * Resolves an order's HOD. Returns { hod, hodSource } where hodSource is one of
 * 'fy' | 'snapshot' | 'exec' | 'branch' | '' — kept on the record so the origin
 * of a value stays auditable rather than being silently blended.
 */
function _resolveHod(order, maps) {
  const names = [order.dealerName, order.custName1, order.customerName].filter(Boolean);

  for (const n of names) {
    const hit = _realHod(maps.byCustFy[_normCust(n)] && maps.byCustFy[_normCust(n)].hod);
    if (hit) return { hod: hit, hodSource: 'fy' };
  }
  for (const n of names) {
    const hit = _realHod(maps.byCustSnap[_normCust(n)]);
    if (hit) return { hod: hit, hodSource: 'snapshot' };
  }
  const viaExec = _realHod(maps.byExec[_norm(order.seName)]);
  if (viaExec) return { hod: viaExec, hodSource: 'exec' };

  if (names.some(_isBranchParty) || _isBranchParty(order.seName)) {
    return { hod: 'Branch Transfer', hodSource: 'branch' };
  }
  return { hod: '', hodSource: '' };
}

async function _allOrders(force) {
  const data = await _loadTab('ORDER RESPONSES', force === true);
  const gi = _hindex(data.headers);
  const list = [];
  for (let i = 0; i < data.rows.length; i++) {
    const o = _mapOrder(data.rows[i], gi);
    if (o.orderNo) list.push(o);
  }
  list.reverse(); // newest first (sheet appends oldest -> newest)
  const hodMaps = await _buildHodMaps(force === true);
  // lookup so an order's "Order Ref" can resolve to the referenced order's
  // dealer / party name (Customer Ref). Built from the full unfiltered list.
  const byNo = {};
  for (let k = 0; k < list.length; k++) byNo[list[k].orderNo.toUpperCase()] = list[k];
  for (let j = 0; j < list.length; j++) {
    const resolved = _resolveHod(list[j], hodMaps);
    list[j].hod = resolved.hod;
    list[j].hodSource = resolved.hodSource;
    const ref = list[j].orderRef ? String(list[j].orderRef).trim().toUpperCase() : '';
    const refOrd = ref ? byNo[ref] : null;
    list[j].custRef = refOrd ? (refOrd.dealerName || refOrd.customerName || '') : '';
  }

  // Second pass — inherit through the order link.
  // A plant-leg order is raised against VIRGO ACP itself, so it has no external
  // customer and nothing to match on (859 such orders). Its "Order Ref" points
  // at the originating branch order, which does carry a real customer. Taking
  // that order's HOD attributes the plant leg to whoever actually owns the
  // demand. Runs after the main pass so it can only ever fill a blank, never
  // override a directly-resolved value. Worth 614 orders (87% -> 95%).
  for (let j = 0; j < list.length; j++) {
    if (list[j].hod) continue;
    const ref = list[j].orderRef ? String(list[j].orderRef).trim().toUpperCase() : '';
    const src = ref ? byNo[ref] : null;
    if (src && src.hod && src.hodSource !== 'linked') {
      list[j].hod = src.hod;
      list[j].hodSource = 'linked';
    }
  }

  return { orders: list, fetchedAt: data.fetchedAt };
}

const _FACTORY = 'Cust. to Factory';
const _STOCKF = 'Branch Stock order- Factory';
// Statuses that take an order out of the open pipeline.
const _TERMINAL = ['fully dispatched', 'rejected', 'cancelled', 'received', 'closed (short)'];

function _applyFmsScope(items, scope) {
  // HOD filtering removed as requested: FMS tables are now globally visible
  // regardless of the user's allowed_hods restriction.
  return items;
}

// All orders (optionally a named queue). Returns the full mapped list so the
// front-end can search / infinite-scroll exactly like the GAS app.
async function getFmsOrders(opts, scope) {
  opts = opts || {};
  let { orders, fetchedAt } = await _allOrders(opts.force === true);
  if (scope) orders = _applyFmsScope(orders, scope);
  const queue = opts.queue || 'all';
  let rows = orders;

  if (queue === 'crr') {
    rows = orders.filter((o) => /^pending crr|^pending do generation/i.test(o.status));
  } else if (queue === 'acc') {
    rows = orders.filter((o) => /^pending accounts/i.test(o.status));
  } else if (queue === 'hold') {
    rows = orders.filter((o) => /^on hold/i.test(o.status));
  } else if (queue === 'plant') {
    rows = orders.filter((o) => {
      const t = o.orderType || o.orderTypeForm;
      return (t === _FACTORY || t === _STOCKF) &&
        ['Pending Plant', 'Partially Dispatched', 'Fully Dispatched'].indexOf(o.status) !== -1;
    });
  }
  return { queue: queue, orders: rows, total: rows.length, fetchedAt: fetchedAt };
}

// Dashboard stat block — faithful port of _calculateOrderStats from the GAS
// Orders_Tracking.gs (cumulative semantics: accApproved/dispatched roll up
// downstream statuses; pendingCRR includes Pending DO Generation; OTIF uses a
// strict day-floored dispatchDate <= deliveryDate).
async function getFmsDashboard(scope) {
  let { orders, fetchedAt } = await _allOrders(false);
  if (scope) orders = _applyFmsScope(orders, scope);
  const s = {
    total: 0, pendingCRR: 0, pendingAcc: 0, pendingPlant: 0, pendingDO: 0,
    onHold: 0, autoApproved: 0, accApproved: 0, dispatched: 0, rejected: 0,
    factory: 0, stock: 0, totalValue: 0, approvedValue: 0, otifPct: 100,
    // Open-order breakdown (everything not in a terminal state)
    open: 0, branchOrderOpen: 0, branchTransferOpen: 0,
    stockOpen: 0, cvbOpen: 0, directOpen: 0, factoryOpen: 0
  };
  let completed = 0, otifOk = 0;

  orders.forEach((o) => {
    const st = o.status, val = o.estValue || 0, ot = o.orderType;
    s.total++; s.totalValue += val;
    if (st === 'Pending CRR') s.pendingCRR++;
    else if (st === 'Pending DO Generation') { s.pendingCRR++; s.pendingDO++; }
    else if (st === 'Pending Accounts' || st === 'Processing...') s.pendingAcc++;
    // Pending Plant only counts factory-bound work — branch orders sitting in
    // this status are not the plant's queue.
    else if (st === 'Pending Plant') { if (ot === _FACTORY || ot === _STOCKF) s.pendingPlant++; }
    else if (st === 'On Hold') s.onHold++;
    else if (st === 'Auto Approved') { s.autoApproved++; s.approvedValue += val; }
    else if (st === 'Accounts Approved') { s.accApproved++; s.approvedValue += val; }
    else if (st === 'Partially Dispatched') { s.dispatched++; s.accApproved++; s.approvedValue += val; }
    else if (st === 'Fully Dispatched') {
      s.dispatched++; s.accApproved++; s.approvedValue += val; completed++;
      const reqDate = _parseDate(o.deliveryDate);
      const dispDate = _parseDate(o.dispatchDate);
      if (reqDate) reqDate.setHours(0, 0, 0, 0);
      if (dispDate) { dispDate.setHours(0, 0, 0, 0); if (reqDate && dispDate.getTime() <= reqDate.getTime()) otifOk++; }
    } else if (st === 'Rejected') s.rejected++;
    if (ot === _FACTORY) s.factory++;
    if (ot === _STOCKF) s.stock++;

    // Open pipeline, split by what kind of order it is.
    if (_TERMINAL.indexOf(String(st || '').toLowerCase()) === -1) {
      s.open++;
      const otL = String(ot || o.orderTypeForm || '').trim().toLowerCase();
      if (otL.indexOf('stock') > -1) { s.stockOpen++; s.factoryOpen++; }
      else if (otL.indexOf('factory') > -1) {
        s.factoryOpen++;
        if (String(o.customerName || '').toUpperCase().indexOf('VIRGO ACP INDUSTRIES') > -1) s.cvbOpen++;
        else s.directOpen++;
      } else if (otL.indexOf('transfer') > -1) s.branchTransferOpen++;
      else s.branchOrderOpen++;
    }
  });
  s.otifPct = completed > 0 ? Math.round((otifOk / completed) * 100) : 100;
  s.fetchedAt = fetchedAt;
  return s;
}

function _parseDate(s) {
  if (!s) return null;
  s = String(s).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // D/M/YYYY or M/D/YYYY
  if (m) {
    let p1 = +m[1], p2 = +m[2], y = +m[3];
    let month = p1, day = p2;
    if (p1 > 12) { day = p1; month = p2; }
    else if (p2 > 12) { month = p1; day = p2; }
    return new Date(y, month - 1, day);
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // ISO
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// DO PRODUCTS row -> item object
function _mapDoItem(row, gi, sheetRowIndex) {
  const g = (name) => { const i = gi(name); return i === -1 ? '' : (row[i] == null ? '' : row[i]); };
  return {
    sheetRowIndex: sheetRowIndex,
    orderNo: _s(g('ORDER NUMBER')),
    code: _s(g('GRADE / COLOUR CODE')),
    length: _num(g('LENGTH (MM)')),
    width: _num(g('WIDTH (MM)')),
    qty: _num(g('QTY (SHEETS)')),
    sqm: _num(g('QTY (SQM)')),
    rate: _num(g('RATE (SQFT)')),
    amount: _num(g('AMOUNT (₹)')),
    batch: _s(g('BATCH')),
    ngrade: _s(g('N GRADE')),
    itemRemarks: _s(g('ITEM REMARKS')),
    prodStatus: _s(g('PROD STATUS')),
    qcStatus: _s(g('QC STATUS')),
    customerName: _s(g('CUSTOMER NAME')),
    location: _s(g('LOCATION')),
    orderDate: _s(g('ORDER DATE')),
    dispatchQty: _num(g('DISPATCH QTY'))
  };
}

// Item weight (kg per sqm) by item-code prefix — ported from FMS Setup.gs.
const ITEM_WEIGHT_MAP = {
  SIGN4030: 5.15, ALFA3030: 4.03, ALFA6030: 7.61, SLEEK3025: 4.03, CROMA3020: 4.03,
  ALFA4030: 5.37, SIGN4002: 5.10, ALFA4050FRB: 7.45, SLEEK4025: 5.37, ALFA4050FRB1: 7.51,
  CROMA3018: 3.92, SLEEK6025: 7.24, ACPSHEET: 4.03, ALFA4050: 5.60, CROMA3015: 3.92,
  CROMA4020: 5.05, SIGN3002: 4.03, SIGN4025: 5.15, SIGN4004: 5.10, APP400: 4.03,
  CROMA2015: 1.75, ALFA4030FRB1: 5.71, ALFA4050FRA2: 8.50, '3015FR': 4.00, ALFA4050FRB2: 7.39,
  ALFA4030FRB2: 5.60, ALFA4030FRO: 5.37, SIGN3025: 4.03, CROMA4018: 4.03, SIGN3020: 3.92,
  ALFA4030FRA2: 8.00, SIGN4050: 5.60, CROMA2020: 2.60, ALFA4050FR: 7.45
};
function _itemWeightPerSqm(code) {
  if (!code) return 0;
  const p = String(code).trim().split('-')[0].toUpperCase();
  return ITEM_WEIGHT_MAP[p] || 0;
}

// Item-wise plant & dispatch register: every undispatched DO line item joined
// with its order context (customer, location, order-ref, ref-customer), plus
// remaining qty, sqm, weight. Mirrors getPlantQueueWithItems (read-only).
async function getFmsPlantItems(scope) {
  const [ordWrap, doData] = await Promise.all([_allOrders(false), _loadTab('DO PRODUCTS', false)]);
  let allOrds = ordWrap.orders;
  if (scope) allOrds = _applyFmsScope(allOrds, scope);
  const byNo = {};
  allOrds.forEach((o) => { byNo[o.orderNo.toUpperCase()] = o; });

  const gi = _hindex(doData.headers);
  const g = (r, n) => { const i = gi(n); return i === -1 ? '' : (r[i] == null ? '' : r[i]); };

  const items = [];
  for (let k = 0; k < doData.rows.length; k++) {
    const r = doData.rows[k];
    const orderNo = _s(g(r, 'ORDER NUMBER'));
    if (!orderNo) continue;
    const ord = byNo[orderNo.toUpperCase()] || {};
    // plant queue = orders currently Pending Plant or Partially Dispatched
    if (ord.status !== 'Pending Plant' && ord.status !== 'Partially Dispatched') continue;
    const prodStatus = _s(g(r, 'PROD STATUS'));
    const qcStatus = _s(g(r, 'QC STATUS'));
    if (prodStatus === 'Dispatched' || qcStatus === 'Dispatched') continue;
    const qty = _num(g(r, 'QTY (SHEETS)'));
    const dispatched = _num(g(r, 'DISPATCH QTY'));
    const remaining = Math.max(0, qty - dispatched);
    if (remaining <= 0) continue;

    const code = _s(g(r, 'GRADE / COLOUR CODE'));
    const sqm = _num(g(r, 'QTY (SQM)'));
    const orderRef = _s(g(r, 'ORDER REF')) || ord.orderRef || '';
    const refOrd = orderRef ? byNo[orderRef.toUpperCase()] : null;

    items.push({
      orderNo: orderNo,
      date: ord.timestamp || _s(g(r, 'ORDER DATE')),
      customer: ord.customerName || _s(g(r, 'CUSTOMER NAME')) || ord.dealerName || '',
      location: _s(g(r, 'LOCATION')) || ord.branchName || '',
      code: code,
      batch: _s(g(r, 'BATCH')),
      length: _num(g(r, 'LENGTH (MM)')),
      width: _num(g(r, 'WIDTH (MM)')),
      qty: qty,
      dispatched: dispatched,
      remaining: remaining,
      sqm: sqm,
      sqft: sqm * 10.7639,
      weight: sqm * _itemWeightPerSqm(code),
      prodStatus: prodStatus,
      qcStatus: qcStatus,
      orderRef: orderRef,
      refCustomer: refOrd ? (refOrd.dealerName || refOrd.customerName || '') : '',
      itemRemarks: _s(g(r, 'ITEM REMARKS')),
      orderStatus: ord.status || '',
      hod: ord.hod || ''
    });
  }
  return { items: items, fetchedAt: ordWrap.fetchedAt };
}

// Full detail for one order (order + DO line items + dispatch log + sub-orders).
async function getFmsOrderDetail(opts, scope) {
  opts = opts || {};
  const orderNo = _s(opts.orderNo);
  if (!orderNo) throw new Error('orderNo required');
  const key = orderNo.toLowerCase();

  const [ordWrap, doData, dispData, subData] = await Promise.all([
    _allOrders(false),
    _loadTab('DO PRODUCTS', false),
    _loadTab('DISPATCH LOGS', false),
    _loadTab('SUB ORDERS', false)
  ]);

  let allOrds = ordWrap.orders;
  if (scope) allOrds = _applyFmsScope(allOrds, scope);
  const order = allOrds.find((o) => o.orderNo.toLowerCase() === key) || null;

  const doGi = _hindex(doData.headers);
  const doNoIdx = doGi('ORDER NUMBER');
  const doItems = [];
  for (let i = 0; i < doData.rows.length; i++) {
    if (_s(doData.rows[i][doNoIdx]).toLowerCase() === key) {
      doItems.push(_mapDoItem(doData.rows[i], doGi, i + 2));
    }
  }

  const dGi = _hindex(dispData.headers);
  const dNoIdx = dGi('ORDER NUMBER');
  const dispatch = [];
  for (let i = 0; i < dispData.rows.length; i++) {
    if (_s(dispData.rows[i][dNoIdx]).toLowerCase() === key) {
      const r = dispData.rows[i];
      const gg = (n) => { const ix = dGi(n); return ix === -1 ? '' : r[ix]; };
      dispatch.push({
        dispatchDate: _s(gg('DISPATCH DATE')),
        type: _s(gg('DISPATCH TYPE')),
        qty: _num(gg('DISPATCHED QTY')),
        billUrl: _s(gg('BILL URL')),
        remarks: _s(gg('REMARKS')),
        dispatchedBy: _s(gg('DISPATCHED BY'))
      });
    }
  }

  const sGi = _hindex(subData.headers);
  const sParentIdx = sGi('PARENT ORDER NO');
  const subOrders = [];
  for (let i = 0; i < subData.rows.length; i++) {
    if (_s(subData.rows[i][sParentIdx]).toLowerCase() === key) {
      const r = subData.rows[i];
      const gg = (n) => { const ix = sGi(n); return ix === -1 ? '' : r[ix]; };
      subOrders.push({
        subOrderNo: _s(gg('SUB-ORDER NO')),
        targetBranch: _s(gg('TARGET BRANCH NAME')),
        quantity: _s(gg('QUANTITY')),
        status: _s(gg('STATUS')),
        createdOn: _s(gg('CREATED ON'))
      });
    }
  }

  return { order: order, doItems: doItems, dispatch: dispatch, subOrders: subOrders };
}

// Party-wise summary — remaining (undispatched) DO quantity per order, with
// order-type classification (faithful port of _renderPartySummary's data prep).
function _psOrderType(customerName, orderRef) {
  const hasVirgo = String(customerName || '').toUpperCase().indexOf('VIRGO') > -1;
  const hasRef = String(orderRef || '').trim().length > 0;
  if (hasVirgo && hasRef) return 'Customer Via Branch';
  if (hasVirgo && !hasRef) return 'Stock Order';
  return 'Direct Customer to Factory';
}

async function getFmsPartySummary(scope) {
  const [ordWrap, doData] = await Promise.all([_allOrders(false), _loadTab('DO PRODUCTS', false)]);
  let allOrds = ordWrap.orders;
  if (scope) allOrds = _applyFmsScope(allOrds, scope);
  const orderMap = {};
  allOrds.forEach((o) => { orderMap[o.orderNo] = o; });

  const gi = _hindex(doData.headers);
  const oNoIdx = gi('ORDER NUMBER'), qtyIdx = gi('QTY (SHEETS)'), dispIdx = gi('DISPATCH QTY'),
    sqmIdx = gi('QTY (SQM)'), lenIdx = gi('LENGTH (MM)'), widIdx = gi('WIDTH (MM)'),
    prodIdx = gi('PROD STATUS'), qcIdx = gi('QC STATUS');

  const map = {};
  doData.rows.forEach((r) => {
    const oNo = _s(r[oNoIdx]); if (!oNo) return;
    const prod = _s(r[prodIdx]).toLowerCase(), qc = _s(r[qcIdx]).toLowerCase();
    if (prod === 'dispatched' || qc === 'dispatched') return; // exclude dispatched line items
    const ord = orderMap[oNo]; if (!ord) return;
    if (!map[oNo]) {
      const d = _parseDate(ord.timestamp);
      map[oNo] = {
        orderNo: oNo, orderRef: ord.orderRef || '', orderDate: ord.timestamp,
        customerName: ord.customerName, refParty: ord.remarks || '', location: ord.branchName || '',
        seName: ord.seName || '', totalQty: ord.quantityOrdered || 0, remainingQty: 0, remainingSqFt: 0,
        deliveryDate: ord.deliveryDate || '', rawDate: d ? d.getTime() : 0, status: ord.status
      };
    }
    const qty = _num(r[qtyIdx]), dispQty = _num(r[dispIdx]), rem = Math.max(0, qty - dispQty);
    map[oNo].remainingQty += rem;
    const sqm = _num(r[sqmIdx]);
    const sqft = sqm > 0 ? sqm * 10.7639 : (_num(r[lenIdx]) * _num(r[widIdx]) * rem / 1000000) * 10.7639;
    map[oNo].remainingSqFt += sqft;
  });

  let orders = Object.keys(map).map((k) => map[k]).filter((o) => o.remainingQty > 0);
  orders.forEach((o) => {
    o.summaryType = _psOrderType(o.customerName, o.orderRef);
    if (o.summaryType === 'Direct Customer to Factory') o.execName = o.seName || '—';
    else if (o.summaryType === 'Customer Via Branch') o.execName = (orderMap[o.orderRef] && orderMap[o.orderRef].seName) || '—';
    else o.execName = '';
  });
  orders.sort((a, b) => b.rawDate - a.rawDate);
  return { orders: orders, fetchedAt: ordWrap.fetchedAt };
}

// Month-wise plant report — faithful port of getPlantMonthWiseAggregated.
// Factory-bound orders only, bucketed by month, split into the three plant
// categories, with per-order qty/sqft resolved from DO PRODUCTS where present.
const _MW_STATUSES = ['Pending CRR', 'Pending Acc. Approval', 'Pending Plant', 'Under Production', 'Ready for Dispatch', 'Fully Dispatched'];
const _MW_CATS = ['Customer Via Branch', 'Direct Customer to Factory', 'Stock Order'];
const _MW_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function _mwZeroCat() { return { rCount: 0, rQty: 0, rSq: 0, dCount: 0, dQty: 0, dSq: 0, pCount: 0, pQty: 0, pSq: 0 }; }

async function getFmsMonthWise(scope) {
  const [ordWrap, doData] = await Promise.all([_allOrders(false), _loadTab('DO PRODUCTS', false)]);
  let allOrds = ordWrap.orders;
  if (scope) allOrds = _applyFmsScope(allOrds, scope);

  // Per-order received/dispatched qty + sqft from the DO line items.
  const gi = _hindex(doData.headers);
  const oNoIdx = gi('ORDER NUMBER'), qtyIdx = gi('QTY (SHEETS)'), dQtyIdx = gi('DISPATCH QTY'),
    sqmIdx = gi('QTY (SQM)'), lenIdx = gi('LENGTH (MM)'), widIdx = gi('WIDTH (MM)');
  const doMap = {};
  doData.rows.forEach((r) => {
    const oNo = _s(r[oNoIdx]); if (!oNo) return;
    if (!doMap[oNo]) doMap[oNo] = { recvQty: 0, recvSq: 0, dispQty: 0, dispSq: 0 };
    const qty = _num(r[qtyIdx]), dQty = _num(r[dQtyIdx]), sqm = _num(r[sqmIdx]);
    const sqftPerItem = sqm > 0
      ? (sqm * 10.7639) / (qty || 1)
      : (_num(r[lenIdx]) * _num(r[widIdx]) / 1000000) * 10.7639;
    doMap[oNo].recvQty += qty;
    doMap[oNo].recvSq += sqftPerItem * qty;
    doMap[oNo].dispQty += dQty;
    doMap[oNo].dispSq += sqftPerItem * dQty;
  });

  const monthMap = {};
  allOrds.forEach((o) => {
    if (o.orderType !== _FACTORY && o.orderType !== _STOCKF) return;
    if (_MW_STATUSES.indexOf(o.status) === -1) return;

    const d = new Date(o.timestamp || o.deliveryDate);
    if (isNaN(d.getTime())) return;
    const mStr = _MW_MON[d.getMonth()] + ' ' + d.getFullYear();

    if (!monthMap[mStr]) {
      monthMap[mStr] = {
        month: mStr, sortKey: d.getFullYear() * 100 + d.getMonth(),
        ReceivedCount: 0, ReceivedQty: 0, ReceivedSqFt: 0,
        DispatchedCount: 0, DispatchedQty: 0, DispatchedSqFt: 0,
        PendingCount: 0, PendingQty: 0, PendingSqFt: 0,
        cats: _MW_CATS.reduce((a, c) => { a[c] = _mwZeroCat(); return a; }, {})
      };
    }

    // Category: a VIRGO customer with a ref came via a branch, without one it
    // is a stock order; anything else is a direct factory order.
    const hasVirgo = String(o.customerName || '').toUpperCase().indexOf('VIRGO') !== -1;
    const hasRef = String(o.orderRef || '').trim().length > 0;
    const cat = hasVirgo ? (hasRef ? 'Customer Via Branch' : 'Stock Order') : 'Direct Customer to Factory';

    const di = doMap[o.orderNo];
    const oRecvQty = di ? di.recvQty : o.quantityOrdered;
    const oRecvSq = di ? di.recvSq : 0;
    const oDispQty = di ? di.dispQty : o.dispatchedQty;
    const oDispSq = di ? di.dispSq : 0;
    const done = o.status === 'Fully Dispatched';
    const oPendQty = done ? 0 : Math.max(0, oRecvQty - oDispQty);
    const oPendSq = done ? 0 : Math.max(0, oRecvSq - oDispSq);

    const m = monthMap[mStr], c = m.cats[cat];
    m.ReceivedCount++; m.ReceivedQty += oRecvQty; m.ReceivedSqFt += oRecvSq;
    if (done) m.DispatchedCount++; else m.PendingCount++;
    m.DispatchedQty += oDispQty; m.DispatchedSqFt += oDispSq;
    m.PendingQty += oPendQty; m.PendingSqFt += oPendSq;

    c.rCount++; c.rQty += oRecvQty; c.rSq += oRecvSq;
    if (done) c.dCount++; else c.pCount++;
    c.dQty += oDispQty; c.dSq += oDispSq;
    c.pQty += oPendQty; c.pSq += oPendSq;
  });

  const months = Object.keys(monthMap).map((k) => monthMap[k]).sort((a, b) => b.sortKey - a.sortKey);
  return { months: months, fetchedAt: ordWrap.fetchedAt };
}

// Delivery tracking — item-wise view of everything that has been dispatched,
// with its delivery state. Fully-delivered lines drop off after 180 days so
// the queue stays about live work. Read-only: no "mark delivered" action.
const _DLV_STALE_DAYS = 180;
const _DLV_OVERDUE_DAYS = 15;

async function getFmsDelivery(scope) {
  const [ordWrap, doData] = await Promise.all([_allOrders(false), _loadTab('DO PRODUCTS', false)]);
  let allOrds = ordWrap.orders;
  if (scope) allOrds = _applyFmsScope(allOrds, scope);
  const byNo = {};
  allOrds.forEach((o) => { byNo[o.orderNo.toUpperCase()] = o; });

  const gi = _hindex(doData.headers);
  const g = (r, n) => { const i = gi(n); return i === -1 ? '' : (r[i] == null ? '' : r[i]); };

  const now = Date.now();
  const rows = [];
  const stat = { pending: 0, partial: 0, delivered: 0, pendingQty: 0, deliveredQty: 0, overdue: 0 };

  doData.rows.forEach((r) => {
    const orderNo = _s(g(r, 'ORDER NUMBER'));
    if (!orderNo) return;
    const dispQty = _num(g(r, 'DISPATCH QTY'));
    if (dispQty <= 0) return;                       // not dispatched yet

    const ord = byNo[orderNo.toUpperCase()] || {};
    const dlvQty = _num(g(r, 'DELIVERED QTY'));
    const dlvDateRaw = _s(g(r, 'DELIVERED DATE'));
    const statusRaw = _s(g(r, 'DELIVERY STATUS'));

    // Delivered state comes from qty first, falling back to the sheet's label.
    let bucket;
    if (dlvQty >= dispQty && dispQty > 0) bucket = 'delivered';
    else if (dlvQty > 0) bucket = 'partial';
    else bucket = /delivered/i.test(statusRaw) ? 'delivered' : 'pending';

    const dispDate = _parseDate(ord.dispatchDate) || _parseDate(_s(g(r, 'DO DATE')));
    const ageDays = dispDate ? Math.floor((now - dispDate.getTime()) / 86400000) : null;

    // Retire long-settled lines.
    if (bucket === 'delivered') {
      const dd = _parseDate(dlvDateRaw) || dispDate;
      if (dd && (now - dd.getTime()) / 86400000 > _DLV_STALE_DAYS) return;
    }

    const overdue = bucket !== 'delivered' && ageDays !== null && ageDays > _DLV_OVERDUE_DAYS;
    stat[bucket]++;
    if (bucket === 'delivered') stat.deliveredQty += dlvQty;
    else { stat.pendingQty += Math.max(0, dispQty - dlvQty); stat.deliveredQty += dlvQty; }
    if (overdue) stat.overdue++;

    const len = _num(g(r, 'LENGTH (MM)')), wid = _num(g(r, 'WIDTH (MM)'));
    rows.push({
      orderNo: orderNo,
      customer: ord.customerName || _s(g(r, 'CUSTOMER NAME')) || '—',
      branch: ord.branchName || _s(g(r, 'LOCATION')) || '—',
      code: _s(g(r, 'GRADE / COLOUR CODE')),
      batch: _s(g(r, 'BATCH')),
      size: len && wid ? len + ' × ' + wid : '',
      dispatchQty: dispQty,
      dispatchDate: ord.dispatchDate || _s(g(r, 'DO DATE')),
      ageDays: ageDays,
      bucket: bucket,
      overdue: overdue,
      deliveryStatus: statusRaw,
      deliveredQty: dlvQty,
      deliveredDate: dlvDateRaw,
      deliveredBy: _s(g(r, 'DELIVERED BY')),
      remarks: _s(g(r, 'DELIVERY REMARKS'))
    });
  });

  // Oldest dispatches first — those are the ones that need chasing.
  rows.sort((a, b) => (b.ageDays == null ? -1 : b.ageDays) - (a.ageDays == null ? -1 : a.ageDays));
  return { rows: rows, stats: stat, fetchedAt: ordWrap.fetchedAt };
}

// ════════════════════════════════════════════════════════════════════════════
//  ITEMS MASTER API
// ════════════════════════════════════════════════════════════════════════════
async function getItems() {
  const [itemsData, doData] = await Promise.all([
    _loadTab('ITEM MASTER', false),
    _loadTab('DO PRODUCTS', false)
  ]);
  
  const iGi = _hindex(itemsData.headers);
  const codeIdx = iGi('GRADE / COLOUR CODE');
  const lenIdx = iGi('LENGTH (MM)');
  const widIdx = iGi('WIDTH (MM)');
  const rateIdx = iGi('RATE (SQFT)');
  const statIdx = iGi('STATUS');
  const wtIdx = iGi('WEIGHT (KG/SQM)');
  
  const itemsMap = new Map();
  itemsData.rows.forEach(r => {
    const stat = _s(statIdx === -1 ? r[5] : r[statIdx]).toLowerCase(); // fallback to 5th col if header missing
    if (stat !== 'active') return;
    const code = _s(codeIdx === -1 ? r[0] : r[codeIdx]);
    if (code) {
      itemsMap.set(code.toLowerCase(), {
        code: code,
        length: _num(lenIdx === -1 ? r[2] : r[lenIdx]),
        width: _num(widIdx === -1 ? r[3] : r[widIdx]),
        rate: _num(rateIdx === -1 ? r[4] : r[rateIdx]),
        weight: _num(wtIdx === -1 ? r[6] : r[wtIdx])
      });
    }
  });

  const doGi = _hindex(doData.headers);
  const doCodeIdx = doGi('GRADE / COLOUR CODE');
  const doRateIdx = doGi('RATE (SQFT)');
  
  if (doCodeIdx !== -1 && doRateIdx !== -1) {
    doData.rows.forEach(r => {
      const code = _s(r[doCodeIdx]).toLowerCase();
      const rate = _num(r[doRateIdx]);
      if (code && rate && itemsMap.has(code)) {
        itemsMap.get(code).rate = rate;
      }
    });
  }

  return Array.from(itemsMap.values());
}


module.exports = {
  getFmsTable, listFmsTables,
  getFmsOrders, getFmsDashboard, getFmsOrderDetail,
  getFmsPartySummary, getFmsPlantItems, getFmsMonthWise, getFmsDelivery,
  getItems,
  FMS_TABLES, FMS_SHEET_ID
};
