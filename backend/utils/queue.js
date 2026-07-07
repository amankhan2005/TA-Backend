const { Queue } = require('bullmq');
const { getRedisConnection } = require('../config/redis');

/**
 * queue.js — Single shared BullMQ queue for all background ERP jobs
 * (notification delivery, scheduled report generation, fee reminder
 * sweeps, bulk import/export processing, etc.).
 *
 * A single queue with a `jobType` field on each job (rather than one queue
 * per job type) keeps operational overhead low at this stage — one queue to
 * monitor, one worker process to deploy (worker.js). If a specific job type
 * ever needs independent scaling/priority, splitting it into its own queue
 * later is a small, isolated change, not a redesign.
 *
 * This file is intentionally NOT imported by server.js's existing startup
 * path — it's only pulled in by controllers that enqueue a job (Phase 1+)
 * and by worker.js. The core Teacher Attendance API has zero dependency on
 * Redis being available.
 */

const QUEUE_NAME = 'erp-jobs';

let queue = null;

function getErpQueue() {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: getRedisConnection() });
  }
  return queue;
}

/**
 * Enqueue a job. `jobType` is a string handled by a registered processor in
 * worker.js (e.g. 'notification.send', 'report.generateScheduled',
 * 'fee.reminderSweep', 'importExport.process'). `idempotencyKey`, when
 * provided, becomes the BullMQ job ID — BullMQ silently no-ops a duplicate
 * job ID, which is the mechanism behind the idempotent-scheduled-job
 * guarantee from the risk assessment (R-6).
 */
async function enqueueJob(jobType, payload, opts = {}) {
  const q = getErpQueue();
  return q.add(
    jobType,
    payload,
    {
      attempts: opts.attempts ?? 5,
      backoff: { type: 'exponential', delay: opts.backoffDelayMs ?? 30_000 },
      removeOnComplete: { age: 7 * 24 * 3600 }, // keep 7 days for debugging, then prune
      removeOnFail: { age: 30 * 24 * 3600 },
      ...(opts.idempotencyKey ? { jobId: opts.idempotencyKey } : {}),
    }
  );
}

module.exports = { QUEUE_NAME, getErpQueue, enqueueJob };
