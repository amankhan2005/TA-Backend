/**
 * planFeature.js — Gates a route behind a SubscriptionPlan.features flag.
 *
 * Must run AFTER requireActiveSchool (middleware/subscription.js), which
 * already attaches `req.school`. This middleware does not query the DB
 * again — it reads the plan off req.school.subscriptionPlan, so the plan
 * must be populated. requireActiveSchool does not currently populate it,
 * so routes using requireFeature() populate it explicitly (see usage note
 * below) — this is a deliberate, additive choice: requireActiveSchool's
 * existing behavior for the routes that already use it is NOT changed.
 *
 * Usage:
 *   router.post('/rfid/scan', deviceAuth, requireFeature('rfidAttendance'), handler);
 *   router.get('/fees', protect('schoolAdmin'), requireActiveSchool,
 *              requireFeature('feeManagement'), handler);
 */
const School = require('../models/School');

const requireFeature = (featureName) => {
  return async (req, res, next) => {
    try {
      // req.school is set by requireActiveSchool for JWT-authenticated routes.
      // req.deviceSchoolId is set by deviceAuth for hardware-authenticated routes.
      const schoolId = req.school?.schoolId || req.deviceSchoolId;
      if (!schoolId) {
        return res.status(403).json({ success: false, message: 'School context missing.' });
      }

      const school = await School.findOne({ schoolId }).populate('subscriptionPlan');
      if (!school || !school.subscriptionPlan) {
        return res.status(403).json({ success: false, message: 'No active subscription plan found.' });
      }

      const enabled = !!school.subscriptionPlan.features?.[featureName];
      if (!enabled) {
        return res.status(403).json({
          success: false,
          message: `This feature (${featureName}) is not enabled on your current plan. Contact support to upgrade.`,
        });
      }

      req.plan = school.subscriptionPlan;
      next();
    } catch (error) {
      res.status(500).json({ success: false, message: 'Server error during feature check.' });
    }
  };
};

module.exports = { requireFeature };
