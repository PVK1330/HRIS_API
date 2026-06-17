'use strict';

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const COMPANY = process.env.COMPANY_NAME || 'Platform';
const BRAND_ARGB = 'FF0F766E';

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

const THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
};
const HEADER_BORDER = {
  top: { style: 'thin', color: { argb: BRAND_ARGB } },
  left: { style: 'thin', color: { argb: BRAND_ARGB } },
  bottom: { style: 'medium', color: { argb: 'FF064E3B' } },
  right: { style: 'thin', color: { argb: BRAND_ARGB } },
};

/* ─── shared Excel builder helpers ─────────────────────────────────────────── */

function makeWorkbook(title, filterLine, colCount) {
  const wb = new ExcelJS.Workbook();
  wb.creator = COMPANY;
  wb.created = new Date();
  const ws = wb.addWorksheet(title, {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const lastCol = String.fromCharCode(64 + Math.min(colCount, 26));
  ws.mergeCells(`A1:${lastCol}1`);
  const t = ws.getCell('A1');
  t.value = `${COMPANY} — ${title}`;
  t.font = { size: 14, bold: true, color: { argb: 'FF0F172A' } };
  t.alignment = { vertical: 'middle', horizontal: 'center' };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
  ws.getRow(1).height = 28;

  ws.mergeCells(`A2:${lastCol}2`);
  const sub = ws.getCell('A2');
  sub.value = `Generated: ${fmt(new Date())}  |  Filters: ${filterLine || 'none'}`;
  sub.font = { size: 9, italic: true, color: { argb: 'FF475569' } };
  sub.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(2).height = 18;
  ws.getRow(3).height = 6;

  return { wb, ws };
}

function addHeaders(ws, headers) {
  const row = ws.getRow(4);
  row.height = 22;
  headers.forEach((h, i) => {
    const c = row.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_ARGB } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
    c.border = HEADER_BORDER;
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: headers.length } };
}

function addRows(ws, rows, valFn) {
  rows.forEach((r, idx) => {
    const row = ws.getRow(5 + idx);
    row.height = 16;
    const bg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
    valFn(r, idx).forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'center' : 'left', wrapText: false };
      c.border = THIN_BORDER;
    });
  });
  const totalRow = ws.getRow(5 + rows.length);
  totalRow.height = 18;
  const totalCell = totalRow.getCell(1);
  totalCell.value = `Total records: ${rows.length}`;
  totalCell.font = { bold: true };
  totalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
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

const PDF_MARGIN = 30;

function makePDF(res, filename) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: PDF_MARGIN, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
  return doc;
}

function drawPDFHeader(doc, title, filterLine) {
  const CONTENT_W = doc.page.width - PDF_MARGIN * 2;
  doc.save();
  doc.rect(PDF_MARGIN, PDF_MARGIN, CONTENT_W, 36).fill('#0F766E');
  doc.fontSize(13).fillColor('#ffffff').font('Helvetica-Bold')
    .text(`${COMPANY} — ${title}`, PDF_MARGIN + 12, PDF_MARGIN + 11, { width: CONTENT_W - 24, align: 'center' });
  doc.restore();
  doc.fontSize(8).fillColor('#475569').font('Helvetica')
    .text(
      `Generated: ${fmt(new Date())}  |  Filters: ${filterLine || 'none'}`,
      PDF_MARGIN, PDF_MARGIN + 42, { width: CONTENT_W },
    );
  doc.moveTo(PDF_MARGIN, PDF_MARGIN + 56).lineTo(PDF_MARGIN + CONTENT_W, PDF_MARGIN + 56).lineWidth(0.5).stroke('#CBD5E1');
}

