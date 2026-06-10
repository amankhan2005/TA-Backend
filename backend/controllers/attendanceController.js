const AttendanceRecord = require('../models/AttendanceRecord');
const QRSession        = require('../models/QRSession');
const SchoolSettings   = require('../models/SchoolSettings');
const Teacher          = require('../models/Teacher');
const { isWithinRadius } = require('../utils/gps');
const { getTodayDate }   = require('../utils/token');
const { logEvent }       = require('../utils/audit');
const crypto = require('crypto');

// ─── Shared: holiday / weekly-off gate ───────────────────────────────────────
function holidayGate(settings, today) {
  if (settings.weeklyOffDays && settings.weeklyOffDays.length > 0) {
    // today is "YYYY-MM-DD"; append T00:00:00Z so UTC day matches local config
    const [_y,_m,_d]=today.split('-').map(Number); const dow=new Date(_y,_m-1,_d).getDay();
    if (settings.weeklyOffDays.includes(dow)) {
      const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      return `Today is a weekly off day (${DAYS[dow]}). Attendance is not allowed.`;
    }
  }
  if (settings.holidays && settings.holidays.length > 0) {
    const h = settings.holidays.find(h => h.date === today && h.isActive !== false);
    if (h) return `Today is a holiday (${h.name}). Attendance is not allowed.`;
  }
  return null; // not blocked
}

// ─── MARK WIFI ATTENDANCE ────────────────────────────────────────────────────
// wifiSSID and gatewayIp are intentionally optional.
// iOS/Expo cannot retrieve the WiFi SSID without a native entitlement.
// When they are null the backend skips those checks and relies on GPS only.
exports.markWifiAttendance = async (req, res) => {
  try {
    const { schoolId, userId: teacherId } = req.user;
    const { wifiSSID, gatewayIp, gpsLatitude, gpsLongitude, deviceId, hasVPN, hasMockGPS } = req.body;

    const today    = getTodayDate();
    const settings = await SchoolSettings.findOne({ schoolId });
    if (!settings) return res.status(500).json({ success: false, message: 'School settings not configured.' });

    if (!settings.wifiAttendanceEnabled)
      return res.status(403).json({ success: false, message: 'WiFi attendance is disabled by your school admin.' });

    const gate = holidayGate(settings, today);
    if (gate) return res.status(403).json({ success: false, message: gate });

    const existing = await AttendanceRecord.findOne({ schoolId, teacherId: teacherId.toString(), date: today });
    if (existing) return res.status(409).json({ success: false, message: 'Attendance already marked for today.' });

    const errors = [];

    if (hasVPN === true)     errors.push({ check: 'vpn',     message: 'VPN detected. Disable VPN and try again.' });
    if (hasMockGPS === true) errors.push({ check: 'mockGps', message: 'Mock GPS detected. Disable location spoofing apps.' });

    // SSID — only compare when both sides have a value (iOS sends null → skip)
    if (wifiSSID && settings.wifiSSID && wifiSSID !== settings.wifiSSID)
      errors.push({ check: 'wifi', message: `Not connected to school WiFi (${settings.wifiSSID}).` });

    // Gateway — same: only compare when both sides have a value
    if (gatewayIp && settings.gatewayIp && gatewayIp !== settings.gatewayIp)
      errors.push({ check: 'gateway', message: 'Gateway IP mismatch. You may be on a hotspot.' });

    // GPS — always required (primary security layer on iOS)
    if (!settings.gpsLatitude || !settings.gpsLongitude) {
      errors.push({ check: 'gps', message: 'School GPS location not configured yet. Contact your admin.' });
    } else {
      const lat = parseFloat(gpsLatitude);
      const lon = parseFloat(gpsLongitude);
      if (isNaN(lat) || isNaN(lon)) {
        errors.push({ check: 'gps', message: 'Invalid GPS coordinates received.' });
      } else {
        const { withinRadius, distance } = isWithinRadius(
          lat, lon, settings.gpsLatitude, settings.gpsLongitude, settings.gpsRadius
        );
        if (!withinRadius)
          errors.push({ check: 'gps', message: `You are ${distance}m from school. Must be within ${settings.gpsRadius}m.` });
      }
    }

    if (errors.length > 0) {
      await logEvent(req, 'attendance.wifi.failed_validation', {
        targetType: 'teacher', targetId: teacherId,
        metadata: { date: today, failedChecks: errors.map(e => e.check) },
      });
      return res.status(403).json({ success: false, message: 'Attendance validation failed.', errors });
    }

    const teacher = await Teacher.findById(teacherId);
    let isSuspicious = false, suspiciousReason = null;
    if (teacher.deviceId && deviceId && teacher.deviceId !== deviceId) {
      isSuspicious = true; suspiciousReason = 'Attendance from unrecognized device.';
    }

    const record = await AttendanceRecord.create({
      schoolId, school: teacher.school,
      teacher: teacherId, teacherId: teacherId.toString(),
      date: today, mode: 'wifi',
      wifiSSID: wifiSSID || null, gatewayIp: gatewayIp || null,
      gpsLatitude: parseFloat(gpsLatitude), gpsLongitude: parseFloat(gpsLongitude),
      deviceId, isSuspicious, suspiciousReason,
    });

    if (isSuspicious) {
      await logEvent(req, 'attendance.suspicious_flagged', {
        targetType: 'teacher', targetId: teacherId, targetName: teacher.name,
        metadata: { date: today, mode: 'wifi', reason: suspiciousReason, deviceId },
      });
    }

    res.status(201).json({ success: true, message: 'Attendance marked successfully.', record });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: 'Attendance already marked for today.' });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GENERATE QR SESSION ─────────────────────────────────────────────────────
