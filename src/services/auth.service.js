/**
 * src/services/auth.service.js
 *
 * Faithful port of the AuthService IIFE from Service.gs.
 * Utilities.computeHmacSha256Signature -> crypto.createHmac (key=salt, msg=hash),
 * so password hashes remain byte-compatible with the original.
 *
 * NOTE: like the original, requireAuth()/getProfile() return a fixed bypass
 * super-admin profile — server-side data scoping is therefore unrestricted,
 * exactly mirroring the Apps Script behaviour.
 */

const crypto = require('crypto');
const { supaFetch } = require('./supabase');
const { DB_TABLES, ROLES } = require('../config');

const BYPASS_PROFILE = {
  id: 'bypass-001',
  full_name: 'Admin User',
  email: 'admin@virgoasia.com',
  role: ROLES.SUPER_ADMIN,
  hod_name: null,
  allowed_states: null,
  is_active: true
};

function _hashPassword(password) {
  const salt = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  let hash = password;
  for (let i = 0; i < 100; i++) {
    const sig = crypto.createHmac('sha256', salt).update(hash).digest();
    hash = Array.from(sig).map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
  }
  return salt + '$' + hash;
}

function _verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 2) return false;
  const salt = parts[0];
  let hash = password;
  for (let i = 0; i < 100; i++) {
    const sig = crypto.createHmac('sha256', salt).update(hash).digest();
    hash = Array.from(sig).map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
  }
  return hash === parts[1];
}

async function login(email, password) {
  if (!email || !password) return BYPASS_PROFILE;

  const users = await supaFetch(
    '/rest/v1/' + DB_TABLES.PROFILES + '?email=eq.' + encodeURIComponent(email.toLowerCase().trim()),
    'get'
  );
  if (!users || users.length === 0) throw new Error('Invalid credentials.');
  const user = users[0];

  if (!user.is_active) throw new Error('Account disabled.');
  if (!_verifyPassword(password, user.password_hash)) throw new Error('Invalid credentials.');

  return {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    role: user.role,
    hod_name: user.hod_name,
    allowed_states: user.allowed_states,
    is_active: user.is_active
  };
}

async function logout() { return { ok: true }; }
async function getProfile() { return BYPASS_PROFILE; }
async function requireAuth() { return BYPASS_PROFILE; }

async function listUsers() {
  return (await supaFetch(
    '/rest/v1/' + DB_TABLES.PROFILES +
    '?select=id,full_name,email,role,hod_name,allowed_states,is_active,created_at' +
    '&order=created_at.desc',
    'get'
  )) || [];
}

async function createUser(data) {
  if (!data.email || !data.full_name) throw new Error('Email and full name are required.');
  if (!data.password) throw new Error('Password is required.');

  return supaFetch('/rest/v1/' + DB_TABLES.PROFILES, 'post', {
    full_name: data.full_name,
    email: data.email.toLowerCase().trim(),
    role: data.role || ROLES.VIEWER,
    hod_name: data.hod_name || null,
    allowed_states: data.allowed_states || null,
    is_active: true,
    password_hash: _hashPassword(data.password),
    auth_user_id: null
  });
}

async function updateUser(profileId, data) {
  const allowed = ['full_name', 'role', 'hod_name', 'allowed_states', 'is_active'];
  const patch = {};
  allowed.forEach(function (k) { if (data[k] !== undefined) patch[k] = data[k]; });
  if (data.password) patch.password_hash = _hashPassword(data.password);

  return supaFetch(
    '/rest/v1/' + DB_TABLES.PROFILES + '?id=eq.' + encodeURIComponent(profileId),
    'patch',
    patch
  );
}

module.exports = {
  login,
  logout,
  getProfile,
  requireAuth,
  listUsers,
  createUser,
  updateUser
};
