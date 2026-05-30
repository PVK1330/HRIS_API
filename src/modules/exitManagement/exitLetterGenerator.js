'use strict';

const fs = require('fs');
const path = require('path');
const env = require('../../config/env');
const { generatePdfFromHtml, replacePlaceholders } = require('../../utils/pdfGenerator');

/** Map exit document types → letter template name search patterns (first match wins) */
const EXIT_DOC_TEMPLATE_PATTERNS = {
  'Relieving Letter': ['Relieving Letter', 'Standard Relieving Letter'],
  'Experience Letter': ['Experience Letter', 'Standard Experience Letter', 'Experience Certificate'],
  'Termination Letter': ['Termination Letter', 'Standard Termination Letter'],
  'NOC': ['NOC', 'No Objection Certificate', 'No Objection'],
  'FnF Settlement': ['FnF Settlement', 'Full & Final Settlement', 'Full and Final Settlement', 'Full & Final Statement'],
  'Full & Final Settlement': ['Full & Final Settlement', 'FnF Settlement', 'Full and Final Settlement'],
  'Recommendation Letter': ['Recommendation Letter', 'Standard Recommendation Letter'],
  'Final Payslip': ['Final Payslip', 'Final Pay Slip'],
  'Full & Final Statement': ['Full & Final Statement', 'FnF Settlement'],
};

const DEFAULT_EXIT_TEMPLATES = {
  'Relieving Letter': `
    <h2 style="text-align:center;color:#0F766E;">Relieving Letter</h2>
    <p>Date: {{today_date}}</p>
    <p>Dear <strong>{{employee_name}}</strong>,</p>
    <p>We confirm that you were employed as <strong>{{job_title}}</strong> in the <strong>{{department}}</strong> department at {{company_name}}.</p>
    <p>Your last working day was <strong>{{last_working_day}}</strong>. You have been formally relieved of all duties and responsibilities.</p>
    <p>We wish you success in your future endeavours.</p>
    <p>Yours sincerely,<br><strong>Human Resources Department</strong><br>{{company_name}}</p>
  `,
  'Experience Letter': `
    <h2 style="text-align:center;color:#0F766E;">Experience Letter</h2>
    <p>Date: {{today_date}}</p>
    <p><strong>To Whom It May Concern</strong></p>
    <p>This is to certify that <strong>{{employee_name}}</strong> (Employee ID: {{employee_id}}) was employed with {{company_name}} from <strong>{{joining_date}}</strong> to <strong>{{last_working_day}}</strong> as <strong>{{job_title}}</strong> in the <strong>{{department}}</strong> department.</p>
    <p>During their tenure, their conduct and performance were satisfactory.</p>
    <p>Yours sincerely,<br><strong>Human Resources Department</strong></p>
  `,
  'Termination Letter': `
    <h2 style="text-align:center;color:#0F766E;">Termination Letter</h2>
    <p>Date: {{today_date}}</p>
    <p>Dear <strong>{{employee_name}}</strong>,</p>
    <p>Your employment with {{company_name}} is terminated effective <strong>{{last_working_day}}</strong>.</p>
    <p>Reason: <em>{{exit_reason}}</em></p>
    <p>Please return all company property and honour your confidentiality obligations.</p>
    <p>Yours sincerely,<br><strong>Human Resources Department</strong></p>
  `,
  'NOC': `
    <h2 style="text-align:center;color:#0F766E;">No Objection Certificate</h2>
    <p>Date: {{today_date}}</p>
    <p>To Whom It May Concern,</p>
    <p>This is to certify that <strong>{{employee_name}}</strong> (Employee ID: {{employee_id}}), {{job_title}} in {{department}}, has cleared all departmental obligations as of {{last_working_day}}.</p>
    <p>{{company_name}} has no objection to {{employee_name}} joining another organisation.</p>
    <p>Yours sincerely,<br><strong>Human Resources Department</strong></p>
  `,
  'FnF Settlement': `
    <h2 style="text-align:center;color:#0F766E;">Full &amp; Final Settlement</h2>
    <p>Date: {{today_date}}</p>
    <p>Dear <strong>{{employee_name}}</strong>,</p>
    <p>Please find below your Full &amp; Final settlement summary for your separation from {{company_name}} (last working day: {{last_working_day}}).</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;">Unpaid Salary</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">{{unpaid_salary}}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;">Leave Encashment</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">{{leave_encashment}}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;">Gratuity</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">{{gratuity}}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;">Deductions</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">{{deductions}}</td></tr>
      <tr><td style="padding:8px;font-weight:bold;">Net Payable</td><td style="padding:8px;font-weight:bold;text-align:right;">{{net_payable}}</td></tr>
    </table>
    <p>Yours sincerely,<br><strong>Finance &amp; HR Department</strong></p>
  `,
  'Recommendation Letter': `
    <h2 style="text-align:center;color:#0F766E;">Recommendation Letter</h2>
    <p>Date: {{today_date}}</p>
    <p><strong>To Whom It May Concern</strong></p>
    <p>I am pleased to recommend <strong>{{employee_name}}</strong>, who served as <strong>{{job_title}}</strong> in {{department}} at {{company_name}} from {{joining_date}} to {{last_working_day}}.</p>
    <p>{{employee_name}} demonstrated professionalism, reliability, and strong collaboration throughout their employment.</p>
    <p>Yours sincerely,<br><strong>Human Resources Department</strong></p>
  `,
  'Final Payslip': `
    <h2 style="text-align:center;color:#0F766E;">Final Payslip</h2>
    <p>Date: {{today_date}}</p>
    <p>Employee: <strong>{{employee_name}}</strong> ({{employee_id}})</p>
    <p>Designation: {{job_title}} | Department: {{department}}</p>
    <p>Last Working Day: {{last_working_day}}</p>
    <p>Final settlement net payable: <strong>{{net_payable}}</strong></p>
    <p>This payslip is issued as part of your exit process from {{company_name}}.</p>
    <p>Yours sincerely,<br><strong>Payroll Department</strong></p>
  `,
};

