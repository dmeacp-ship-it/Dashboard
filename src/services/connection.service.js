const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../connections.json');

function _initDB() {
  if (!fs.existsSync(DB_PATH)) {
    // Default to the .env configuration initially
    const defaultConnection = {
      id: 'default',
      name: 'Primary Database',
      url: process.env.SUPABASE_URL || '',
      key: process.env.SUPABASE_KEY || ''
    };
    fs.writeFileSync(DB_PATH, JSON.stringify({ activeId: 'default', connections: [defaultConnection] }, null, 2), 'utf-8');
  }
}

function _readDB() {
  _initDB();
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch (err) {
    console.error('Failed to read connections.json', err);
    return { activeId: '', connections: [] };
  }
}

function _writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Returns the currently active connection credentials.
 */
function getActiveConnection() {
  const db = _readDB();
  const conn = db.connections.find(c => c.id === db.activeId);
  if (!conn) {
    return { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_KEY };
  }
  return conn;
}

/**
 * Returns all connections and the active ID for the UI
 */
function getAllConnections() {
  return _readDB();
}

/**
 * Saves all connections and the active ID from the UI
 */
function saveConnections(data) {
  _writeDB({
    activeId: data.activeId,
    connections: data.connections
  });
}

module.exports = {
  getActiveConnection,
  getAllConnections,
  saveConnections
};
