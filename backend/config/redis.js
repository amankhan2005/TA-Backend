const IORedis = require('ioredis');
 

let connection = null;

function getRedisConnection() {
  if (connection) return connection;

  if (!process.env.REDIS_URL) {
    throw new Error(
      'REDIS_URL is not set. Required for job queue / worker features (ERP Phase 0+). ' +
      'The core Teacher Attendance API does not need this — only import config/redis.js ' +
      'from code paths that use the job queue.'
    );
  }

  connection = new IORedis(process.env.REDIS_URL, {
    // BullMQ requirement: must be null, not undefined, to disable ioredis's
    // built-in retry-forever-on-command-timeout behavior in favor of BullMQ's own.
    maxRetriesPerRequest: null,
  });

  connection.on('error', (err) => {
    console.error('❌ Redis connection error:', err.message);
  });

  return connection;
}

module.exports = { getRedisConnection };
