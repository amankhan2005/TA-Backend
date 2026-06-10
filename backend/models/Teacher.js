const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const teacherSchema = new mongoose.Schema({
  schoolId:     { type: String, required: true, index: true },
  school:       { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
  name:         { type: String, required: true, trim: true },
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  phone:        { type: String, default: null },
  deviceId:     { type: String, default: null },
  isActive:     { type: Boolean, default: true },

  // Issue 8 — profile picture
  profileImageUrl:      { type: String, default: null },
  profileImagePublicId: { type: String, default: null },

  // Issue 9 — deletion request
  deletionRequest: {
    requested:   { type: Boolean, default: false },
    requestedAt: { type: Date,    default: null  },
    reason:      { type: String,  default: null  },
    status:      { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
    resolvedAt:  { type: Date,    default: null  },
    resolvedBy:  { type: String,  default: null  },
  },
}, { timestamps: true });

teacherSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next();
  this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
  next();
});

teacherSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(password, this.passwordHash);
};

teacherSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  return obj;
};

module.exports = mongoose.model('Teacher', teacherSchema);
