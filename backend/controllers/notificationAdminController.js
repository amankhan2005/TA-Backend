const NotificationSettings = require('../models/NotificationSettings');
const NotificationLog = require('../models/NotificationLog');
const Student = require('../models/Student');
const School = require('../models/School');
const StudentInvoice = require('../models/StudentInvoice');
const { deliverOnChannel } = require('../utils/notificationDelivery');
const { logEvent } = require('../utils/audit');
const money = require('../utils/money');

const CHANNEL_TYPES = ['attendancePunchIn', 'attendancePunchOut', 'attendanceLate', 'feeReminderDue', 'feeReminderOverdue', 'reportDelivery'];

// ═══════════════════════ NOTIFICATION SETTINGS (item 7 UI) ═══════════════════

/** GET /api/notification-settings — per-school channel matrix (auto-creates defaults). */
exports.getNotificationSettings = async (req, res) => {
  try {
    const { schoolId } = req.user;
    let settings = await NotificationSettings.findOne({ schoolId });
    if (!settings) settings = await NotificationSettings.create({ schoolId });

    // Surface whether WhatsApp is actually available on the plan, so the UI can
    // explain why a WhatsApp toggle may have no effect.
    const school = await School.findOne({ schoolId }).populate('subscriptionPlan');
    const whatsappPlanEnabled = school?.subscriptionPlan?.features?.whatsappNotifications === true;

    res.json({ success: true, settings, whatsappPlanEnabled });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PATCH /api/notification-settings — update channel prefs. Body is any subset of
 * the six types, each an object { email?:boolean, whatsapp?:boolean }.
 */
exports.updateNotificationSettings = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const set = {};
    for (const type of CHANNEL_TYPES) {
      if (req.body[type] && typeof req.body[type] === 'object') {
        if (typeof req.body[type].email === 'boolean') set[`${type}.email`] = req.body[type].email;
        if (typeof req.body[type].whatsapp === 'boolean') set[`${type}.whatsapp`] = req.body[type].whatsapp;
      }
    }
    if (!Object.keys(set).length) {
      return res.status(400).json({ success: false, message: 'No valid channel preferences supplied.' });
    }

    const settings = await NotificationSettings.findOneAndUpdate(
      { schoolId }, { $set: set }, { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    await logEvent(req, 'notificationSettings.updated', {
      targetType: 'notificationSettings', targetId: settings._id, metadata: req.body,
    });

    res.json({ success: true, message: 'Notification settings updated.', settings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════ PARENT NOTIFICATION TEST TOOL (item 11) ═════════════

const TEST_TYPES = {
  punch_in: 'attendance_punch_in',
  punch_out: 'attendance_punch_out',
  fee: 'fee_due',
};
const SETTINGS_KEY = {
  attendance_punch_in: 'attendancePunchIn',
  attendance_punch_out: 'attendancePunchOut',
  fee_due: 'feeReminderDue',
};

/**
 * POST /api/notification-settings/test
 *   { studentId, event: 'punch_in'|'punch_out'|'fee', channels?: {email?,whatsapp?} }
 *
 * Fires the chosen notification for the chosen student and returns a per-channel
 * verdict. Unlike the production path (fire-and-forget → only "queued"), the
 * test tool delivers INLINE via the same deliverOnChannel used by the worker, so
 * the admin gets an immediate Delivered / Failed / Skipped result. Every attempt
 * is still written to NotificationLog exactly like a real send.
 */
exports.testNotification = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { studentId, event } = req.body;
    const type = TEST_TYPES[event];
    if (!type) {
      return res.status(400).json({ success: false, message: "event must be one of: punch_in, punch_out, fee." });
    }

    const student = await Student.findOne({ _id: studentId, schoolId })
      .populate('class', 'name').populate('section', 'name');
    if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });

    const [settings, school] = await Promise.all([
      NotificationSettings.findOne({ schoolId }),
      School.findOne({ schoolId }).populate('subscriptionPlan'),
    ]);
    const whatsappPlanEnabled = school?.subscriptionPlan?.features?.whatsappNotifications === true;

    // Channel selection: explicit override → else the school's configured prefs
    // for this type → else email-only default (mirrors the worker).
    const configured = settings?.[SETTINGS_KEY[type]] || { email: true, whatsapp: false };
    const want = req.body.channels && typeof req.body.channels === 'object'
      ? { email: !!req.body.channels.email, whatsapp: !!req.body.channels.whatsapp }
      : configured;

    // Build the template data for this event.
    const now = new Date();
    let data = {
      schoolName: school?.name, schoolLogoUrl: school?.logoUrl,
      className: student.class?.name, sectionName: student.section?.name,
      date: now.toISOString().slice(0, 10), time: now.toTimeString().slice(0, 5),
    };
    if (type === 'fee_due') {
      // Use a real outstanding invoice when one exists, else a clearly-marked sample.
      const inv = await StudentInvoice.findOne({
        schoolId, student: student._id, status: { $in: ['unpaid', 'partial', 'overdue'] },
      }).sort({ dueDate: 1 });
      const cur = inv?.currency || 'USD';
      const pendingMinor = inv ? (inv.totalPayableMinor - inv.paidMinor) : 0;
      data = {
        ...data,
        currency: cur,
        amountDue: money.formatMinor(pendingMinor, cur, { withCode: true }),
        dueDate: inv ? new Date(inv.dueDate).toISOString().slice(0, 10) : data.date,
      };
    }

    const results = [];
    for (const channel of ['email', 'whatsapp']) {
      if (!want[channel]) { results.push({ channel, status: 'skipped', reason: 'channel_disabled' }); continue; }
      const recipient = channel === 'email' ? student.email : student.whatsappNumber;
      if (!recipient) { results.push({ channel, status: 'skipped', reason: 'no_recipient_on_student' }); continue; }
      if (channel === 'whatsapp' && !whatsappPlanEnabled) {
        results.push({ channel, status: 'skipped', reason: 'plan_disabled' });
        continue;
      }

      const log = await NotificationLog.create({
        schoolId, student: student._id, channel, type,
        recipient, status: 'pending', payload: { ...data, _test: true },
      });
      try {
        const out = await deliverOnChannel({ channel, type, student, data });
        log.status = 'sent';
        if (out?.providerMessageId) log.providerMessageId = out.providerMessageId;
        await log.save();
        results.push({ channel, status: 'delivered', recipient });
      } catch (err) {
        log.status = 'failed';
        log.errorMessage = err.message;
        await log.save();
        results.push({ channel, status: 'failed', recipient, error: err.message });
      }
    }

    await logEvent(req, 'notification.test', {
      targetType: 'student', targetId: student._id, targetName: student.name,
      metadata: { event, type, results: results.map((r) => ({ channel: r.channel, status: r.status })) },
    });

    res.json({ success: true, studentId: student._id, event, type, results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
