require('dotenv').config();
require('./config/validateEnv').validateEnv({ role: 'worker' });
const mongoose = require('mongoose');
const { Worker } = require('bullmq');
const connectDB = require('./config/db');
const { getRedisConnection } = require('./config/redis');
const { QUEUE_NAME, getErpQueue, enqueueJob } = require('./utils/queue');

/**
 * worker.js — Background job processor for ERP features (notifications,
 * scheduled reports, fee reminders, bulk import/export). Deployed as a
 * SEPARATE process from server.js (e.g. `npm run worker`), sharing the
 * same MongoDB connection and models, but never handling HTTP requests.
 *
 * This is new infrastructure (ERP Phase 0). It does not replace or modify
 * server.js — the existing API process runs completely independently and
 * has no dependency on this worker or on Redis being available.
 *
 * ── Phase 0 scope ──────────────────────────────────────────────────────
 * This file wires up the queue consumer and a `ping` job handler as an
 * end-to-end smoke test (queue connectivity, DB connectivity, graceful
 * shutdown). Real job handlers (notification.send, report.generateScheduled,
 * fee.reminderSweep, importExport.process) are added as their owning
 * modules are built (Phase 1, 4, 5, and 2/3/5 respectively) — each is a
 * small additive registration in the `handlers` map below, not a change to
 * this file's structure.
 */

// ── Shared helper: write a report_ready delivery result back onto its
//    GeneratedReport, and roll up the overall status. Used by both the initial
//    dispatch and the retry sweep so the report history stays accurate. ────────
async function recordReportDelivery(relatedReportId, channel, status, errorMessage) {
  if (!relatedReportId) return;
  const GeneratedReport = require('./models/GeneratedReport');
  try {
    const set = { [`delivery.${channel}.status`]: status, [`delivery.${channel}.at`]: new Date() };
    if (errorMessage) set[`delivery.${channel}.error`] = errorMessage;
    await GeneratedReport.findByIdAndUpdate(relatedReportId, { $set: set });
  } catch (e) {
    console.error('[worker] report delivery status update failed:', e.message);
  }
}

async function rollupReportStatus(relatedReportId) {
  if (!relatedReportId) return;
  const GeneratedReport = require('./models/GeneratedReport');
  try {
    const r = await GeneratedReport.findById(relatedReportId);
    if (!r) return;
    const legs = [r.delivery?.email?.status, r.delivery?.whatsapp?.status].filter((s) => s && s !== 'none');
    if (!legs.length) return;
    const anySent = legs.includes('sent');
    const anyFailed = legs.includes('failed');
    r.status = anySent && anyFailed ? 'partially_sent' : anySent ? 'sent' : anyFailed ? 'failed' : r.status;
    await r.save();
  } catch (e) {
    console.error('[worker] report rollup status update failed:', e.message);
  }
}

