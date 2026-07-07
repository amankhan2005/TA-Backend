const mongoose = require('mongoose');

/**
 * NotificationSettings — one document per school, controlling which
 * channel(s) are used for each notification type. School Admin configurable.
 *
 * Defaults intentionally favor email-only: WhatsApp requires an approved
 * Meta Business template + working Cloud API credentials per school's
 * chosen provider setup, so it should be an explicit opt-in per school,
 * not silently on for schools that haven't set it up yet.
 */

const channelPair = () => ({
  email: { type: Boolean, default: true },
  whatsapp: { type: Boolean, default: false },
});

const notificationSettingsSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, unique: true, index: true },

    attendancePunchIn: channelPair(),
    attendancePunchOut: channelPair(),
    attendanceLate: channelPair(),
    feeReminderDue: channelPair(),
    feeReminderOverdue: channelPair(),
    reportDelivery: channelPair(),
  },
  { timestamps: true }
);

module.exports = mongoose.model('NotificationSettings', notificationSettingsSchema);
