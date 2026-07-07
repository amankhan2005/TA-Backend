const mongoose = require('mongoose');

/**
 * StudentAttendanceRecord — one document per student per day. Unlike the
 * existing teacher AttendanceRecord (which rejects a second write outright),
 * this record legitimately holds BOTH the punch-in and punch-out event —
 * the application layer (attendanceStateMachine.js) decides whether an
 * incoming scan is a punch-in, a punch-out, or should be ignored entirely
 * (in which case this record is never touched).
 */
const studentAttendanceRecordSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    studentIdRef: { type: String, required: true }, // Student.studentId, denormalized (mirrors Teacher AttendanceRecord's teacherId pattern)
    date: { type: String, required: true }, // "YYYY-MM-DD", school-local

    punchInAt: { type: Date, default: null },
    punchInRfid: { type: String, default: null },
    punchInDevice: { type: String, default: null },
    isLate: { type: Boolean, default: false },

    punchOutAt: { type: Date, default: null },
    punchOutRfid: { type: String, default: null },
    punchOutDevice: { type: String, default: null },

    status: { type: String, enum: ['punched_in', 'punched_out'], default: 'punched_in' },
    isLocked: { type: Boolean, default: false },

    // Immutable placement snapshot (Phase 7.1) — the class/section/session the
    // student belonged to WHEN this record was created. Analytics use these so
    // a later promotion/transfer never rewrites history. Null on pre-existing
    // records → analytics fall back to the student's current placement.
    classSnapshot: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolClass', default: null },
    sectionSnapshot: { type: mongoose.Schema.Types.ObjectId, ref: 'Section', default: null },
    sessionSnapshot: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicSession', default: null },

    notifications: {
      punchIn: { emailSent: { type: Boolean, default: false }, whatsappSent: { type: Boolean, default: false } },
      punchOut: { emailSent: { type: Boolean, default: false }, whatsappSent: { type: Boolean, default: false } },
      late: { emailSent: { type: Boolean, default: false }, whatsappSent: { type: Boolean, default: false } },
    },
  },
  { timestamps: true }
);

// Mirrors the existing teacher AttendanceRecord's uniqueness pattern exactly.
studentAttendanceRecordSchema.index({ schoolId: 1, studentIdRef: 1, date: 1 }, { unique: true });
studentAttendanceRecordSchema.index({ schoolId: 1, date: 1 });
studentAttendanceRecordSchema.index({ student: 1, date: 1 });

module.exports = mongoose.model('StudentAttendanceRecord', studentAttendanceRecordSchema);