// Job-type → handler registry. Add new entries here as later phases land.
const handlers = {
  ping: async (job) => {
    console.log(`[worker] ping job ${job.id} received:`, job.data);
    return { pong: true, receivedAt: new Date().toISOString() };
  },

  /**
   * notification.dispatch (ERP Phase 1) — resolves NotificationSettings for
   * the school, sends via each enabled channel, writes a NotificationLog
   * entry per channel attempted. A failure on one channel never blocks the
   * other (email succeeding while WhatsApp fails is a partial success, not
   * a job failure) — mirrors the risk assessment's R-9 mitigation.
   */
  'notification.dispatch': async (job) => {
    const Student = require('./models/Student');
    const School = require('./models/School');
    const NotificationSettings = require('./models/NotificationSettings');
    const NotificationLog = require('./models/NotificationLog');
    const { deliverOnChannel, computeNextRetryAt } = require('./utils/notificationDelivery');

    const { schoolId, studentId, type, data = {}, relatedReportId, channelOverride } = job.data;

    const [student, settings, school] = await Promise.all([
      Student.findById(studentId),
      NotificationSettings.findOne({ schoolId }),
      School.findOne({ schoolId }).populate('subscriptionPlan'),
    ]);
    if (!student) throw new Error(`notification.dispatch: student ${studentId} not found`);

    const settingsKeyByType = {
      attendance_punch_in: 'attendancePunchIn',
      attendance_punch_out: 'attendancePunchOut',
      attendance_late: 'attendanceLate',
      fee_due: 'feeReminderDue',
      fee_overdue: 'feeReminderOverdue',
      report_ready: 'reportDelivery',
    };
    // channelOverride (Phase 4 report schedules) wins over NotificationSettings.
    const channelPrefs = channelOverride || settings?.[settingsKeyByType[type]] || { email: true, whatsapp: false };
    const whatsappPlanEnabled = school?.subscriptionPlan?.features?.whatsappNotifications === true;

    const results = [];

    // ── EMAIL ──────────────────────────────────────────────────────────────
    if (channelPrefs.email && student.email) {
      const log = await NotificationLog.create({
        schoolId, student: student._id, channel: 'email', type,
        recipient: student.email, status: 'pending', relatedReport: relatedReportId || null, payload: data,
      });
      try {
        await deliverOnChannel({ channel: 'email', type, student, data });
        log.status = 'sent';
        await log.save();
        results.push({ channel: 'email', status: 'sent' });
        await recordReportDelivery(relatedReportId, 'email', 'sent');
      } catch (err) {
        log.status = 'failed';
        log.errorMessage = err.message;
        log.nextRetryAt = computeNextRetryAt(0); // schedule first retry
        await log.save();
        results.push({ channel: 'email', status: 'failed', error: err.message });
        await recordReportDelivery(relatedReportId, 'email', 'failed', err.message);
      }
    }

    // ── WHATSAPP ───────────────────────────────────────────────────────────
    if (channelPrefs.whatsapp && student.whatsappNumber) {
      if (!whatsappPlanEnabled) {
        // F-5: plan doesn't include WhatsApp → skip delivery, log the reason,
        // and DO NOT schedule a retry (this is a permanent plan condition, not a
        // transient failure). Email above already went out independently.
        await NotificationLog.create({
          schoolId, student: student._id, channel: 'whatsapp', type,
          recipient: student.whatsappNumber, status: 'skipped', payload: data,
          relatedReport: relatedReportId || null,
          errorMessage: 'WhatsApp not enabled on the school\'s subscription plan (whatsappNotifications=false).',
        });
        results.push({ channel: 'whatsapp', status: 'skipped', reason: 'plan_disabled' });
      } else {
        const log = await NotificationLog.create({
          schoolId, student: student._id, channel: 'whatsapp', type,
          recipient: student.whatsappNumber, status: 'pending', relatedReport: relatedReportId || null, payload: data,
        });
        try {
          const { providerMessageId } = await deliverOnChannel({ channel: 'whatsapp', type, student, data });
          log.providerMessageId = providerMessageId || null;
          log.status = 'sent';
          await log.save();
          results.push({ channel: 'whatsapp', status: 'sent' });
          await recordReportDelivery(relatedReportId, 'whatsapp', 'sent');
        } catch (err) {
          log.status = 'failed';
          log.errorMessage = err.message;
          log.nextRetryAt = computeNextRetryAt(0);
          await log.save();
          results.push({ channel: 'whatsapp', status: 'failed', error: err.message });
          await recordReportDelivery(relatedReportId, 'whatsapp', 'failed', err.message);
        }
      }
    }

    if (relatedReportId) await rollupReportStatus(relatedReportId);
    return { studentId, type, results };
  },

  /**
   * notification.retrySweep (F-4) — periodically re-attempts NotificationLog
   * entries that failed and whose backoff window has elapsed, up to a max retry
   * count. Re-sends via the SAME deliverOnChannel path as the first attempt,
   * using the persisted `payload`. Terminal after NOTIFICATION_MAX_RETRIES.
   */
  'notification.retrySweep': async (job) => {
    const NotificationLog = require('./models/NotificationLog');
    const Student = require('./models/Student');
    const { deliverOnChannel, computeNextRetryAt } = require('./utils/notificationDelivery');

    const MAX = parseInt(process.env.NOTIFICATION_MAX_RETRIES || '5', 10);
    const now = new Date();
    const batchSize = parseInt(job.data?.batchSize || '100', 10);

    const due = await NotificationLog.find({
      status: 'failed',
      retryCount: { $lt: MAX },
      $or: [{ nextRetryAt: { $lte: now } }, { nextRetryAt: null }],
    }).sort({ nextRetryAt: 1 }).limit(batchSize);

    let retried = 0, recovered = 0, stillFailing = 0, gaveUp = 0;

    for (const log of due) {
      const student = await Student.findById(log.student);
      if (!student) { // student gone — don't retry forever
        log.status = 'failed'; log.retryCount = MAX; log.nextRetryAt = null;
        log.errorMessage = 'Student no longer exists; retry abandoned.';
        await log.save();
        gaveUp += 1;
        continue;
      }

      log.status = 'retrying';
      log.retryCount += 1;
      await log.save();
      retried += 1;

      try {
        const { providerMessageId } = await deliverOnChannel({
          channel: log.channel, type: log.type, student, data: log.payload || {},
        });
        log.status = 'sent';
        log.providerMessageId = providerMessageId || log.providerMessageId || null;
        log.errorMessage = null;
        log.nextRetryAt = null;
        await log.save();
        await recordReportDelivery(log.relatedReport, log.channel, 'sent');
        await rollupReportStatus(log.relatedReport);
        recovered += 1;
      } catch (err) {
        const terminal = log.retryCount >= MAX;
        log.status = 'failed';
        log.errorMessage = err.message;
        log.nextRetryAt = terminal ? null : computeNextRetryAt(log.retryCount);
        await log.save();
        if (terminal) {
          await recordReportDelivery(log.relatedReport, log.channel, 'failed', err.message);
          await rollupReportStatus(log.relatedReport);
          gaveUp += 1;
        } else {
          stillFailing += 1;
        }
      }
    }

    if (retried) console.log(`[worker] notification.retrySweep: ${retried} retried, ${recovered} recovered, ${stillFailing} rescheduled, ${gaveUp} gave up`);
    return { scanned: due.length, retried, recovered, stillFailing, gaveUp };
  },

  /**
   * report.dailySweep (ERP Phase 4) — the single daily timer. Loads every
   * ENABLED ReportSchedule, asks the pure isScheduleDueOn() whether it fires
   * today, and for each due schedule enqueues a report.generateForSchool job
   * with an idempotency key of `report:<scheduleId>:<runDate>` so re-running
   * the sweep on the same day never double-generates (R-6).
   */
  'report.dailySweep': async (job) => {
    const ReportSchedule = require('./models/ReportSchedule');
    const { isScheduleDueOn, toDateStr } = require('./utils/reportScheduling');

    const runDate = job.data?.runDate ? new Date(job.data.runDate) : new Date();
    const runDateStr = toDateStr(runDate);

    const schedules = await ReportSchedule.find({ enabled: true });
    let due = 0;
    for (const s of schedules) {
      if (!isScheduleDueOn(s, runDate)) continue;
      due += 1;
      await enqueueJob(
        'report.generateForSchool',
        { scheduleId: s._id.toString(), runDate: runDate.toISOString() },
        { idempotencyKey: `report:${s._id}:${runDateStr}` }
      );
    }
    console.log(`[worker] report.dailySweep ${runDateStr}: ${due}/${schedules.length} schedule(s) due`);
    return { runDate: runDateStr, totalEnabled: schedules.length, due };
  },

  /**
   * report.generateForSchool (ERP Phase 4) — generates every in-scope student's
   * report for one schedule's computed period, then enqueues each parent's
   * report_ready notification. Delegates to utils/reportGenerator.js.
   */
  'report.generateForSchool': async (job) => {
    const { generateReportsForSchedule } = require('./utils/reportGenerator');
    return generateReportsForSchedule({ scheduleId: job.data.scheduleId, runDate: job.data.runDate });
  },

  /**
   * fee.reminderSweep (Phase 5) — daily sweep that enqueues due-soon and overdue
   * fee reminders. Reuses the notification pipeline (dispatch → F-5 plan gate →
   * F-4 retry). Throttles via each invoice's lastReminderAt so parents aren't
   * spammed: due reminders fire once inside the window; overdue reminders re-fire
   * on a cadence.
   */
  'fee.reminderSweep': async (job) => {
    const StudentInvoice = require('./models/StudentInvoice');
    const { formatMinor } = require('./utils/money');

    const now = job.data?.now ? new Date(job.data.now) : new Date();
    const DUE_WINDOW_DAYS = parseInt(process.env.FEE_DUE_WINDOW_DAYS || '3', 10);
    const OVERDUE_CADENCE_DAYS = parseInt(process.env.FEE_OVERDUE_CADENCE_DAYS || '7', 10);
    const dueWindowEnd = new Date(now.getTime() + DUE_WINDOW_DAYS * 86400000);
    const overdueCadenceAgo = new Date(now.getTime() - OVERDUE_CADENCE_DAYS * 86400000);

    const invoices = await StudentInvoice.find({ status: { $in: ['unpaid', 'partial', 'overdue'] } })
      .limit(parseInt(job.data?.batchSize || '500', 10));

    let dueSent = 0, overdueSent = 0;
    for (const inv of invoices) {
      const balance = Math.max(0, inv.totalPayableMinor - inv.paidMinor);
      if (balance <= 0) continue;
      const isOverdue = inv.dueDate.getTime() < now.getTime();

      let type = null;
      if (isOverdue) {
        if (!inv.lastReminderAt || inv.lastReminderAt.getTime() <= overdueCadenceAgo.getTime()) type = 'fee_overdue';
      } else if (inv.dueDate.getTime() <= dueWindowEnd.getTime() && !inv.lastReminderAt) {
        type = 'fee_due';
      }
      if (!type) continue;

      try {
        await enqueueJob('notification.dispatch', {
          schoolId: inv.schoolId,
          studentId: inv.student.toString(),
          type,
          data: { amountDue: formatMinor(balance, inv.currency, { withCode: true }), currency: inv.currency, dueDate: inv.dueDate.toISOString().slice(0, 10) },
        });
        inv.lastReminderAt = now;
        inv.reminderCount += 1;
        if (isOverdue && inv.status !== 'overdue') inv.status = 'overdue';
        await inv.save();
        if (type === 'fee_overdue') overdueSent += 1; else dueSent += 1;
      } catch (e) {
        console.error('[fee.reminderSweep] enqueue failed for', inv.invoiceNumber, e.message);
      }
    }
    console.log(`[worker] fee.reminderSweep: ${dueSent} due, ${overdueSent} overdue`);
    return { scanned: invoices.length, dueSent, overdueSent };
  },

  /**
   * fee.monthlyStatementSweep (Phase 5) — fans out per school to generate the
   * previous month's fee statements. Mirrors report.dailySweep's fan-out shape.
   */
  'fee.monthlyStatementSweep': async (job) => {
    const School = require('./models/School');
    const now = job.data?.now ? new Date(job.data.now) : new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const year = Number(job.data?.year) || prev.getUTCFullYear();
    const month = Number(job.data?.month) || (prev.getUTCMonth() + 1);

    const schools = await School.find({}).select('schoolId');
    for (const s of schools) {
      await enqueueJob(
        'fee.generateStatementsForSchool',
        { schoolId: s.schoolId, year, month },
        { idempotencyKey: `feestmt:${s.schoolId}:${year}-${month}` }
      );
    }
    return { schools: schools.length, year, month };
  },

  'fee.generateStatementsForSchool': async (job) => {
    const { schoolId, year, month } = job.data;
    const StudentInvoice = require('./models/StudentInvoice');
    const Student = require('./models/Student');
    const { generateStudentStatement, monthBounds } = require('./utils/feeService');
    const { start, end } = monthBounds(year, month);

    const pairs = await StudentInvoice.aggregate([
      { $match: { schoolId, status: { $ne: 'void' }, issueDate: { $gte: start, $lte: new Date(end.getTime() + 86399999) } } },
      { $group: { _id: { student: '$student', currency: '$currency' } } },
    ]);

    let generated = 0, failed = 0;
    for (const p of pairs) {
      try {
        const student = await Student.findById(p._id.student);
        if (!student) continue;
        await generateStudentStatement({ schoolId, student, year, month, currency: p._id.currency });
        generated += 1;
      } catch (e) { failed += 1; console.error('[fee.generateStatementsForSchool]', e.message); }
    }
    return { schoolId, year, month, generated, failed };
  },

  // ── Identity bulk operations (Phase 8, Step 5) — queued, non-blocking ───────
  'identity.bulkQr': async (job) => {
    const identity = require('./utils/identityService');
    const { schoolId, scope, classId, sectionId, studentIds, regenerate, requestedBy } = job.data;
    const students = await identity.resolveScope({ schoolId, scope, classId, sectionId, studentIds });
    let done = 0, failed = 0;
    for (const s of students) {
      try { await identity.generateQr({ schoolId, studentId: s._id, issuedBy: requestedBy, regenerate }); done += 1; }
      catch (e) { failed += 1; console.error('[identity.bulkQr]', s.studentId, e.message); }
    }
    console.log(`[worker] identity.bulkQr: ${done} generated, ${failed} failed`);
    return { total: students.length, done, failed, regenerate: !!regenerate };
  },

  'identity.bulkPdf': async (job) => {
    const identity = require('./utils/identityService');
    const RfidCard = require('./models/RfidCard');
    const School = require('./models/School');
    const { renderIdentitySheetPDF } = require('./utils/pdf');
    const { uploadIdentityPdf } = require('./utils/reportStorage');
    const { assertStorageAvailable, recordUpload } = require('./utils/storageService');
    const { schoolId, scope, classId, sectionId, studentIds, requestedBy } = job.data;

    const [students, school] = await Promise.all([
      identity.resolveScope({ schoolId, scope, classId, sectionId, studentIds }),
      School.findOne({ schoolId }).populate('subscriptionPlan'),
    ]);
    const cards = [];
    for (const s of students) {
      const gen = await identity.generateQr({ schoolId, studentId: s._id, issuedBy: requestedBy });
      const qrBuffer = await identity.qrPngBuffer(gen.token);
      const card = await RfidCard.findOne({ schoolId, student: s._id, status: 'active' });
      cards.push({ student: { name: s.name, studentId: s.studentId, rollNumber: s.rollNumber, className: s.class?.name, sectionName: s.section?.name, photoUrl: s.photoUrl }, qrBuffer, rfidUid: card?.rfidNumber });
    }
    const buffer = await renderIdentitySheetPDF({ school: { name: school?.name, logoUrl: school?.logoUrl }, title: 'Identity Sheets', cards });
    await assertStorageAvailable(schoolId, buffer.length, school?.subscriptionPlan?.storageLimitMB ?? null);
    const up = await uploadIdentityPdf(buffer, { schoolId, filename: `identity_batch_${Date.now()}` });
    await recordUpload(schoolId, buffer.length, 'idCards');
    return { total: students.length, url: up.url };
  },

  'identity.bulkExport': async (job) => {
    const identity = require('./utils/identityService');
    const RfidCard = require('./models/RfidCard');
    const StudentIdentity = require('./models/StudentIdentity');
    const { schoolId, scope, classId, sectionId } = job.data;
    const students = await identity.resolveScope({ schoolId, scope, classId, sectionId });
    const rows = [['studentId', 'name', 'class', 'section', 'rfidUid', 'rfidStatus', 'qrVersion']];
    for (const s of students) {
      const [card, id] = await Promise.all([
        RfidCard.findOne({ schoolId, student: s._id, status: 'active' }).select('rfidNumber status'),
        StudentIdentity.findOne({ schoolId, student: s._id }).select('qrVersion'),
      ]);
      rows.push([s.studentId, s.name, s.class?.name || '', s.section?.name || '', card?.rfidNumber || '', card?.status || 'unassigned', id?.qrVersion || 1]);
    }
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    console.log(`[worker] identity.bulkExport: ${students.length} rows`);
    return { total: students.length, csvLength: csv.length, csvPreview: csv.slice(0, 200) };
  },

  // importExport.process: registered alongside each module's bulk import/export
};

