const School = require('../models/School');

// Blocks access if school is inactive or suspended
const requireActiveSchool = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    if (!schoolId) return res.status(403).json({ success: false, message: 'School context missing.' });

    const school = await School.findOne({ schoolId });
    if (!school) return res.status(404).json({ success: false, message: 'School not found.' });

    if (school.status === 'inactive') {
      return res.status(403).json({ success: false, message: 'Your school subscription is inactive. Please contact support.' });
    }
    if (school.status === 'suspended') {
      return res.status(403).json({ success: false, message: 'Your school account has been suspended. Please contact support.' });
    }

    req.school = school;
    next();
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error during subscription check.' });
  }
};

module.exports = { requireActiveSchool };
