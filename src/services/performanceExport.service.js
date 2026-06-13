'use strict';

const PdfKit = require('pdfkit');
const ExcelJS = require('exceljs');
const ApiError = require('../utils/ApiError');
const { assertEmployeeRecordAccess } = require('../utils/applyDataScope');

const validExportTypes = ['csv', 'pdf', 'excel'];

async function fetchCycles(pool) {
  const { rows } = await pool.query(
    `SELECT id, cycle_name, start_date, end_date
     FROM performance_cycles
     WHERE deleted_at IS NULL
     ORDER BY start_date DESC`
  );
  return rows.map((row) => ({
    id: row.id,
    cycleName: row.cycle_name,
    startDate: row.start_date ? row.start_date.toISOString().split('T')[0] : null,
    endDate: row.end_date ? row.end_date.toISOString().split('T')[0] : null,
  }));
}

async function fetchCyclesForEmployee(pool, employeeId) {
  if (!employeeId) return [];
  const { rows } = await pool.query(
    `SELECT DISTINCT pc.id, pc.cycle_name, pc.start_date, pc.end_date
     FROM employee_performance ep
     JOIN performance_cycles pc ON ep.performance_cycle_id = pc.id
     WHERE ep.employee_id = $1
       AND ep.deleted_at IS NULL
       AND pc.deleted_at IS NULL
     ORDER BY pc.start_date DESC`,
    [employeeId]
  );
  return rows.map((row) => ({
    id: row.id,
    cycleName: row.cycle_name,
    startDate: row.start_date ? row.start_date.toISOString().split('T')[0] : null,
    endDate: row.end_date ? row.end_date.toISOString().split('T')[0] : null,
  }));
}

