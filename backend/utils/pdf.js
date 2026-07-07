/**
 * pdf.js — Reusable PDF engine (Phase 4 "PDF Infrastructure", built once,
 * reused by every future module that emits a PDF: attendance reports now;
 * fee statements (Phase 5) and student ID cards (Phase 8) later).
 *
 * Engine choice: pdfkit (not Puppeteer). Puppeteer bundles a headless Chromium
 * (~300MB) and needs system libraries that aren't guaranteed on a small VPS,
 * and spawns a browser process per render — heavy for a background worker on a
 * modest Liberia deployment. pdfkit is pure JS, streams straight to a Buffer,
 * has no native/system deps, and is more than enough for tabular reports and
 * ID cards. Documented as a deliberate decision.
 *
 * All renderers return a Promise<Buffer> so the caller can upload the bytes
 * anywhere (Cloudinary raw asset, email attachment, HTTP response) without the
 * engine caring about storage.
 *
 * Branding scope (per approved spec): school logo + school name + basic
 * brand colours. Nothing here depends on a specific school.
 */

const PDFDocument = require('pdfkit');

// Platform brand colours (mirrors utils/email.js tokens for visual consistency).
const COLORS = {
  navy: '#0A3475',
  teal: '#13C6B3',
  ink: '#0F172A',
  mid: '#374151',
  light: '#6B7280',
  muted: '#9CA3AF',
  border: '#E2E8F0',
  cardBg: '#F5F8FC',
  present: '#0F9E8E',
  absent: '#DC2626',
  late: '#D97706',
  white: '#FFFFFF',
};

const PAGE = { size: 'A4', margin: 40 };

/**
 * Fetch a remote image (logo / student photo) into a Buffer for embedding.
 * Never throws — a missing or unreachable image must never fail a whole
 * report run; the renderer simply omits the image. (Node 18+ global fetch.)
 */
