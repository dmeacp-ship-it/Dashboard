/**
 * src/services/loginlog.service.js
 *
 * Sign-in activity behind Settings -> Login Activity: who signs in, when they
 * last used the dashboard, and who never does. Stored in the Supabase
 * `dashboard_login_logs` table and rolled up per username by `vw_login_summary`
 * (db/migrations/13_create_login_logs.sql).
 *
 * Events: login | login_failed | logout | session. `session` is opening the
 * dashboard on a still-valid sign-in -- a sign-in lasts 12 hours, so without it
 * someone who comes back later the same day would look inactive.
 *
 * Writing is best-effort. A log that can't be written (the table not created
 * yet, Supabase slow) must never block or fail a sign-in, so record() swallows
 * its errors and gives up after WRITE_TIMEOUT_MS.
 */

const { supaFetch } = require('./supabase');
const Users = require('./users.service');

const TABLE = 'dashboard_login_logs';
const SUMMARY_VIEW = 'vw_login_summary';
const EVENTS = ['login', 'login_failed', 'logout', 'session'];
const WRITE_TIMEOUT_MS = 2000;
const MAX_ROWS = 1000; // Supabase's PostgREST max-rows cap

// A still-valid session is logged at most this often per user, so refreshing
// the page doesn't write a row each time. The throttle lives in memory: on
// Vercel each warm instance keeps its own, so a busy user can get a few extra
// rows -- never fewer.
const SESSION_EVERY_MS = 30 * 60 * 1000;
const _lastSession = new Map(); // username -> ms

const SETUP_MSG = 'Login activity is not set up yet. Run db/migrations/13_create_login_logs.sql in the Supabase SQL Editor, then refresh.';

function _tableMissing(e) { return e && /PGRST205|Could not find the table|relation .* does not exist|404/i.test(e.message || ''); }
function _clip(v, n) { return (v == null || v === '') ? null : String(v).slice(0, n); }
function _name(v) { return String(v || '').toLowerCase().trim().slice(0, 80); }

let _warnedMissing = false;

/**
 * Writes one event. `who` is a profile ({ id, username, full_name, role }),
 * optionally with `detail`; `meta` is { ip, user_agent }. Never throws.
 */
async function record(event, who, meta) {
  who = who || {};
  meta = meta || {};
  const username = _name(who.username);
  if (EVENTS.indexOf(event) === -1 || !username) return false;
  if (event === 'login' || event === 'session') _lastSession.set(username, Date.now());

  const row = {
    username: username,
    user_id: _clip(who.id, 64),
    full_name: _clip(who.full_name, 120),
    role: _clip(who.role, 32),
    event: event,
    detail: _clip(who.detail, 200),
    ip: _clip(meta.ip, 64),
    user_agent: _clip(meta.user_agent, 400)
  };
  try {
    await supaFetch('/rest/v1/' + TABLE, 'post', row, WRITE_TIMEOUT_MS);
    return true;
  } catch (e) {
    if (_tableMissing(e)) {
      if (!_warnedMissing) { _warnedMissing = true; console.warn('[loginlog] ' + SETUP_MSG); }
    } else {
      console.warn('[loginlog] could not record ' + event + ' for ' + username + ': ' + e.message);
    }
    return false;
  }
}

/** Logs opening the dashboard on a still-valid sign-in, throttled per user. */
async function recordSession(profile, meta) {
  const username = _name(profile && profile.username);
  if (!username) return false;
  const last = _lastSession.get(username);
  if (last && Date.now() - last < SESSION_EVERY_MS) return false;
  return record('session', profile, meta);
}

/**
 * Logs a refused sign-in. The username is looked up so the log can tell a
 * wrong password on a real account from a username that doesn't exist.
 */
async function recordFailure(username, err, meta) {
  const typed = _name(username);
  if (!typed) return false;
  let account = null;
  let lookedUp = false;
  try { account = await Users.findByUsername(typed); lookedUp = true; } catch (e) { /* still log the attempt */ }

  const msg = String((err && err.message) || '');
  const detail = /disabled/i.test(msg) ? 'Account disabled'
    : (lookedUp && !account) ? 'Unknown username'
      : (lookedUp && /^Invalid username or password/i.test(msg)) ? 'Wrong password'
        : (_clip(msg, 200) || 'Sign-in refused');

  return record('login_failed', {
    username: typed,
    id: account && account.id,
    full_name: account && account.full_name,
    role: account && account.role,
    detail: detail
  }, meta);
}

/**
 * Most recent events, newest first. opts: { days (1-366, default 30),
 * username, event, limit (default 500, capped at MAX_ROWS) }.
 * Returns { ready, message?, days, limit, rows }.
 */
async function list(opts) {
  opts = opts || {};
  const days = Math.min(Math.max(parseInt(opts.days, 10) || 30, 1), 366);
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 500, 1), MAX_ROWS);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const parts = [
    'select=id,created_at,username,user_id,full_name,role,event,detail,ip,user_agent',
    'created_at=gte.' + encodeURIComponent(since),
    'order=created_at.desc',
    'limit=' + limit
  ];
  const username = _name(opts.username);
  if (username) parts.push('username=eq.' + encodeURIComponent(username));
  if (EVENTS.indexOf(opts.event) !== -1) parts.push('event=eq.' + opts.event);

  try {
    const rows = await supaFetch('/rest/v1/' + TABLE + '?' + parts.join('&'));
    return { ready: true, days: days, limit: limit, rows: rows || [] };
  } catch (e) {
    if (_tableMissing(e)) return { ready: false, message: SETUP_MSG, days: days, limit: limit, rows: [] };
    throw e;
  }
}

/**
 * One row per dashboard account -- including accounts that have never signed
 * in, which the view can't know about -- with last login, last seen and recent
 * counts. Returns { ready, message?, users }.
 */
async function summary() {
  const users = await Users.list();
  let stats = [];
  let ready = true;
  let message;
  try {
    stats = (await supaFetch('/rest/v1/' + SUMMARY_VIEW + '?select=*')) || [];
  } catch (e) {
    if (!_tableMissing(e)) throw e;
    ready = false;
    message = SETUP_MSG;
  }

  const byName = {};
  stats.forEach(function (s) { byName[_name(s.username)] = s; });

  return {
    ready: ready,
    message: message,
    users: users.map(function (u) {
      const s = byName[_name(u.username)] || {};
      return {
        id: u.id,
        username: u.username,
        full_name: u.full_name,
        role: u.role,
        is_active: u.is_active,
        created_at: u.created_at,
        last_login: s.last_login || null,
        last_seen: s.last_seen || null,
        last_failed: s.last_failed || null,
        logins_7d: Number(s.logins_7d) || 0,
        logins_30d: Number(s.logins_30d) || 0,
        active_days_30d: Number(s.active_days_30d) || 0,
        failed_7d: Number(s.failed_7d) || 0
      };
    })
  };
}

module.exports = { record, recordSession, recordFailure, list, summary, EVENTS };
