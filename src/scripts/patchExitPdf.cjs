const fs = require('fs');
const path = require('path');
const p = path.resolve('c:/Users/pkk22/OneDrive/Desktop/TECHNOWEB/HRIS PROJECT/HRIS_PROJECT/HRIS_API/src/modules/exitManagement/exitManagement.service.js');
let code = fs.readFileSync(p, 'utf8');

const imports = `const fs = require('fs');
const path = require('path');
const env = require('../../config/env');
const { getIo } = require('../../socket');
const { generatePdfFromHtml, replacePlaceholders } = require('../../utils/pdfGenerator');`;

code = code.replace(/const fs = require\('fs'\);[\s\S]*?const { getIo } = require\('\.\.\/\.\.\/socket'\);/, imports);

const oldFuncStart = code.indexOf('async function generateLetterPdf');
const nextFuncStart = code.indexOf('async function generateExitDocument');

if (oldFuncStart !== -1 && nextFuncStart !== -1) {
  const newFunc = `async function generateLetterPdf(tenant, exitRecordId, docType, userId) {
  const pool = await getTenantPool(tenant.dbName);

  const { rows } = await pool.query(\`
    SELECT er.*, e.full_name, e.first_name, e.last_name, e.emp_id, e.department, e.job_title, e.join_date
    FROM exit_records er
    INNER JOIN employees e ON e.id = er.employee_id
    WHERE er.id = $1
  \`, [exitRecordId]);

  const record = rows[0];
  if (!record) return null;

  const empNameStr = record.full_name || [record.first_name, record.last_name].filter(Boolean).join(' ') || 'Employee';
  const tenantDb = tenant.dbName || 'default';

  const targetDir = path.resolve(env.UPLOAD.dir, 'exit_documents', tenantDb);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  const filename = \`\${exitRecordId}_\${docType.replace(/\\s+/g, '_').toLowerCase()}.pdf\`;
  const filePath = path.join(targetDir, filename);
  const relativeUrl = \`/uploads/exit_documents/\${tenantDb}/\${filename}\`;

  const fmtUK = (d) =>
    d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : 'N/A';
  
  const placeholders = {
    employee_name: empNameStr,
    first_name: record.first_name || '',
    last_name: record.last_name || '',
    emp_id: record.emp_id || '',
    department: record.department || '',
    job_title: record.job_title || 'an employee',
    join_date: fmtUK(record.join_date),
    last_working_day: fmtUK(record.last_working_day),
    exit_reason: record.exit_reason || '',
    today_date: fmtUK(new Date()),
    document_type: docType
  };

  const { rows: templates } = await pool.query(\`
    SELECT body FROM letter_templates 
    WHERE name ILIKE $1 OR category = 'Exit' AND name ILIKE $1
    LIMIT 1
  \`, [\`%\${docType}%\`]);

  let htmlBody = '';
  if (templates.length > 0) {
    htmlBody = templates[0].body;
  } else {
    if (docType === 'Relieving Letter') {
      htmlBody = \`
        <p>Dear <strong>{{employee_name}}</strong>,</p>
        <p>We write to confirm that you were employed by this organisation in the capacity of {{job_title}} within the {{department}} Department.</p>
        <p>Your last day of service with the company was {{last_working_day}}, on which date you were formally relieved of all duties and responsibilities.</p>
        <p>This letter serves as confirmation that you have been duly relieved from your position.</p>
      \`;
    } else if (docType === 'Experience Letter') {
      htmlBody = \`
        <p><strong>To Whom It May Concern</strong></p>
        <p>This letter is to certify that <strong>{{employee_name}}</strong> was employed with our organisation from {{join_date}} to {{last_working_day}}, serving as {{job_title}} in the {{department}} Department.</p>
        <p>During the period of their employment, {{employee_name}} demonstrated professionalism and commitment. We confirm that their conduct and performance were satisfactory throughout their tenure.</p>
      \`;
    } else if (docType === 'Termination Letter') {
      htmlBody = \`
        <p>Dear <strong>{{employee_name}}</strong>,</p>
        <p>We write to formally inform you that your employment with this organisation has been terminated, effective {{last_working_day}}.</p>
        <p>Reason for Termination: <em>{{exit_reason}}</em></p>
        <p>You are reminded of your obligations regarding the return of all company property and confidentiality of information.</p>
      \`;
    } else {
      htmlBody = \`<p>This document relates to {{document_type}} for {{employee_name}}.</p>\`;
    }
  }

  htmlBody = replacePlaceholders(htmlBody, placeholders);
  const pdfBuffer = await generatePdfFromHtml(htmlBody, tenant);
  fs.writeFileSync(filePath, pdfBuffer);

  const docTitle = \`\${docType} - \${empNameStr}\`;
  const { rows: existingDoc } = await pool.query(
    \`SELECT id FROM exit_documents WHERE exit_record_id = $1 AND document_type = $2\`,
    [exitRecordId, docType],
  );

  let insertedRow;
  if (existingDoc.length) {
    const res = await pool.query(
      \`UPDATE exit_documents
         SET file_url = $1, file_name = $2, generated_at = NOW(), generated_by = $3
       WHERE id = $4 RETURNING *\`,
      [relativeUrl, filename, userId || null, existingDoc[0].id],
    );
    insertedRow = res.rows[0];
  } else {
    const res = await pool.query(
      \`INSERT INTO exit_documents
         (exit_record_id, document_type, document_title, file_url, file_name, generated_at, generated_by)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6) RETURNING *\`,
      [exitRecordId, docType, docTitle, relativeUrl, filename, userId || null],
    );
    insertedRow = res.rows[0];
  }

  return { relativeUrl, filePath, row: insertedRow };
}
\n\n`;
  
  code = code.substring(0, oldFuncStart) + newFunc + code.substring(nextFuncStart);
  fs.writeFileSync(p, code, 'utf8');
  console.log('Successfully updated generateLetterPdf');
} else {
  console.log('Failed to find function bounds');
}
