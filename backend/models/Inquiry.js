const mongoose = require('mongoose');

const inquirySchema = new mongoose.Schema({
  // School info
  schoolName:    { type: String, required: true, trim: true },
  contactPerson: { type: String, required: true, trim: true },
  email:         { type: String, required: true, lowercase: true, trim: true },
  phone:         { type: String, required: true, trim: true },
  country:       { type: String, required: true, trim: true },
  teacherCount:  { type: Number, required: true, min: 1 },
  message:       { type: String, trim: true, default: '' },

  // Lifecycle
  status: {
    type: String,
    enum: ['new', 'contacted', 'demo_scheduled', 'converted', 'closed'],
    default: 'new',
    index: true,
  },

  // CRM notes
  notes: { type: String, trim: true, default: '' },

  // Tracking
  ipAddress:  { type: String, default: null },
  assignedTo: { type: String, default: null }, // Super Admin email

}, { timestamps: true });

inquirySchema.index({ email: 1 });
inquirySchema.index({ createdAt: -1 });
inquirySchema.index({ status: 1, createdAt: -1 });
inquirySchema.index({
  schoolName: 'text',
  contactPerson: 'text',
  email: 'text',
  country: 'text',
});

module.exports = mongoose.model('Inquiry', inquirySchema);
