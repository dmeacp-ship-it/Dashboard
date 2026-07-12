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
const https = require('https');
const http = require('http');
const { getSupabaseUrl, getSupabaseKey, DB_TABLES } = require('../config');

// Reuse TLS connections across requests (saves a full TCP+TLS handshake per
// call, which dominates latency when paging or fanning out to Supabase).
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
function _agent(url) { return url.startsWith('https') ? httpsAgent : httpAgent; }

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
    agent: _agent(url),
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
  const agent = _agent(url);

  // 1. First page doubles as the count probe: `Prefer: count=exact` makes
  // PostgREST return Content-Range on the data response, so no separate
  // HEAD round-trip is needed.
  const firstRes = await fetch(base + sep + 'offset=0&limit=' + LIMIT, {
    method: 'get',
    agent,
    headers: Object.assign({ Prefer: 'count=exact' }, headers)
  });
  if (firstRes.status >= 400) {
    const text = await firstRes.text();
    throw new Error('Supabase ' + firstRes.status + ': ' + text.slice(0, 200));
  }
  let all = JSON.parse((await firstRes.text()) || '[]');
  if (!Array.isArray(all)) return all;
  if (all.length < LIMIT) return all;

  let totalRows = -1;
  const rng = firstRes.headers.get('content-range') || '';
  const m = rng.match(/\/(\d+)/);
  if (m) totalRows = parseInt(m[1], 10);

  // 2a. Count known -> fetch every page in parallel. Postgres has no stable
  // row order without ORDER BY, so OFFSET pages from separate queries can
  // overlap or skip rows (observed live: duplicated + missing rows). Impose a
  // total order over every column and re-fetch all pages consistently.
  if (totalRows > -1) {
    const cols = Object.keys(all[0] || {});
    const orderQ = (cols.length && !/(?:^|[?&])order=/.test(base))
      ? '&order=' + cols.map(encodeURIComponent).join(',')
      : '';
    const requests = [];
    for (let offset = 0; offset < totalRows; offset += LIMIT) {
      requests.push(
        fetch(base + sep + 'offset=' + offset + '&limit=' + LIMIT + orderQ, { method: 'get', agent, headers })
      );
    }
    const responses = await Promise.all(requests);
    all = [];
    for (const res of responses) {
      if (res.status === 200) {
        const text = await res.text();
        if (text) all = all.concat(JSON.parse(text));
      }
    }
    return all;
  }

  // 2b. Count unknown (e.g. RPC) -> page sequentially until a short page.
  let offset = LIMIT;
  while (true) {
    const res = await fetch(base + sep + 'offset=' + offset + '&limit=' + LIMIT, { method: 'get', agent, headers });
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
      agent: _agent(url),
      headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'count=exact' }
    });
    const rng = res.headers.get('content-range') || '';
    const m = rng.match(/\/(\d+)/);
    return m ? m[1] : '0';
  } catch (e) {
    return '0';
  }
}

module.exports = { supaFetch, fetchAll, getSalesRowCount, keepAliveAgent: _agent };
