/**
 * src/services/supabase.js
 *
 * Faithful port of the Google Apps Script Supabase helpers from Service.gs:
 *   - _supaFetch(path, method, payload)   (single request, returns parsed JSON)
 *   - _fetch(endpoint, qs)                (count-aware paginated bulk read)
 *
 * UrlFetchApp -> fetch.  PropertiesService -> process.env.
 */

const fetch = require('node-fetch');
const { getSupabaseUrl, getSupabaseKey, DB_TABLES } = require('../config');

/**
 * Single Supabase REST request. `path` is relative to the project URL and must
 * include the `/rest/v1/...` prefix (mirrors the original _supaFetch usage).
 * Returns parsed JSON, or null for empty bodies. Throws on HTTP >= 400.
 */
async function supaFetch(path, method, payload) {
  const url = getSupabaseUrl();
  const key = getSupabaseKey();

  const opts = {
    method: method || 'get',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
  };
  if (payload) opts.body = JSON.stringify(payload);

  const res = await fetch(url + path, opts);
  const code = res.status;
  if (code >= 400) {
    const text = await res.text();
    throw new Error('DB error ' + code + ': ' + text.slice(0, 200));
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Count-aware bulk read against a view/table. `endpoint` is the bare relation
 * name (e.g. 'vw_monthly_agg'); `qs` is an optional query string that may or
 * may not start with '?'. Pages through all rows (1000 at a time), fetching
 * pages in parallel when the exact count is known, otherwise sequentially.
 */
async function fetchAll(endpoint, qs) {
  qs = qs || '';
  if (qs && qs[0] !== '?') qs = '?' + qs;

  const url = getSupabaseUrl();
  const key = getSupabaseKey();
  const base = url + '/rest/v1/' + endpoint + qs;
  const sep = qs.indexOf('?') !== -1 ? '&' : '?';
  const LIMIT = 1000;

  const headers = {
    apikey: key,
    Authorization: 'Bearer ' + key,
    Accept: 'application/json'
  };

  // 1. Try to learn the exact row count via a HEAD request.
  let totalRows = -1;
  try {
    const headRes = await fetch(base + sep + 'limit=1', {
      method: 'HEAD',
      headers: Object.assign({ Prefer: 'count=exact' }, headers)
    });
    if (headRes.status < 400) {
      const rng = headRes.headers.get('content-range') || '';
      const m = rng.match(/\/(\d+)/);
      if (m) totalRows = parseInt(m[1], 10);
    }
  } catch (e) {
    /* fall through to sequential paging */
  }

  // 2a. Count known -> fetch every page in parallel.
  if (totalRows > -1) {
    if (totalRows === 0) return [];
    const requests = [];
    for (let offset = 0; offset < totalRows; offset += LIMIT) {
      requests.push(
        fetch(base + sep + 'offset=' + offset + '&limit=' + LIMIT, { method: 'get', headers })
      );
    }
    const responses = await Promise.all(requests);
    let all = [];
    for (const res of responses) {
      if (res.status === 200) {
        const text = await res.text();
        if (text) all = all.concat(JSON.parse(text));
      }
    }
    return all;
  }

  // 2b. Count unknown (e.g. RPC) -> page sequentially until a short page.
  let all = [];
  let offset = 0;
  while (true) {
    const res = await fetch(base + sep + 'offset=' + offset + '&limit=' + LIMIT, { method: 'get', headers });
    if (res.status !== 200) {
      const text = await res.text();
      throw new Error('Supabase ' + res.status + ': ' + text.slice(0, 200));
    }
    const page = JSON.parse((await res.text()) || '[]');
    if (!page || !page.length) break;
    all = all.concat(page);
    if (page.length < LIMIT) break;
    offset += LIMIT;
  }
  return all;
}

/**
 * Exact row count of the sales table via a HEAD/count request.
 * Used by the clearServerCache endpoint. Returns a numeric string ('0' on error).
 */
async function getSalesRowCount() {
  try {
    const url = getSupabaseUrl();
    const key = getSupabaseKey();
    const res = await fetch(url + '/rest/v1/' + DB_TABLES.SALES + '?select=id&limit=1', {
      method: 'HEAD',
      headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'count=exact' }
    });
    const rng = res.headers.get('content-range') || '';
    const m = rng.match(/\/(\d+)/);
    return m ? m[1] : '0';
  } catch (e) {
    return '0';
  }
}

module.exports = { supaFetch, fetchAll, getSalesRowCount };
