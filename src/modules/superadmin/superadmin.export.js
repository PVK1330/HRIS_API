'use strict';

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const COMPANY = process.env.COMPANY_NAME || 'Platform';

function fmt(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mon = dt.toLocaleString('en-GB', { month: 'short' });
  return `${dd}-${mon}-${dt.getFullYear()}`;
}

function cap(s) {
  if (!s) return '';
  return String(s).charAt(0).toUpperCase() + String(s).slice(1);
}

function trunc(s, max) {
  const t = String(s ?? '');
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/* ─── shared Excel builder helpers ─────────────────────────────────────────── */

function makeWorkbook(title, filterLine, colCount) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(title, { views: [{ state: 'frozen', ySplit: 4 }] });

  const lastCol = String.fromCharCode(64 + colCount);
  ws.mergeCells(`A1:${lastCol}1`);
  const t = ws.getCell('A1');
  t.value = `${COMPANY} — ${title}`;
  t.font = { size: 14, bold: true };
  t.alignment = { vertical: 'middle', horizontal: 'center' };

  ws.mergeCells(`A2:${lastCol}2`);
  const sub = ws.getCell('A2');
  sub.value = `Generated: ${fmt(new Date())}  |  Filters: ${filterLine || 'none'}`;
  sub.font = { size: 11 };
  sub.alignment = { horizontal: 'left' };

  ws.getRow(3).values = [];
  return { wb, ws };
}

function addHeaders(ws, headers) {
  const row = ws.getRow(4);
  headers.forEach((h, i) => {
    const c = row.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: headers.length } };
}

function addRows(ws, rows, valFn) {
  rows.forEach((r, idx) => {
    const row = ws.getRow(5 + idx);
    const bg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
    valFn(r, idx).forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    });
  });
  const total = ws.getRow(5 + rows.length);
  total.getCell(1).value = `Total records: ${rows.length}`;
  total.font = { bold: true };
}

function autoWidth(ws) {
  ws.columns.forEach((col) => {
    let max = 10;
    col.eachCell({ includeEmpty: true }, (cell) => {
      const len = cell.value != null ? String(cell.value).length : 0;
      if (len > max) max = len;
    });
    col.width = Math.min(Math.max(max + 2, 12), 45);
  });
}

async function sendExcel(res, wb, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
}

/* ─── shared PDF builder helpers ───────────────────────────────────────────── */

function makePDF(res, filename) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
  return doc;
}

function drawPDFHeader(doc, title, filterLine) {
  doc.rect(30, 30, 50, 18).stroke('#cbd5e1');
  doc.fontSize(7).fillColor('#64748b').text('LOGO', 42, 36);
  doc.fontSize(13).fillColor('#0f172a').text(`${COMPANY} — ${title}`, 90, 31, {
    align: 'right', width: doc.page.width - 120,
  });
  doc.fontSize(8).fillColor('#475569').text(
    `Generated: ${fmt(new Date())}  |  Filters: ${filterLine || 'none'}`, 30, 54,
    { width: doc.page.width - 60 },
  );
  doc.moveTo(30, 70).lineTo(doc.page.width - 30, 70).stroke('#e2e8f0');
}

function drawPDFTable(doc, cols, rows, valFn) {
  const tableLeft = 30;
  const tableWidth = cols.reduce((s, c) => s + c.w, 0);
  const rowH = 17;
  let y = 80;

  function drawHeader() {
    let x = tableLeft;
    doc.save();
    doc.rect(tableLeft, y, tableWidth, rowH).fill('#0F766E');
    doc.fontSize(7).fillColor('#ffffff');
    cols.forEach((c) => {
      doc.text(c.t, x + 2, y + 5, { width: c.w - 4 });
      x += c.w;
    });
    doc.restore();
    y += rowH;
  }

  drawHeader();

  rows.forEach((r, idx) => {
    if (y + rowH > doc.page.height - 40) {
      doc.addPage();
      y = 40;
      drawHeader();
    }
    const bg = idx % 2 === 0 ? '#ffffff' : '#F5F5F5';
    let x = tableLeft;
    doc.save();
    cols.forEach((c) => { doc.rect(x, y, c.w, rowH).fillAndStroke(bg, '#e5e7eb'); x += c.w; });
    doc.restore();
    x = tableLeft;
    doc.fontSize(7).fillColor('#111827');
    valFn(r, idx).forEach((v, i) => {
      doc.text(String(v ?? ''), x + 2, y + 5, { width: cols[i].w - 4, ellipsis: true });
      x += cols[i].w;
    });
    y += rowH;
  });

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.fontSize(7).fillColor('#94a3b8').text(
      `Page ${i + 1} of ${range.count}`, 30, doc.page.height - 25,
      { width: doc.page.width - 60, align: 'center' },
    );
  }
  doc.end();
}

/* ══════════════════════════════════════════════════════════════════════════════
   TENANTS
══════════════════════════════════════════════════════════════════════════════ */

