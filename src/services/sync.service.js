/**
 * src/services/sync.service.js
 *
 * Faithful port of the sync engine from Main.gs:
 *   - processAggregation(options)   resumable, polled Sheets -> Supabase sync
 *   - syncOutstandingData()         Customer Master -> outstanding_master
 *   - syncTargetData()              Target sheet    -> target_master
 *
 * GAS mappings:
 *   SpreadsheetApp        -> googleapis (service account, read-only)
 *   UrlFetchApp           -> node-fetch
 *   PropertiesService     -> in-memory SYNC_STATE (sync cursor) + process.env
 *   CacheService          -> cache.service.invalidateAll()
 *
 * Resumable cursor: the front-end round-trips `nextToken`, so the {sheetIndex,
 * startRow} state survives across polls even on stateless hosts.
 */

const crypto = require('crypto');
const { google } = require('googleapis');
const fetch = require('node-fetch');
const { invalidateAll } = require('./cache.service');
const {
  CONFIG, DB_TABLES, COLUMN_MAP, SYNC_CONFIG,
  OUTSTANDING_CONFIG, OUTSTANDING_COLUMN_MAP,
  TARGET_CONFIG, TARGET_COLUMN_MAP,
  getSupabaseUrl, getSupabaseKey
} = require('../config');
const SettingsService = require('./settings.service');

// In-memory replacements for PropertiesService sync cursor + sheet cache.
const SYNC_STATE = {};       // SYNC_SHEET_INDEX / SYNC_LAST_ROW
const SHEET_CACHE = new Map(); // spreadsheetId -> { headers, rows, totalRows }

let _googleAuth = null;
function getGoogleAuth() {
  if (_googleAuth) return _googleAuth;
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!keyJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON missing (share each sheet with the service account email).');
  const credentials = JSON.parse(keyJson);
  _googleAuth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  return _googleAuth;
}

// Loads (and caches) a sheet's values. Mirrors getValues(): headers = row 1,
// rows = data rows (sheet row 2+), totalRows = data row count.
async function _loadSheet(spreadsheetId, sheetName) {
  if (SHEET_CACHE.has(spreadsheetId)) return SHEET_CACHE.get(spreadsheetId);
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  let values = [];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: sheetName,
      valueRenderOption: 'FORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING'
    });
    values = res.data.values || [];
  } catch (e) {
    throw new Error('Could not open spreadsheet/tab "' + sheetName + '": ' + e.message);
  }
  if (!values.length) {
    const empty = { headers: [], rows: [], totalRows: 0 };
    SHEET_CACHE.set(spreadsheetId, empty);
    return empty;
  }
  const headers = values[0].map((h) => String(h).trim());
  const rows = values.slice(1);
  const out = { headers, rows, totalRows: rows.length };
  SHEET_CACHE.set(spreadsheetId, out);
  return out;
}