async function fetchImageBuffer(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    // pdfkit only embeds JPEG/PNG. Skip anything else (e.g. SVG/webp logos).
    if (!/jpe?g|png/i.test(type)) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

/** Create a buffered A4 document and a promise that resolves to its bytes. */
function createBrandedDocument({ title }) {
  const doc = new PDFDocument({
    ...PAGE,
    bufferPages: true, // required so footers can be stamped after all content
    info: { Title: title || 'Report', Producer: 'TeacherAttendance', Creator: 'TeacherAttendance' },
  });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const finished = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  return { doc, finished };
}

const contentWidth = (doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;
const bottomLimit = (doc) => doc.page.height - doc.page.margins.bottom;

/** Branded header band: logo (optional) + school name + report title + meta. */
function drawBrandHeader(doc, { schoolName, logoBuffer, reportTitle, periodLabel, generatedOn }) {
  const x = doc.page.margins.left;
  const w = contentWidth(doc);
  const bandH = 74;

  doc.save();
  doc.roundedRect(x, doc.y, w, bandH, 8).fill(COLORS.navy);

  const bandTop = doc.y;
  let textX = x + 18;

  if (logoBuffer) {
    try {
      doc.image(logoBuffer, x + 14, bandTop + 15, { fit: [44, 44] });
      textX = x + 14 + 44 + 14;
    } catch { /* corrupt image bytes — ignore, keep text-only */ }
  }

  doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(16)
    .text(schoolName || 'School', textX, bandTop + 16, { width: w - (textX - x) - 18 });
  doc.fillColor('#BFDCF5').font('Helvetica').fontSize(10)
    .text(reportTitle || 'Attendance Report', textX, bandTop + 40, { width: w - (textX - x) - 18 });

  doc.restore();
  doc.y = bandTop + bandH + 12;

  // Meta line under the band.
  doc.fillColor(COLORS.light).font('Helvetica').fontSize(9);
  const metaBits = [];
  if (periodLabel) metaBits.push(periodLabel);
  if (generatedOn) metaBits.push(`Generated ${generatedOn}`);
  if (metaBits.length) doc.text(metaBits.join('   ·   '), x, doc.y);
  doc.moveDown(0.6);
  doc.strokeColor(COLORS.border).lineWidth(1)
    .moveTo(x, doc.y).lineTo(x + w, doc.y).stroke();
  doc.moveDown(0.8);
}

/** Student identity block: photo (optional) + name/id/class/section. */
function drawStudentBlock(doc, { studentName, studentId, className, sectionName, sessionName, photoBuffer }) {
  const x = doc.page.margins.left;
  const w = contentWidth(doc);
  const top = doc.y;
  const photoSize = 56;
  let infoX = x;

  if (photoBuffer) {
    try {
      doc.save();
      doc.roundedRect(x, top, photoSize, photoSize, 6).clip();
      doc.image(photoBuffer, x, top, { fit: [photoSize, photoSize], align: 'center', valign: 'center' });
      doc.restore();
      infoX = x + photoSize + 14;
    } catch { /* ignore bad photo */ }
  }

  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(14)
    .text(studentName || '—', infoX, top, { width: w - (infoX - x) });
  doc.fillColor(COLORS.mid).font('Helvetica').fontSize(10);
  const line2 = [studentId && `ID: ${studentId}`, className, sectionName && `Section ${sectionName}`]
    .filter(Boolean).join('   ·   ');
  doc.text(line2, infoX, doc.y + 2, { width: w - (infoX - x) });
  if (sessionName) doc.fillColor(COLORS.light).fontSize(9).text(sessionName, infoX, doc.y + 1);

  doc.y = Math.max(doc.y, top + photoSize) + 14;
}

/** Four summary stat cards: present / absent / late / percentage. */
function drawSummaryCards(doc, summary) {
  const x = doc.page.margins.left;
  const w = contentWidth(doc);
  const gap = 10;
  const cardW = (w - gap * 3) / 4;
  const cardH = 58;
  const top = doc.y;

  const cards = [
    { label: 'Present', value: String(summary.presentDays), color: COLORS.present },
    { label: 'Absent', value: String(summary.absentDays), color: COLORS.absent },
    { label: 'Late', value: String(summary.lateDays), color: COLORS.late },
    { label: 'Attendance', value: `${summary.attendancePercentage}%`, color: COLORS.navy },
  ];

  cards.forEach((c, i) => {
    const cx = x + i * (cardW + gap);
    doc.roundedRect(cx, top, cardW, cardH, 6).fill(COLORS.cardBg);
    doc.roundedRect(cx, top, cardW, cardH, 6).lineWidth(1).stroke(COLORS.border);
    doc.fillColor(c.color).font('Helvetica-Bold').fontSize(20)
      .text(c.value, cx, top + 10, { width: cardW, align: 'center' });
    doc.fillColor(COLORS.light).font('Helvetica').fontSize(9)
      .text(c.label.toUpperCase(), cx, top + 37, { width: cardW, align: 'center', characterSpacing: 0.5 });
  });

  doc.y = top + cardH + 16;
  doc.fillColor(COLORS.light).font('Helvetica').fontSize(9)
    .text(`School days in period: ${summary.schoolDays}`, x, doc.y);
  doc.moveDown(0.8);
}

const STATUS_COLOR = {
  present: COLORS.present, late: COLORS.late, absent: COLORS.absent, present_non_school_day: COLORS.light,
};
const STATUS_LABEL = {
  present: 'Present', late: 'Late', absent: 'Absent', present_non_school_day: 'Present (off-day)',
};

/** Date-wise attendance table with automatic pagination + repeated header row. */
function drawAttendanceTable(doc, details) {
  const x = doc.page.margins.left;
  const w = contentWidth(doc);
  // Columns: Date | Status | In | Out | Duration
  const cols = [
    { key: 'date', label: 'Date', width: w * 0.24 },
    { key: 'status', label: 'Status', width: w * 0.20 },
    { key: 'punchIn', label: 'In', width: w * 0.16 },
    { key: 'punchOut', label: 'Out', width: w * 0.16 },
    { key: 'duration', label: 'Duration', width: w * 0.24 },
  ];
  const rowH = 20;

  const drawHeaderRow = () => {
    const top = doc.y;
    doc.roundedRect(x, top, w, rowH, 3).fill(COLORS.navy);
    let cx = x + 8;
    doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(9);
    cols.forEach((c) => {
      doc.text(c.label, cx, top + 6, { width: c.width - 10 });
      cx += c.width;
    });
    doc.y = top + rowH;
  };

  drawHeaderRow();

  details.forEach((row, idx) => {
    if (doc.y + rowH > bottomLimit(doc)) {
      doc.addPage();
      drawHeaderRow();
    }
    const top = doc.y;
    if (idx % 2 === 0) doc.rect(x, top, w, rowH).fill('#FBFCFE');
    let cx = x + 8;
    cols.forEach((c) => {
      if (c.key === 'status') {
        doc.fillColor(STATUS_COLOR[row.status] || COLORS.mid).font('Helvetica-Bold').fontSize(9)
          .text(STATUS_LABEL[row.status] || row.status, cx, top + 6, { width: c.width - 10 });
      } else {
        doc.fillColor(COLORS.mid).font('Helvetica').fontSize(9)
          .text(row[c.key] != null ? String(row[c.key]) : '—', cx, top + 6, { width: c.width - 10 });
      }
      cx += c.width;
    });
    doc.strokeColor(COLORS.border).lineWidth(0.5).moveTo(x, top + rowH).lineTo(x + w, top + rowH).stroke();
    doc.y = top + rowH;
  });
}

/** Stamp "Generated … · School · Page X of Y" on every buffered page. */
function drawFooters(doc, { schoolName, generatedOn }) {
  const range = doc.bufferedPageRange(); // { start, count } — captured before stamping
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing into the bottom-margin band would otherwise trip pdfkit's
    // auto-pagination (y past the content limit → it inserts a blank page per
    // footer). Zeroing the bottom margin on this page while we stamp prevents
    // that; content is already fully laid out, so this is safe.
    doc.page.margins.bottom = 0;
    const x = doc.page.margins.left;
    const w = contentWidth(doc);
    const y = doc.page.height - 28;
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8);
    const left = [schoolName, generatedOn && `Generated ${generatedOn}`].filter(Boolean).join('  ·  ');
    doc.text(left, x, y, { width: w * 0.7, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, x, y, { width: w, align: 'right', lineBreak: false });
  }
}

/**
 * High-level attendance report renderer.
 * @param {Object} data
 * @param {Object} data.school   { name, logoUrl }
 * @param {Object} data.student  { name, studentId, className, sectionName, sessionName, photoUrl }
 * @param {Object} data.summary  output of computeAttendanceSummary()
 * @param {Object} data.period   { label } (from computeReportPeriod)
 * @param {Date}   [data.generatedAt]
 * @returns {Promise<Buffer>}
 */
async function renderAttendanceReportPDF(data) {
  const { school = {}, student = {}, summary, period = {}, generatedAt = new Date() } = data;
  const generatedOn = generatedAt.toISOString().slice(0, 10);

  const [logoBuffer, photoBuffer] = await Promise.all([
    fetchImageBuffer(school.logoUrl),
    fetchImageBuffer(student.photoUrl),
  ]);

  const { doc, finished } = createBrandedDocument({ title: `Attendance Report — ${student.name || ''}` });

  drawBrandHeader(doc, {
    schoolName: school.name,
    logoBuffer,
    reportTitle: 'Student Attendance Report',
    periodLabel: period.label,
    generatedOn,
  });
  drawStudentBlock(doc, {
    studentName: student.name,
    studentId: student.studentId,
    className: student.className,
    sectionName: student.sectionName,
    sessionName: student.sessionName,
    photoBuffer,
  });
  drawSummaryCards(doc, summary);

  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(11).text('Date-wise Attendance', doc.page.margins.left, doc.y);
  doc.moveDown(0.4);
  drawAttendanceTable(doc, summary.details || []);

  drawFooters(doc, { schoolName: school.name, generatedOn });

  doc.end();
  return finished;
}

// ── Generic helpers for fee documents (Phase 5) ─────────────────────────────
const { formatMinor } = require('./money');

/** A compact label/value info box (receipt meta, statement summary). */
function drawInfoRows(doc, rows) {
  const x = doc.page.margins.left;
  const w = contentWidth(doc);
  const rowH = 18;
  const boxH = rows.length * rowH + 12;
  doc.roundedRect(x, doc.y, w, boxH, 6).lineWidth(1).stroke(COLORS.border);
  let y = doc.y + 8;
  for (const [label, value] of rows) {
    doc.fillColor(COLORS.light).font('Helvetica').fontSize(9).text(label, x + 12, y, { width: w * 0.4 });
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(9).text(String(value), x + w * 0.42, y, { width: w * 0.56 - 12, align: 'right' });
    y += rowH;
  }
  doc.y = doc.y + boxH + 10;
}

/** A simple paginating table. columns: [{label,key,width,align}]. rows: array of objects. */
function drawSimpleTable(doc, columns, rows) {
  const x = doc.page.margins.left;
  const w = contentWidth(doc);
  const rowH = 20;
  const totalW = columns.reduce((s, c) => s + c.width, 0);
  const scale = w / totalW;
  const colX = [];
  let acc = x;
  for (const c of columns) { colX.push(acc); acc += c.width * scale; }

  const drawHeader = () => {
    doc.roundedRect(x, doc.y, w, rowH, 3).fill(COLORS.navy);
    const top = doc.y;
    doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(8.5);
    columns.forEach((c, i) => doc.text(c.label, colX[i] + 5, top + 6, { width: c.width * scale - 10, align: c.align || 'left', lineBreak: false }));
    doc.y = top + rowH;
  };

  drawHeader();
  for (const row of rows) {
    if (doc.y + rowH > bottomLimit(doc)) { doc.addPage(); drawHeader(); }
    const top = doc.y;
    doc.fillColor(COLORS.mid).font('Helvetica').fontSize(8.5);
    columns.forEach((c, i) => doc.text(String(row[c.key] ?? ''), colX[i] + 5, top + 6, { width: c.width * scale - 10, align: c.align || 'left', lineBreak: false }));
    doc.strokeColor(COLORS.border).lineWidth(0.5).moveTo(x, top + rowH).lineTo(x + w, top + rowH).stroke();
    doc.y = top + rowH;
  }
  doc.moveDown(0.6);
}

/**
 * Payment receipt renderer.
 * @param {Object} data { school:{name,logoUrl}, student:{name,studentId,className,sectionName}, payment, invoice }
 * @returns {Promise<Buffer>}
 */
async function renderReceiptPDF({ school = {}, student = {}, payment, invoice, generatedAt = new Date() }) {
  const generatedOn = generatedAt.toISOString().slice(0, 10);
  const [logoBuffer, photoBuffer] = await Promise.all([fetchImageBuffer(school.logoUrl), fetchImageBuffer(student.photoUrl)]);
  const { doc, finished } = createBrandedDocument({ title: `Receipt ${payment.receiptNumber}` });
  const cur = payment.currency;

  drawBrandHeader(doc, { schoolName: school.name, logoBuffer, reportTitle: 'Payment Receipt', periodLabel: `Receipt ${payment.receiptNumber}`, generatedOn });
  drawStudentBlock(doc, { studentName: student.name, studentId: student.studentId, className: student.className, sectionName: student.sectionName, photoBuffer });

  drawInfoRows(doc, [
    ['Receipt Number', payment.receiptNumber],
    ['Invoice Number', invoice.invoiceNumber],
    ['Payment Date', new Date(payment.paidAt).toISOString().slice(0, 10)],
    ['Method', String(payment.method || 'cash').replace(/_/g, ' ')],
    ...(payment.reference ? [['Reference', payment.reference]] : []),
  ]);

  drawInfoRows(doc, [
    ['Invoice Total', formatMinor(invoice.totalPayableMinor, cur, { withCode: true })],
    ['Amount Received', formatMinor(payment.amountMinor, cur, { withCode: true })],
    ['Applied to Invoice', formatMinor(payment.appliedMinor, cur, { withCode: true })],
    ...(payment.overpayMinor ? [['Advance / Credit', formatMinor(payment.overpayMinor, cur, { withCode: true })]] : []),
    ['Invoice Balance After', formatMinor(Math.max(0, invoice.totalPayableMinor - invoice.paidMinor), cur, { withCode: true })],
  ]);

  doc.fillColor(COLORS.light).font('Helvetica-Oblique').fontSize(8)
    .text('This is a computer-generated receipt.', doc.page.margins.left, doc.y);

  drawFooters(doc, { schoolName: school.name, generatedOn });
  doc.end();
  return finished;
}

/**
 * Monthly fee statement renderer.
 * @param {Object} data { school, student, periodLabel, currency, invoices[], payments[], summary }
 */
async function renderFeeStatementPDF({ school = {}, student = {}, periodLabel, currency, invoices = [], payments = [], summary, generatedAt = new Date() }) {
  const generatedOn = generatedAt.toISOString().slice(0, 10);
  const [logoBuffer, photoBuffer] = await Promise.all([fetchImageBuffer(school.logoUrl), fetchImageBuffer(student.photoUrl)]);
  const { doc, finished } = createBrandedDocument({ title: `Fee Statement — ${student.name || ''}` });
  const cur = currency;

  drawBrandHeader(doc, { schoolName: school.name, logoBuffer, reportTitle: 'Monthly Fee Statement', periodLabel, generatedOn });
  drawStudentBlock(doc, { studentName: student.name, studentId: student.studentId, className: student.className, sectionName: student.sectionName, photoBuffer });

  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(11).text('Invoices', doc.page.margins.left, doc.y);
  doc.moveDown(0.3);
  drawSimpleTable(doc,
    [
      { label: 'Invoice', key: 'num', width: 90, align: 'left' },
      { label: 'Period', key: 'period', width: 70, align: 'left' },
      { label: 'Due', key: 'due', width: 60, align: 'left' },
      { label: 'Total', key: 'total', width: 60, align: 'right' },
      { label: 'Paid', key: 'paid', width: 60, align: 'right' },
      { label: 'Balance', key: 'bal', width: 60, align: 'right' },
      { label: 'Status', key: 'status', width: 55, align: 'left' },
    ],
    invoices.map((i) => ({
      num: i.invoiceNumber, period: i.periodLabel || '—', due: new Date(i.dueDate).toISOString().slice(0, 10),
      total: formatMinor(i.totalPayableMinor, cur), paid: formatMinor(Math.min(i.paidMinor, i.totalPayableMinor), cur),
      bal: formatMinor(Math.max(0, i.totalPayableMinor - i.paidMinor), cur), status: i.status,
    }))
  );

  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(11).text('Payments', doc.page.margins.left, doc.y);
  doc.moveDown(0.3);
  drawSimpleTable(doc,
    [
      { label: 'Receipt', key: 'num', width: 100, align: 'left' },
      { label: 'Date', key: 'date', width: 70, align: 'left' },
      { label: 'Method', key: 'method', width: 90, align: 'left' },
      { label: 'Amount', key: 'amount', width: 70, align: 'right' },
    ],
    payments.map((p) => ({
      num: p.receiptNumber, date: new Date(p.paidAt).toISOString().slice(0, 10),
      method: String(p.method || 'cash').replace(/_/g, ' '), amount: formatMinor(p.amountMinor, cur),
    }))
  );

  drawInfoRows(doc, [
    ['Opening Balance', formatMinor(summary.openingBalanceMinor, cur, { withCode: true })],
    ['Billed This Period', formatMinor(summary.billedMinor, cur, { withCode: true })],
    ['Paid This Period', formatMinor(summary.paidMinor, cur, { withCode: true })],
    ['Closing Balance', formatMinor(summary.closingBalanceMinor, cur, { withCode: true })],
  ]);

  drawFooters(doc, { schoolName: school.name, generatedOn });
  doc.end();
  return finished;
}

/**
 * Optional identity sheets (Phase 8). NOT a PVC card — a printable sheet with
 * one bordered identity block per student (photo, name, roll, class/section, QR,
 * RFID UID). `cards` = [{ student:{name,studentId,rollNumber,className,sectionName,photoUrl}, qrBuffer, rfidUid }].
 * Reuses the branded document + header primitives.
 */
async function renderIdentitySheetPDF({ school = {}, title = 'Student Identity Sheet', cards = [], generatedAt = new Date() }) {
  const generatedOn = generatedAt.toISOString().slice(0, 10);
  const logoBuffer = await fetchImageBuffer(school.logoUrl);
  const { doc, finished } = createBrandedDocument({ title });
  drawBrandHeader(doc, { schoolName: school.name, logoBuffer, reportTitle: title, periodLabel: `${cards.length} student(s)`, generatedOn });

  const x = doc.page.margins.left;
  const w = contentWidth(doc);
  const cardH = 150;

  for (const c of cards) {
    if (doc.y + cardH > bottomLimit(doc)) doc.addPage();
    const top = doc.y;
    doc.roundedRect(x, top, w, cardH, 8).lineWidth(1).stroke(COLORS.border);

    // Photo (left)
    const photo = await fetchImageBuffer(c.student.photoUrl);
    const px = x + 14, py = top + 16, ps = 96;
    if (photo) { try { doc.image(photo, px, py, { fit: [ps, ps] }); } catch { /* ignore */ } }
    else { doc.roundedRect(px, py, ps, ps, 6).fill(COLORS.border); doc.fillColor(COLORS.light).fontSize(9).text('No Photo', px, py + ps / 2 - 5, { width: ps, align: 'center' }); }

    // Details (middle)
    const dx = px + ps + 20;
    let dy = top + 18;
    const line = (label, val) => { doc.fillColor(COLORS.light).font('Helvetica').fontSize(8).text(label, dx, dy); doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(11).text(val || '—', dx, dy + 10); dy += 30; };
    line('NAME', c.student.name);
    line('STUDENT ID / ROLL', `${c.student.studentId}${c.student.rollNumber ? '  ·  Roll ' + c.student.rollNumber : ''}`);
    line('CLASS / SECTION', `${c.student.className || '—'}${c.student.sectionName ? ' — ' + c.student.sectionName : ''}`);
    doc.fillColor(COLORS.light).font('Helvetica').fontSize(8).text('RFID UID', dx, dy);
    doc.fillColor(COLORS.navy).font('Courier-Bold').fontSize(11).text(c.rfidUid || 'Unassigned', dx, dy + 10);

    // QR (right)
    if (c.qrBuffer) { try { doc.image(c.qrBuffer, x + w - 130, top + 22, { fit: [104, 104] }); } catch { /* ignore */ } }
    doc.fillColor(COLORS.light).font('Helvetica').fontSize(7).text('Scan to verify', x + w - 130, top + 128, { width: 104, align: 'center' });

    doc.y = top + cardH + 14;
  }

  drawFooters(doc, { schoolName: school.name, generatedOn });
  doc.end();
  return finished;
}

module.exports = {
  COLORS,
  fetchImageBuffer,
  createBrandedDocument,
  drawBrandHeader,
  drawStudentBlock,
  drawSummaryCards,
  drawAttendanceTable,
  drawFooters,
  renderAttendanceReportPDF,
  renderReceiptPDF,
  renderFeeStatementPDF,
  renderIdentitySheetPDF,
};
