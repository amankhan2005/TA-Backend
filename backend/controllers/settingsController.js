const SchoolSettings = require('../models/SchoolSettings');
const { logEvent }   = require('../utils/audit');

exports.getSettings = async (req, res) => {
  try {
    const { schoolId } = req.user;
    let s = await SchoolSettings.findOne({ schoolId });
    if (!s) s = await SchoolSettings.create({ schoolId, school: req.school._id });
    res.json({ success: true, settings: s });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateWifiSettings = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { wifiSSID, wifiBSSID, gatewayIp, gpsLatitude, gpsLongitude, gpsRadius } = req.body;
    const upd = {};
    if (wifiSSID     !== undefined) upd.wifiSSID     = wifiSSID;
    // BSSID normalised to lower-case so device-side comparison is consistent
    if (wifiBSSID    !== undefined) upd.wifiBSSID    = wifiBSSID ? String(wifiBSSID).trim().toLowerCase() : null;
    if (gatewayIp    !== undefined) upd.gatewayIp    = gatewayIp;
    if (gpsLatitude  !== undefined) upd.gpsLatitude  = gpsLatitude;
    if (gpsLongitude !== undefined) upd.gpsLongitude = gpsLongitude;
    if (gpsRadius    !== undefined) upd.gpsRadius    = gpsRadius;
    const s = await SchoolSettings.findOneAndUpdate({ schoolId }, { $set: upd }, { new: true, runValidators: true });
    if (!s) return res.status(404).json({ success: false, message: 'Settings not found.' });
    await logEvent(req, 'settings.wifi.updated', { targetType:'settings', targetId:schoolId, metadata:{ fields:Object.keys(upd) } });
    res.json({ success: true, message: 'WiFi settings updated.', settings: s });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateQrSettings = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const s = await SchoolSettings.findOneAndUpdate({ schoolId }, { $set: { qrExpiryMinutes: req.body.qrExpiryMinutes } }, { new: true });
    if (!s) return res.status(404).json({ success: false, message: 'Settings not found.' });
    res.json({ success: true, message: 'QR settings updated.', settings: s });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.toggleAttendanceMode = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { wifiAttendanceEnabled, qrAttendanceEnabled } = req.body;
    if (wifiAttendanceEnabled === false && qrAttendanceEnabled === false)
      return res.status(400).json({ success: false, message: 'At least one attendance mode must be enabled.' });
    const upd = {};
    if (typeof wifiAttendanceEnabled === 'boolean') upd.wifiAttendanceEnabled = wifiAttendanceEnabled;
    if (typeof qrAttendanceEnabled   === 'boolean') upd.qrAttendanceEnabled   = qrAttendanceEnabled;
    const s = await SchoolSettings.findOneAndUpdate({ schoolId }, { $set: upd }, { new: true });
    if (!s) return res.status(404).json({ success: false, message: 'Settings not found.' });
    res.json({ success: true, message: 'Attendance mode updated.', settings: s });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// Issue 13 — weekly off
exports.updateWeeklyOffDays = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { weeklyOffDays } = req.body;
    if (!Array.isArray(weeklyOffDays) || !weeklyOffDays.every(d => Number.isInteger(d) && d >= 0 && d <= 6))
      return res.status(400).json({ success: false, message: 'weeklyOffDays must be array of integers 0-6.' });
    const s = await SchoolSettings.findOneAndUpdate({ schoolId }, { $set: { weeklyOffDays } }, { new: true });
    if (!s) return res.status(404).json({ success: false, message: 'Settings not found.' });
    await logEvent(req, 'settings.weeklyoff.updated', { targetType:'settings', targetId:schoolId, metadata:{ weeklyOffDays } });
    res.json({ success: true, message: 'Weekly off days updated.', settings: s });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// Issue 12 — holidays
exports.addHoliday = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { date, name, recurring } = req.body;
    const s = await SchoolSettings.findOneAndUpdate(
      { schoolId },
      { $push: { holidays: { date, name, recurring: !!recurring, isActive: true } } },
      { new: true }
    );
    if (!s) return res.status(404).json({ success: false, message: 'Settings not found.' });
    res.json({ success: true, message: 'Holiday added.', settings: s });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateHoliday = async (req, res) => {
  try {
    const { schoolId } = req.user; const { holidayId } = req.params;
    const { date, name, recurring, isActive } = req.body;
    const upd = {};
    if (date      !== undefined) upd['holidays.$.date']      = date;
    if (name      !== undefined) upd['holidays.$.name']      = name;
    if (recurring !== undefined) upd['holidays.$.recurring'] = recurring;
    if (isActive  !== undefined) upd['holidays.$.isActive']  = isActive;
    const s = await SchoolSettings.findOneAndUpdate({ schoolId, 'holidays._id': holidayId }, { $set: upd }, { new: true });
    if (!s) return res.status(404).json({ success: false, message: 'Holiday not found.' });
    res.json({ success: true, message: 'Holiday updated.', settings: s });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.deleteHoliday = async (req, res) => {
  try {
    const { schoolId } = req.user; const { holidayId } = req.params;
    const s = await SchoolSettings.findOneAndUpdate({ schoolId }, { $pull: { holidays: { _id: holidayId } } }, { new: true });
    if (!s) return res.status(404).json({ success: false, message: 'Settings not found.' });
    res.json({ success: true, message: 'Holiday deleted.', settings: s });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// Issue 6 — support contact
exports.updateSupportContact = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { supportPhone, supportEmail, supportWhatsApp } = req.body;
    const upd = {};
    if (supportPhone    !== undefined) upd.supportPhone    = supportPhone;
    if (supportEmail    !== undefined) upd.supportEmail    = supportEmail;
    if (supportWhatsApp !== undefined) upd.supportWhatsApp = supportWhatsApp;
    const s = await SchoolSettings.findOneAndUpdate({ schoolId }, { $set: upd }, { new: true });
    if (!s) return res.status(404).json({ success: false, message: 'Settings not found.' });
    await logEvent(req, 'settings.support.updated', { targetType:'settings', targetId:schoolId, metadata:upd });
    res.json({ success: true, message: 'Support contact updated.', settings: s });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};