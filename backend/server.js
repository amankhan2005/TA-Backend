 require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/db');
const errorHandler = require('./middleware/errorHandler');

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

 
const allowedOrigins = [
  // Production — main domain (covers all subpath-deployed panel apps
  // because browsers send only the domain as the Origin header)
  'https://teacherattendance.com',
  'https://www.teacherattendance.com',

  // Local development
  'http://localhost:5173',   // Vite default / website
  'http://localhost:5174',   // school admin local
  'http://localhost:5175',   // super admin local

  // Netlify preview URLs (add your actual Netlify app hostnames here)
  'https://teachertattendance.netlify.app',
  // e.g. 'https://ta-schooladmin.netlify.app',
  // e.g. 'https://ta-superadmin.netlify.app',
].filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    // Allow server-to-server / mobile app / Postman (no Origin header)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) return callback(null, true);

    return callback(new Error(`CORS blocked: ${origin} is not allowed`));
  },

  credentials: true,

  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

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