function drawPDFTable(doc, cols, rows, valFn, title, filterLine) {
  const tableLeft = PDF_MARGIN;
  const tableWidth = cols.reduce((s, c) => s + c.w, 0);
  const rowH = 17;
  const BANNER_BOTTOM = PDF_MARGIN + 66;
  let y = BANNER_BOTTOM;

  function drawHeader() {
    let x = tableLeft;
    doc.save();
    doc.rect(tableLeft, y, tableWidth, rowH).fill('#0F766E');
    doc.fontSize(7).fillColor('#ffffff').font('Helvetica-Bold');
    cols.forEach((c) => {
      doc.text(c.t, x + 3, y + 5, { width: c.w - 6, ellipsis: true });
      x += c.w;
    });
    doc.restore();
    y += rowH;
  }

  drawHeader();

  rows.forEach((r, idx) => {
    if (y + rowH > doc.page.height - 36) {
      doc.addPage();
      drawPDFHeader(doc, title, filterLine);
      y = BANNER_BOTTOM;
      drawHeader();
    }
    const bg = idx % 2 === 0 ? '#ffffff' : '#F8FAFC';
    let x = tableLeft;
    doc.save();
    cols.forEach((c) => { doc.rect(x, y, c.w, rowH).fillAndStroke(bg, '#E2E8F0'); x += c.w; });
    doc.restore();
    x = tableLeft;
    doc.fontSize(7).fillColor('#1E293B').font('Helvetica');
    valFn(r, idx).forEach((v, i) => {
      doc.text(String(v ?? ''), x + 3, y + 5, { width: cols[i].w - 6, ellipsis: true });
      x += cols[i].w;
    });
    y += rowH;
  });

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    doc.fontSize(7).fillColor('#94A3B8').font('Helvetica')
      .text(
        `${COMPANY}  |  Page ${i + 1} of ${range.count}  |  ${new Date().toUTCString()}`,
        PDF_MARGIN, doc.page.height - 22, { width: doc.page.width - PDF_MARGIN * 2, align: 'center' },
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

/* ─── Professional Tenants PDF (SaaS Super Admin Report) ────────────────────── */

function fmtDateTime(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mon = dt.toLocaleString('en-GB', { month: 'short' });
  const yyyy = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${dd} ${mon} ${yyyy} ${hh}:${mm}`;
}

function drawRoundedRect(doc, x, y, w, h, r, fillColor, strokeColor) {
  doc.save();
  doc.roundedRect(x, y, w, h, r);
  if (fillColor && strokeColor) doc.fillAndStroke(fillColor, strokeColor);
  else if (fillColor) doc.fill(fillColor);
  else if (strokeColor) doc.stroke(strokeColor);
  doc.restore();
}

/** Draw a filled arc segment for pie/doughnut charts */
function drawPieSlice(doc, cx, cy, r, startAngle, endAngle, color) {
  if (Math.abs(endAngle - startAngle) < 0.001) return;
  doc.save();
  doc.moveTo(cx, cy);
  doc.arc(cx, cy, r, startAngle, endAngle);
  doc.lineTo(cx, cy);
  doc.closePath();
  doc.fill(color);
  doc.restore();
}

/** Draw doughnut chart */
function drawDoughnutChart(doc, cx, cy, outerR, innerR, segments) {
  // Draw outer slices
  let angle = -Math.PI / 2;
  segments.forEach(seg => {
    const sweep = (seg.value / Math.max(1, segments.reduce((s, x) => s + x.value, 0))) * 2 * Math.PI;
    drawPieSlice(doc, cx, cy, outerR, angle, angle + sweep, seg.color);
    angle += sweep;
  });
  // Draw inner white circle (doughnut hole)
  doc.save();
  doc.circle(cx, cy, innerR).fill('#ffffff');
  doc.restore();
}

/** Draw bar chart */
function drawBarChart(doc, x, y, w, h, bars, maxVal) {
  const barCount = bars.length;
  const gap = 6;
  const barW = Math.floor((w - (barCount - 1) * gap) / barCount);
  const scaleH = h - 20; // leave 20pt for labels below

  bars.forEach((bar, i) => {
    const bh = maxVal > 0 ? Math.round((bar.value / maxVal) * scaleH) : 0;
    const bx = x + i * (barW + gap);
    const by = y + scaleH - bh;

    // Shadow
    doc.save();
    doc.rect(bx + 1, by + 1, barW, bh).fill('#e0e0e0');
    doc.restore();

    // Bar
    drawRoundedRect(doc, bx, by, barW, bh, 2, bar.color, null);

    // Value label on top
    doc.fontSize(6).fillColor('#374151')
      .text(String(bar.value), bx, by - 8, { width: barW, align: 'center' });

    // Label below
    doc.fontSize(6).fillColor('#6b7280')
      .text(bar.label, bx, y + scaleH + 4, { width: barW, align: 'center' });
  });

  // Baseline
  doc.save();
  doc.moveTo(x - 2, y + scaleH).lineTo(x + w, y + scaleH).stroke('#d1d5db');
  doc.restore();
}

/** Returns a light pastel background colour for a given status string */
function statusBadgeBg(status) {
  switch (String(status).toLowerCase()) {
    case 'active':    return '#D1FAE5'; // green-100
    case 'trial':     return '#DBEAFE'; // blue-100
    case 'suspended': return '#FEE2E2'; // red-100
    default:          return '#F1F5F9'; // slate-100
  }
}

/** Returns an icon circle background for insight cards */
function insightCircleBg(fg) {
  const map = {
    '#10B981': '#D1FAE5',
    '#3B82F6': '#DBEAFE',
    '#EF4444': '#FEE2E2',
    '#0F766E': '#CCFBF1',
    '#7C3AED': '#EDE9FE',
  };
  return map[fg] || '#F1F5F9';
}

/** Draw the professional tenant PDF report */
function buildTenantsPDF(res, rows, filters = {}) {
  const fl = [filters.search && `search=${filters.search}`, filters.plan && `plan=${filters.plan}`, filters.status && `status=${filters.status}`].filter(Boolean).join(' | ') || 'none';
  const doc = makePDF(res, `tenants_${fmt(new Date())}.pdf`);
  drawPDFHeader(doc, 'Tenants', fl);
  drawPDFTable(doc, TENANT_COLS, rows, tenantVals, 'Tenants', fl);
}

/* ══════════════════════════════════════════════════════════════════════════════
   ADMIN USERS
══════════════════════════════════════════════════════════════════════════════ */

const ADMIN_HEADERS = ['#', 'Name', 'Email', 'Role', 'Status', 'Last Login', 'Created'];
const ADMIN_COLS = [
  { w: 28, t: '#' }, { w: 110, t: 'Name' }, { w: 140, t: 'Email' },
  { w: 90, t: 'Role' }, { w: 65, t: 'Status' }, { w: 85, t: 'Last Login' }, { w: 75, t: 'Created' },
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
  drawPDFTable(doc, ADMIN_COLS, rows, adminVals, 'Admin Users', 'none');
}

/* ══════════════════════════════════════════════════════════════════════════════
   PAYMENTS / BILLING
══════════════════════════════════════════════════════════════════════════════ */

const PAY_HEADERS = ['#', 'Tenant', 'Plan', 'Amount', 'Currency', 'Method', 'Status', 'Date'];
const PAY_COLS = [
  { w: 28, t: '#' }, { w: 110, t: 'Tenant' }, { w: 100, t: 'Plan' },
  { w: 75, t: 'Amount' }, { w: 60, t: 'Currency' }, { w: 90, t: 'Method' },
  { w: 65, t: 'Status' }, { w: 80, t: 'Date' },
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
  drawPDFTable(doc, PAY_COLS, rows, payVals, 'Billing & Payments', fl);
}

/* ══════════════════════════════════════════════════════════════════════════════
   AUDIT LOGS
══════════════════════════════════════════════════════════════════════════════ */

const AUDIT_HEADERS = ['#', 'Actor', 'Action', 'Target', 'IP Address', 'Result', 'Date'];
const AUDIT_COLS = [
  { w: 28, t: '#' }, { w: 120, t: 'Actor' }, { w: 130, t: 'Action' },
  { w: 130, t: 'Target' }, { w: 95, t: 'IP Address' }, { w: 65, t: 'Result' }, { w: 80, t: 'Date' },
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
  drawPDFTable(doc, AUDIT_COLS, rows, auditVals, 'Audit Logs', 'none');
}

/* ══════════════════════════════════════════════════════════════════════════════
   SUPPORT TICKETS
══════════════════════════════════════════════════════════════════════════════ */

const TKT_HEADERS = ['#', 'Ticket', 'Organisation', 'Subject', 'Priority', 'Assigned To', 'Status', 'Created'];
const TKT_COLS = [
  { w: 28, t: '#' }, { w: 65, t: 'Ticket' }, { w: 110, t: 'Organisation' },
  { w: 140, t: 'Subject' }, { w: 65, t: 'Priority' }, { w: 95, t: 'Assigned To' },
  { w: 60, t: 'Status' }, { w: 75, t: 'Created' },
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
  drawPDFTable(doc, TKT_COLS, rows, tktVals, 'Support Tickets', 'none');
}

/* ══════════════════════════════════════════════════════════════════════════════
   ANNOUNCEMENTS
══════════════════════════════════════════════════════════════════════════════ */

const ANN_HEADERS = ['#', 'Title', 'Audience', 'Type', 'Recipients', 'Date'];
const ANN_COLS = [
  { w: 28, t: '#' }, { w: 200, t: 'Title' }, { w: 120, t: 'Audience' },
  { w: 80, t: 'Type' }, { w: 80, t: 'Recipients' }, { w: 90, t: 'Date' },
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
  drawPDFTable(doc, ANN_COLS, rows, annVals, 'Announcements', 'none');
}

module.exports = {
  buildTenantsExcel, buildTenantsPDF,
  buildAdminUsersExcel, buildAdminUsersPDF,
  buildPaymentsExcel, buildPaymentsPDF,
  buildAuditLogsExcel, buildAuditLogsPDF,
  buildSupportTicketsExcel, buildSupportTicketsPDF,
  buildAnnouncementsExcel, buildAnnouncementsPDF,
};
