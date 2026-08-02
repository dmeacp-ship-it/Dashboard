/**
 * src/services/ratelimit.js
 *
 * Minimal in-memory fixed-window rate limiter, used to slow credential
 * stuffing against the login endpoint.
 *
 * Scope caveat: state is per-process. On the local Express server that means
 * one shared counter; on Vercel each warm serverless instance keeps its own,
 * so a distributed attacker gets `max` attempts per instance rather than
 * globally. That is a real weakening but still turns an unbounded online
 * guessing attack into a heavily throttled one, with no new infrastructure.
 * For a hard global limit, move this to Supabase or Upstash Redis.
 */

const _buckets = new Map(); // key -> { count, resetAt }
let _lastSweep = Date.now();
const SWEEP_EVERY_MS = 60 * 1000;

function _sweep(now) {
  if (now - _lastSweep < SWEEP_EVERY_MS) return;
  _lastSweep = now;
  for (const [k, b] of _buckets) {
    if (b.resetAt <= now) _buckets.delete(k);
  }
}

/**
 * Records an attempt against `key`.
 * @returns {{allowed: boolean, remaining: number, retryAfterSec: number}}
 */
function hit(key, max, windowMs) {
  const now = Date.now();
  _sweep(now);

  let b = _buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    _buckets.set(key, b);
  }
  b.count++;

  const allowed = b.count <= max;
  return {
    allowed: allowed,
    remaining: Math.max(0, max - b.count),
    retryAfterSec: allowed ? 0 : Math.ceil((b.resetAt - now) / 1000)
  };
}

/** Clears the counter for a key — call after a successful login. */
function reset(key) { _buckets.delete(key); }

/** Best-effort client IP, honouring the proxy header Vercel sets. */
function clientIp(req) {
  const xff = (req.headers && (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For'])) || '';
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = { hit, reset, clientIp };
