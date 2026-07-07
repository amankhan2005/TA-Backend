const ApiDevice = require('../models/ApiDevice');

/**
 * deviceAuth.js — Authenticates hardware/kiosk devices (RFID readers, etc.)
 * against ApiDevice records, instead of the JWT-based `protect()` used for
 * human users. Devices don't hold a login session, so this is a separate,
 * parallel auth mechanism — it does not touch or modify middleware/auth.js.
 *
 * Expected header: `X-Device-Key: <deviceId>.<rawKey>`
 * (deviceId is the ApiDevice _id, not secret by itself — the raw key is
 *  the actual secret and is bcrypt-compared against the stored hash.)
 *
 * On success, attaches `req.device` (safe object, no key hash) and
 * `req.deviceSchoolId` for the controller to use exactly like `req.user`
 * carries `schoolId` for human-authenticated routes.
 */
const deviceAuth = async (req, res, next) => {
  try {
    const header = req.headers['x-device-key'];
    if (!header || !header.includes('.')) {
      return res.status(401).json({ success: false, message: 'Device credentials missing or malformed.' });
    }

    const [deviceId, rawKey] = header.split('.');
    if (!deviceId || !rawKey) {
      return res.status(401).json({ success: false, message: 'Device credentials missing or malformed.' });
    }

    const device = await ApiDevice.findById(deviceId);
    if (!device || !device.isActive) {
      return res.status(401).json({ success: false, message: 'Device not recognized or has been deactivated.' });
    }

    const valid = await device.compareKey(rawKey);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid device credentials.' });
    }

    // Fire-and-forget last-seen update — never blocks or fails the request.
    ApiDevice.updateOne({ _id: device._id }, { lastSeenAt: new Date() }).catch(() => {});

    req.device = device.toSafeObject();
    req.deviceSchoolId = device.schoolId;
    next();
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error during device authentication.' });
  }
};

module.exports = { deviceAuth };
