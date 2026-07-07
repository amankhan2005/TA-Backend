/**
 * studentAnalyticsService.js — Student population analytics for one school.
 * Every query is tenant-scoped by schoolId. Reusable by dashboards, reports,
 * exports, and (later) the parent portal / mobile apps.
 */

const Student = require('../../models/Student');
const { monthBounds } = require('./time');

async function studentStats({ schoolId, ref = new Date() }) {
  const { start } = monthBounds(ref);
  const [total, active, newThisMonth, byClass, bySection, bySession] = await Promise.all([
    Student.countDocuments({ schoolId }),
    Student.countDocuments({ schoolId, status: 'active' }),
    Student.countDocuments({ schoolId, createdAt: { $gte: start } }),
    Student.aggregate([
      { $match: { schoolId, status: 'active' } },
      { $group: { _id: '$class', count: { $sum: 1 } } },
      { $lookup: { from: 'schoolclasses', localField: '_id', foreignField: '_id', as: 'c' } },
      { $project: { _id: 0, classId: '$_id', name: { $ifNull: [{ $arrayElemAt: ['$c.name', 0] }, 'Unknown'] }, count: 1 } },
      { $sort: { count: -1 } },
    ]),
    Student.aggregate([
      { $match: { schoolId, status: 'active' } },
      { $group: { _id: '$section', count: { $sum: 1 } } },
      { $lookup: { from: 'sections', localField: '_id', foreignField: '_id', as: 's' } },
      { $project: { _id: 0, sectionId: '$_id', name: { $ifNull: [{ $arrayElemAt: ['$s.name', 0] }, 'Unknown'] }, count: 1 } },
      { $sort: { count: -1 } },
    ]),
    Student.aggregate([
      { $match: { schoolId, status: 'active' } },
      { $group: { _id: '$session', count: { $sum: 1 } } },
      { $lookup: { from: 'academicsessions', localField: '_id', foreignField: '_id', as: 'se' } },
      { $project: { _id: 0, sessionId: '$_id', name: { $ifNull: [{ $arrayElemAt: ['$se.name', 0] }, 'Unknown'] }, count: 1 } },
      { $sort: { count: -1 } },
    ]),
  ]);

  return { total, active, inactive: total - active, newThisMonth, byClass, bySection, bySession };
}

module.exports = { studentStats };
