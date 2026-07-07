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

    // ── ERP Phase 0+ feature flags ───────────────────────────────────────
    // All default to false so every EXISTING seeded plan (Basic/Pro/Enterprise)
    // keeps today's behavior unchanged until a Super Admin explicitly enables
    // a flag per plan. No existing school gains or loses access silently.
    rfidAttendance:      { type: Boolean, default: false },
    feeManagement:       { type: Boolean, default: false },
    parentPortal:        { type: Boolean, default: false },
    whatsappNotifications: { type: Boolean, default: false },
    promotionSystem:     { type: Boolean, default: false },
    idCardGeneration:    { type: Boolean, default: false },
    leaveManagement:     { type: Boolean, default: false },
    bulkImportExport:    { type: Boolean, default: false },
  },
  price: { type: Number, required: true }, // monthly SaaS subscription price (platform billing — unrelated to student fee currency)

  // ── ERP Phase 0+ limits ───────────────────────────────────────────────
  // Optional (not required) so existing plan documents remain valid without
  // a migration. Controllers treat a missing/null limit as "unlimited" —
  // mirrors how maxTeachers already works today, just made explicit here.
  studentLimit:    { type: Number, default: null },
  rfidLimit:       { type: Number, default: null },
  storageLimitMB:  { type: Number, default: null },

  isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
