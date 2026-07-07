/* Ad-hoc integration test for the Attendance-Rules-Management phase.
 * Run: node tests/attendancePhase.itest.js
 * Uses mongodb-memory-server; asserts the NEW logic against a real DB.
 */
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

function mockRes() {
  const r = { statusCode: 200, headers: {}, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (o) => { r.body = o; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.send = (s) => { r.body = s; return r; };
  r.end = () => {};
  return r;
}
const assert = require('assert');
let passed = 0; const fail = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ok -', name); } else { fail.push(name); console.log('  FAIL -', name); } }

(async () => {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  const Session = require('../models/AcademicSession');
  const Klass = require('../models/SchoolClass');
  const Section = require('../models/Section');
  const Student = require('../models/Student');
  const SAR = require('../models/StudentAttendanceRecord');
  const Invoice = require('../models/StudentInvoice');
  const Payment = require('../models/FeePayment');
  const School = require('../models/School');

  const schoolId = 'S1';
  const school = await School.create({ schoolId, name: 'Test School', email: 't@s.com', city: 'X', state: 'Y', country: 'Z', passwordHash: 'x', subdomain: 's1' }).catch(async () => {
    // Fallback: School schema unknown-required — create minimally by bypassing strict required via raw insert.
    return mongoose.connection.collection('schools').insertOne({ schoolId, name: 'Test School' });
  });
  const sess = await Session.create({ schoolId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') }).catch(e => { throw new Error('Session seed: ' + e.message); });
  const cls = await Klass.create({ schoolId, session: sess._id, name: 'Grade 1' }).catch(e => { throw new Error('Class seed: ' + e.message); });
  const sec = await Section.create({ schoolId, session: sess._id, class: cls._id, name: 'A' }).catch(e => { throw new Error('Section seed: ' + e.message); });

  async function mkStudent(sid, name) {
    return Student.create({
      schoolId, school: new mongoose.Types.ObjectId(), studentId: sid, admissionNumber: 'ADM-' + sid,
      name, dob: new Date('2015-01-01'), gender: 'male', class: cls._id, section: sec._id, session: sess._id,
      admissionDate: new Date('2026-01-01'), status: 'active', email: name.toLowerCase() + '@p.com', whatsappNumber: '2311234567',
    });
  }
  const alice = await mkStudent('STU-1', 'Alice');
  const bob = await mkStudent('STU-2', 'Bob');
  const carol = await mkStudent('STU-3', 'Carol'); // zero records → 0%

  // Attendance across Mon–Fri 2026-07-06..10 (all school days). Alice present 5/5, Bob 1/5.
  const days = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'];
  for (const d of days) {
    await SAR.create({ schoolId, student: alice._id, studentIdRef: 'STU-1', date: d, punchInAt: new Date(d + 'T08:05:00'), punchInRfid: 'RF-A', status: 'punched_in', isLate: d === '2026-07-06' });
  }
  await SAR.create({ schoolId, student: bob._id, studentIdRef: 'STU-2', date: '2026-07-06', punchInAt: new Date('2026-07-06T08:00:00'), punchInRfid: 'RF-B', status: 'punched_in', isLate: false });

  // Invoices: Bob owes, Carol paid in full, Alice none.
  await Invoice.create({ schoolId, student: bob._id, studentIdRef: 'STU-2', invoiceNumber: 'INV-1', currency: 'USD', lineItems: [{ description: 'Tuition', amountMinor: 10000, quantity: 1, lineTotalMinor: 10000 }], subtotalMinor: 10000, totalPayableMinor: 10000, paidMinor: 2000, status: 'partial', dueDate: new Date('2026-07-01'), classSnapshot: cls._id, sectionSnapshot: sec._id, sessionSnapshot: sess._id });
  await Invoice.create({ schoolId, student: carol._id, studentIdRef: 'STU-3', invoiceNumber: 'INV-2', currency: 'USD', lineItems: [{ description: 'Tuition', amountMinor: 10000, quantity: 1, lineTotalMinor: 10000 }], subtotalMinor: 10000, totalPayableMinor: 10000, paidMinor: 10000, status: 'paid', dueDate: new Date('2026-07-01'), classSnapshot: cls._id, sectionSnapshot: sec._id, sessionSnapshot: sess._id });
  await Payment.create({ schoolId, invoice: new mongoose.Types.ObjectId(), student: bob._id, studentIdRef: 'STU-2', receiptNumber: 'R1', currency: 'USD', amountMinor: 2000, appliedMinor: 2000, method: 'cash', paidAt: new Date('2026-07-02'), status: 'recorded' });

  const attCtl = require('../controllers/attendanceExportController');
  const feeCtl = require('../controllers/feeController');
  const saCtl = require('../controllers/studentAttendanceController');

  // ── T1: settings cross-field validation rejects duplicate >= minPunchOut ──
  {
    const res = mockRes();
    await saCtl.updateSettings({ user: { schoolId }, body: { duplicateScanWindowMinutes: 300, minPunchOutDurationMinutes: 120 } }, res);
    ok('settings: rejects duplicateWindow >= minPunchOut', res.statusCode === 400);
  }
  // ── T2: valid settings update persists coerced numbers ──
  {
    const res = mockRes();
    await saCtl.updateSettings({ user: { schoolId }, body: { schoolStartTime: '08:00', minPunchOutDurationMinutes: '240', duplicateScanWindowMinutes: '5', lateThresholdMinutes: '15' } }, res);
    ok('settings: valid update succeeds', res.body?.success === true && res.body.settings.minPunchOutDurationMinutes === 240);
  }

  // ── T3: attendance defaulters (< 75%) — Bob(20%) & Carol(0%) in, Alice(100%) out ──
  {
    const res = mockRes();
    await attCtl.getAttendanceDefaulters({ user: { schoolId }, query: { range: 'custom', from: '2026-07-06', to: '2026-07-10', threshold: '75' } }, res);
    const names = (res.body.results || []).map(r => r.studentName).sort();
    ok('defaulters: correct set below 75%', JSON.stringify(names) === JSON.stringify(['Bob', 'Carol']));
    const bobRow = res.body.results.find(r => r.studentName === 'Bob');
    ok('defaulters: Bob 1/5 = 20%', bobRow && bobRow.attendancePct === 20 && bobRow.present === 1 && bobRow.absent === 4);
    const carolRow = res.body.results.find(r => r.studentName === 'Carol');
    ok('defaulters: Carol 0% (no records, roster-expanded)', carolRow && carolRow.attendancePct === 0);
  }

  // ── T4: student attendance CSV export has 12 headers + Alice rows ──
  {
    const res = mockRes();
    await attCtl.exportStudentAttendance({ user: { schoolId }, query: { format: 'csv', range: 'custom', from: '2026-07-06', to: '2026-07-10' } }, res);
    const csv = res.body || '';
    ok('student export: csv content-type', /text\/csv/.test(res.headers['Content-Type'] || ''));
    ok('student export: 12 columns', /Student Name,Admission Number,Session,Class,Section,RFID,Date,Punch In,Punch Out,Status,Late,Attendance %/.test(csv));
    ok('student export: Alice 100% present rows', /Alice/.test(csv) && /100%/.test(csv));
  }

  // ── T5: teacher export headers (no teacher records → header-only, still valid) ──
  {
    const res = mockRes();
    await attCtl.exportTeacherAttendance({ user: { schoolId }, query: { format: 'csv', range: 'custom', from: '2026-07-06', to: '2026-07-10' } }, res);
    ok('teacher export: 7 columns', /Teacher Name,Employee ID,Date,Check In,Check Out,Status,Late/.test(res.body || ''));
  }

  // ── T6: fee defaulters — only Bob (owes 80.00), not Carol (paid) ──
  {
    const res = mockRes();
    await feeCtl.getFeeDefaulters({ user: { schoolId }, query: {} }, res);
    const rows = res.body.results || [];
    ok('fee defaulters: only Bob', rows.length === 1 && rows[0].studentName === 'Bob');
    ok('fee defaulters: pending = 80.00 USD, lastPayment set', rows[0] && rows[0].pendingMinor === 8000 && rows[0].lastPaymentDate === '2026-07-02');
  }

  // ── T7: fee defaulters CSV export headers ──
  {
    const res = mockRes();
    await feeCtl.getFeeDefaulters({ user: { schoolId }, query: { format: 'csv' } }, res);
    ok('fee defaulters export: 8 columns', /Student,Admission Number,Class,Section,Total Fee,Paid,Pending,Last Payment Date/.test(res.body || ''));
  }

  await mongoose.disconnect();
  await mongo.stop();

  console.log(`\nPASSED ${passed}, FAILED ${fail.length}` + (fail.length ? `: ${fail.join(', ')}` : ''));
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