const TENANT_HEADERS = ['#', 'Name', 'Domain / DB', 'Admin Email', 'Plan', 'Status', 'Created'];
const TENANT_COLS = [
  { w: 28, t: '#' }, { w: 100, t: 'Name' }, { w: 110, t: 'Domain / DB' },
  { w: 120, t: 'Admin Email' }, { w: 80, t: 'Plan' }, { w: 55, t: 'Status' }, { w: 70, t: 'Created' },
];
const tenantVals = (r, i) => [
  i + 1, r.name || '', r.db_name || '', r.admin_email || '',
  r.plan || 'None', cap(r.status), fmt(r.created_at),
];

async function buildTenantsExcel(res, rows, filters = {}) {
  const fl = [filters.search && `search=${filters.search}`, filters.plan && `plan=${filters.plan}`, filters.status && `status=${filters.status}`].filter(Boolean).join(' | ') || 'none';
  const { wb, ws } = makeWorkbook('Tenants', fl, TENANT_HEADERS.length);
  addHeaders(ws, TENANT_HEADERS);
  addRows(ws, rows, tenantVals);
  autoWidth(ws);
  await sendExcel(res, wb, `tenants_${fmt(new Date())}.xlsx`);
}

function buildTenantsPDF(res, rows, filters = {}) {
  const fl = [filters.search && `search=${filters.search}`, filters.plan && `plan=${filters.plan}`, filters.status && `status=${filters.status}`].filter(Boolean).join(' | ') || 'none';
  const doc = makePDF(res, `tenants_${fmt(new Date())}.pdf`);
  drawPDFHeader(doc, 'Tenants', fl);
  drawPDFTable(doc, TENANT_COLS, rows, tenantVals);
}

/* ══════════════════════════════════════════════════════════════════════════════
   ADMIN USERS
══════════════════════════════════════════════════════════════════════════════ */

const ADMIN_HEADERS = ['#', 'Name', 'Email', 'Role', 'Status', 'Last Login', 'Created'];
const ADMIN_COLS = [
  { w: 28, t: '#' }, { w: 100, t: 'Name' }, { w: 130, t: 'Email' },
  { w: 80, t: 'Role' }, { w: 60, t: 'Status' }, { w: 80, t: 'Last Login' }, { w: 70, t: 'Created' },
];
const adminVals = (r, i) => [
  i + 1, r.name || '', r.email || '', cap(r.role || 'superadmin'),
  cap(r.status || 'active'), fmt(r.last_login_at) || 'Never', fmt(r.created_at),
];

async function buildAdminUsersExcel(res, rows) {
  const { wb, ws } = makeWorkbook('Admin Users', 'none', ADMIN_HEADERS.length);
  addHeaders(ws, ADMIN_HEADERS);
  addRows(ws, rows, adminVals);
  autoWidth(ws);
  await sendExcel(res, wb, `admin_users_${fmt(new Date())}.xlsx`);
}

function buildAdminUsersPDF(res, rows) {
  const doc = makePDF(res, `admin_users_${fmt(new Date())}.pdf`);
  drawPDFHeader(doc, 'Admin Users', 'none');
  drawPDFTable(doc, ADMIN_COLS, rows, adminVals);
}

/* ══════════════════════════════════════════════════════════════════════════════
   PAYMENTS / BILLING
══════════════════════════════════════════════════════════════════════════════ */

const PAY_HEADERS = ['#', 'Tenant', 'Plan', 'Amount', 'Currency', 'Method', 'Status', 'Date'];
const PAY_COLS = [
  { w: 28, t: '#' }, { w: 100, t: 'Tenant' }, { w: 90, t: 'Plan' },
  { w: 70, t: 'Amount' }, { w: 55, t: 'Currency' }, { w: 80, t: 'Method' },
  { w: 65, t: 'Status' }, { w: 75, t: 'Date' },
];
const payVals = (r, i) => [
  i + 1, r.tenant_name || '', r.plan_name || '',
  Number(r.amount || 0).toFixed(2), r.currency || '',
  r.payment_method || '', cap(r.status), fmt(r.created_at),
];

async function buildPaymentsExcel(res, rows, filters = {}) {
  const fl = [filters.search && `search=${filters.search}`, filters.status && `status=${filters.status}`].filter(Boolean).join(' | ') || 'none';
  const { wb, ws } = makeWorkbook('Billing & Payments', fl, PAY_HEADERS.length);
  addHeaders(ws, PAY_HEADERS);
  addRows(ws, rows, payVals);
  autoWidth(ws);
  await sendExcel(res, wb, `payments_${fmt(new Date())}.xlsx`);
}

function buildPaymentsPDF(res, rows, filters = {}) {
  const fl = [filters.search && `search=${filters.search}`, filters.status && `status=${filters.status}`].filter(Boolean).join(' | ') || 'none';
  const doc = makePDF(res, `payments_${fmt(new Date())}.pdf`);
  drawPDFHeader(doc, 'Billing & Payments', fl);
  drawPDFTable(doc, PAY_COLS, rows, payVals);
}

