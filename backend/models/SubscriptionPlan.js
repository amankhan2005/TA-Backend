const mongoose = require('mongoose');

const subscriptionPlanSchema = new mongoose.Schema({
  name: { type: String, required: true, enum: ['Basic', 'Pro', 'Enterprise'], unique: true },
  maxTeachers: { type: Number, required: true },
  features: {
    wifiAttendance: { type: Boolean, default: true },
    qrAttendance: { type: Boolean, default: true },
    monthlyReports: { type: Boolean, default: true },
    analyticsReports: { type: Boolean, default: false },
    prioritySupport: { type: Boolean, default: false },
  },
  price: { type: Number, required: true }, // monthly price in KES
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