async function fetchSheetHeaders(spreadsheetId, sheetName) {
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!1:1`,
      valueRenderOption: 'UNFORMATTED_VALUE'
    });
    const values = res.data.values || [];
    if (!values.length) return [];
    return values[0].map(h => String(h).trim()).filter(Boolean);
  } catch (e) {
    throw new Error(`Could not fetch headers for ${sheetName}: ` + e.message);
  }
}

async function fetchSheetTabs(spreadsheetId) {
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  try {
    const res = await sheets.spreadsheets.get({ spreadsheetId });
    return res.data.sheets.map(s => s.properties.title);
  } catch (e) {
    throw new Error(`Could not fetch tabs for sheet ID ${spreadsheetId}: ` + e.message);
  }
}

// Low-level Supabase REST call returning { code, text } (mirrors UrlFetchApp).
async function _supaRest(pathWithQuery, method, bodyObj, prefer) {
  const url = getSupabaseUrl();
  const key = getSupabaseKey();
  const headers = {
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json'
  };
  if (prefer) headers.Prefer = prefer;
  const opts = { method, headers };
  if (bodyObj !== undefined && bodyObj !== null) opts.body = JSON.stringify(bodyObj);
  const res = await fetch(url + pathWithQuery, opts);
  return { code: res.status, text: await res.text() };
}

function formatDateForSQL(jsDate) {
  if (!jsDate || !(jsDate instanceof Date) || isNaN(jsDate)) return null;
  const y = jsDate.getFullYear();
  const m = String(jsDate.getMonth() + 1).padStart(2, '0');
  const d = String(jsDate.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

// Normalises a sheet date (Date object OR locale string) to Postgres-safe
// ISO yyyy-mm-dd. Sheets read with FORMATTED_VALUE return strings like
// "13-04-2024" (dd-mm-yyyy) which Postgres misreads as mm-dd → out of range.
function _toSqlDate(val) {
  if (val instanceof Date) return formatDateForSQL(val);
  const s = String(val).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/); // yyyy-mm-dd already
  if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);   // dd-mm-yyyy (day first)
  if (m) {
    let d = m[1], mo = m[2], y = m[3];
    if (y.length === 2) y = '20' + y;
    if (parseInt(mo, 10) > 12 && parseInt(d, 10) <= 12) { const t = d; d = mo; mo = t; } // tolerate mm-dd-yyyy
    return y + '-' + mo.padStart(2, '0') + '-' + d.padStart(2, '0');
  }
  const dt = new Date(s);
  return isNaN(dt) ? null : formatDateForSQL(dt);
}

// Plain pipe-join (NOT a digest) — identical to Main.gs _computeRowHash so the
// on_conflict=row_hash dedupe matches any rows the Apps Script already wrote.
function _computeRowHash(rowObj) {
  return [
    rowObj.branch_name || '',
    rowObj.sale_date || '',
    rowObj.customer_code || '',
    rowObj.item_code || '',
    rowObj.batch || '',
    String(rowObj.quantity || 0),
    String(rowObj.net_revenue || 0),
    String(rowObj.sq_ft || 0)
  ].join('|');
}

async function _clearSupabaseTable() {
  const res = await _supaRest(
    '/rest/v1/' + SYNC_CONFIG.TABLE_NAME + '?row_hash=not.is.null',
    'delete', null, 'return=minimal'
  );
  if (res.code >= 400) {
    throw new Error('Table clear failed HTTP ' + res.code + ': ' + res.text.slice(0, 250));
  }
}

async function _finishSync() {
  // 1. Refresh Supabase materialized views (best-effort).
  try {
    await _supaRest('/rest/v1/rpc/refresh_dashboard_views', 'post', {}, null);
  } catch (e) { /* RPC may not exist */ }

  // 2. Invalidate server-side cache.
  invalidateAll();

  // 3. Report final row count.
  let rowCount = '?';
  try {
    const url = getSupabaseUrl();
    const key = getSupabaseKey();
    const res = await fetch(url + '/rest/v1/' + SYNC_CONFIG.TABLE_NAME + '?select=id&limit=1', {
      method: 'HEAD',
      headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'count=exact' }
    });
    const rng = res.headers.get('content-range') || '';
    const m = rng.match(/\/(\d+)/);
    if (m) rowCount = parseInt(m[1], 10).toLocaleString('en-IN');
  } catch (e) { /* ignore */ }

  SHEET_CACHE.clear();
  return { status: 'COMPLETE', progress: 100, message: '✓ Sync complete!  ' + rowCount + ' rows now in database.' };
}

async function processAggregation(options) {
  options = options || {};
  const mode = options.mode || 'resume';

  if (mode === 'reset') {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) throw new Error('SUPABASE_URL or SUPABASE_KEY missing.');
    await _clearSupabaseTable();
    delete SYNC_STATE.SYNC_SHEET_INDEX;
    delete SYNC_STATE.SYNC_LAST_ROW;
    SHEET_CACHE.clear();
  }

  const settings = await SettingsService.getSettings();
  const sources = (settings && settings.SOURCE_SHEETS && settings.SOURCE_SHEETS.length > 0) ? settings.SOURCE_SHEETS : CONFIG.SOURCE_SHEETS;
  const totalSheets = sources.length;

  const state = options.token ? JSON.parse(options.token) : null;
  const sheetIndex = state ? state.sheetIndex : parseInt(SYNC_STATE.SYNC_SHEET_INDEX || '0', 10);
  const startRow = state ? state.startRow : parseInt(SYNC_STATE.SYNC_LAST_ROW || '2', 10);

  if (sheetIndex >= totalSheets) {
    return { status: 'COMPLETE', progress: 100, message: 'All sheets already synced.' };
  }

  const source = sources[sheetIndex];
  const sheetName = source.name || CONFIG.RAW_SHEET_NAME;
  const sheet = await _loadSheet(source.id, sheetName);
  const headers = sheet.headers;
  const totalRows = sheet.totalRows;

  if (totalRows <= 0 || startRow > totalRows + 1) {
    const nextIdx = sheetIndex + 1;
    SYNC_STATE.SYNC_SHEET_INDEX = String(nextIdx);
    SYNC_STATE.SYNC_LAST_ROW = '2';
    const pct = Math.round((nextIdx / totalSheets) * 99);
    if (nextIdx >= totalSheets) return _finishSync();
    return {
      status: 'POLLING',
      progress: pct,
      message: 'Finished ' + source.fy + ', moving to next…',
      nextToken: JSON.stringify({ sheetIndex: nextIdx, startRow: 2 })
    };
  }

  const rowsToFetch = Math.min(SYNC_CONFIG.BATCH_SIZE, (totalRows + 2) - startRow);
  const data = sheet.rows.slice(startRow - 2, startRow - 2 + rowsToFetch);

  const numericCols = ['quantity', 'net_revenue', 'revenue_with_gst', 'total_sqm', 'sq_ft', 'length_mm', 'width_mm'];
  const payload = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowObj = {};
    let hasData = false;

    for (let j = 0; j < headers.length; j++) {
      const headerName = String(headers[j]).trim();
      const sqlColumn = COLUMN_MAP[headerName];
      if (sqlColumn) {
        let val = row[j];
        if (val !== '' && val !== null && val !== undefined) {
          if (sqlColumn === 'sale_date' || sqlColumn.slice(-5) === '_date') {
            val = _toSqlDate(val);
          } else if (val instanceof Date) {
            val = formatDateForSQL(val);
          } else if (numericCols.indexOf(sqlColumn) !== -1) {
            const parsed = parseFloat(String(val).replace(/,/g, '').trim());
            val = isNaN(parsed) ? 0 : parsed;
          } else {
            val = String(val).trim();
          }
          rowObj[sqlColumn] = val;
          hasData = true;
        } else {
          rowObj[sqlColumn] = null;
        }
      }
    }

    if (hasData) {
      if (!rowObj.fy_year) rowObj.fy_year = source.fy.replace(/\s/g, '-');
      rowObj.row_hash = _computeRowHash(rowObj);
      payload.push(rowObj);
    }
  }

  if (payload.length > 0) {
    const res = await _supaRest(
      '/rest/v1/' + SYNC_CONFIG.TABLE_NAME + '?on_conflict=row_hash',
      'post', payload, 'resolution=ignore-duplicates,return=minimal'
    );
    if (res.code >= 300) throw new Error('Supabase upload error: ' + res.text);
  }

  const nextStartRow = startRow + rowsToFetch;
  const sheetDone = nextStartRow > totalRows + 1;
  const sheetPct = sheetDone ? 1 : (nextStartRow - 2) / totalRows;
  const overallPct = Math.min(99, Math.round(((sheetIndex + sheetPct) / totalSheets) * 99));

  if (sheetDone) {
    const nextIdx = sheetIndex + 1;
    SYNC_STATE.SYNC_SHEET_INDEX = String(nextIdx);
    SYNC_STATE.SYNC_LAST_ROW = '2';
    if (nextIdx >= totalSheets) return _finishSync();
    return {
      status: 'POLLING',
      progress: overallPct,
      message: 'Finished ' + source.fy + ' ✓  Moving to ' + sources[nextIdx].fy + '…',
      nextToken: JSON.stringify({ sheetIndex: nextIdx, startRow: 2 })
    };
  }

  SYNC_STATE.SYNC_LAST_ROW = String(nextStartRow);
  return {
    status: 'POLLING',
    progress: overallPct,
    message: source.fy + ': synced ' + (nextStartRow - 2) + ' of ' + totalRows + ' rows…',
    nextToken: JSON.stringify({ sheetIndex: sheetIndex, startRow: nextStartRow })
  };
}

// ════════════════════════════════════════════════════════════════════════════
// OUTSTANDING MASTER SYNC
// ════════════════════════════════════════════════════════════════════════════
async function syncOutstandingData() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    return { status: 'ERROR', message: 'Supabase credentials missing.' };
  }

  const settings = await SettingsService.getSettings();
  const sheetId = (settings && settings.OUTSTANDING_SHEET_ID) ? settings.OUTSTANDING_SHEET_ID : OUTSTANDING_CONFIG.SHEET_ID;
  const sheetName = (settings && settings.OUTSTANDING_SHEET_NAME) ? settings.OUTSTANDING_SHEET_NAME : OUTSTANDING_CONFIG.SHEET_NAME;

  let sheet;
  try {
    sheet = await _loadSheetFresh(sheetId, sheetName);
  } catch (e) {
    return { status: 'ERROR', message: 'Cannot open outstanding sheet: ' + e.message };
  }
  if (!sheet.totalRows) return { status: 'OK', message: 'No data rows in outstanding sheet.' };

  const headers = sheet.headers;
  const data = sheet.rows;

  function _normalise(s) {
    return String(s).replace(/₹/g, '').replace(/\(.*?\)/g, '').trim().toUpperCase();
  }
  const NORM_MAP = {};
  Object.keys(OUTSTANDING_COLUMN_MAP).forEach(function (k) { NORM_MAP[_normalise(k)] = OUTSTANDING_COLUMN_MAP[k]; });

  const headerCols = headers.map(function (h) {
    const exact = OUTSTANDING_COLUMN_MAP[String(h).trim()];
    if (exact) return exact;
    return NORM_MAP[_normalise(h)] || null;
  });

  const numericCols = ['credit_limit', 'current_outstanding', 'below_45_days', 'above_45_days', 'days_90_plus'];
  const payload = [];

  data.forEach(function (row) {
    const rowObj = {};
    let hasCode = false;
    headerCols.forEach(function (col, j) {
      if (!col) return;
      const val = row[j];
      if (col === 'customer_code' && val) hasCode = true;
      if (val === '' || val === null || val === undefined) {
        rowObj[col] = numericCols.indexOf(col) !== -1 ? 0 : null;
      } else if (numericCols.indexOf(col) !== -1) {
        const n = parseFloat(String(val).replace(/[₹,\s]/g, ''));
        rowObj[col] = isNaN(n) ? 0 : n;
      } else if (col.slice(-5) === '_date' || col === 'last_updated_src') {
        rowObj[col] = _toSqlDate(val);
      } else if (val instanceof Date) {
        rowObj[col] = formatDateForSQL(val);
      } else {
        rowObj[col] = String(val).trim();
      }
    });
    if (hasCode && rowObj.customer_code) {
      rowObj.synced_at = new Date().toISOString();
      payload.push(rowObj);
    }
  });

  // Deduplicate by customer_code (last one wins) to prevent Postgres ON CONFLICT errors
  const dedupedMap = {};
  payload.forEach(function(row) {
      dedupedMap[row.customer_code] = row;
  });
  const finalPayload = Object.values(dedupedMap);

  if (!finalPayload.length) return { status: 'OK', message: 'No valid rows with customer codes.' };

  const BATCH = 500;
  let errors = 0;
  let firstError = '';
  for (let i = 0; i < finalPayload.length; i += BATCH) {
    const batch = finalPayload.slice(i, i + BATCH);
    const res = await _supaRest(
      '/rest/v1/' + OUTSTANDING_CONFIG.TABLE_NAME + '?on_conflict=customer_code',
      'post', batch, 'resolution=merge-duplicates,return=minimal'
    );
    if (res.code >= 300) {
      errors++;
      if (!firstError) firstError = 'HTTP ' + res.code + ': ' + res.text.slice(0, 300);
    }
  }

  invalidateAll();
  const msg = errors
    ? 'SYNC ERROR (' + errors + '/' + Math.ceil(finalPayload.length / BATCH) + ' batches failed): ' + firstError
    : 'Synced ' + finalPayload.length + ' outstanding records successfully.';
  return { status: errors ? 'ERROR' : 'OK', message: msg, count: finalPayload.length, errors: errors };
}

// ════════════════════════════════════════════════════════════════════════════
// SALES EXECUTIVE TARGET SYNC
// ════════════════════════════════════════════════════════════════════════════
async function syncTargetData() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    return { status: 'ERROR', message: 'Supabase credentials missing.' };
  }

  const settings = await SettingsService.getSettings();
  const sheetId = (settings && settings.TARGET_SHEET_ID) ? settings.TARGET_SHEET_ID : TARGET_CONFIG.SHEET_ID;
  const sheetName = (settings && settings.TARGET_SHEET_NAME) ? settings.TARGET_SHEET_NAME : TARGET_CONFIG.SHEET_NAME;

  let sheet;
  try {
    sheet = await _loadSheetFresh(sheetId, sheetName);
  } catch (e) {
    return { status: 'ERROR', message: 'Cannot open target sheet: ' + e.message };
  }
  if (!sheet.totalRows) return { status: 'OK', message: 'No data rows in target sheet.' };

  const headers = sheet.headers;
  const data = sheet.rows;
  const payload = [];

  data.forEach(function (row) {
    const rowObj = {};
    let hasEmployee = false;

    Object.keys(TARGET_COLUMN_MAP).forEach(function (sheetCol) {
      const idx = headers.indexOf(sheetCol);
      if (idx !== -1) {
        let val = row[idx];
        const sqlCol = TARGET_COLUMN_MAP[sheetCol];
        if (sqlCol === 'employee_name' && val) hasEmployee = true;

        if (val === '' || val === null || val === undefined) {
          rowObj[sqlCol] = (sqlCol === 'target_sqft' || sqlCol === 'achievement') ? 0 : null;
        } else if (sqlCol === 'month_name') {
          if (val instanceof Date) {
            const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
            rowObj[sqlCol] = months[val.getMonth()];
          } else {
            let mStr = String(val).trim();
            rowObj[sqlCol] = mStr.length >= 3 ? mStr.substring(0, 3).toUpperCase() : mStr;
          }
        } else if (sqlCol === 'target_sqft' || sqlCol === 'achievement') {
          const n = parseFloat(String(val).replace(/[₹,\s]/g, ''));
          rowObj[sqlCol] = isNaN(n) ? 0 : n;
        } else {
          rowObj[sqlCol] = String(val).trim();
        }
      }
    });

    if (hasEmployee) {
      rowObj.row_hash = crypto.createHash('md5').update(JSON.stringify(rowObj)).digest('hex');
      rowObj.synced_at = new Date().toISOString();
      payload.push(rowObj);
    }
  });

  if (!payload.length) return { status: 'OK', message: 'No valid target rows found.' };

  // Hard reset to keep a 1:1 mapping with the sheet.
  try {
    await _supaRest('/rest/v1/' + TARGET_CONFIG.TABLE_NAME + '?fy_year=not.is.null', 'delete', null, null);
  } catch (e) { /* ignore */ }

  const BATCH = 500;
  let errors = 0;
  let firstError = '';
  for (let i = 0; i < payload.length; i += BATCH) {
    const batch = payload.slice(i, i + BATCH);
    const res = await _supaRest(
      '/rest/v1/' + TARGET_CONFIG.TABLE_NAME + '?on_conflict=row_hash',
      'post', batch, 'resolution=merge-duplicates,return=minimal'
    );
    if (res.code >= 300) {
      errors++;
      if (!firstError) firstError = 'HTTP ' + res.code + ': ' + res.text.slice(0, 300);
    }
  }

  invalidateAll();
  const msg = errors
    ? 'SYNC ERROR (' + errors + ' batches failed): ' + firstError
    : 'Synced ' + payload.length + ' target records successfully.';
  return { status: errors ? 'ERROR' : 'OK', message: msg, count: payload.length, errors: errors };
}

// Outstanding/target syncs always re-read the sheet (not the polling cache).
async function _loadSheetFresh(spreadsheetId, sheetName) {
  SHEET_CACHE.delete(spreadsheetId);
  const out = await _loadSheet(spreadsheetId, sheetName);
  SHEET_CACHE.delete(spreadsheetId);
  return out;
}

module.exports = {
  processAggregation,
  syncOutstandingData,
  syncTargetData,
  fetchSheetData: _loadSheetFresh,
  fetchSheetHeaders,
  fetchSheetTabs
};