exports.generateQRSession = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const settings = await SchoolSettings.findOne({ schoolId });
    if (!settings) return res.status(500).json({ success: false, message: 'School settings not configured.' });
    if (!settings.qrAttendanceEnabled) return res.status(403).json({ success: false, message: 'QR attendance is disabled.' });

    const today = getTodayDate();
    await QRSession.updateMany({ schoolId, date: today, isActive: true }, { isActive: false });
    const token     = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + settings.qrExpiryMinutes * 60 * 1000);
    const session   = await QRSession.create({ schoolId, school: req.school._id, token, expiresAt, generatedBy: req.user.userId, date: today });
    res.status(201).json({ success: true, message: `QR valid for ${settings.qrExpiryMinutes} minutes.`, session: { token: session.token, expiresAt: session.expiresAt, date: session.date, expiryMinutes: settings.qrExpiryMinutes } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── GET ACTIVE QR SESSION ───────────────────────────────────────────────────
exports.getActiveQRSession = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const today   = getTodayDate();
    const session = await QRSession.findOne({ schoolId, date: today, isActive: true }).sort({ createdAt: -1 });
    if (!session || !session.isValid()) return res.json({ success: true, session: null });
    res.json({ success: true, session: { token: session.token, expiresAt: session.expiresAt, date: session.date } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── MARK QR ATTENDANCE ──────────────────────────────────────────────────────
exports.markQRAttendance = async (req, res) => {
  try {
    const { schoolId, userId: teacherId } = req.user;
    const { qrToken, deviceId } = req.body;
    const selfieUrl       = req.file ? req.file.path     : null;
    const selfiePublicId  = req.file ? req.file.filename : null;

    if (!selfieUrl) return res.status(400).json({ success: false, message: 'Live selfie is required.' });

    const settings = await SchoolSettings.findOne({ schoolId });
    if (!settings)                       return res.status(500).json({ success: false, message: 'School settings not configured.' });
    if (!settings.qrAttendanceEnabled)   return res.status(403).json({ success: false, message: 'QR attendance is disabled.' });

    const today = getTodayDate();
    const gate  = holidayGate(settings, today);
    if (gate) return res.status(403).json({ success: false, message: gate });

    const existing = await AttendanceRecord.findOne({ schoolId, teacherId: teacherId.toString(), date: today });
    if (existing) return res.status(409).json({ success: false, message: 'Attendance already marked for today.' });

    const session = await QRSession.findOne({ schoolId, token: qrToken, date: today });
    if (!session)          return res.status(400).json({ success: false, message: 'Invalid QR code.' });
    if (!session.isValid()) return res.status(400).json({ success: false, message: 'QR code expired. Ask admin to regenerate.' });

    const teacher = await Teacher.findById(teacherId);
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found.' });

    let isSuspicious = false, suspiciousReason = null;
    if (teacher.deviceId && deviceId && teacher.deviceId !== deviceId) {
      isSuspicious = true; suspiciousReason = 'Attendance from unrecognized device.';
    }

    const record = await AttendanceRecord.create({
      schoolId, school: teacher.school,
      teacher: teacherId, teacherId: teacherId.toString(),
      date: today, mode: 'qr', selfieUrl, selfiePublicId, qrSession: session._id,
      deviceId, isSuspicious, suspiciousReason,
    });

    if (isSuspicious) await logEvent(req, 'attendance.suspicious_flagged', { targetType:'teacher', targetId:teacherId, targetName:teacher.name, metadata:{ date:today, mode:'qr', reason:suspiciousReason, deviceId } });

    res.status(201).json({ success: true, message: 'Attendance marked successfully.', record });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: 'Attendance already marked for today.' });
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getTodayAttendance = async (req, res) => {
  try {
    const { schoolId } = req.user; const today = getTodayDate();
    const records     = await AttendanceRecord.find({ schoolId, date: today }).populate('teacher','name email').sort({ markedAt:-1 });
    const allTeachers = await Teacher.find({ schoolId, isActive: true }).select('name email');
    const presentIds  = new Set(records.map(r => r.teacherId));
    const absent      = allTeachers.filter(t => !presentIds.has(t._id.toString()));
    res.json({ success:true, date:today, summary:{ present:records.length, absent:absent.length, total:allTeachers.length }, present:records, absent });
  } catch (err) { res.status(500).json({ success:false, message:err.message }); }
};

exports.getMyAttendance = async (req, res) => {
  try {
    const { userId: teacherId, schoolId } = req.user;
    const { month, year } = req.query;
    const filter = { schoolId, teacherId: teacherId.toString() };
    if (month && year) filter.date = { $regex: `^${year}-${String(month).padStart(2,'0')}` };
    const records = await AttendanceRecord.find(filter).sort({ date: -1 });
    res.json({ success: true, total: records.length, records });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getMonthlyReport = async (req, res) => {
  try {
    const { schoolId } = req.user; const { month, year } = req.params;
    const datePrefix = `${year}-${String(month).padStart(2,'0')}`;
    const teachers = await Teacher.find({ schoolId, isActive: true }).select('name email');
    const records  = await AttendanceRecord.find({ schoolId, date: { $regex: `^${datePrefix}` } });
    const report   = teachers.map(t => {
      const recs = records.filter(r => r.teacherId === t._id.toString());
      return { teacher: { id:t._id, name:t.name, email:t.email }, totalPresent:recs.length, records: recs.map(r => ({ date:r.date, mode:r.mode, markedAt:r.markedAt })) };
    });
    res.json({ success:true, month, year, report });
  } catch (err) { res.status(500).json({ success:false, message:err.message }); }
};

exports.getDailyReport = async (req, res) => {
  try {
    const { schoolId } = req.user; const { date } = req.params;
    const records     = await AttendanceRecord.find({ schoolId, date }).populate('teacher','name email').sort({ markedAt:1 });
    const allTeachers = await Teacher.find({ schoolId, isActive: true }).select('name email');
    const presentIds  = new Set(records.map(r => r.teacherId));
    const absent      = allTeachers.filter(t => !presentIds.has(t._id.toString()));
    res.json({ success:true, date, summary:{ present:records.length, absent:absent.length, total:allTeachers.length }, present:records, absent });
  } catch (err) { res.status(500).json({ success:false, message:err.message }); }
};

exports.getSuspiciousActivity = async (req, res) => {
  try {
    const { schoolId, page = 1, limit = 50 } = req.query;
    const filter = { isSuspicious: true };
    if (schoolId) filter.schoolId = schoolId;
    const logs  = await AttendanceRecord.find(filter).populate('teacher','name email').populate('school','name').sort({ createdAt:-1 }).skip((page-1)*limit).limit(parseInt(limit));
    const total = await AttendanceRecord.countDocuments(filter);
    res.json({ success:true, total, page: parseInt(page), logs });
  } catch (err) { res.status(500).json({ success:false, message:err.message }); }
};
