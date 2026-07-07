const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { requireActiveSchool } = require('../middleware/subscription');
const c = require('../controllers/promotionController');

// Student promotion is a core academic operation (not a paid add-on).
const guard = [protect('schoolAdmin'), requireActiveSchool];

router.post('/', ...guard, c.createBatch);
router.get('/', ...guard, c.listBatches);
router.get('/students/:studentId/history', ...guard, c.getStudentHistory);
router.get('/:id', ...guard, c.getBatch);
router.post('/:id/preview', ...guard, c.previewBatch);
router.post('/:id/execute', ...guard, c.executeBatch);
router.post('/:id/rollback', ...guard, c.rollbackBatch);
router.post('/:id/cancel', ...guard, c.cancelBatch);

module.exports = router;
