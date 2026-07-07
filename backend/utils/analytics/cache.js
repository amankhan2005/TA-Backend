/**
 * cache.js — Tiny Redis-backed cache for analytics/dashboard/trend queries.
 * Reuses the shared BullMQ Redis connection (config/redis.js). Degrades
 * gracefully: if Redis is unreachable or unset, the producer just runs — the
 * dashboard is never *broken* by a cache miss, only slower.
 *
 * Keys are namespaced and tenant-scoped by the caller (always include schoolId
 * for school-scoped data) so one school can never read another's cached blob.
 */

let getRedisConnection = null;
try { ({ getRedisConnection } = require('../../config/redis')); } catch { /* redis optional */ }

const PREFIX = 'analytics:';

async function getClient() {
  if (!getRedisConnection || !process.env.REDIS_URL) return null;
  try { return getRedisConnection(); } catch { return null; }
}

/**
 * @param {string} key       cache key (caller namespaces with schoolId etc.)
 * @param {number} ttlSec    seconds to cache
 * @param {Function} producer async () => data
 */
async function cached(key, ttlSec, producer) {
  const client = await getClient();
  const fullKey = PREFIX + key;
  if (client) {
    try {
      const hit = await client.get(fullKey);
      if (hit != null) return JSON.parse(hit);
    } catch { /* ignore read errors, fall through to producer */ }
  }
  const data = await producer();
  if (client) {
    try { await client.set(fullKey, JSON.stringify(data), 'EX', ttlSec); } catch { /* ignore write errors */ }
  }
  return data;
}

/** Invalidate a cache key (e.g. after a mutation). Safe no-op without Redis. */
async function invalidate(key) {
  const client = await getClient();
  if (client) { try { await client.del(PREFIX + key); } catch { /* ignore */ } }
}

module.exports = { cached, invalidate };
