const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { requireActiveSchool } = require('../middleware/subscription');
const admin = require('../controllers/parentAdminController');
const leave = require('../controllers/leaveController');

// School-admin management of parent accounts + leave review.
const guard = [protect('schoolAdmin'), requireActiveSchool];

router.post('/', ...guard, admin.createParent);      // { name, mobileNumber, email, studentId, relation }
router.post('/link', ...guard, admin.linkChild);     // { parentId, studentId, relation }
router.get('/leave', ...guard, leave.listForSchool); // ?status=&student=
router.post('/leave/:leaveId/review', ...guard, leave.review); // { decision, remarks }

module.exports = router;
