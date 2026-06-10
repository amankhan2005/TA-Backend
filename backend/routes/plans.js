const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { getPlans, createPlan, updatePlan, deletePlan } = require('../controllers/planController');

router.get('/', getPlans); // Public — used in invite form dropdown

router.post('/', protect('superAdmin'), [
  body('name').isIn(['Basic', 'Pro', 'Enterprise']).withMessage('Plan name must be Basic, Pro, or Enterprise.'),
  body('maxTeachers').isInt({ min: 1 }).withMessage('maxTeachers must be a positive integer.'),
  body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number.'),
  validate,
], createPlan);

router.put('/:id', protect('superAdmin'), updatePlan);
router.delete('/:id', protect('superAdmin'), deletePlan);

module.exports = router;
