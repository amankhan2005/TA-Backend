/**
 * reportStorage.js — The ONE place report PDFs touch external storage.
 *
 * Generated report PDFs are hosted as Cloudinary "raw" assets (Cloudinary is
 * already this codebase's asset store for logos and student photos — same
 * account, same credentials, no new dependency). The report-ready parent
 * notification links to the returned secure_url; the PDF is delivered as a
 * download link, not an email attachment, matching sendReportReadyEmail's
 * existing "Download Report" CTA.
 *
 * This is deliberately the single network-dependent module in the Phase 4
 * pipeline. Everything else (scheduling maths, summary maths, PDF rendering)
 * is offline-testable; the untestable bit is quarantined here behind two
 * small functions so a live smoke test only needs to exercise this one file.
 */

const { cloudinary } = require('../config/cloudinary');

/**
 * @param {Buffer} buffer  the rendered PDF bytes
 * @param {Object} opts
 * @param {string} opts.schoolId
 * @param {string} opts.filename  sanitized, without extension
 * @returns {Promise<{ url: string, publicId: string }>}
 */
function uploadReportPdf(buffer, { schoolId, filename }) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw',
        folder: `teacherattendance/reports/${schoolId}`,
        public_id: filename,
        format: 'pdf',
        overwrite: true,
      },
      (err, result) => {
        if (err) return reject(err);
        if (!result?.secure_url) return reject(new Error('Cloudinary returned no secure_url for report PDF.'));
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });
}

/** Best-effort delete (used when a report is regenerated). Never throws. */
async function deleteReportPdf(publicId) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
  } catch (err) {
    console.error('[reportStorage] Failed to delete old report PDF:', err.message);
  }
}

module.exports = { uploadReportPdf, deleteReportPdf, uploadFeePdf, uploadIdentityPdf };

function uploadIdentityPdf(buffer, { schoolId, filename }) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: 'raw', folder: `teacherattendance/identity/`, public_id: filename, format: 'pdf', overwrite: true },
      (err, result) => { if (err) return reject(err); resolve({ url: result.secure_url, publicId: result.public_id }); }
    );
    stream.end(buffer);
  });
}

/**
 * Upload a fee receipt/statement PDF (raw resource) to a fees-specific folder.
 * Separate folder from attendance reports for tidiness; same storage-accounting
 * category work is done by the caller via storageService (category 'feeReports').
 */
function uploadFeePdf(buffer, { schoolId, filename }) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw',
        folder: `teacherattendance/fees/${schoolId}`,
        public_id: filename,
        format: 'pdf',
        overwrite: true,
      },
      (err, result) => {
        if (err) return reject(err);
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });
}