function fmtUK(d) {
  return d
    ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    : '';
}

function fmtMoney(value) {
  if (value == null || value === '') return '0.00';
  const num = Number(value);
  if (Number.isNaN(num)) return String(value);
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function normalizeDocType(docType) {
  const map = {
    'No Objection Certificate': 'NOC',
    'Full & Final Settlement': 'FnF Settlement',
    'Full & Final Statement': 'FnF Settlement',
  };
  return map[docType] || docType;
}

function buildExitLetterPlaceholders(record, settlement, tenant, docType) {
  const employeeName =
    record.full_name ||
    [record.first_name, record.last_name].filter(Boolean).join(' ') ||
    'Employee';
  const joiningFormatted = fmtUK(record.join_date);

  return {
    employee_name: employeeName,
    first_name: record.first_name || '',
    last_name: record.last_name || '',
    employee_id: record.emp_id || '',
    emp_id: record.emp_id || '',
    job_title: record.job_title || '',
    department: record.department || '',
    joining_date: joiningFormatted,
    join_date: joiningFormatted,
    salary: record.salary != null ? fmtMoney(record.salary) : '',
    work_email: record.work_email || '',
    work_location: record.work_location || '',
    today_date: fmtUK(new Date()),
    company_name: tenant?.company_name || tenant?.name || 'Organization',
    last_working_day: fmtUK(record.last_working_day),
    exit_reason: record.exit_reason || record.reason_detail || '',
    reason_detail: record.reason_detail || '',
    exit_type: record.exit_type || '',
    notice_period: String(record.notice_period_days ?? ''),
    notice_period_days: String(record.notice_period_days ?? ''),
    document_type: docType,
    manager_name: record.manager_name || '',
    resignation_date: fmtUK(record.resignation_date),
    net_payable: settlement ? fmtMoney(settlement.net_payable) : fmtMoney(0),
    unpaid_salary: settlement ? fmtMoney(settlement.unpaid_salary) : fmtMoney(0),
    leave_encashment: settlement ? fmtMoney(settlement.leave_encashment) : fmtMoney(0),
    gratuity: settlement ? fmtMoney(settlement.gratuity) : fmtMoney(0),
    deductions: settlement ? fmtMoney(settlement.deductions) : fmtMoney(0),
  };
}

async function resolveExitLetterTemplate(pool, docType, templateId = null) {
  if (templateId) {
    const { rows } = await pool.query(
      `SELECT id, name, body FROM letter_templates WHERE id = $1 AND status = 'Active' LIMIT 1`,
      [templateId],
    );
    if (rows.length) return rows[0];
  }

  const normalized = normalizeDocType(docType);
  const patterns = EXIT_DOC_TEMPLATE_PATTERNS[normalized] || EXIT_DOC_TEMPLATE_PATTERNS[docType] || [docType];

  for (const pattern of patterns) {
    const { rows } = await pool.query(
      `SELECT id, name, body FROM letter_templates
       WHERE status = 'Active'
         AND (name = $1 OR name ILIKE $2)
       ORDER BY
         CASE WHEN category = 'Exit' THEN 0 ELSE 1 END,
         CASE WHEN name = $1 THEN 0 ELSE 1 END,
         usage_count DESC,
         id ASC
       LIMIT 1`,
      [pattern, `%${pattern}%`],
    );
    if (rows.length) return rows[0];
  }

  const { rows } = await pool.query(
    `SELECT id, name, body FROM letter_templates
     WHERE status = 'Active' AND category = 'Exit' AND name ILIKE $1
     ORDER BY usage_count DESC LIMIT 1`,
    [`%${normalized.split(' ')[0]}%`],
  );
  return rows[0] || null;
}

function getDefaultTemplateBody(docType) {
  const normalized = normalizeDocType(docType);
  return DEFAULT_EXIT_TEMPLATES[normalized] || DEFAULT_EXIT_TEMPLATES[docType] || DEFAULT_EXIT_TEMPLATES['Relieving Letter'];
}

async function recordTemplateDispatch(pool, { templateId, employeeId, employeeName, templateName, sentBy, bodySnapshot }) {
  if (!templateId) return;
  try {
    await pool.query(
      `INSERT INTO letter_dispatch_history
         (template_id, employee_id, employee, template, sent_by, body_snapshot, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'Delivered')`,
      [templateId, employeeId || null, employeeName, templateName, sentBy || 'HRIS', bodySnapshot || null],
    );
    await pool.query(
      'UPDATE letter_templates SET usage_count = usage_count + 1 WHERE id = $1',
      [templateId],
    );
  } catch (err) {
    console.error('Failed to record letter dispatch history:', err);
  }
}

/**
 * Load exit record + employee (+ manager + settlement) for letter generation.
 */
async function loadExitLetterContext(pool, exitRecordId) {
  const { rows } = await pool.query(
    `SELECT er.*,
            e.full_name, e.first_name, e.last_name, e.emp_id, e.department, e.job_title,
            e.join_date, e.work_email, e.personal_email, e.salary, e.work_location,
            mgr.full_name AS manager_name
     FROM exit_records er
     INNER JOIN employees e ON e.id = er.employee_id
     LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id
     WHERE er.id = $1`,
    [exitRecordId],
  );
  if (!rows.length) return null;

  const { rows: settlements } = await pool.query(
    `SELECT * FROM final_settlements WHERE exit_request_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [exitRecordId],
  );

  return {
    record: rows[0],
    settlement: settlements[0] || null,
  };
}

/**
 * Generate exit letter PDF from letter_templates (or built-in fallback) with dynamic tags.
 */
async function generateExitLetterPdf(tenant, exitRecordId, docType, userId, options = {}) {
  const pool = options.pool;
  if (!pool) throw new Error('pool is required');

  const ctx = await loadExitLetterContext(pool, exitRecordId);
  if (!ctx) return null;

  const { record, settlement } = ctx;
  const normalizedType = normalizeDocType(docType);
  const placeholders = buildExitLetterPlaceholders(record, settlement, tenant, docType);
  const template = await resolveExitLetterTemplate(pool, docType, options.templateId);

  let htmlBody = template?.body || getDefaultTemplateBody(docType);
  htmlBody = replacePlaceholders(htmlBody, placeholders);

  const tenantDb = tenant.dbName || 'default';
  const targetDir = path.resolve(env.UPLOAD.dir, 'exit_documents', tenantDb);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  const safeType = normalizedType.replace(/\s+/g, '_').toLowerCase();
  const filename = `${exitRecordId}_${safeType}.pdf`;
  const filePath = path.join(targetDir, filename);
  const relativeUrl = `/uploads/exit_documents/${tenantDb}/${filename}`;

  const pdfBuffer = await generatePdfFromHtml(htmlBody, tenant);
  fs.writeFileSync(filePath, pdfBuffer);

  const employeeName = placeholders.employee_name;
  const docTitle = `${docType} - ${employeeName}`;

  const { rows: existingDoc } = await pool.query(
    `SELECT id FROM exit_documents WHERE exit_record_id = $1 AND document_type = $2`,
    [exitRecordId, docType],
  );

  let insertedRow;
  if (existingDoc.length) {
    const res = await pool.query(
      `UPDATE exit_documents
         SET file_url = $1, file_name = $2, generated_at = NOW(), generated_by = $3
       WHERE id = $4 RETURNING *`,
      [relativeUrl, filename, userId || null, existingDoc[0].id],
    );
    insertedRow = res.rows[0];
  } else {
    const res = await pool.query(
      `INSERT INTO exit_documents
         (exit_record_id, document_type, document_title, file_url, file_name, generated_at, generated_by)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6) RETURNING *`,
      [exitRecordId, docType, docTitle, relativeUrl, filename, userId || null],
    );
    insertedRow = res.rows[0];
  }

  const sentByName = options.sentByName || 'HRIS Exit Management';
  await recordTemplateDispatch(pool, {
    templateId: template?.id,
    employeeId: record.employee_id,
    employeeName,
    templateName: template?.name || docType,
    sentBy: sentByName,
    bodySnapshot: htmlBody,
  });

  return {
    relativeUrl,
    filePath,
    row: insertedRow,
    templateId: template?.id || null,
    templateName: template?.name || null,
    placeholders,
  };
}

module.exports = {
  EXIT_DOC_TEMPLATE_PATTERNS,
  buildExitLetterPlaceholders,
  resolveExitLetterTemplate,
  loadExitLetterContext,
  generateExitLetterPdf,
  normalizeDocType,
};
