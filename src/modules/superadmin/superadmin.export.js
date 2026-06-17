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
  const doc = new (require('pdfkit'))({
    size: 'A4',
    layout: 'portrait',
    margin: 0,
    bufferPages: true,
    info: {
      Title: 'Organisation Management Report',
      Author: COMPANY,
      Subject: 'Super Admin Dashboard Report',
    },
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="organisation_report_${fmt(new Date())}.pdf"`);
  doc.pipe(res);

  const PW = doc.page.width;   // 595
  const PH = doc.page.height;  // 842
  const ML = 36; // margin left
  const MR = 36; // margin right
  const CW = PW - ML - MR;     // content width

  // ── Colour palette ──────────────────────────────────────────────
  const C = {
    teal:       '#0F766E',
    tealDark:   '#0c6b64',
    tealLight:  '#CCFBF1',
    green:      '#10B981',
    greenLight: '#D1FAE5',
    blue:       '#3B82F6',
    blueLight:  '#DBEAFE',
    red:        '#EF4444',
    redLight:   '#FEE2E2',
    orange:     '#F59E0B',
    dark:       '#0F172A',
    slate800:   '#1E293B',
    slate600:   '#475569',
    slate400:   '#94A3B8',
    slate200:   '#E2E8F0',
    slate100:   '#F1F5F9',
    white:      '#FFFFFF',
    headerBg:   '#0F172A',
  };

  // ── Compute stats ────────────────────────────────────────────────
  const total     = rows.length;
  const active    = rows.filter(r => String(r.status).toLowerCase() === 'active').length;
  const trial     = rows.filter(r => String(r.status).toLowerCase() === 'trial').length;
  const suspended = rows.filter(r => String(r.status).toLowerCase() === 'suspended').length;

  // Tier distribution
  const tierMap = {};
  rows.forEach(r => {
    const t = r.plan || 'Unknown';
    tierMap[t] = (tierMap[t] || 0) + 1;
  });
  const tierEntries = Object.entries(tierMap).sort((a, b) => b[1] - a[1]);
  const mostPopularTier = tierEntries.length > 0 ? tierEntries[0][0] : 'N/A';
  const totalEmployees = rows.reduce((s, r) => s + (Number(r.employee_count) || 0), 0);

  // Recently registered (last 5)
  const recentRows = [...rows]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5);

  const generatedAt = fmtDateTime(new Date());
  const generatedBy = 'Super Admin';

  // ════════════════════════════════════════════════════════════════
  // PAGE 1 — COVER + EXECUTIVE SUMMARY + CHARTS
  // ════════════════════════════════════════════════════════════════

  // ── Cover header block ───────────────────────────────────────────
  doc.rect(0, 0, PW, 110).fill(C.headerBg);

  // Decorative accent strip
  doc.rect(0, 0, 6, 110).fill(C.teal);

  // Logo placeholder box
  drawRoundedRect(doc, ML, 20, 52, 38, 4, C.teal, null);
  doc.fontSize(7).fillColor(C.white).text('LOGO', ML + 14, 36, { width: 24, align: 'center' });

  // Title
  doc.fontSize(18).font('Helvetica-Bold').fillColor(C.white)
    .text('Organisation Management Report', ML + 62, 22, { width: CW - 62 });
  doc.fontSize(9).font('Helvetica').fillColor('#94A3B8')
    .text('Super Admin Dashboard Report  •  Confidential', ML + 62, 46, { width: CW - 62 });

  // Meta row
  doc.fontSize(8).fillColor('#CBD5E1')
    .text(`Generated: ${generatedAt}   |   By: ${generatedBy}   |   Total Records: ${total}`, ML + 62, 62, { width: CW - 62 });

  // Filter chips
  const fl = [
    filters.search && `Search: ${filters.search}`,
    filters.plan   && `Plan: ${filters.plan}`,
    filters.status && `Status: ${filters.status}`,
  ].filter(Boolean).join('  •  ');
  if (fl) {
    doc.fontSize(7).fillColor('#64748B').text(`Filters applied: ${fl}`, ML + 62, 78, { width: CW - 62 });
  }

  // Accent underline
  doc.rect(0, 110, PW, 3).fill(C.teal);

  // ── Executive Summary — Stat Cards ───────────────────────────────
  let cy = 128;
  doc.fontSize(11).font('Helvetica-Bold').fillColor(C.dark)
    .text('Executive Summary', ML, cy);
  doc.fontSize(7).font('Helvetica').fillColor(C.slate600)
    .text('Key performance indicators across all registered organisations', ML, cy + 14);
  cy += 32;

  const cards = [
    { label: 'TOTAL ORGANIZATIONS', value: total,     bg: C.dark,    fg: C.white,      accent: C.teal  },
    { label: 'ACTIVE',              value: active,    bg: C.teal,    fg: C.white,      accent: C.green },
    { label: 'TRIAL',               value: trial,     bg: C.blue,    fg: C.white,      accent: '#60A5FA' },
    { label: 'SUSPENDED',           value: suspended, bg: C.red,     fg: C.white,      accent: '#FCA5A5' },
  ];
  const cardW = Math.floor(CW / 4) - 4;
  const cardH = 64;
  cards.forEach((card, i) => {
    const cx2 = ML + i * (cardW + 5);
    // shadow
    doc.save();
    doc.rect(cx2 + 2, cy + 2, cardW, cardH).fill('#00000015');
    doc.restore();
    // card bg
    drawRoundedRect(doc, cx2, cy, cardW, cardH, 5, card.bg, null);
    // top accent strip
    doc.save();
    doc.roundedRect(cx2, cy, cardW, 4, 2).fill(card.accent);
    doc.restore();
    // label
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor(card.fg)
      .text(card.label, cx2 + 8, cy + 12, { width: cardW - 16, align: 'left', characterSpacing: 0.5 });
    // value
    doc.fontSize(24).font('Helvetica-Bold').fillColor(card.fg)
      .text(String(card.value), cx2 + 8, cy + 28, { width: cardW - 16, align: 'left' });
  });
  cy += cardH + 24;

  // ── Charts ───────────────────────────────────────────────────────
  doc.fontSize(11).font('Helvetica-Bold').fillColor(C.dark)
    .text('Analytics Overview', ML, cy);
  doc.fontSize(7).font('Helvetica').fillColor(C.slate600)
    .text('Visual breakdown of organisation status distribution and tier allocation', ML, cy + 14);
  cy += 30;

  const chartAreaH = 170;
  const halfW = Math.floor(CW / 2) - 8;

  // Left chart panel
  drawRoundedRect(doc, ML, cy, halfW, chartAreaH, 6, C.white, C.slate200);
  doc.fontSize(8.5).font('Helvetica-Bold').fillColor(C.dark)
    .text('Organisation Status Overview', ML + 10, cy + 10);
  doc.fontSize(6.5).font('Helvetica').fillColor(C.slate600)
    .text('Doughnut Chart — Active / Trial / Suspended', ML + 10, cy + 22);

  // Draw doughnut
  const doughnutSegs = [
    { label: 'Active',    value: active,    color: C.green },
    { label: 'Trial',     value: trial,     color: C.blue  },
    { label: 'Suspended', value: suspended, color: C.red   },
  ].filter(s => s.value > 0);

  const dcx = ML + halfW / 2;
  const dcy = cy + chartAreaH / 2 + 8;
  const dR  = 52;
  const dInR = 28;

  if (doughnutSegs.length > 0) {
    drawDoughnutChart(doc, dcx, dcy, dR, dInR, doughnutSegs);
    // Center label
    doc.fontSize(8).font('Helvetica-Bold').fillColor(C.dark)
      .text(String(total), dcx - 14, dcy - 7, { width: 28, align: 'center' });
    doc.fontSize(5.5).font('Helvetica').fillColor(C.slate600)
      .text('Total', dcx - 14, dcy + 4, { width: 28, align: 'center' });
  } else {
    doc.fontSize(9).fillColor(C.slate400).text('No data', dcx - 20, dcy - 5);
  }

  // Legend
  let legendY = cy + chartAreaH - 48;
  const legendX = ML + halfW / 2 + dR + 8;
  doughnutSegs.forEach((seg, i) => {
    const lx = ML + 10 + (i % 2 === 0 ? 0 : halfW / 2 - 10);
    const ly = cy + chartAreaH - 38 + Math.floor(i / 2) * 14;
    doc.save();
    doc.rect(lx, ly + 2, 8, 8).fill(seg.color);
    doc.restore();
    doc.fontSize(6.5).font('Helvetica').fillColor(C.dark)
      .text(`${seg.label}: ${seg.value}`, lx + 11, ly + 1, { width: 60 });
  });
  // suppress unused variable warning
  void legendY; void legendX;

  // Right chart panel
  const rightChartX = ML + halfW + 16;
  drawRoundedRect(doc, rightChartX, cy, halfW, chartAreaH, 6, C.white, C.slate200);
  doc.fontSize(8.5).font('Helvetica-Bold').fillColor(C.dark)
    .text('Tier Distribution', rightChartX + 10, cy + 10);
  doc.fontSize(6.5).font('Helvetica').fillColor(C.slate600)
    .text('Bar Chart — Subscription Plan Breakdown', rightChartX + 10, cy + 22);

  const tierColors = ['#0F766E', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444', '#10B981', '#EC4899'];
  const barItems = tierEntries.slice(0, 6).map((e, i) => ({
    label: e[0].length > 8 ? e[0].slice(0, 7) + '…' : e[0],
    value: e[1],
    color: tierColors[i % tierColors.length],
  }));
  const maxBarVal = barItems.length > 0 ? Math.max(...barItems.map(b => b.value)) : 1;

  const bChartX = rightChartX + 16;
  const bChartY = cy + 40;
  const bChartW = halfW - 32;
  const bChartH = chartAreaH - 64;

  if (barItems.length > 0) {
    drawBarChart(doc, bChartX, bChartY, bChartW, bChartH, barItems, maxBarVal);
  } else {
    doc.fontSize(9).fillColor(C.slate400).text('No data', bChartX + 20, bChartY + 30);
  }

  cy += chartAreaH + 14;

  // ── Section divider ──────────────────────────────────────────────
  doc.rect(ML, cy, CW, 1).fill(C.slate200);
  cy += 10;

  // Recently Registered preview (compact, 3 rows)
  doc.fontSize(10).font('Helvetica-Bold').fillColor(C.dark)
    .text('Recently Registered Organisations', ML, cy);
  doc.fontSize(6.5).font('Helvetica').fillColor(C.slate600)
    .text('Latest 5 onboarded organisations (see detailed table on next page)', ML, cy + 12);
  cy += 24;

  const rcCols = [
    { label: 'Organisation Name', w: Math.round(CW * 0.30) },
    { label: 'Tier / Plan',       w: Math.round(CW * 0.18) },
    { label: 'Status',            w: Math.round(CW * 0.14) },
    { label: 'Registration Date', w: Math.round(CW * 0.20) },
    { label: 'Admin Email',       w: Math.round(CW * 0.18) },
  ];

  // Header row
  let rx = ML;
  doc.rect(ML, cy, CW, 16).fill(C.teal);
  rcCols.forEach(col => {
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor(C.white)
      .text(col.label, rx + 4, cy + 4, { width: col.w - 8 });
    rx += col.w;
  });
  cy += 16;

  recentRows.forEach((row, idx) => {
    const rowBg = idx % 2 === 0 ? C.white : C.slate100;
    doc.rect(ML, cy, CW, 15).fill(rowBg);
    rx = ML;
    const cells = [
      trunc(row.name || '', 28),
      trunc(row.plan || 'None', 16),
      cap(row.status),
      fmt(row.created_at),
      trunc(row.admin_email || '', 22),
    ];
    // Status badge color
    const statusColor = {
      active:    C.green,
      trial:     C.blue,
      suspended: C.red,
    }[String(row.status).toLowerCase()] || C.slate600;

    rcCols.forEach((col, ci) => {
      const cellVal = cells[ci] || '';
      if (ci === 2) {
        // Status badge
        const badgeW = 36;
        const badgeX = rx + 4;
        const badgeY = cy + 2;
        drawRoundedRect(doc, badgeX, badgeY, badgeW, 11, 3, statusBadgeBg(row.status), null);
        doc.fontSize(6).font('Helvetica-Bold').fillColor(statusColor)
          .text(cellVal.toUpperCase(), badgeX + 2, badgeY + 2, { width: badgeW - 4, align: 'center' });
      } else {
        doc.fontSize(6.5).font('Helvetica').fillColor(C.dark)
          .text(cellVal, rx + 4, cy + 4, { width: col.w - 8, ellipsis: true });
      }
      rx += col.w;
    });
    cy += 15;
  });

  // bottom border for recent table
  doc.rect(ML, cy, CW, 1).fill(C.slate200);
  cy += 1;

  // ════════════════════════════════════════════════════════════════
  // PAGE 2+ — FULL ORGANISATION TABLE
  // ════════════════════════════════════════════════════════════════
  doc.addPage({ size: 'A4', layout: 'portrait', margin: 0 });

  const tableCols = [
    { label: '#',                 w: Math.round(CW * 0.04), key: '_idx'       },
    { label: 'Organisation Name', w: Math.round(CW * 0.18), key: 'name'       },
    { label: 'Domain / DB',       w: Math.round(CW * 0.16), key: 'db_name'    },
    { label: 'Tier / Plan',       w: Math.round(CW * 0.11), key: 'plan'       },
    { label: 'Status',            w: Math.round(CW * 0.10), key: 'status'     },
    { label: 'Admin Email',       w: Math.round(CW * 0.18), key: 'admin_email'},
    { label: 'Root Admin',        w: Math.round(CW * 0.13), key: 'admin_name' },
    { label: 'Registered',        w: Math.round(CW * 0.10), key: 'created_at' },
  ];
  // clamp last col to fill
  const usedW = tableCols.reduce((s, c) => s + c.w, 0);
  tableCols[tableCols.length - 1].w += CW - usedW;

  function drawTablePageHeader(pageY) {
    // Page banner
    doc.rect(0, 0, PW, 34).fill(C.headerBg);
    doc.rect(0, 0, 6, 34).fill(C.teal);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(C.white)
      .text('Organisation Details  —  Full Registry', ML, 8);
    doc.fontSize(7).font('Helvetica').fillColor('#94A3B8')
      .text(`${COMPANY}  •  Super Admin Report  •  ${generatedAt}`, ML, 20);

    let headerY = 44;
    doc.fontSize(10).font('Helvetica-Bold').fillColor(C.dark)
      .text('Organisation Details Table', ML, headerY);
    doc.fontSize(6.5).font('Helvetica').fillColor(C.slate600)
      .text(`Showing ${rows.length} registered organisations — All available data exported`, ML, headerY + 12);
    headerY += 26;

    // Table header
    let hx = ML;
    doc.rect(ML, headerY, CW, 17).fill(C.teal);
    tableCols.forEach(col => {
      doc.fontSize(6.5).font('Helvetica-Bold').fillColor(C.white)
        .text(col.label, hx + 4, headerY + 4, { width: col.w - 8 });
      hx += col.w;
    });
    return headerY + 17;
  }

  let tableRowY = drawTablePageHeader(0);
  const ROW_H = 16;

  rows.forEach((row, idx) => {
    if (tableRowY + ROW_H > PH - 36) {
      doc.addPage({ size: 'A4', layout: 'portrait', margin: 0 });
      tableRowY = drawTablePageHeader(0);
    }

    const rowBg = idx % 2 === 0 ? C.white : C.slate100;
    doc.rect(ML, tableRowY, CW, ROW_H).fill(rowBg);

    // cell separator lines
    doc.save();
    doc.rect(ML, tableRowY, CW, ROW_H).stroke(C.slate200);
    doc.restore();

    let tx = ML;
    const statusColor = {
      active:    C.green,
      trial:     C.blue,
      suspended: C.red,
    }[String(row.status).toLowerCase()] || C.slate600;

    tableCols.forEach(col => {
      let cellVal = '';
      if (col.key === '_idx')       cellVal = String(idx + 1);
      else if (col.key === 'status') cellVal = cap(row.status);
      else if (col.key === 'created_at') cellVal = fmt(row.created_at);
      else cellVal = trunc(String(row[col.key] || ''), 24);

      if (col.key === 'status') {
        const bW = col.w - 10;
        drawRoundedRect(doc, tx + 4, tableRowY + 3, bW, 10, 3, statusBadgeBg(row.status), null);
        doc.fontSize(5.5).font('Helvetica-Bold').fillColor(statusColor)
          .text(cellVal.toUpperCase(), tx + 4, tableRowY + 5, { width: bW, align: 'center' });
      } else if (col.key === '_idx') {
        doc.fontSize(6.5).font('Helvetica-Bold').fillColor(C.slate600)
          .text(cellVal, tx + 2, tableRowY + 4, { width: col.w - 4, align: 'center' });
      } else {
        doc.fontSize(6.5).font('Helvetica').fillColor(C.dark)
          .text(cellVal, tx + 4, tableRowY + 4, { width: col.w - 8, ellipsis: true });
      }
      tx += col.w;
    });

    tableRowY += ROW_H;
  });

  // After table — total row
  if (tableRowY + 14 > PH - 36) {
    doc.addPage({ size: 'A4', layout: 'portrait', margin: 0 });
    tableRowY = 36;
  }
  doc.rect(ML, tableRowY, CW, 14).fill(C.teal + '22');
  doc.fontSize(7).font('Helvetica-Bold').fillColor(C.tealDark)
    .text(`Total organisations exported: ${rows.length}`, ML + 6, tableRowY + 3, { width: CW - 12 });
  tableRowY += 20;

  // ── Report Insights Section ──────────────────────────────────────
  if (tableRowY + 140 > PH - 40) {
    doc.addPage({ size: 'A4', layout: 'portrait', margin: 0 });
    tableRowY = 36;
  }

  doc.rect(ML, tableRowY, CW, 1).fill(C.slate200);
  tableRowY += 14;

  doc.fontSize(11).font('Helvetica-Bold').fillColor(C.dark)
    .text('Report Insights', ML, tableRowY);
  doc.fontSize(6.5).font('Helvetica').fillColor(C.slate600)
    .text('Aggregated analytics and key takeaways from the exported dataset', ML, tableRowY + 13);
  tableRowY += 30;

  const insightCards = [
    { label: 'Active Organisations',   value: String(active),          bg: C.greenLight, fg: C.green  },
    { label: 'Trial Organisations',    value: String(trial),           bg: C.blueLight,  fg: C.blue   },
    { label: 'Suspended Organisations',value: String(suspended),       bg: C.redLight,   fg: C.red    },
    { label: 'Most Popular Tier',      value: mostPopularTier,         bg: C.tealLight,  fg: C.teal   },
    { label: 'Total Employees',        value: totalEmployees > 0 ? String(totalEmployees) : 'N/A',
      bg: '#F3E8FF', fg: '#7C3AED' },
  ];
  const icW  = Math.floor(CW / insightCards.length) - 5;
  const icH  = 58;
  insightCards.forEach((ic, i) => {
    const icX = ML + i * (icW + 6);
    drawRoundedRect(doc, icX, tableRowY, icW, icH, 6, ic.bg, null);
    // icon placeholder circle
    doc.save();
    doc.circle(icX + 14, tableRowY + 14, 9).fill(insightCircleBg(ic.fg));
    doc.restore();
    doc.fontSize(10).font('Helvetica-Bold').fillColor(ic.fg)
      .text('✦', icX + 9, tableRowY + 7, { width: 12, align: 'center' });
    doc.fontSize(7).font('Helvetica-Bold').fillColor(ic.fg)
      .text(ic.label, icX + 6, tableRowY + 28, { width: icW - 12 });
    doc.fontSize(13).font('Helvetica-Bold').fillColor(ic.fg)
      .text(ic.value, icX + 6, tableRowY + 38, { width: icW - 12, ellipsis: true });
  });
  tableRowY += icH + 10;

  // ════════════════════════════════════════════════════════════════
  // PER-PAGE FOOTER
  // ════════════════════════════════════════════════════════════════
  const pageRange = doc.bufferedPageRange();
  for (let pi = 0; pi < pageRange.count; pi++) {
    doc.switchToPage(pageRange.start + pi);
    const footerY = PH - 28;

    doc.rect(0, footerY - 4, PW, 32).fill(C.headerBg);
    doc.rect(0, footerY - 4, PW, 1).fill(C.teal);

    // Left — report info
    doc.fontSize(6.5).font('Helvetica').fillColor('#64748B')
      .text(`Organisation Management Report  •  Generated on: ${generatedAt}  •  Confidential – Super Admin Access Only`,
        ML, footerY + 2, { width: CW - 80 });

    // Right — page number
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#94A3B8')
      .text(`Page ${pi + 1} of ${pageRange.count}`,
        PW - MR - 70, footerY + 2, { width: 70, align: 'right' });
  }

  doc.end();
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
