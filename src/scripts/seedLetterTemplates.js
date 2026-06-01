'use strict';

const db = require('../config/db');
const logger = require('../utils/logger');

const INDUSTRY_TEMPLATES = [
  {
    name: 'Standard Offer Letter',
    type: 'Letter',
    category: 'Recruitment',
    description: 'Industry-standard employment offer letter for new hires.',
    body: `
      <h2 style="text-align: center; color: #0F766E;">Offer of Employment</h2>
      <p>Date: {{date_of_offer}}</p>
      <p>Dear {{candidate_name}},</p>
      <p>We are pleased to offer you the position of {{job_title}} in the {{department}} department at {{company_name}}.</p>
      <table style="width: 100%; margin-top: 20px; margin-bottom: 20px; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Position:</strong></td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">{{job_title}}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Department:</strong></td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">{{department}}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Expected joining date:</strong></td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">{{join_date}}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Employment type:</strong></td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">{{employment_type}}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Reporting manager:</strong></td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">{{manager_name}}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Annual CTC:</strong></td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">{{annual_ctc}}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Offer valid until:</strong></td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">{{offer_expiry_date}}</td>
        </tr>
      </table>
      <p>Please review this offer. Use the link in your email to accept or reject. Upon acceptance you may sign this offer digitally.</p>
      <p>We look forward to welcoming you to the team.</p>
      <p>Sincerely,<br><strong>Human Resources Department</strong></p>
    `
  },
  {
    name: 'Standard Relieving Letter',
    type: 'Letter',
    category: 'Exit',
    description: 'Official confirmation of employee relief from duties.',
    body: `
      <p>Date: {{today_date}}</p>
      <p>Dear <strong>{{employee_name}}</strong>,</p>
      <p>We write to confirm that you were employed by this organisation in the capacity of <strong>{{job_title}}</strong> within the <strong>{{department}}</strong> Department.</p>
      <p>Your last day of service with the company was <strong>{{last_working_day}}</strong>, on which date you were formally relieved of all duties and responsibilities.</p>
      <p>All company property, access credentials, and confidential information must be returned or relinquished in accordance with your contractual obligations and the Company's exit policy.</p>
      <p>This letter serves as confirmation that you have been duly relieved from your position and that there are no outstanding obligations on the part of the Company with respect to your employment.</p>
      <p>We wish you all the best in your future endeavors.</p>
      <p>Yours sincerely,<br><strong>Human Resources Department</strong></p>
    `
  },
  {
    name: 'Standard Experience Letter',
    type: 'Letter',
    category: 'Exit',
    description: 'Official certification of employment tenure and conduct.',
    body: `
      <p>Date: {{today_date}}</p>
      <p><strong>To Whom It May Concern</strong></p>
      <p>This letter is to certify that <strong>{{employee_name}}</strong> was employed with our organisation from <strong>{{joining_date}}</strong> to <strong>{{last_working_day}}</strong>, serving as <strong>{{job_title}}</strong> in the <strong>{{department}}</strong> Department.</p>
      <p>During the period of their employment, {{employee_name}} demonstrated professionalism and commitment to their responsibilities. We confirm that their conduct and performance were satisfactory throughout their tenure.</p>
      <p>This letter is issued at the request of the individual named herein for whatever lawful purpose it may serve.</p>
      <p>Yours sincerely,<br><strong>Human Resources Department</strong></p>
    `
  },
  {
    name: 'Standard Termination Letter',
    type: 'Letter',
    category: 'Exit',
    description: 'Formal notification of contract termination.',
    body: `
      <p>Date: {{today_date}}</p>
      <p>Dear <strong>{{employee_name}}</strong>,</p>
      <p>We write to formally inform you that your employment with this organisation has been terminated, effective <strong>{{last_working_day}}</strong>. This decision has been made in accordance with the terms of your contract of employment and the Company's procedures.</p>
      <p>Reason for Termination: <em>{{exit_reason}}</em></p>
      <p>You are reminded of your obligations regarding the return of all company property, confidentiality of information, and any post-termination restrictions set out in your contract of employment.</p>
      <p>Your final salary payment, including any accrued holiday entitlement, will be processed in accordance with the Company's standard payroll procedures and applicable employment legislation.</p>
      <p>Yours sincerely,<br><strong>Human Resources Department</strong></p>
    `
  },
  {
    name: 'No Objection Certificate',
    type: 'Certificate',
    category: 'Exit',
    description: 'NOC confirming employee cleared all obligations.',
    body: `
      <h2 style="text-align:center;color:#0F766E;">No Objection Certificate</h2>
      <p>Date: {{today_date}}</p>
      <p>To Whom It May Concern,</p>
      <p>This is to certify that <strong>{{employee_name}}</strong> (Employee ID: {{employee_id}}), {{job_title}} in the {{department}} department at {{company_name}}, has completed all exit formalities as of {{last_working_day}}.</p>
      <p>We have no objection to {{employee_name}} joining any other organisation.</p>
      <p>Yours sincerely,<br><strong>Human Resources Department</strong></p>
    `
  },
  {
    name: 'Full & Final Settlement',
    type: 'Letter',
    category: 'Exit',
    description: 'Full and final settlement statement.',
    body: `
      <h2 style="text-align:center;color:#0F766E;">Full &amp; Final Settlement</h2>
      <p>Date: {{today_date}}</p>
      <p>Dear <strong>{{employee_name}}</strong>,</p>
      <p>Settlement summary for your separation from {{company_name}} (last working day: {{last_working_day}}).</p>
      <p>Unpaid Salary: {{unpaid_salary}} | Leave Encashment: {{leave_encashment}} | Gratuity: {{gratuity}} | Deductions: {{deductions}} | <strong>Net Payable: {{net_payable}}</strong></p>
      <p>Yours sincerely,<br><strong>Finance &amp; HR Department</strong></p>
    `
  },
  {
    name: 'Recommendation Letter',
    type: 'Letter',
    category: 'Exit',
    description: 'Professional recommendation for exiting employee.',
    body: `
      <h2 style="text-align:center;color:#0F766E;">Recommendation Letter</h2>
      <p>Date: {{today_date}}</p>
      <p><strong>To Whom It May Concern</strong></p>
      <p>I recommend <strong>{{employee_name}}</strong>, {{job_title}} in {{department}} at {{company_name}}, employed from {{joining_date}} to {{last_working_day}}.</p>
      <p>Yours sincerely,<br><strong>Human Resources Department</strong></p>
    `
  },
  {
    name: 'Final Payslip',
    type: 'Report',
    category: 'Exit',
    description: 'Final payslip at exit.',
    body: `
      <h2 style="text-align:center;color:#0F766E;">Final Payslip</h2>
      <p>Date: {{today_date}}</p>
      <p>Employee: <strong>{{employee_name}}</strong> ({{employee_id}}) | {{job_title}} | {{department}}</p>
      <p>Joining: {{joining_date}} | Last Working Day: {{last_working_day}} | Net Payable: {{net_payable}}</p>
      <p>Yours sincerely,<br><strong>Payroll Department</strong></p>
    `
  },
  {
    name: 'Standard Warning Letter',
    type: 'Letter',
    category: 'Disciplinary',
    description: 'Formal disciplinary warning letter.',
    body: `
      <p>Date: {{today_date}}</p>
      <p>Dear <strong>{{employee_name}}</strong>,</p>
      <p>This letter serves as a formal warning regarding your recent conduct/performance. It has been brought to our attention that you have failed to meet the expected standards in the following areas: <em>[Insert Details Here]</em>.</p>
      <p>This behavior is in violation of company policy. Immediate and sustained improvement is expected. Failure to improve may result in further disciplinary action up to and including termination of employment.</p>
      <p>We remain committed to supporting you in meeting these standards and encourage you to reach out to your manager or HR if you need assistance.</p>
      <p>Yours sincerely,<br><strong>Human Resources Department</strong></p>
    `
  },
  {
    name: 'Standard Promotion Letter',
    type: 'Letter',
    category: 'HR',
    description: 'Official confirmation of employee promotion.',
    body: `
      <p>Date: {{today_date}}</p>
      <p>Dear <strong>{{employee_name}}</strong>,</p>
      <p>We are thrilled to inform you that you have been promoted to the position of <strong>[New Job Title]</strong> in the <strong>[New Department]</strong>, effective <strong>[Effective Date]</strong>.</p>
      <p>Your hard work, dedication, and significant contributions to the team have not gone unnoticed. We are confident that you will continue to excel in this new role.</p>
      <p>Your revised compensation details are attached as an addendum to your employment contract.</p>
      <p>Congratulations once again on this well-deserved promotion!</p>
      <p>Yours sincerely,<br><strong>Human Resources Department</strong></p>
    `
  }
];

