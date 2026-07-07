/**
 * attendanceAnalyticsService.js — Attendance analytics for one school, from the
 * RFID StudentAttendanceRecord data. Tenant-scoped by schoolId.
 *
 * Attendance % definition (documented): for a period, % =
 *   (total present-records in period) / (activeStudents × distinctDatesWithData)
 * i.e. average daily presence over the days that actually had attendance —
 * avoids needing the holiday/weekend calendar here (that lives in the report
 * summary engine) while giving a stable, explainable rate.
 */

const StudentAttendanceRecord = require('../../models/StudentAttendanceRecord');
const Student = require('../../models/Student');
const { dayBounds, weekBounds, monthBounds, toDateStr, trendBuckets } = require('./time');

const pct = (num, den) => (den > 0 ? +((num / den) * 100).toFixed(1) : 0);

async function activeCount(schoolId) {
  return Student.countDocuments({ schoolId, status: 'active' });
}

async function todaySnapshot({ schoolId, ref = new Date() }) {
  const today = dayBounds(ref).str;
  const [active, present, late, inside, checkedOut] = await Promise.all([
    activeCount(schoolId),
    StudentAttendanceRecord.countDocuments({ schoolId, date: today }),
    StudentAttendanceRecord.countDocuments({ schoolId, date: today, isLate: true }),
    StudentAttendanceRecord.countDocuments({ schoolId, date: today, status: 'punched_in' }),
    StudentAttendanceRecord.countDocuments({ schoolId, date: today, status: 'punched_out' }),
  ]);
  return {
    date: today, activeStudents: active,
    presentToday: present, absentToday: Math.max(0, active - present), lateToday: late,
    currentlyInside: inside, checkedOut,
    attendancePercentageToday: pct(present, active),
  };
}

// Period attendance % using the documented definition.
async function periodPercentage({ schoolId, startStr, endStr }) {
  const active = await activeCount(schoolId);
  const rows = await StudentAttendanceRecord.aggregate([
    { $match: { schoolId, date: { $gte: startStr, $lte: endStr } } },
    { $group: { _id: '$date', present: { $sum: 1 } } },
  ]);
  if (!rows.length || active === 0) return { percentage: 0, distinctDays: 0, avgDailyPresent: 0 };
  const totalPresent = rows.reduce((s, r) => s + r.present, 0);
  const distinctDays = rows.length;
  const avgDailyPresent = totalPresent / distinctDays;
  return { percentage: pct(avgDailyPresent, active), distinctDays, avgDailyPresent: +avgDailyPresent.toFixed(1) };
}

async function attendanceRates({ schoolId, ref = new Date() }) {
  const today = dayBounds(ref);
  const week = weekBounds(ref);
  const month = monthBounds(ref);
  const [t, w, m] = await Promise.all([
    periodPercentage({ schoolId, startStr: today.str, endStr: today.str }),
    periodPercentage({ schoolId, startStr: week.startStr, endStr: week.endStr }),
    periodPercentage({ schoolId, startStr: month.startStr, endStr: month.endStr }),
  ]);
  return { today: t.percentage, week: w.percentage, month: m.percentage };
}

// Class/section-wise attendance for a given day range (default: today).
async function classWise({ schoolId, startStr, endStr, groupBy = 'class' }) {
  const localField = groupBy === 'section' ? 'section' : 'class';
  const lookupFrom = groupBy === 'section' ? 'sections' : 'schoolclasses';
  const active = await Student.aggregate([
    { $match: { schoolId, status: 'active' } },
    { $group: { _id: `$${localField}`, students: { $sum: 1 } } },
  ]);
  const activeMap = new Map(active.map((a) => [String(a._id), a.students]));

  const rows = await StudentAttendanceRecord.aggregate([
    { $match: { schoolId, date: { $gte: startStr, $lte: endStr } } },
    { $lookup: { from: 'students', localField: 'student', foreignField: '_id', as: 'st' } },
    { $unwind: '$st' },
    { $group: { _id: { $ifNull: [`$${localField}Snapshot`, `$st.${localField}`] }, present: { $sum: 1 }, late: { $sum: { $cond: ['$isLate', 1, 0] } }, days: { $addToSet: '$date' } } },
    { $lookup: { from: lookupFrom, localField: '_id', foreignField: '_id', as: 'grp' } },
    { $project: { _id: 0, groupId: '$_id', name: { $ifNull: [{ $arrayElemAt: ['$grp.name', 0] }, 'Unknown'] }, present: 1, late: 1, distinctDays: { $size: '$days' } } },
  ]);

  const result = rows.map((r) => {
    const students = activeMap.get(String(r.groupId)) || 0;
    const avgDaily = r.distinctDays ? r.present / r.distinctDays : 0;
    return { groupId: r.groupId, name: r.name, students, present: r.present, late: r.late, attendancePercentage: pct(avgDaily, students) };
  }).sort((a, b) => b.attendancePercentage - a.attendancePercentage);

  const withData = result.filter((r) => r.students > 0);
  return {
    groups: result,
    best: withData[0] || null,
    lowest: withData.length ? withData[withData.length - 1] : null,
    mostLate: [...result].sort((a, b) => b.late - a.late)[0] || null,
  };
}

async function trend({ schoolId, granularity = 'daily', count = 14, ref = new Date() }) {
  const buckets = trendBuckets(granularity, count, ref);
  const active = await activeCount(schoolId);
  const startStr = toDateStr(buckets[0].start);
  const endStr = toDateStr(buckets[buckets.length - 1].end);
  const rows = await StudentAttendanceRecord.aggregate([
    { $match: { schoolId, date: { $gte: startStr, $lte: endStr } } },
    { $group: { _id: '$date', present: { $sum: 1 } } },
  ]);
  const byDate = new Map(rows.map((r) => [r._id, r.present]));

  return buckets.map((b) => {
    let present = 0, days = 0;
    for (const [date, p] of byDate) {
      if (date >= toDateStr(b.start) && date <= toDateStr(b.end)) { present += p; days += 1; }
    }
    const avgDaily = days ? present / days : 0;
    return { period: b.key, present, attendancePercentage: pct(avgDaily, active) };
  });
}

module.exports = { todaySnapshot, attendanceRates, periodPercentage, classWise, trend };
