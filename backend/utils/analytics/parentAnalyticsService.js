/**
 * parentAnalyticsService.js — Phase 9 parent-account metrics for dashboards.
 * School-scoped counts use the ownership links (linkedStudents.schoolId).
 */
const Parent = require('../../models/Parent');
const Student = require('../../models/Student');
const LeaveRequest = require('../../models/LeaveRequest');

async function schoolParentStats({ schoolId }) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
  const [total, active, recentlyActive, pendingLeave] = await Promise.all([
    Parent.countDocuments({ 'linkedStudents.schoolId': schoolId }),
    Parent.countDocuments({ 'linkedStudents.schoolId': schoolId, isActive: true, isActivated: true }),
    Parent.countDocuments({ 'linkedStudents.schoolId': schoolId, lastLoginAt: { $gte: thirtyDaysAgo } }),
    LeaveRequest.countDocuments({ schoolId, status: 'pending' }),
  ]);
  return {
    totalParentAccounts: total,
    activeParentAccounts: active,
    portalUsageLast30Days: recentlyActive,
    portalUsageRatePct: total > 0 ? +((recentlyActive / total) * 100).toFixed(1) : 0,
    pendingLeaveRequests: pendingLeave,
  };
}

async function platformParentStats() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
  const [total, activated, loggedInEver, recentlyActive, totalStudents] = await Promise.all([
    Parent.countDocuments({}),
    Parent.countDocuments({ isActivated: true }),
    Parent.countDocuments({ lastLoginAt: { $ne: null } }),
    Parent.countDocuments({ lastLoginAt: { $gte: thirtyDaysAgo } }),
    Student.countDocuments({ status: 'active' }),
  ]);
  return {
    totalParents: total,
    activatedParents: activated,
    parentsLoggedInEver: loggedInEver,
    portalActivityLast30Days: recentlyActive,
    parentAdoptionRatePct: totalStudents > 0 ? +((total / totalStudents) * 100).toFixed(1) : 0,
  };
}

module.exports = { schoolParentStats, platformParentStats };
