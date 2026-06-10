const mongoose = require('mongoose');

const qrSessionSchema = new mongoose.Schema({
  schoolId: { type: String, required: true, index: true },
  school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
  token: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  isActive: { type: Boolean, default: true },
  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolAdmin', required: true },
  date: { type: String, required: true }, // YYYY-MM-DD — one session per school per day
}, { timestamps: true });

// Auto-expire: mark inactive after expiry
qrSessionSchema.methods.isValid = function () {
  return this.isActive && new Date() < this.expiresAt;
};

module.exports = mongoose.model('QRSession', qrSessionSchema);
