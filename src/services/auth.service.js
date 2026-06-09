/**
 * src/services/auth.service.js
 *
 * Username + password login backed by the Supabase `dashboard_users` table,
 * issuing stateless signed session tokens (see session.js). The token carries
 * the user's role + data scope (allowed_hods / allowed_zones) so the API can
 * enforce restrictions without a per-request DB lookup.
 *
 * Roles: super_admin | admin | hod | zonal_head
 */

const Session = require('./session');
const Users = require('./users.service');

function _profile(p) {
  return {
    id: p.id,
    username: p.username,
    full_name: p.full_name,
    role: p.role,
    allowed_hods: p.allowed_hods || [],
    allowed_zones: p.allowed_zones || []
  };
}

async function login(username, password) {
  if (!username || !password) throw new Error('Username and password are required.');
  const user = await Users.verifyLogin(username, password);
  if (!user) throw new Error('Invalid username or password.');
  const profile = _profile(user);
  return { token: Session.sign(profile), profile: profile };
}

async function logout() { return { ok: true }; }

// Open: returns the profile for a token, or null if missing/expired (no throw).
function tryProfile(token) {
  const p = Session.verify(token);
  return p ? _profile(p) : null;
}

// Secure: throws AUTH_REQUIRED if the token is missing/invalid/expired.
function requireAuth(token) {
  const p = Session.verify(token);
  if (!p) throw new Error('AUTH_REQUIRED: Please sign in.');
  return _profile(p);
}

async function getProfile(token) { return tryProfile(token); }

async function listUsers() { return Users.list(); }
async function createUser(data) { return Users.create(data); }
async function updateUser(id, data) { return Users.update(id, data); }
async function deleteUser(id) { return Users.remove(id); }

module.exports = {
  login, logout, getProfile, tryProfile, requireAuth,
  listUsers, createUser, updateUser, deleteUser
};
