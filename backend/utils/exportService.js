/**
 * exportService.js — The single tabular-export helper for the ERP. Turns an
 * array of plain row objects + a column spec into either an .xlsx (via exceljs)
 * or a .csv download, written directly to the Express response with the correct
 * Content-Type / Content-Disposition headers.
 *
 * Deliberately generic (columns are passed in) so student-attendance,
 * teacher-attendance, attendance-defaulters and fee-defaulters all share ONE
 * export code path — the same "one pipeline" principle the scan service uses.
 * This module does ZERO querying; callers build the rows, this only formats.
 *
 * A column is: { key: string, header: string }. Row values are looked up by
 * `key`; missing/null values render as '' (csv) / blank (xlsx).
 */

const ExcelJS = require('exceljs');

/** RFC-4180-ish CSV cell: quote if it contains comma, quote, CR or LF; double internal quotes. */
function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(columns, rows) {
  const head = columns.map((c) => csvCell(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(',')).join('\r\n');
  // Leading UTF-8 BOM so Excel opens accented names / non-ASCII correctly.
  return `\uFEFF${head}\r\n${body}`;
}

/** Sanitizes a string into a safe download filename stem (no path/special chars). */
function safeName(stem) {
  return String(stem || 'export').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'export';
}

/**
 * Stream a CSV download.
 * @param {import('express').Response} res
 * @param {{filename:string, columns:Array<{key,header}>, rows:Array<Object>}} p
 */
function sendCsv(res, { filename, columns, rows }) {
  const csv = buildCsv(columns, rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName(filename)}.csv"`);
  return res.status(200).send(csv);
}

/**
 * Stream an XLSX download (single sheet).
 * @param {import('express').Response} res
 * @param {{filename:string, sheetName?:string, columns:Array<{key,header,width?}>, rows:Array<Object>, title?:string}} p
 */
async function sendXlsx(res, { filename, sheetName = 'Sheet1', columns, rows, title }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TeacherAttendance';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName.slice(0, 31)); // Excel sheet-name limit

  let headerRowIndex = 1;
  if (title) {
    ws.mergeCells(1, 1, 1, columns.length);
    const tCell = ws.getCell(1, 1);
    tCell.value = title;
    tCell.font = { bold: true, size: 13 };
    tCell.alignment = { vertical: 'middle', horizontal: 'left' };
    headerRowIndex = 2;
  }

  ws.columns = columns.map((c) => ({ key: c.key, width: c.width || Math.max(12, c.header.length + 2) }));

  const header = ws.getRow(headerRowIndex);
  columns.forEach((c, i) => { header.getCell(i + 1).value = c.header; });
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A3475' } }; // brand navy
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });

  rows.forEach((r) => {
    const values = {};
    columns.forEach((c) => { values[c.key] = r[c.key] === null || r[c.key] === undefined ? '' : r[c.key]; });
    ws.addRow(values);
  });

  ws.autoFilter = {
    from: { row: headerRowIndex, column: 1 },
    to: { row: headerRowIndex, column: columns.length },
  };
  ws.views = [{ state: 'frozen', ySplit: headerRowIndex }];

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName(filename)}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

/**
 * Convenience dispatcher — picks csv/xlsx from a `format` string.
 * @param {'xlsx'|'csv'} format
 */
async function sendTabular(res, format, payload) {
  if (format === 'csv') return sendCsv(res, payload);
  return sendXlsx(res, payload);
}

module.exports = { sendCsv, sendXlsx, sendTabular, buildCsv, safeName, csvCell };
