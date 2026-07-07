const ReportSchedule = require('../models/ReportSchedule');
const GeneratedReport = require('../models/GeneratedReport');
const School = require('../models/School');
const { logEvent } = require('../utils/audit');
const { getPagination, buildPaginatedResponse } = require('../utils/pagination');
const { generateAdHocStudentReport } = require('../utils/reportGenerator');
const { getUsage, summarize } = require('../utils/storageService');

// ═══════════════════════ SCHEDULE CRUD ══════════════════════════════════════

/**
 * Validate that the frequency-specific field required by `frequency` is present
 * and sane. Returns an error string, or null if OK.
 */
function validateScheduleShape({ frequency, dayOfWeek, monthlyMode, dayOfMonth }) {
  if (frequency === 'weekly') {
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return 'weekly schedule requires dayOfWeek (0=Sunday … 6=Saturday).';
    }
  }
  if (frequency === 'monthly') {
    if (!['start', 'end', 'day'].includes(monthlyMode)) {
      return "monthly schedule requires monthlyMode ('start', 'end', or 'day').";
    }
    if (monthlyMode === 'day' && (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31)) {
      return "monthly 'day' schedule requires dayOfMonth (1–31).";
    }
  }
  if (frequency === 'custom') {
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
      return 'custom schedule requires dayOfMonth (1–31).';
    }
  }
  return null;
}

