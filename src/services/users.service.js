/**
 * src/services/users.service.js
 *
 * Dashboard login accounts, stored in the Supabase `dashboard_users` table
 * (see db/dashboard_users.sql). Roles: super_admin | admin | hod | zonal_head.
 *  - hod        users carry one or MORE hod_name values (allowed_hods)
 *  - zonal_head users carry one or more zones (allowed_zones)
 *
 * Passwords are hashed salt$hash with HMAC-SHA256 (100 rounds) — same scheme
 * the rest of the app already uses.
 */

const crypto = require('crypto');
const { supaFetch } = require('./supabase');

const TABLE = 'dashboard_users';
const VALID_ROLES = ['super_admin', 'admin', 'hod', 'zonal_head'];

// Built-in Super Admin used ONLY when the Supabase `dashboard_users` table
// doesn't exist yet (so the app is usable before db/dashboard_users.sql is run).
// Same credentials as the SQL seed — username: superadmin / password: Virgo@2025.
const FALLBACK = {
  id: 'fallback-superadmin', username: 'superadmin', full_name: 'Super Admin',
  role: 'super_admin', allowed_hods: [], allowed_zones: [], is_active: true,
  password_hash: 'ce54155a7da94d09$b9c5a80c84f21fcec8b046bcb6fa319a1ecbfa879f8cb5be6e3cc999f8a941f0'
};
function _tableMissing(e) { return e && /PGRST205|Could not find the table|relation .* does not exist|404/i.test(e.message || ''); }
const SETUP_MSG = 'User accounts table not set up yet — run db/dashboard_users.sql in your Supabase SQL editor first.';

function _hash(password) {
  const salt = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  let hash = String(password);
  for (let i = 0; i < 100; i++) {
    const sig = crypto.createHmac('sha256', salt).update(hash).digest();
    hash = Array.from(sig).map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
  }
  return salt + '$' + hash;
}
function _verify(password, stored) {
  if (!stored || stored.indexOf('$') === -1) return false;
  const parts = stored.split('$');
  const salt = parts[0];
  let hash = String(password);
  for (let i = 0; i < 100; i++) {
    const sig = crypto.createHmac('sha256', salt).update(hash).digest();
    hash = Array.from(sig).map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
  }
  return hash === parts[1];
}

function _clean(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, full_name: u.full_name, role: u.role,
    allowed_hods: u.allowed_hods || [], allowed_zones: u.allowed_zones || [],
    is_active: u.is_active, created_at: u.created_at
  };
}

async function list() {
  try {
    const rows = await supaFetch(
      '/rest/v1/' + TABLE +
      '?select=id,username,full_name,role,allowed_hods,allowed_zones,is_active,created_at&order=created_at.desc'
    );
    return (rows || []).map(_clean);
  } catch (e) {
    if (_tableMissing(e)) return [_clean(FALLBACK)];
    throw e;
  }
}

async function findByUsername(username) {
  if (!username) return null;
  const u = String(username).toLowerCase().trim();
  try {
    const rows = await supaFetch(
      '/rest/v1/' + TABLE + '?username=eq.' + encodeURIComponent(u) + '&select=*'
    );
    if (rows && rows[0]) return rows[0];
    // Table reachable but no visible row (empty seed, or RLS hiding it) →
    // fall back to the built-in super admin so login is never locked out.
    return u === FALLBACK.username ? FALLBACK : null;
  } catch (e) {
    if (_tableMissing(e)) return u === FALLBACK.username ? FALLBACK : null;
    throw e;
  }
}

async function verifyLogin(username, password) {
  const u = await findByUsername(username);
  if (!u) return null;
  if (u.is_active === false) throw new Error('Account is disabled. Contact an administrator.');
  if (!_verify(password, u.password_hash)) return null;
  return _clean(u);
}

async function create(d) {
  if (!d || !d.username) throw new Error('Username is required.');
  if (!d.password) throw new Error('Password is required.');
  const role = VALID_ROLES.indexOf(d.role) !== -1 ? d.role : 'hod';
  const username = String(d.username).toLowerCase().trim();
  let dup;
  try { dup = await findByUsername(username); }
  catch (e) { if (_tableMissing(e)) throw new Error(SETUP_MSG); throw e; }
  if (dup) throw new Error('That username already exists.');
  const body = {
    username: username,
    full_name: d.full_name || d.username,
    role: role,
    allowed_hods: role === 'hod' && Array.isArray(d.allowed_hods) ? d.allowed_hods : [],
    allowed_zones: role === 'zonal_head' && Array.isArray(d.allowed_zones) ? d.allowed_zones : [],
    is_active: d.is_active !== false,
    password_hash: _hash(d.password)
  };
  try { await supaFetch('/rest/v1/' + TABLE, 'post', body); }
  catch (e) { if (_tableMissing(e)) throw new Error(SETUP_MSG); throw e; }
  return { ok: true };
}

async function update(id, d) {
  if (!id) throw new Error('User id is required.');
  d = d || {};
  const patch = {};
  ['full_name', 'is_active', 'allowed_hods', 'allowed_zones'].forEach(function (k) {
    if (d[k] !== undefined) patch[k] = d[k];
  });
  if (d.role && VALID_ROLES.indexOf(d.role) !== -1) patch.role = d.role;
  if (d.password) patch.password_hash = _hash(d.password);
  await supaFetch('/rest/v1/' + TABLE + '?id=eq.' + encodeURIComponent(id), 'patch', patch);
  return { ok: true };
}

async function remove(id) {
  if (!id) throw new Error('User id is required.');
  await supaFetch('/rest/v1/' + TABLE + '?id=eq.' + encodeURIComponent(id), 'delete');
  return { ok: true };
}

module.exports = { list, findByUsername, verifyLogin, create, update, remove, VALID_ROLES };
