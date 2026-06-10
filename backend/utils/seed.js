/**
 * TeacherAttendance — Database Seed Script
 * Run: node utils/seed.js
 *
 * Creates:
 *   - 1 Super Admin account
 *   - 3 Subscription Plans (Basic, Pro, Enterprise)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const SuperAdmin = require('../models/SuperAdmin');
const SubscriptionPlan = require('../models/SubscriptionPlan');

const seed = async () => {
  await connectDB();

  // ── Subscription Plans ────────────────────────────────────────────────────
  const plans = [
    { name: 'Basic',      maxTeachers: 20,  price: 2000,  features: { wifiAttendance: true,  qrAttendance: false, monthlyReports: true,  analyticsReports: false, prioritySupport: false } },
    { name: 'Pro',        maxTeachers: 60,  price: 5000,  features: { wifiAttendance: true,  qrAttendance: true,  monthlyReports: true,  analyticsReports: true,  prioritySupport: false } },
    { name: 'Enterprise', maxTeachers: 200, price: 12000, features: { wifiAttendance: true,  qrAttendance: true,  monthlyReports: true,  analyticsReports: true,  prioritySupport: true  } },
  ];

  for (const plan of plans) {
    await SubscriptionPlan.findOneAndUpdate(
      { name: plan.name },
      plan,
      { upsert: true, new: true }
    );
    console.log(`✅ Plan: ${plan.name}`);
  }

  // ── Super Admin ───────────────────────────────────────────────────────────
  const existingAdmin = await SuperAdmin.findOne({ email: 'admin@teacherattendance.com' });
  if (!existingAdmin) {
    await SuperAdmin.create({
      name: 'TeacherAttendance Super Admin',
      email: 'admin@teacherattendance.com',
      passwordHash: 'Admin@1234',
    });
    console.log('✅ Super Admin created: admin@teacherattendance.com / Admin@1234');
    console.log('⚠️  IMPORTANT: Change this password immediately after first login!');
  } else {
    console.log('ℹ️  Super Admin already exists — skipped.');
  }

  console.log('\n🎉 TeacherAttendance database seeded successfully!');
  process.exit(0);
};

seed().catch(err => {
  console.error('❌ Seed error:', err);
  process.exit(1);
});
