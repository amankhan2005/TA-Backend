/**
 * storageAnalyticsService.js — Storage + PDF-artifact analytics for one school.
 * Reuses storageService (used/remaining/limit) and counts generated artifacts.
 */
const { getUsage, summarize } = require('../storageService');
const GeneratedReport = require('../../models/GeneratedReport');
const FeeStatement = require('../../models/FeeStatement');
const FeePayment = require('../../models/FeePayment');
const School = require('../../models/School');

async function storageStats({ schoolId }) {
  const [usage, school, attendanceReports, feeStatements, receipts] = await Promise.all([
    getUsage(schoolId),
    School.findOne({ schoolId }).populate('subscriptionPlan'),
    GeneratedReport.countDocuments({ schoolId, status: { $ne: 'failed' } }),
    FeeStatement.countDocuments({ schoolId }),
    FeePayment.countDocuments({ schoolId, receiptUrl: { $ne: null } }),
  ]);
  const limitMB = school?.subscriptionPlan?.storageLimitMB ?? null;
  return {
    storage: summarize(usage, limitMB),
    attendanceReportsGenerated: attendanceReports,
    feeStatementsGenerated: feeStatements,
    receiptsGenerated: receipts,
    totalPdfsGenerated: attendanceReports + feeStatements + receipts,
  };
}

module.exports = { storageStats };
