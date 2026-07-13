require('dotenv').config();
require('./config/validateEnv').validateEnv({ role: 'api' });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/db');
const errorHandler = require('./middleware/errorHandler');
const brand = require('./config/brand');

// Route imports
const authRoutes          = require('./routes/auth');
const schoolRoutes        = require('./routes/schools');
const teacherRoutes       = require('./routes/teachers');
const attendanceRoutes    = require('./routes/attendance');
const settingsRoutes      = require('./routes/settings');
const planRoutes          = require('./routes/plans');
const auditRoutes         = require('./routes/audit');
const appVersionRoutes    = require('./routes/appVersion');
const inquiryRoutes       = require('./routes/inquiries');
const teacherInquiryRoutes = require('./routes/teacherInquiries');

// ── ERP Phase 2+ route imports (additive; nothing above is touched) ─────────
const sessionRoutes       = require('./routes/sessions');
const classRoutes         = require('./routes/classes');
const sectionRoutes       = require('./routes/sections');
const studentRoutes       = require('./routes/students');
const rfidRoutes          = require('./routes/rfid');
const studentAttendanceRoutes = require('./routes/studentAttendance');
const apiDeviceRoutes     = require('./routes/apiDevices');
const reportRoutes        = require('./routes/reports');
const feeRoutes           = require('./routes/fees');
const dashboardRoutes     = require('./routes/dashboard');
const platformRoutes      = require('./routes/platform');
const promotionRoutes     = require('./routes/promotions');
const identityRoutes      = require('./routes/identity');
const verificationRoutes  = require('./routes/verification');
const parentAuthRoutes    = require('./routes/parentAuth');
const parentPortalRoutes  = require('./routes/parentPortal');
const parentsRoutes       = require('./routes/parents');
const notificationSettingsRoutes = require('./routes/notificationSettings');

const app = express();

 
app.set('trust proxy', 1);

// ─────────────────────────────────────────────────────────────
// Connect Database
// ─────────────────────────────────────────────────────────────
connectDB();

// ─────────────────────────────────────────────────────────────
// Security Middleware
// ─────────────────────────────────────────────────────────────
app.use(helmet());

 
// The full allowlist — production origins (liberiaschoolhub.com and the
// api/parent/schooladmin hosts), any EXTRA_CORS_ORIGINS, and localhost dev
// ports — is centralised in config/brand.js so the domain lives in exactly
// one place. Subpath apps (/parent, /schooladmin) collapse to one origin,
// which is all the browser's Origin header carries.
 
const allowedOrigins = [
  'https://www.liberiaschoolhub.com',
  'https://liberiaschoolhub.com',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
];

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));
// ─────────────────────────────────────────────────────────────
// Rate Limiting
// ─────────────────────────────────────────────────────────────

// Global limiter
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  message: { success: false, message: 'Too many requests. Please try again in a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// Auth limiter (login / register protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { success: false, message: 'Too many login attempts. Please try again in 15 minutes.' },
});

// ─────────────────────────────────────────────────────────────
// Body Parsing
// ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── NoSQL-injection hardening (audit Fix 1) ─────────────────────────────────
// Strips any key containing a Mongo operator prefix ($) or a dot from
// req.body / req.query / req.params, so payloads like {"$gt":""} or
// {"$ne":null} can never reach a query. Runs after body parsing, before routes.
const mongoSanitize = require('express-mongo-sanitize');
app.use(mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ req, key }) => {
    console.warn(`[security] sanitized suspicious key "${key}" on ${req.method} ${req.originalUrl} from ${req.ip}`);
  },
}));

// ─────────────────────────────────────────────────────────────
// Health Check
// ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'TeacherAttendance API is running.',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date(),
  });
});

// ─────────────────────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────────────────────
app.use('/api/auth',             authLimiter, authRoutes);
app.use('/api/schools',          schoolRoutes);
app.use('/api/teachers',         teacherRoutes);
app.use('/api/attendance',       attendanceRoutes);
app.use('/api/settings',         settingsRoutes);
app.use('/api/plans',            planRoutes);
app.use('/api/audit',            auditRoutes);
app.use('/api/app-version',      appVersionRoutes);
app.use('/api/teacher-inquiries', teacherInquiryRoutes);
app.use('/api/inquiries',        inquiryRoutes);

// ── ERP Phase 2+ routes (additive; nothing above is touched) ────────────────
app.use('/api/sessions',         sessionRoutes);
app.use('/api/classes',          classRoutes);
app.use('/api/sections',         sectionRoutes);
app.use('/api/students',         studentRoutes);
app.use('/api/rfid',             rfidRoutes);
app.use('/api/student-attendance', studentAttendanceRoutes);
app.use('/api/rfid-devices',       apiDeviceRoutes);
app.use('/api/reports',            reportRoutes);
app.use('/api/fees',               feeRoutes);
app.use('/api/dashboard',          dashboardRoutes);
app.use('/api/platform',           platformRoutes);
app.use('/api/promotions',         promotionRoutes);
app.use('/api/identity',           identityRoutes);
app.use('/api/verification',       verificationRoutes);
app.use('/api/parent/auth',        parentAuthRoutes);
app.use('/api/parent/portal',      parentPortalRoutes);
app.use('/api/parents',            parentsRoutes);
app.use('/api/notification-settings', notificationSettingsRoutes);

// ─────────────────────────────────────────────────────────────
// 404 Handler
// ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found.`,
  });
});

// ─────────────────────────────────────────────────────────────
// Global Error Handler
// ─────────────────────────────────────────────────────────────
app.use(errorHandler);

// ─────────────────────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
  console.log(
    `🚀 TeacherAttendance API running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`
  );
});

module.exports = app;