async function start() {
  await connectDB();

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const handler = handlers[job.name];
      if (!handler) {
        throw new Error(`No handler registered for job type "${job.name}".`);
      }
      return handler(job);
    },
    {
      connection: getRedisConnection(),
      concurrency: parseInt(process.env.WORKER_CONCURRENCY || '5', 10),
    }
  );

  worker.on('completed', (job) => {
    console.log(`✅ [worker] job ${job.id} (${job.name}) completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`❌ [worker] job ${job?.id} (${job?.name}) failed:`, err.message);
  });

  console.log('🚀 ERP background worker running, listening on queue:', QUEUE_NAME);

  // ── Register the daily report sweep (ERP Phase 4) ──────────────────────────
  // A single repeatable job drives ALL report schedules. Re-adding it with the
  // same name + repeat pattern + jobId is idempotent — restarting the worker
  // does not stack duplicate timers. Cron is server-local; a single-region
  // Liberia deployment matches the schools' timezone (documented assumption,
  // same as the attendance "date" derivation).
  const sweepCron = process.env.REPORT_SWEEP_CRON || '0 6 * * *'; // 06:00 daily
  try {
    await getErpQueue().add(
      'report.dailySweep',
      {},
      {
        repeat: { pattern: sweepCron },
        jobId: 'report-daily-sweep',
        removeOnComplete: { count: 30 },
        removeOnFail: { count: 30 },
      }
    );
    console.log(`🗓️  Daily report sweep scheduled (cron "${sweepCron}").`);
  } catch (err) {
    console.error('⚠️  Failed to register daily report sweep:', err.message);
  }

  // ── Register the notification retry sweep (F-4) ────────────────────────────
  // Re-attempts failed email/WhatsApp deliveries with exponential backoff, up
  // to NOTIFICATION_MAX_RETRIES. Idempotent registration (fixed jobId).
  const retryCron = process.env.NOTIFICATION_RETRY_CRON || '*/15 * * * *'; // every 15 min
  try {
    await getErpQueue().add(
      'notification.retrySweep',
      {},
      {
        repeat: { pattern: retryCron },
        jobId: 'notification-retry-sweep',
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 50 },
      }
    );
    console.log(`🔁 Notification retry sweep scheduled (cron "${retryCron}").`);
  } catch (err) {
    console.error('⚠️  Failed to register notification retry sweep:', err.message);
  }

  // ── Register the fee reminder sweep (Phase 5) ──────────────────────────────
  const feeReminderCron = process.env.FEE_REMINDER_CRON || '0 7 * * *'; // daily 07:00
  try {
    await getErpQueue().add('fee.reminderSweep', {}, {
      repeat: { pattern: feeReminderCron }, jobId: 'fee-reminder-sweep',
      removeOnComplete: { count: 50 }, removeOnFail: { count: 50 },
    });
    console.log(`💰 Fee reminder sweep scheduled (cron "${feeReminderCron}").`);
  } catch (err) {
    console.error('⚠️  Failed to register fee reminder sweep:', err.message);
  }

  // ── Register the monthly fee statement sweep (Phase 5) ─────────────────────
  const feeStatementCron = process.env.FEE_STATEMENT_CRON || '0 8 1 * *'; // 1st of month 08:00
  try {
    await getErpQueue().add('fee.monthlyStatementSweep', {}, {
      repeat: { pattern: feeStatementCron }, jobId: 'fee-monthly-statement-sweep',
      removeOnComplete: { count: 12 }, removeOnFail: { count: 12 },
    });
    console.log(`🧾 Monthly fee statement sweep scheduled (cron "${feeStatementCron}").`);
  } catch (err) {
    console.error('⚠️  Failed to register monthly fee statement sweep:', err.message);
  }

  const shutdown = async (signal) => {
    console.log(`\n[worker] received ${signal}, shutting down gracefully...`);
    await worker.close();
    await mongoose.connection.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  start().catch((err) => {
    console.error('❌ Worker failed to start:', err);
    process.exit(1);
  });
}

module.exports = { handlers, start };
