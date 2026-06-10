const mongoose = require('mongoose');

const schoolSchema = new mongoose.Schema({
  schoolId: { type: String, required: true, unique: true },
  name: { type: String, required: true, trim: true },
  city: { type: String, required: true, trim: true },
  state: { type: String, required: true, trim: true },
  phone: { type: String, required: true },
  website: { type: String, default: null },
  logoUrl: { type: String, default: null },
  logoPublicId: { type: String, default: null }, // Cloudinary public_id for deletion
  status: { type: String, enum: ['active', 'inactive', 'suspended'], default: 'active' },
  subscriptionPlan: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionPlan', required: true },
  maxTeachers: { type: Number, required: true },
  inviteToken: { type: String, default: null },
  inviteTokenExpiry: { type: Date, default: null },
  inviteEmail: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('School', schoolSchema);
