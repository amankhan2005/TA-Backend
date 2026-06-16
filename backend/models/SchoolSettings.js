const mongoose = require('mongoose');

const holidaySchema = new mongoose.Schema({
  date:      { type: String,  required: true },  // YYYY-MM-DD
  name:      { type: String,  required: true },
  recurring: { type: Boolean, default: false },
  isActive:  { type: Boolean, default: true  },
}, { _id: true });

const schoolSettingsSchema = new mongoose.Schema({
  schoolId: { type: String, required: true, unique: true, index: true },
  school:   { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },

  wifiAttendanceEnabled: { type: Boolean, default: true  },
  qrAttendanceEnabled:   { type: Boolean, default: true  },
  wifiSSID:              { type: String,  default: null   },
  // BSSID = the access point's MAC address (e.g. "a4:2b:b0:11:22:33").
  // Uniquely identifies the physical router, so it can't be spoofed by simply
  // naming another network the same SSID. Stored lower-case for comparison.
  wifiBSSID:             { type: String,  default: null   },
  // gatewayIp kept for backward compatibility with older records; no longer
  // used for validation (the gateway IP is not reliably retrievable on-device).
  gatewayIp:             { type: String,  default: null   },
  gpsLatitude:           { type: Number,  default: null   },
  gpsLongitude:          { type: Number,  default: null   },
  gpsRadius:             { type: Number,  default: 100    },
  qrExpiryMinutes:       { type: Number,  default: 10     },

  // Issue 13 — weekly off (0=Sun … 6=Sat)
  weeklyOffDays:   { type: [Number], default: [] },

  // Issue 12 — holiday calendar
  holidays:        { type: [holidaySchema], default: [] },

  // Issue 6 — support contact
  supportPhone:    { type: String, default: null },
  supportEmail:    { type: String, default: null },
  supportWhatsApp: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('SchoolSettings', schoolSettingsSchema);