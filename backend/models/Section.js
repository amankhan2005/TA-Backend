const mongoose = require('mongoose');

const sectionSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },
    class: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolClass', required: true },
    name: { type: String, required: true, trim: true }, // "A", "B", "C" — unlimited, free text
    capacity: { type: Number, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

sectionSchema.index({ schoolId: 1, class: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Section', sectionSchema);
