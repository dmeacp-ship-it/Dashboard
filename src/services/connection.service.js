const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Connection store. On a normal server the connections live in connections.json
 * at the project root. On read-only/serverless filesystems (e.g. Vercel's
 * /var/task) that file cannot be created or written, so this module:
 *   - NEVER writes on init (reads fall back to the .env defaults), and
 *   - on save, tries each candidate path and falls back to os.tmpdir(),
 *     keeping an in-memory copy so the running instance stays consistent.
 *
 * Note: on serverless hosts, edits made via the Connections UI persist only for
 * the life of the warm instance. For durable config set SUPABASE_URL /
 * SUPABASE_KEY (and optionally CONNECTIONS_PATH) as environment variables.
 */

function _candidatePaths() {
  const list = [];
  if (process.env.CONNECTIONS_PATH) list.push(process.env.CONNECTIONS_PATH);
  list.push(path.join(__dirname, '../../connections.json')); // writable on a normal server
  list.push(path.join(os.tmpdir(), 'acp-connections.json'));  // writable on serverless (ephemeral)
  return list;
}

let _mem = null; // in-process cache

function _defaultDB() {
  return {
    activeId: 'default',
    connections: [{
      id: 'default',
      name: 'Primary Database',
      url: process.env.SUPABASE_URL || '',
      key: process.env.SUPABASE_KEY || ''
    }]
  };
}

function _readDB() {
  if (_mem) return _mem;
  for (const p of _candidatePaths()) {
    try {
      if (p && fs.existsSync(p)) {
        _mem = JSON.parse(fs.readFileSync(p, 'utf-8'));
        return _mem;
      }
    } catch (err) {
      /* corrupt/unreadable — try the next candidate */
    }
  }
  // Nothing on disk: use the .env-derived default WITHOUT writing it (read-only safe).
  _mem = _defaultDB();
  return _mem;
}

function _writeDB(data) {
  _mem = data; // always keep the running instance consistent
  for (const p of _candidatePaths()) {
    try {
      fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
      return;
    } catch (err) {
      /* read-only or no permission — try the next candidate */
    }
  }
  console.warn('[connections] could not persist to disk (read-only FS); kept in memory for this instance.');
}

/** Currently active connection credentials (falls back to env vars). */
function getActiveConnection() {
  const db = _readDB();
  const conn = (db.connections || []).find((c) => c.id === db.activeId);
  if (!conn || (!conn.url && !conn.key)) {
    return { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_KEY };
  }
  return conn;
}

/** All connections + active id. Internal use only — includes real keys. */
function getAllConnections() {
  return _readDB();
}

// ── Key masking ─────────────────────────────────────────────────────────────
// The Supabase key is a service_role credential: it bypasses RLS and grants
// full read/write on the project. It must never reach the browser, so the
// Connections UI is served a mask instead. Any value that still looks like a
// mask (or is blank) on save means "unchanged" and the stored key is kept.
const MASK_CHAR = '•'; // •

function _mask(key) {
  if (!key) return '';
  const tail = String(key).slice(-4);
  return MASK_CHAR.repeat(8) + tail;
}

function _isMask(v) {
  if (!v) return true;                       // blank => unchanged
  return String(v).indexOf(MASK_CHAR) !== -1; // contains a bullet => still masked
}

/**
 * All connections + active id, safe to send to the browser. The `key` field is
 * replaced by a mask; `hasKey` tells the UI whether one is actually stored.
 */
function getAllConnectionsMasked() {
  const db = _readDB();
  return {
    activeId: db.activeId,
    connections: (db.connections || []).map((c) => ({
      id: c.id,
      name: c.name,
      url: c.url,
      key: _mask(c.key),
      hasKey: !!c.key
    }))
  };
}

/**
 * Persist all connections + active id from the UI. A connection whose submitted
 * key is blank or still masked keeps whatever key is already stored for that id,
 * so saving an unrelated field (name/url/active) never wipes the credential.
 */
function saveConnections(data) {
  const existing = _readDB();
  const byId = {};
  (existing.connections || []).forEach((c) => { byId[c.id] = c; });

  const merged = (data.connections || []).map((c) => {
    const prev = byId[c.id];
    const key = _isMask(c.key) ? (prev ? prev.key : '') : c.key;
    return { id: c.id, name: c.name, url: c.url, key: key };
  });

  _writeDB({ activeId: data.activeId, connections: merged });
}

module.exports = {
  getActiveConnection,
  getAllConnections,
  getAllConnectionsMasked,
  saveConnections
};
