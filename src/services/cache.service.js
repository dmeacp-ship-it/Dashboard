const NodeCache = require('node-cache');
const { CONFIG } = require('../config');

// Initialize cache with TTL from config
const cache = new NodeCache({ stdTTL: CONFIG.CACHE_TTL, checkperiod: 120 });

// Global cache timestamp used to invalidate all cached data
let CACHE_TS = Date.now();

/**
 * Cache wrapper similar to GAS _cached()
 * Uses the CACHE_TS to partition cache keys. When CACHE_TS updates,
 * old keys naturally miss and eventually expire via TTL.
 */
async function cached(key, fn) {
  const versionedKey = `${key}_${CACHE_TS}`;
  
  const cachedData = cache.get(versionedKey);
  if (cachedData !== undefined) {
    return cachedData;
  }

  const freshData = await fn();
  
  if (freshData !== undefined && freshData !== null) {
    cache.set(versionedKey, freshData);
  }
  
  return freshData;
}

/**
 * Invalidate all cached dashboard data by bumping the global timestamp
 */
function invalidateAll() {
  CACHE_TS = Date.now();
  // We can optionally flush all immediately, or let TTL handle it.
  // Flushing is cleaner.
  cache.flushAll();
}

function getCacheTS() {
  return CACHE_TS;
}

module.exports = {
  cached,
  invalidateAll,
  invalidate: invalidateAll, // alias used by the API router
  getCacheTS
};
