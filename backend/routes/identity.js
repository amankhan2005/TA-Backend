const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { requireActiveSchool } = require('../middleware/subscription');
const c = require('../controllers/identityController');

// Identity Center — school admin only, tenant-scoped by req.user.schoolId.
const guard = [protect('schoolAdmin'), requireActiveSchool];

router.get('/health', ...guard, c.getHealth);
router.get('/rfid/:uid/verify', ...guard, c.verifyRfid);
router.get('/students/:studentId/profile', ...guard, c.getProfile);
router.get('/students/:studentId/history', ...guard, c.getHistory);
router.get('/students/:studentId/verify', ...guard, c.verifyStudent);
router.post('/students/:studentId/qr', ...guard, c.generateQr);        // { regenerate?:bool }
router.get('/students/:studentId/qr.png', ...guard, c.getQrImage);
router.get('/students/:studentId/sheet', ...guard, c.getStudentSheet); // optional identity PDF
router.post('/students/:studentId/reissue', ...guard, c.reissue);      // { newRfidNumber, reason, retireStatus? }
router.post('/cards/:cardId/lost', ...guard, c.markLost);
router.post('/cards/:cardId/damaged', ...guard, c.markDamaged);
// Bulk (queued, non-blocking)
router.post('/bulk/qr', ...guard, c.bulkQr);
router.post('/bulk/pdf', ...guard, c.bulkPdf);
router.post('/bulk/export', ...guard, c.bulkExport);

module.exports = router;
