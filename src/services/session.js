/**
 * src/services/session.js
 *
 * Stateless signed session tokens (HMAC-SHA256). No server-side session store,
 * so it works on serverless. Token = base64url(payload).base64url(signature).
 * Payload carries the user's scope (role + allowed_hods + allowed_zones) so the
 * API can apply data restrictions without a DB lookup per request.
 */

const crypto = require('crypto');

function _secret() {
  return (
    process.env.SESSION_SECRET ||
    (process.env.SUPABASE_KEY ? 'sk-' + process.env.SUPABASE_KEY.slice(-40) : '') ||
    'virgo-acp-dashboard-default-session-secret'
  );
}

function _b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function _b64uDecode(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(s, 'base64').toString('utf8');
}

function sign(profile, ttlHours) {
  ttlHours = ttlHours || 12;
  const payload = Object.assign({}, profile, { exp: Date.now() + ttlHours * 3600000 });
  const body = _b64u(JSON.stringify(payload));
  const sig = _b64u(crypto.createHmac('sha256', _secret()).update(body).digest());
  return body + '.' + sig;
}

function verify(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return null;
  const idx = token.indexOf('.');
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expect = _b64u(crypto.createHmac('sha256', _secret()).update(body).digest());
  // length-safe constant comparison
  if (sig.length !== expect.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expect.charCodeAt(i);
  if (diff !== 0) return null;
  let p;
  try { p = JSON.parse(_b64uDecode(body)); } catch (e) { return null; }
  if (!p || !p.exp || Date.now() > p.exp) return null;
  return p;
}

module.exports = { sign, verify };
