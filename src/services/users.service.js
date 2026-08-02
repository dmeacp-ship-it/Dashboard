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

// Emergency-only built-in Super Admin, for bootstrapping a deployment before
// db/dashboard_users.sql has been run. Its credentials are published in this
// repo, so it is DISABLED unless ALLOW_FALLBACK_ADMIN=1 is set explicitly.
// Never enable it on a deployment that has a populated dashboard_users table.
const FALLBACK = {
  id: 'fallback-superadmin', username: 'superadmin', full_name: 'Super Admin',
  role: 'super_admin', allowed_hods: [], allowed_zones: [], is_active: true,
  password_hash: 'ce54155a7da94d09$b9c5a80c84f21fcec8b046bcb6fa319a1ecbfa879f8cb5be6e3cc999f8a941f0'
};
function _fallbackEnabled() { return process.env.ALLOW_FALLBACK_ADMIN === '1'; }
function _fallbackFor(u) { return (_fallbackEnabled() && u === FALLBACK.username) ? FALLBACK : null; }

function _tableMissing(e) { return e && /PGRST205|Could not find the table|relation .* does not exist|404/i.test(e.message || ''); }
const SETUP_MSG = 'User accounts table not set up yet — run db/dashboard_users.sql in your Supabase SQL editor first.';

// ── Password hashing ────────────────────────────────────────────────────────
// Current scheme: scrypt (memory-hard, ~100ms/attempt).
//   format: scrypt$N$r$p$saltHex$hashHex
// Legacy scheme (pre-hardening): 100 rounds of HMAC-SHA256 over a hex string,
//   format: saltHex$hashHex
// _verify accepts both so existing accounts keep working; verifyLogin then
// transparently re-hashes a legacy password to scrypt on the next successful
// sign-in, so the old format drains away without anyone resetting a password.

const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, SCRYPT_KEYLEN = 64;

function _scrypt(password, salt, N, r, p, keylen) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, keylen, { N: N, r: r, p: p, maxmem: 256 * 1024 * 1024 },
      (err, dk) => (err ? reject(err) : resolve(dk)));
  });
}

async function _hash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const dk = await _scrypt(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P, SCRYPT_KEYLEN);
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt, dk.toString('hex')].join('$');
}

function _timingSafeEq(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function _verifyLegacy(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 2) return false;
  const salt = parts[0];
  let hash = String(password);
  for (let i = 0; i < 100; i++) {
    const sig = crypto.createHmac('sha256', salt).update(hash).digest();
    hash = Array.from(sig).map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
  }
  return _timingSafeEq(hash, parts[1]);
}

/** True if `stored` uses the retired HMAC format and should be re-hashed. */
function _isLegacyHash(stored) {
  return !!stored && String(stored).indexOf('scrypt$') !== 0 && String(stored).indexOf('$') !== -1;
}

async function _verify(password, stored) {
  if (!stored || String(stored).indexOf('$') === -1) return false;
  if (String(stored).indexOf('scrypt$') !== 0) return _verifyLegacy(password, stored);

  const p = String(stored).split('$'); // scrypt,N,r,p,salt,hash
  if (p.length !== 6) return false;
  const N = parseInt(p[1], 10), r = parseInt(p[2], 10), pp = parseInt(p[3], 10);
  const salt = p[4], expected = p[5];
  if (!N || !r || !pp || !salt || !expected) return false;
  try {
    const dk = await _scrypt(password, salt, N, r, pp, expected.length / 2);
    return _timingSafeEq(dk.toString('hex'), expected);
  } catch (e) {
    return false;
  }
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
    if (_tableMissing(e)) return _fallbackEnabled() ? [_clean(FALLBACK)] : [];
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
    // Table reachable but no matching row. Previously this silently fell back
    // to the built-in super admin, which meant deleting (or RLS-hiding) the
    // superadmin row re-enabled a password published in this repo. Now the
    // fallback only applies when explicitly enabled.
    return _fallbackFor(u);
  } catch (e) {
    if (_tableMissing(e)) return _fallbackFor(u);
    throw e;
  }
}

async function verifyLogin(username, password) {
  const u = await findByUsername(username);
  if (!u) return null;
  if (u.is_active === false) throw new Error('Account is disabled. Contact an administrator.');
  if (!(await _verify(password, u.password_hash))) return null;

  // Transparent upgrade: the password was correct, so re-hash it with the
  // current scheme and store that. Best-effort — a failure here must never
  // block a valid sign-in, it just means we retry on the next login.
  if (_isLegacyHash(u.password_hash) && u.id !== FALLBACK.id) {
    try {
      const upgraded = await _hash(password);
      await supaFetch('/rest/v1/' + TABLE + '?id=eq.' + encodeURIComponent(u.id), 'patch',
        { password_hash: upgraded });
    } catch (e) {
      console.warn('[users] password re-hash failed for ' + u.username + ': ' + e.message);
    }
  }

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
    password_hash: await _hash(d.password)
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
  if (d.password) patch.password_hash = await _hash(d.password);
  await supaFetch('/rest/v1/' + TABLE + '?id=eq.' + encodeURIComponent(id), 'patch', patch);
  return { ok: true };
}

async function remove(id) {
  if (!id) throw new Error('User id is required.');
  await supaFetch('/rest/v1/' + TABLE + '?id=eq.' + encodeURIComponent(id), 'delete');
  return { ok: true };
}

/**
 * Confirms `password` is the current password for user `id`. Used to gate
 * self-serve password changes so a stolen session token alone can't take
 * permanent ownership of an account.
 */
async function verifyCurrentPassword(id, password) {
  if (!id || !password) return false;
  let rows;
  try {
    rows = await supaFetch(
      '/rest/v1/' + TABLE + '?id=eq.' + encodeURIComponent(id) + '&select=id,password_hash'
    );
  } catch (e) {
    // Fail closed, and never surface the raw DB error — a malformed id would
    // otherwise echo a Postgres message straight back to the client.
    console.warn('[users] verifyCurrentPassword lookup failed: ' + e.message);
    return false;
  }
  if (!rows || !rows[0]) return false;
  return _verify(password, rows[0].password_hash);
}

module.exports = {
  list, findByUsername, verifyLogin, create, update, remove,
  verifyCurrentPassword, VALID_ROLES
};
