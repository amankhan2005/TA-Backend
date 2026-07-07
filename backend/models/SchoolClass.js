const mongoose = require('mongoose');

/**
 * SchoolClass — a grade/class within a school (e.g. "Grade 5"). School Admin
 * can either bulk-create the standard Liberia default list (see
 * DEFAULT_LIBERIA_GRADES below, used by the "quick setup" endpoint in
 * academicController.js) or create fully custom grades. Both paths write to
 * this same collection — there is no special-cased "default" vs "custom"
 * type, keeping the model and every downstream query (Student.class, fees,
 * promotion) agnostic to how a grade was created.
 */

const schoolClassSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    session: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicSession', required: true },
    name: { type: String, required: true, trim: true }, // "Nursery", "K1", "Grade 5", or any custom name
    sortOrder: { type: Number, required: true, default: 0 }, // display ordering — NOT alphabetical (Grade 2 < Grade 10)
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

schoolClassSchema.index({ schoolId: 1, session: 1, name: 1 }, { unique: true });
schoolClassSchema.index({ schoolId: 1, session: 1, sortOrder: 1 });

// Default Liberia grade structure — used only by the optional "quick setup"
// endpoint; School Admin is never required to use it and can freely add,
// rename, or remove classes beyond this list.
const DEFAULT_LIBERIA_GRADES = [
  'Nursery', 'K1', 'K2',
  'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6',
  'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12',
];

module.exports = mongoose.model('SchoolClass', schoolClassSchema);
module.exports.DEFAULT_LIBERIA_GRADES = DEFAULT_LIBERIA_GRADES;