async function seedLetterTemplates() {
  const { rows } = await db.superAdminPool.query(
    `SELECT id, name, db_name FROM public.tenants ORDER BY id ASC`
  );

  if (rows.length === 0) {
    logger.info('[seedLetterTemplates] No tenants found.');
    return;
  }

  logger.info(`[seedLetterTemplates] Found ${rows.length} tenant(s). Seeding letter templates...`);

  let success = 0;
  let failed  = 0;

  for (const tenant of rows) {
    try {
      const pool = await db.getTenantPool(tenant.db_name);
      
      let inserted = 0;
      for (const tpl of INDUSTRY_TEMPLATES) {
        const { rows: existing } = await pool.query(
          `SELECT id FROM letter_templates WHERE name = $1`,
          [tpl.name]
        );

        if (existing.length === 0) {
          // Check if admin user exists to assign created_by
          let adminId = null;
          const { rows: admins } = await pool.query(`SELECT id FROM admin_users LIMIT 1`);
          if (admins.length > 0) adminId = admins[0].id;

          await pool.query(
            `INSERT INTO letter_templates (name, type, category, description, body, status, created_by)
             VALUES ($1, $2, $3, $4, $5, 'Active', $6)`,
            [tpl.name, tpl.type, tpl.category, tpl.description, tpl.body, adminId]
          );
          inserted++;
        }
      }

      logger.info(
        `[seedLetterTemplates] ✔ ${tenant.name} (${tenant.db_name}) — inserted ${inserted} standard templates`
      );
      success++;
    } catch (err) {
      logger.error(`[seedLetterTemplates] ✘ Failed for tenant ${tenant.name} (${tenant.db_name}):`, err);
      failed++;
    }
  }

  logger.info(`[seedLetterTemplates] Finished. Success: ${success}, Failed: ${failed}`);
}

if (require.main === module) {
  (async () => {
    try {
      await db.assertDbConnection();
      await seedLetterTemplates();
      await db.pool.end();
      process.exit(0);
    } catch (err) {
      logger.error('[seedLetterTemplates] failed', err);
      try { await db.pool.end(); } catch (_) { }
      process.exit(1);
    }
  })();
}

module.exports = seedLetterTemplates;