/* ══════════════════════════════════════════════════════════════════════════════
   AUDIT LOGS
══════════════════════════════════════════════════════════════════════════════ */

const AUDIT_HEADERS = ['#', 'Actor', 'Action', 'Target', 'IP Address', 'Result', 'Date'];
const AUDIT_COLS = [
  { w: 28, t: '#' }, { w: 110, t: 'Actor' }, { w: 120, t: 'Action' },
  { w: 120, t: 'Target' }, { w: 90, t: 'IP Address' }, { w: 60, t: 'Result' }, { w: 80, t: 'Date' },
];
const auditVals = (r, i) => [
  i + 1, r.actor_name || '', r.action || '',
  trunc(r.target || '', 40), r.ip_address || '', cap(r.result || 'Success'), fmt(r.created_at),
];

async function buildAuditLogsExcel(res, rows) {
  const { wb, ws } = makeWorkbook('Audit Logs', 'none', AUDIT_HEADERS.length);
  addHeaders(ws, AUDIT_HEADERS);
  addRows(ws, rows, auditVals);
  autoWidth(ws);
  await sendExcel(res, wb, `audit_logs_${fmt(new Date())}.xlsx`);
}

function buildAuditLogsPDF(res, rows) {
  const doc = makePDF(res, `audit_logs_${fmt(new Date())}.pdf`);
  drawPDFHeader(doc, 'Audit Logs', 'none');
  drawPDFTable(doc, AUDIT_COLS, rows, auditVals);
}

/* ══════════════════════════════════════════════════════════════════════════════
   SUPPORT TICKETS
══════════════════════════════════════════════════════════════════════════════ */

const TKT_HEADERS = ['#', 'Ticket', 'Organisation', 'Subject', 'Priority', 'Assigned To', 'Status', 'Created'];
const TKT_COLS = [
  { w: 28, t: '#' }, { w: 65, t: 'Ticket' }, { w: 100, t: 'Organisation' },
  { w: 130, t: 'Subject' }, { w: 60, t: 'Priority' }, { w: 90, t: 'Assigned To' },
  { w: 55, t: 'Status' }, { w: 70, t: 'Created' },
];
const tktVals = (r, i) => [
  i + 1, r.ticket_code || '', r.org_name || '',
  trunc(r.subject || '', 50), r.priority || 'Medium',
  r.assigned_to || 'Unassigned', cap(r.status), fmt(r.created_at),
];

async function buildSupportTicketsExcel(res, rows) {
  const { wb, ws } = makeWorkbook('Support Tickets', 'none', TKT_HEADERS.length);
  addHeaders(ws, TKT_HEADERS);
  addRows(ws, rows, tktVals);
  autoWidth(ws);
  await sendExcel(res, wb, `support_tickets_${fmt(new Date())}.xlsx`);
}

function buildSupportTicketsPDF(res, rows) {
  const doc = makePDF(res, `support_tickets_${fmt(new Date())}.pdf`);
  drawPDFHeader(doc, 'Support Tickets', 'none');
  drawPDFTable(doc, TKT_COLS, rows, tktVals);
}

/* ══════════════════════════════════════════════════════════════════════════════
   ANNOUNCEMENTS
══════════════════════════════════════════════════════════════════════════════ */

const ANN_HEADERS = ['#', 'Title', 'Audience', 'Type', 'Recipients', 'Date'];
const ANN_COLS = [
  { w: 28, t: '#' }, { w: 160, t: 'Title' }, { w: 100, t: 'Audience' },
  { w: 70, t: 'Type' }, { w: 70, t: 'Recipients' }, { w: 80, t: 'Date' },
];
const annVals = (r, i) => [
  i + 1, r.title || '', r.audience || 'All',
  r.type || 'Info', r.recipients ?? 0, fmt(r.sent_date || r.created_at),
];

async function buildAnnouncementsExcel(res, rows) {
  const { wb, ws } = makeWorkbook('Announcements', 'none', ANN_HEADERS.length);
  addHeaders(ws, ANN_HEADERS);
  addRows(ws, rows, annVals);
  autoWidth(ws);
  await sendExcel(res, wb, `announcements_${fmt(new Date())}.xlsx`);
}

function buildAnnouncementsPDF(res, rows) {
  const doc = makePDF(res, `announcements_${fmt(new Date())}.pdf`);
  drawPDFHeader(doc, 'Announcements', 'none');
  drawPDFTable(doc, ANN_COLS, rows, annVals);
}

module.exports = {
  buildTenantsExcel, buildTenantsPDF,
  buildAdminUsersExcel, buildAdminUsersPDF,
  buildPaymentsExcel, buildPaymentsPDF,
  buildAuditLogsExcel, buildAuditLogsPDF,
  buildSupportTicketsExcel, buildSupportTicketsPDF,
  buildAnnouncementsExcel, buildAnnouncementsPDF,
};