exports.createSchedule = async (req, res) => {
  try {
    const { schoolId, email } = req.user;
    const { name, frequency, dayOfWeek, monthlyMode, dayOfMonth, deliveryChannel, enabled } = req.body;

    if (!['daily', 'weekly', 'monthly', 'custom'].includes(frequency)) {
      return res.status(400).json({ success: false, message: 'frequency must be daily, weekly, monthly, or custom.' });
    }
    const shapeErr = validateScheduleShape({ frequency, dayOfWeek, monthlyMode, dayOfMonth });
    if (shapeErr) return res.status(400).json({ success: false, message: shapeErr });

    const schedule = await ReportSchedule.create({
      schoolId,
      reportType: 'attendance',
      name: name || null,
      frequency,
      dayOfWeek: frequency === 'weekly' ? dayOfWeek : null,
      monthlyMode: frequency === 'monthly' ? monthlyMode : null,
      dayOfMonth: (frequency === 'custom' || (frequency === 'monthly' && monthlyMode === 'day')) ? dayOfMonth : null,
      deliveryChannel: deliveryChannel || 'default',
      enabled: enabled !== undefined ? !!enabled : true,
      createdBy: email || null,
    });

    await logEvent(req, 'reportSchedule.created', {
      targetType: 'reportSchedule', targetId: schedule._id, targetName: schedule.name || schedule.frequency,
      metadata: { frequency, deliveryChannel: schedule.deliveryChannel },
    });

    res.status(201).json({ success: true, message: 'Report schedule created.', schedule });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.listSchedules = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const schedules = await ReportSchedule.find({ schoolId }).sort({ createdAt: -1 });
    res.json({ success: true, schedules });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateSchedule = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { id } = req.params;
    const existing = await ReportSchedule.findOne({ _id: id, schoolId });
    if (!existing) return res.status(404).json({ success: false, message: 'Schedule not found.' });

    const merged = {
      frequency: req.body.frequency ?? existing.frequency,
      dayOfWeek: req.body.dayOfWeek ?? existing.dayOfWeek,
      monthlyMode: req.body.monthlyMode ?? existing.monthlyMode,
      dayOfMonth: req.body.dayOfMonth ?? existing.dayOfMonth,
    };
    if (!['daily', 'weekly', 'monthly', 'custom'].includes(merged.frequency)) {
      return res.status(400).json({ success: false, message: 'Invalid frequency.' });
    }
    const shapeErr = validateScheduleShape(merged);
    if (shapeErr) return res.status(400).json({ success: false, message: shapeErr });

    const fields = ['name', 'frequency', 'dayOfWeek', 'monthlyMode', 'dayOfMonth', 'deliveryChannel', 'enabled'];
    fields.forEach((f) => { if (req.body[f] !== undefined) existing[f] = req.body[f]; });
    // Normalize now-irrelevant frequency fields to null so stale values don't linger.
    if (existing.frequency !== 'weekly') existing.dayOfWeek = null;
    if (existing.frequency !== 'monthly') existing.monthlyMode = null;
    if (!(existing.frequency === 'custom' || (existing.frequency === 'monthly' && existing.monthlyMode === 'day'))) {
      existing.dayOfMonth = null;
    }
    await existing.save();

    await logEvent(req, 'reportSchedule.updated', {
      targetType: 'reportSchedule', targetId: existing._id, metadata: req.body,
    });

    res.json({ success: true, message: 'Report schedule updated.', schedule: existing });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.toggleSchedule = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { id } = req.params;
    const schedule = await ReportSchedule.findOne({ _id: id, schoolId });
    if (!schedule) return res.status(404).json({ success: false, message: 'Schedule not found.' });

    schedule.enabled = req.body.enabled !== undefined ? !!req.body.enabled : !schedule.enabled;
    await schedule.save();

    await logEvent(req, 'reportSchedule.toggled', {
      targetType: 'reportSchedule', targetId: schedule._id, metadata: { enabled: schedule.enabled },
    });

    res.json({ success: true, message: `Schedule ${schedule.enabled ? 'enabled' : 'disabled'}.`, schedule });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.deleteSchedule = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { id } = req.params;
    const schedule = await ReportSchedule.findOneAndDelete({ _id: id, schoolId });
    if (!schedule) return res.status(404).json({ success: false, message: 'Schedule not found.' });
    // Historical GeneratedReport rows are intentionally retained — deleting a
    // schedule does not erase the reports it already produced.
    res.json({ success: true, message: 'Report schedule deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════ REPORT HISTORY ═════════════════════════════════════

exports.listReports = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { student, status, scheduleId, from, to } = req.query;
    const { page, limit, skip } = getPagination(req.query);

    const filter = { schoolId };
    if (student) filter.student = student;
    if (status) filter.status = status;
    if (scheduleId) filter.schedule = scheduleId;
    if (from || to) {
      filter.periodStart = {};
      if (from) filter.periodStart.$gte = from;
      if (to) filter.periodStart.$lte = to;
    }

    const [results, total] = await Promise.all([
      GeneratedReport.find(filter)
        .populate('student', 'name studentId')
        .sort({ createdAt: -1 })
        .skip(skip).limit(limit),
      GeneratedReport.countDocuments(filter),
    ]);

    res.json(buildPaginatedResponse(results, total, page, limit));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getReport = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const report = await GeneratedReport.findOne({ _id: req.params.id, schoolId })
      .populate('student', 'name studentId')
      .populate('schedule', 'name frequency');
    if (!report) return res.status(404).json({ success: false, message: 'Report not found.' });
    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════ STORAGE USAGE (F-3) ════════════════════════════════

exports.getStorageUsage = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const school = await School.findOne({ schoolId }).populate('subscriptionPlan');
    const usage = await getUsage(schoolId);
    const limitMB = school?.subscriptionPlan?.storageLimitMB ?? null;
    res.json({ success: true, storage: summarize(usage, limitMB) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════ AD-HOC GENERATION ══════════════════════════════════

/**
 * POST /api/reports/generate — generate a report on demand for ONE student over
 * an explicit date range. Runs inline (single student = fast) and returns the
 * GeneratedReport, including the PDF download URL. The parent report_ready
 * notification is enqueued exactly as in the scheduled path.
 */
exports.generateNow = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { studentId, periodStart, periodEnd, periodLabel } = req.body;

    if (!studentId || !periodStart || !periodEnd) {
      return res.status(400).json({ success: false, message: 'studentId, periodStart and periodEnd are required.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
      return res.status(400).json({ success: false, message: 'periodStart/periodEnd must be "YYYY-MM-DD".' });
    }
    if (periodStart > periodEnd) {
      return res.status(400).json({ success: false, message: 'periodStart must be on or before periodEnd.' });
    }

    const { report, deliveryQueued } = await generateAdHocStudentReport({ schoolId, studentId, periodStart, periodEnd, periodLabel });

    if (report.status === 'failed') {
      // Generation itself failed (render/upload/storage-limit) — no downloadable
      // artifact exists, so this is a real error.
      return res.status(502).json({ success: false, message: `Report generation failed: ${report.error}`, report, deliveryQueued: false });
    }
    // F-6: the PDF exists and is downloadable. Even if the parent notification
    // couldn't be enqueued (e.g. Redis down), the report is a valid success —
    // report it as such with deliveryQueued:false rather than a 500.
    res.status(201).json({ success: true, message: 'Report generated.', report, deliveryQueued });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
