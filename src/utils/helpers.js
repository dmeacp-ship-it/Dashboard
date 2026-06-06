/**
 * src/utils/helpers.js — Shared utility functions
 */

const crypto = require('crypto');

/**
 * Converts a JavaScript Date object to a SQL-friendly date string.
 *
 * @param {Date} jsDate — A valid Date instance.
 * @returns {string} Date formatted as 'YYYY-MM-DD'.
 */
function formatDateForSQL(jsDate) {
  if (!(jsDate instanceof Date) || isNaN(jsDate.getTime())) {
    throw new TypeError('formatDateForSQL expects a valid Date object');
  }

  const year  = jsDate.getFullYear();
  const month = String(jsDate.getMonth() + 1).padStart(2, '0');
  const day   = String(jsDate.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Builds a deterministic hash for a row object by joining a fixed set
 * of key field values with '|' and returning the SHA-256 hex digest.
 *
 * This is used for upsert deduplication — if the hash hasn't changed
 * the row can be skipped.
 *
 * @param {Object} rowObj — A row object whose values are primitives.
 * @returns {string} SHA-256 hex digest of the joined key fields.
 */
function computeRowHash(rowObj) {
  // Use all keys sorted alphabetically for deterministic ordering
  const keys = Object.keys(rowObj).sort();
  const payload = keys.map((k) => String(rowObj[k] ?? '')).join('|');

  return crypto.createHash('sha256').update(payload).digest('hex');
}

module.exports = {
  formatDateForSQL,
  computeRowHash
};
