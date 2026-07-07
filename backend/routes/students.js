const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { requireActiveSchool } = require('../middleware/subscription');
const { uploadStudentPhoto } = require('../config/cloudinary');
const {
  createStudent, getStudents, getStudent, updateStudent, deleteStudent, getStudentProfile,
} = require('../controllers/studentController');

router.use(protect('schoolAdmin'), requireActiveSchool);

router.post('/', uploadStudentPhoto.single('photo'), [
  body('admissionNumber').notEmpty(),
  body('name').notEmpty(),
  body('dob').isISO8601(),
  body('gender').isIn(['male', 'female', 'other']),
  body('class').notEmpty(),
  body('section').notEmpty(),
  body('session').notEmpty(),
  validate,
], createStudent);

router.get('/', getStudents); // paginated: ?page=&limit=&search=&classId=&section=&status=
router.get('/:id', getStudent);
router.get('/:id/profile', getStudentProfile);
router.patch('/:id', uploadStudentPhoto.single('photo'), updateStudent);
router.delete('/:id', deleteStudent);

module.exports = router;