async function exportData(pool, options, auth) {
  const {
    employeeId,
    cycleId,
    startDate,
    endDate,
    exportType,
    organizationName,
  } = options;

  // 1. Validation
  if (!employeeId) {
    throw ApiError.badRequest('Employee is required.');
  }

  if (!exportType || !validExportTypes.includes(String(exportType).toLowerCase())) {
    throw ApiError.badRequest('Invalid export type. Must be csv or pdf.');
  }

  const hasCycle = cycleId !== undefined && cycleId !== null && cycleId !== '';
  const hasDateRange = startDate || endDate;

  if (hasCycle && hasDateRange) {
    throw ApiError.badRequest('Please select either performance cycle or custom date range, not both.');
  }

  if (!hasCycle && (!startDate || !endDate)) {
    throw ApiError.badRequest('Please select performance cycle or start and end date.');
  }

  let dateFrom = startDate;
  let dateTo = endDate;
  let cycleName = 'Custom Date Range';

  if (hasCycle) {
    const cycleResult = await pool.query(
      `SELECT cycle_name, start_date, end_date FROM performance_cycles WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [cycleId]
    );
    if (!cycleResult.rows.length) {
      throw ApiError.notFound('Selected performance cycle not found.');
    }
    const cycle = cycleResult.rows[0];
    cycleName = cycle.cycle_name;
    dateFrom = cycle.start_date ? cycle.start_date.toISOString().split('T')[0] : null;
    dateTo = cycle.end_date ? cycle.end_date.toISOString().split('T')[0] : null;
  }

  // 2. Fetch Employee Profile Details with Department and Manager
  const empResult = await pool.query(
    `SELECT e.id, e.full_name as employee_name, e.emp_id as employee_code,
            d.name as department_name, d.name as department,
            e.reporting_manager_id, e.department_id,
            mgr.full_name as manager_name
     FROM employees e
     LEFT JOIN departments d ON e.department_id = d.id
     LEFT JOIN employees mgr ON e.reporting_manager_id = mgr.id
     WHERE e.id = $1 AND e.deleted_at IS NULL LIMIT 1`,
    [employeeId]
  );
  if (!empResult.rows.length) {
    throw ApiError.notFound('Employee not found.');
  }
  const employeeDetails = empResult.rows[0];

  // Data-scope enforcement: a SELF/TEAM/DEPARTMENT user must not export another
  // employee's performance record by supplying an arbitrary employeeId.
  assertEmployeeRecordAccess(auth, employeeDetails);

  // 3. Fetch Performance Assessment matching employee and selected cycle/date range
  const assessmentQuery = `
    SELECT ep.*, pc.cycle_name, pc.start_date as cycle_start_date, pc.end_date as cycle_end_date,
           mgr.full_name as assessment_manager_name
    FROM employee_performance ep
    LEFT JOIN performance_cycles pc ON ep.performance_cycle_id = pc.id
    LEFT JOIN employees mgr ON ep.manager_id = mgr.id AND mgr.deleted_at IS NULL
    WHERE ep.employee_id = $1
      AND ep.deleted_at IS NULL
      AND (
        ($2::integer IS NOT NULL AND ep.performance_cycle_id = $2::integer) OR
        ($2 IS NULL AND (
          ep.assessment_date::date BETWEEN $3::date AND $4::date
          OR (ep.assessment_date IS NULL AND ep.created_at::date BETWEEN $3::date AND $4::date)
        ))
      )
    ORDER BY ep.created_at DESC
    LIMIT 1
  `;
  const assessmentRes = await pool.query(assessmentQuery, [
    employeeId,
    cycleId || null,
    dateFrom || null,
    dateTo || null
  ]);

  if (!assessmentRes.rows.length) {
    throw ApiError.notFound('No performance assessment record found for this employee in the selected cycle/date range.');
  }
  const assessment = assessmentRes.rows[0];

  // Resolve competency names
  const competencyRatings = assessment.competency_ratings || [];
  let competencyRatingsFormatted = [];
  if (Array.isArray(competencyRatings) && competencyRatings.length > 0) {
    const compIds = competencyRatings.map(cr => Number(cr.competency)).filter(Boolean);
    if (compIds.length > 0) {
      const compRes = await pool.query(
        `SELECT id, competency_name FROM competencies WHERE id = ANY($1)`,
        [compIds]
      );
      const compMap = {};
      compRes.rows.forEach(c => {
        compMap[c.id] = c.competency_name;
      });
      competencyRatingsFormatted = competencyRatings.map(cr => ({
        competencyName: compMap[cr.competency] || 'Unknown Competency',
        rating: Number(cr.rating || 0)
      }));
    }
  }

  const cycleDuration = `${formatDateShort(dateFrom)} to ${formatDate(dateTo)}`;

  const completeData = {
    employeeName: employeeDetails.employee_name || 'N/A',
    employeeCode: employeeDetails.employee_code || 'N/A',
    departmentName: employeeDetails.department_name || 'N/A',
    managerName: assessment.assessment_manager_name || employeeDetails.manager_name || assessment.performance_lead || 'N/A',
    performanceCycle: assessment.cycle_name || cycleName,
    cycleDuration: cycleDuration,
    competencyRatings: competencyRatingsFormatted,
    overallRating: assessment.overall_rating ? Number(assessment.overall_rating) : 0,
    performanceBand: assessment.performance_band || 'N/A',
    keyContributions: assessment.key_contributions || 'N/A',
    growthObjectives: assessment.growth_objectives || 'N/A',
    remarks: assessment.remarks || 'N/A',
    goalTitle: assessment.goal_title || 'N/A',
    priority: assessment.priority || 'Medium',
    kpiTarget: assessment.kpi_target || 'N/A',
    goalDueDate: assessment.due_date ? assessment.due_date.toISOString().split('T')[0] : 'N/A',
    weightage: assessment.weightage || null,
    employeeStatus: assessment.employee_status || 'Not Started',
    employeeProgress: assessment.employee_progress || '0',
    employeeComments: assessment.employee_comments || 'N/A',
    completionNotes: assessment.completion_notes || 'N/A',
    reportGeneratedDate: new Date().toLocaleString(),
    organizationName: organizationName || 'HRIS System',
  };

  const type = exportType.toLowerCase();
  if (type === 'csv') return generateCsv(completeData);
  if (type === 'excel') return generateExcel(completeData);
  return generatePdf(completeData);
}

// ────────────────────────────────────────────────────────────────────────
// PDF / CSV GENERATION HELPERS
// ────────────────────────────────────────────────────────────────────────

const formatDate = (dateInput) => {
  if (!dateInput) return 'N/A';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return 'N/A';
  const day = date.getDate();
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${day} ${months[date.getMonth()]} ${date.getFullYear()}`;
};

const formatDateShort = (dateInput) => {
  if (!dateInput) return 'N/A';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return 'N/A';
  const day = date.getDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${months[date.getMonth()]}`;
};

// ── Palette ──────────────────────────────────────────────────────────────
const C = {
  headerBg:   '#1E3A8A',   // deep indigo header
  headerText: '#FFFFFF',
  accent1:    '#2563EB',   // blue  – employee card
  accent2:    '#7C3AED',   // purple – competency
  accent3:    '#0F766E',   // teal  – admin feedback
  accent4:    '#C2410C',   // orange – goals
  accent5:    '#065F46',   // emerald – progress
  cardBg1:    '#EFF6FF',
  cardBg2:    '#F5F3FF',
  cardBg3:    '#F0FDFA',
  cardBg4:    '#FFF7ED',
  cardBg5:    '#ECFDF5',
  text:       '#1E293B',
  muted:      '#64748B',
  border:     '#E2E8F0',
  barBg:      '#E2E8F0',
};

// ── Page geometry ─────────────────────────────────────────────────────────
const PAGE_W  = 595.28;
const PAGE_H  = 841.89;
const MARGIN  = 28;
const CONTENT_W = PAGE_W - MARGIN * 2;  // 539.28
const FOOTER_H  = 28;
const SAFE_BOTTOM = PAGE_H - FOOTER_H - 10; // ~803

// ── Guard: add page if not enough vertical space ──────────────────────────
function ensureSpace(doc, needed) {
  if (doc.y + needed > SAFE_BOTTOM) {
    doc.addPage();
    doc.y = 36;
  }
}

// ── Section header (left-bar accent + bold title) ─────────────────────────
function drawSectionHeader(doc, title, color) {
  ensureSpace(doc, 30);
  doc.moveDown(0.5);
  const y = doc.y;
  doc.rect(MARGIN, y, 4, 20).fill(color);
  doc.fillColor(color)
     .font('Helvetica-Bold')
     .fontSize(15)
     .text(title, MARGIN + 10, y + 2);
  doc.moveDown(0.6);
}

// ── Progress-bar helper ───────────────────────────────────────────────────
// percentage: 0-100
function drawProgressBar(doc, x, y, barW, barH, percentage) {
  const pct = Math.min(100, Math.max(0, percentage));

  // color by score
  let fillColor = '#10B981'; // green  ≥ 71%
  if (pct <= 40)       fillColor = '#EF4444'; // red
  else if (pct <= 70)  fillColor = '#F59E0B'; // amber

  // background track
  doc.roundedRect(x, y, barW, barH, barH / 2).fill(C.barBg);

  // filled portion
  if (pct > 0) {
    const fillW = Math.max(barH, (pct / 100) * barW); // min width = height (circle)
    doc.roundedRect(x, y, fillW, barH, barH / 2).fill(fillColor);
  }

  return fillColor;
}

// ── Colored badge ─────────────────────────────────────────────────────────
function drawBadge(doc, label, x, y) {
  let bgColor = '#F1F5F9', textColor = '#475569';
  const s = String(label).toLowerCase();
  if (['high','unsatisfactory','needs improvement'].includes(s)) {
    bgColor = '#FEE2E2'; textColor = '#991B1B';
  } else if (['medium','pending','on hold','developing'].includes(s)) {
    bgColor = '#FFEDD5'; textColor = '#C2410C';
  } else if (['low','completed','approved','meets','active'].includes(s)) {
    bgColor = '#D1FAE5'; textColor = '#065F46';
  } else if (['in progress','exceeds','outstanding','upcoming'].includes(s)) {
    bgColor = '#DBEAFE'; textColor = '#1E40AF';
  }
  doc.font('Helvetica-Bold').fontSize(8);
  const bw = doc.widthOfString(label) + 14;
  const bh = 15;
  doc.roundedRect(x, y, bw, bh, 4).fill(bgColor);
  doc.fillColor(textColor).text(label, x + 7, y + 3.5);
  return bw;
}

// ── Compact table ─────────────────────────────────────────────────────────
function drawCompactTable(doc, headers, rows, x, y, width, hdrColor, altBg) {
  const colW = width / headers.length;
  let curY = y;
  const ROW_H = 20;
  const HDR_H = 22;

  const drawHeader = (atY) => {
    doc.rect(x, atY, width, HDR_H).fill(hdrColor);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10);
    headers.forEach((h, i) => {
      doc.text(h, x + i * colW + 6, atY + 6, { width: colW - 12, align: 'left' });
    });
    return atY + HDR_H;
  };

  curY = drawHeader(curY);

  doc.font('Helvetica').fontSize(10);
  rows.forEach((row, ri) => {
    if (curY + ROW_H > SAFE_BOTTOM) {
      doc.addPage();
      curY = 36;
      curY = drawHeader(curY);
      doc.font('Helvetica').fontSize(10);
    }
    const bg = ri % 2 === 0 ? '#FFFFFF' : altBg;
    doc.rect(x, curY, width, ROW_H).fill(bg);
    doc.strokeColor(C.border).lineWidth(0.4).rect(x, curY, width, ROW_H).stroke();
    doc.fillColor(C.text);
    row.forEach((cell, ci) => {
      doc.text(String(cell ?? 'N/A'), x + ci * colW + 6, curY + 5, {
        width: colW - 12, align: 'left'
      });
    });
    curY += ROW_H;
  });

  doc.y = curY;
}

// ────────────────────────────────────────────────────────────────────────────
// generatePdf
// ────────────────────────────────────────────────────────────────────────────
function generatePdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PdfKit({
      size: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      bufferPages: true,
    });
    const buffers = [];
    doc.on('data', (c) => buffers.push(c));
    doc.on('end', () => resolve({
      data: Buffer.concat(buffers),
      contentType: 'application/pdf',
      contentDisposition: 'attachment; filename=employee-performance-report.pdf',
    }));
    doc.on('error', reject);

    // ── PAGE 1: HEADER BANNER ────────────────────────────────────────────────
    // Gradient-look: two-tone bar
    doc.rect(0, 0, PAGE_W, 80).fill(C.headerBg);
    doc.rect(0, 60, PAGE_W, 20).fill('#1D4ED8');  // lighter bottom strip

    // Decorative circle accent
    doc.circle(PAGE_W - 55, -20, 70).fill('#2563EB').opacity(0.25);
    doc.circle(PAGE_W - 20, 90, 50).fill('#7C3AED').opacity(0.15);
    doc.opacity(1);

    // Report title
    doc.fillColor(C.headerText)
       .font('Helvetica-Bold')
       .fontSize(24)
       .text('Employee Performance Report', MARGIN, 14, { characterSpacing: 0.3 });

    // Sub-title: cycle info
    doc.fillColor('#BFDBFE')
       .font('Helvetica')
       .fontSize(11)
       .text(`${data.performanceCycle}  •  ${data.cycleDuration}`, MARGIN, 46);

    // Organization name (right)
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(13)
       .text(data.organizationName, 0, 18, { align: 'right', width: PAGE_W - MARGIN });
    doc.fillColor('#BFDBFE').font('Helvetica').fontSize(9)
       .text('HRIS System', 0, 35, { align: 'right', width: PAGE_W - MARGIN });

    doc.y = 92;

    // ── SECTION 1: EMPLOYEE DETAILS (two-column) ─────────────────────────────
    drawSectionHeader(doc, 'Employee Details', C.accent1);
    const edY = doc.y;
    const CARD_H = 78;

    // card background
    doc.roundedRect(MARGIN, edY, CONTENT_W, CARD_H, 7).fill(C.cardBg1);
    doc.strokeColor('#BFDBFE').lineWidth(0.8).roundedRect(MARGIN, edY, CONTENT_W, CARD_H, 7).stroke();
    doc.rect(MARGIN, edY, 4, CARD_H).fill(C.accent1);  // left accent

    // Left column
    const LC = MARGIN + 14;
    doc.fillColor(C.accent1).font('Helvetica-Bold').fontSize(13)
       .text(data.employeeName, LC, edY + 10, { width: 240 });
    doc.fillColor(C.muted).font('Helvetica').fontSize(11)
       .text(`ID: ${data.employeeCode}`, LC, edY + 28);
    doc.fillColor(C.text).font('Helvetica').fontSize(11)
       .text(`Department: ${data.departmentName}`, LC, edY + 44);
    doc.fillColor(C.text).font('Helvetica').fontSize(11)
       .text(`Manager: ${data.managerName}`, LC, edY + 60);

    // Right column
    const RC = MARGIN + CONTENT_W / 2 + 10;
    doc.fillColor(C.accent1).font('Helvetica-Bold').fontSize(11)
       .text('Performance Cycle', RC, edY + 10);
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(11)
       .text(data.performanceCycle, RC, edY + 26, { width: CONTENT_W / 2 - 10 });
    doc.fillColor(C.muted).font('Helvetica').fontSize(10)
       .text(`Duration: ${data.cycleDuration}`, RC, edY + 44, { width: CONTENT_W / 2 - 10 });

    // Overall rating box (far right)
    const RR = MARGIN + CONTENT_W - 70;
    doc.roundedRect(RR, edY + 8, 62, 58, 6).fill('#1E3A8A');
    doc.fillColor('#BFDBFE').font('Helvetica').fontSize(8)
       .text('OVERALL', RR, edY + 14, { width: 62, align: 'center' });
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20)
       .text(data.overallRating ? data.overallRating.toFixed(1) : '0.0', RR, edY + 24, { width: 62, align: 'center' });
    doc.fillColor('#93C5FD').font('Helvetica').fontSize(8)
       .text('/5.0', RR, edY + 46, { width: 62, align: 'center' });

    doc.y = edY + CARD_H + 8;

    // ── SECTION 2: COMPETENCY RATINGS (progress bars) ─────────────────────────
    const competencies = Array.isArray(data.competencyRatings) ? data.competencyRatings : [];
    const COMP_ROW_H = 22;
    const compBlockH = competencies.length > 0
      ? competencies.length * COMP_ROW_H + 16
      : 36;

    ensureSpace(doc, 30 + compBlockH);
    drawSectionHeader(doc, 'Competency Ratings', C.accent2);
    const crY = doc.y;

    // Card
    doc.roundedRect(MARGIN, crY, CONTENT_W, compBlockH, 7).fill(C.cardBg2);
    doc.strokeColor('#DDD6FE').lineWidth(0.8).roundedRect(MARGIN, crY, CONTENT_W, compBlockH, 7).stroke();

    if (competencies.length === 0) {
      doc.fillColor(C.muted).font('Helvetica-Oblique').fontSize(11)
         .text('No competency ratings available.', MARGIN + 12, crY + 10);
    } else {
      const BAR_X     = MARGIN + 14;
      const BAR_LABEL_W = 180;       // name column
      const BAR_W    = CONTENT_W - BAR_LABEL_W - 80; // bar
      const BAR_H    = 10;
      const PCT_X    = BAR_X + BAR_LABEL_W + BAR_W + 6;

      competencies.forEach((cr, idx) => {
        const rowY  = crY + 8 + idx * COMP_ROW_H;
        const pct   = Math.round((cr.rating / 5) * 100);
        const barY  = rowY + (COMP_ROW_H - BAR_H) / 2;

        // Competency name (left)
        doc.fillColor(C.text).font('Helvetica-Bold').fontSize(11)
           .text(cr.competencyName, BAR_X, rowY + 4, { width: BAR_LABEL_W - 8, ellipsis: true });

        // Progress bar
        const fillColor = drawProgressBar(doc, BAR_X + BAR_LABEL_W, barY, BAR_W, BAR_H, pct);

        // Percentage text (right)
        doc.fillColor(fillColor).font('Helvetica-Bold').fontSize(10)
           .text(`${pct}%  (${cr.rating}/5)`, PCT_X, rowY + 3, { width: 65, align: 'right' });
      });
    }

    doc.y = crY + compBlockH + 8;

    // ── SECTION 3: ADMIN FEEDBACK ────────────────────────────────────────────
    const FB_H = 90;
    ensureSpace(doc, 30 + FB_H);
    drawSectionHeader(doc, 'Admin Feedback', C.accent3);
    const fbY = doc.y;
    const halfW = (CONTENT_W - 8) / 2;

    // Left card – Key Contributions
    doc.roundedRect(MARGIN, fbY, halfW, FB_H, 6).fill(C.cardBg3);
    doc.strokeColor('#99F6E4').lineWidth(0.8).roundedRect(MARGIN, fbY, halfW, FB_H, 6).stroke();
    doc.fillColor(C.accent3).font('Helvetica-Bold').fontSize(11)
       .text('Key Contributions / Strengths', MARGIN + 10, fbY + 10, { width: halfW - 20 });
    doc.fillColor(C.text).font('Helvetica').fontSize(10)
       .text(data.keyContributions, MARGIN + 10, fbY + 28, { width: halfW - 20, height: FB_H - 35, ellipsis: true });

    // Right card – Growth Objectives
    const fbRX = MARGIN + halfW + 8;
    doc.roundedRect(fbRX, fbY, halfW, FB_H, 6).fill(C.cardBg3);
    doc.strokeColor('#99F6E4').lineWidth(0.8).roundedRect(fbRX, fbY, halfW, FB_H, 6).stroke();
    doc.fillColor(C.accent3).font('Helvetica-Bold').fontSize(11)
       .text('Growth Objectives', fbRX + 10, fbY + 10, { width: halfW - 20 });
    doc.fillColor(C.text).font('Helvetica').fontSize(10)
       .text(data.growthObjectives, fbRX + 10, fbY + 28, { width: halfW - 20, height: FB_H - 35, ellipsis: true });

    doc.y = fbY + FB_H + 6;

    // Optional Remarks
    if (data.remarks && data.remarks !== 'N/A') {
      ensureSpace(doc, 50);
      const rmY = doc.y;
      doc.roundedRect(MARGIN, rmY, CONTENT_W, 44, 6).fill('#F8FAFC');
      doc.strokeColor(C.border).lineWidth(0.6).roundedRect(MARGIN, rmY, CONTENT_W, 44, 6).stroke();
      doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(10)
         .text('General Assessment Remarks:', MARGIN + 10, rmY + 8);
      doc.fillColor(C.text).font('Helvetica').fontSize(10)
         .text(data.remarks, MARGIN + 10, rmY + 22, { width: CONTENT_W - 20, height: 18, ellipsis: true });
      doc.y = rmY + 52;
    }

    // ── SECTION 4: GOAL & KPI DETAILS (table) ────────────────────────────────
    ensureSpace(doc, 30 + 22 + 20 * 3);
    drawSectionHeader(doc, 'Goal & KPI Details', C.accent4);
    const goalHeaders = ['Goal Title', 'Priority', 'KPI Target', 'Due Date', 'Weightage'];
    const goalRows = [[
      data.goalTitle,
      data.priority,
      data.kpiTarget,
      formatDate(data.goalDueDate),
      data.weightage ? `${data.weightage}%` : 'N/A'
    ]];
    drawCompactTable(doc, goalHeaders, goalRows, MARGIN, doc.y, CONTENT_W, C.accent4, C.cardBg4);
    doc.y += 8;

    // ── SECTION 5: EMPLOYEE PROGRESS UPDATE (table) ───────────────────────────
    ensureSpace(doc, 30 + 22 + 20 * 3);
    drawSectionHeader(doc, 'Employee Progress Update', C.accent5);
    const progressHeaders = ['Status', 'Progress', 'Comments', 'Completion Notes'];

    const progressRaw = data.employeeProgress || '0';
    const progMatch = progressRaw.match(/\d+/);
    const progressPct = progMatch ? Math.min(100, Math.max(0, parseInt(progMatch[0], 10))) : 0;

    // For the table we draw text; then below we add a visual progress bar row
    const progressRows = [[
      data.employeeStatus,
      `${progressPct}%`,
      data.employeeComments,
      data.completionNotes,
    ]];
    drawCompactTable(doc, progressHeaders, progressRows, MARGIN, doc.y, CONTENT_W, C.accent5, C.cardBg5);

    // Visual progress bar below the table
    ensureSpace(doc, 28);
    const vpY = doc.y + 4;
    const VP_W = CONTENT_W - 120;
    doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(10)
       .text('Progress:', MARGIN, vpY + 3);
    drawProgressBar(doc, MARGIN + 70, vpY, VP_W, 12, progressPct);
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(10)
       .text(`${progressPct}%`, MARGIN + 70 + VP_W + 8, vpY + 1);
    doc.y = vpY + 22;

    // ── FOOTERS on every page ─────────────────────────────────────────────────
    const genDate = new Date().toLocaleString('en-US', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      // Divider line
      doc.strokeColor(C.border).lineWidth(0.5)
         .moveTo(MARGIN, PAGE_H - FOOTER_H)
         .lineTo(PAGE_W - MARGIN, PAGE_H - FOOTER_H)
         .stroke();
      // Footer text
      doc.fillColor(C.muted).font('Helvetica').fontSize(9)
         .text(
           `Report Generated: ${genDate}  |  Elitepic HRIS - Confidential`,
           MARGIN, PAGE_H - FOOTER_H + 6
         );
      doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(9)
         .text(`Page ${i + 1} of ${pages.count}`,
           0, PAGE_H - FOOTER_H + 6,
           { align: 'right', width: PAGE_W - MARGIN });
    }

    doc.end();
  });
}

// ────────────────────────────────────────────────────────────────────────
// EXCEL GENERATION
// ────────────────────────────────────────────────────────────────────────

async function generateExcel(data) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Elitepic HRIS';
  wb.created = new Date();

  // ── colour palette (mirrors PDF) ────────────────────────────────────────
  const HEADER_BG  = '1E3A8A';
  const ACCENT1    = '2563EB';
  const ACCENT2    = '7C3AED';
  const ACCENT3    = '0F766E';
  const ACCENT4    = 'C2410C';
  const ACCENT5    = '065F46';
  const LIGHT_GREY = 'F1F5F9';
  const WHITE      = 'FFFFFF';

  function hdrFont(color = WHITE) {
    return { name: 'Calibri', bold: true, size: 11, color: { argb: `FF${color}` } };
  }
  function bodyFont(bold = false) {
    return { name: 'Calibri', bold, size: 10, color: { argb: 'FF1E293B' } };
  }
  function hdrFill(hex) {
    return { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hex}` } };
  }
  function lightFill(hex) {
    return { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hex}` } };
  }
  function thinBorder() {
    const s = { style: 'thin', color: { argb: 'FFE2E8F0' } };
    return { top: s, left: s, bottom: s, right: s };
  }

  // ── Sheet 1: Overview ────────────────────────────────────────────────────
  const ws = wb.addWorksheet('Performance Report', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
    properties: { tabColor: { argb: `FF${HEADER_BG}` } },
  });
  ws.columns = [
    { key: 'a', width: 28 },
    { key: 'b', width: 38 },
    { key: 'c', width: 18 },
    { key: 'd', width: 20 },
  ];

  // ── Title banner ─────────────────────────────────────────────────────────
  ws.mergeCells('A1:D1');
  const titleCell = ws.getCell('A1');
  titleCell.value = 'Employee Performance Report';
  titleCell.font = { name: 'Calibri', bold: true, size: 16, color: { argb: `FF${WHITE}` } };
  titleCell.fill = hdrFill(HEADER_BG);
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 32;

  ws.mergeCells('A2:D2');
  const subCell = ws.getCell('A2');
  subCell.value = `${data.performanceCycle}  •  ${data.cycleDuration}`;
  subCell.font = { name: 'Calibri', size: 10, color: { argb: 'FFBFDBFE' } };
  subCell.fill = hdrFill(HEADER_BG);
  subCell.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(2).height = 20;

  ws.addRow([]);

  // ── Section helper ───────────────────────────────────────────────────────
  function addSectionHeader(label, hex) {
    ws.addRow([]);
    const r = ws.addRow([label]);
    ws.mergeCells(`A${r.number}:D${r.number}`);
    r.getCell(1).font = hdrFont(WHITE);
    r.getCell(1).fill = hdrFill(hex);
    r.getCell(1).alignment = { vertical: 'middle', indent: 1 };
    r.height = 22;
    return r;
  }

  function addDataRow(label, value, bgHex = null) {
    const r = ws.addRow([label, value]);
    r.getCell(1).font = bodyFont(true);
    r.getCell(1).fill = lightFill(bgHex || LIGHT_GREY);
    r.getCell(2).font = bodyFont();
    r.getCell(2).fill = lightFill(bgHex || WHITE);
    [1, 2].forEach((c) => { r.getCell(c).border = thinBorder(); r.getCell(c).alignment = { wrapText: true, vertical: 'middle' }; });
    r.height = 18;
    return r;
  }

  // ── 1. Employee Details ───────────────────────────────────────────────────
  addSectionHeader('Employee Details', ACCENT1);
  addDataRow('Employee Name', data.employeeName);
  addDataRow('Employee ID', data.employeeCode);
  addDataRow('Department', data.departmentName);
  addDataRow('Manager', data.managerName);
  addDataRow('Performance Cycle', data.performanceCycle);
  addDataRow('Cycle Duration', data.cycleDuration);
  addDataRow('Overall Rating', data.overallRating ? `${data.overallRating.toFixed(1)} / 5.0` : '0.0 / 5.0');
  addDataRow('Performance Band', data.performanceBand);

  // ── 2. Competency Ratings ─────────────────────────────────────────────────
  addSectionHeader('Competency Ratings', ACCENT2);
  const compHdr = ws.addRow(['Competency', 'Rating (out of 5)', 'Score %', '']);
  ws.mergeCells(`C${compHdr.number}:D${compHdr.number}`);
  [1, 2, 3].forEach((c) => {
    compHdr.getCell(c).font = hdrFont('FFFFFF');
    compHdr.getCell(c).fill = hdrFill('DDD6FE');
    compHdr.getCell(c).font = { name: 'Calibri', bold: true, size: 10, color: { argb: `FF${ACCENT2}` } };
    compHdr.getCell(c).border = thinBorder();
    compHdr.getCell(c).alignment = { vertical: 'middle', horizontal: 'center' };
  });
  compHdr.height = 20;

  const competencies = Array.isArray(data.competencyRatings) ? data.competencyRatings : [];
  if (competencies.length === 0) {
    const r = ws.addRow(['No competency ratings available.', '', '', '']);
    ws.mergeCells(`A${r.number}:D${r.number}`);
    r.getCell(1).font = { name: 'Calibri', italic: true, size: 10, color: { argb: 'FF64748B' } };
  } else {
    competencies.forEach((cr, i) => {
      const pct = Math.round((cr.rating / 5) * 100);
      const r = ws.addRow([cr.competencyName, cr.rating, `${pct}%`, '']);
      ws.mergeCells(`C${r.number}:D${r.number}`);
      const bg = i % 2 === 0 ? 'FFFFFF' : 'F5F3FF';
      [1, 2, 3].forEach((c) => {
        r.getCell(c).font = bodyFont();
        r.getCell(c).fill = lightFill(bg);
        r.getCell(c).border = thinBorder();
        r.getCell(c).alignment = { vertical: 'middle', horizontal: c === 1 ? 'left' : 'center' };
      });
      r.height = 18;
    });
  }

  // ── 3. Admin Feedback ────────────────────────────────────────────────────
  addSectionHeader('Admin Feedback', ACCENT3);
  addDataRow('Key Contributions / Strengths', data.keyContributions, 'F0FDFA');
  addDataRow('Growth Objectives', data.growthObjectives, 'F0FDFA');
  if (data.remarks && data.remarks !== 'N/A') {
    addDataRow('Remarks', data.remarks, 'F8FAFC');
  }

  // ── 4. Goal & KPI Details ────────────────────────────────────────────────
  addSectionHeader('Goal & KPI Details', ACCENT4);
  addDataRow('Goal Title', data.goalTitle, 'FFF7ED');
  addDataRow('Priority', data.priority, 'FFF7ED');
  addDataRow('KPI / Target', data.kpiTarget, 'FFF7ED');
  addDataRow('Due Date', formatDate(data.goalDueDate), 'FFF7ED');
  addDataRow('Weightage', data.weightage ? `${data.weightage}%` : 'N/A', 'FFF7ED');

  // ── 5. Employee Progress ─────────────────────────────────────────────────
  addSectionHeader('Employee Progress Update', ACCENT5);
  addDataRow('Status', data.employeeStatus, 'ECFDF5');
  addDataRow('Progress', `${data.employeeProgress}%`, 'ECFDF5');
  addDataRow('Employee Comments', data.employeeComments, 'ECFDF5');
  addDataRow('Completion Notes', data.completionNotes, 'ECFDF5');

  // ── Footer row ───────────────────────────────────────────────────────────
  ws.addRow([]);
  const footerRow = ws.addRow([`Report Generated: ${data.reportGeneratedDate}  |  Elitepic HRIS - Confidential`]);
  ws.mergeCells(`A${footerRow.number}:D${footerRow.number}`);
  footerRow.getCell(1).font = { name: 'Calibri', italic: true, size: 9, color: { argb: 'FF64748B' } };
  footerRow.getCell(1).alignment = { horizontal: 'center' };

  const buffer = await wb.xlsx.writeBuffer();
  return {
    data: Buffer.from(buffer),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    contentDisposition: 'attachment; filename=employee-performance-report.xlsx',
  };
}

// ────────────────────────────────────────────────────────────────────────
// CSV GENERATION
// ────────────────────────────────────────────────────────────────────────

/** Escape a value for safe CSV output (RFC 4180). */
function csvCell(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Build a single-assessment CSV report from the same completeData used by the PDF. */
function generateCsv(data) {
  const rows = [];
  rows.push(['Field', 'Value']);
  rows.push(['Employee Name', data.employeeName]);
  rows.push(['Employee Code', data.employeeCode]);
  rows.push(['Department', data.departmentName]);
  rows.push(['Manager', data.managerName]);
  rows.push(['Performance Cycle', data.performanceCycle]);
  rows.push(['Cycle Duration', data.cycleDuration]);
  rows.push(['Overall Rating', data.overallRating]);
  rows.push(['Performance Band', data.performanceBand]);
  rows.push(['Key Contributions', data.keyContributions]);
  rows.push(['Growth Objectives', data.growthObjectives]);
  rows.push(['Remarks', data.remarks]);
  rows.push(['Goal Title', data.goalTitle]);
  rows.push(['Priority', data.priority]);
  rows.push(['KPI / Target', data.kpiTarget]);
  rows.push(['Goal Due Date', data.goalDueDate]);
  rows.push(['Weightage', data.weightage]);
  rows.push(['Employee Status', data.employeeStatus]);
  rows.push(['Employee Progress (%)', data.employeeProgress]);
  rows.push(['Employee Comments', data.employeeComments]);
  rows.push(['Completion Notes', data.completionNotes]);
  rows.push([]);
  rows.push(['Competency', 'Rating']);
  (data.competencyRatings || []).forEach((cr) => {
    rows.push([cr.competencyName, cr.rating]);
  });
  rows.push([]);
  rows.push(['Report Generated', data.reportGeneratedDate]);

  // Prefix BOM so Excel renders UTF-8 correctly
  const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

  return {
    data: Buffer.from(csv, 'utf8'),
    contentType: 'text/csv; charset=utf-8',
    contentDisposition: 'attachment; filename=employee-performance-report.csv',
  };
}

module.exports = {
  fetchCycles,
  fetchCyclesForEmployee,
  exportData,
};
