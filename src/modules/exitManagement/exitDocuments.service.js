'use strict';

/**
 * Exit documents — generate official exit letters (relieving / experience / full & final
 * settlement / NOC …) for an exiting employee from the shared letter_templates catalog
 * (category 'Exit'), render them to PDF, store them as exit_request_attachments, and
 * optionally email them to the employee.
 *
 * Reuses existing infrastructure: utils/pdfGenerator (puppeteer HTML→PDF), letters.repository
 * (template catalog + dispatch history), helpers/mailer (tenant SMTP). Authorization is enforced
 * by the route chain (authorizeExitAccess({action:'generate_documents'})) BEFORE these run.
 */

const fs = require('fs');
const path = require('path');

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const env = require('../../config/env');
const { generatePdfFromHtml, replacePlaceholders } = require('../../utils/pdfGenerator');
const lettersRepo = require('../letters/letters.repository');
const logger = require('../../utils/logger');

const EXIT_CATEGORY = 'Exit';
const ATTACHMENT_TYPE = 'GENERATED_DOC'; // must match chk_exit_attachment_type (migration 080)
// The cover template is the EMAIL wrapper (uses {{document_list}}), not a deliverable
// document — it must never be generated as a standalone PDF.
const COVER_TEMPLATE_NAME = 'Exit Documents Cover';

function fmtDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

/** The active Exit-category letter templates an HR/admin can issue for an exit. */
async function listTemplates(tenant) {
  const pool = await getTenantPool(tenant.dbName);
  const rows = await lettersRepo.findAllTemplates(pool, {
    category: EXIT_CATEGORY, status: 'Active', limit: 100, offset: 0,
  });
  return rows
    .filter((r) => String(r.name).trim().toLowerCase() !== COVER_TEMPLATE_NAME.toLowerCase())
    .map((r) => ({ id: r.id, name: r.name, type: r.type, description: r.description }));
}

/** Documents already generated for this exit request (for re-download). */
async function listGenerated(tenant, requestId) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT a.id, a.file_name, a.file_url, a.mime_type, a.uploaded_at, e.full_name AS uploaded_by_name
     FROM exit_request_attachments a
     LEFT JOIN employees e ON e.id = a.uploaded_by
     WHERE a.exit_request_id = $1 AND a.attachment_type = $2
     ORDER BY a.uploaded_at DESC`,
    [requestId, ATTACHMENT_TYPE],
  );
  return rows;
}

async function loadContext(pool, requestId) {
  const { rows } = await pool.query(
    `SELECT er.id, er.employee_id, er.exit_type, er.exit_reason, er.status,
            er.notice_date, er.resignation_date, er.last_working_day,
            e.full_name, e.first_name, e.last_name, e.work_email, e.job_title, e.department, e.join_date,
            tt.name AS termination_type_name
     FROM exit_requests er
     LEFT JOIN employees e ON e.id = er.employee_id
     LEFT JOIN termination_types tt ON tt.id = er.termination_type_id
     WHERE er.id = $1`,
    [requestId],
  );
  if (!rows.length) throw ApiError.notFound('Exit request not found');
  return rows[0];
}

async function getCompany(tenant) {
  try {
    const tenantSettingsService = require('../tenantSettings/tenantSettings.service');
    const tenantSettings = await tenantSettingsService.getAdminSettings(tenant.dbName, '');
    return {
      company_name: tenantSettings.companyName || tenant.companyName || 'Organisation',
      contact_email: tenantSettings.contactDetails || '',
      company_address: tenantSettings.address || '',
      company_logo_path: tenantSettings.logoUrl || '',
    };
  } catch (_) {
    return { company_name: tenant.companyName || 'Organisation', contact_email: '', company_address: '', company_logo_path: '' };
  }
}

function buildTagMap(ctx, company) {
  return {
    today_date: fmtDate(new Date()),
    employee_name: ctx.full_name || [ctx.first_name, ctx.last_name].filter(Boolean).join(' '),
    first_name: ctx.first_name || '',
    last_name: ctx.last_name || '',
    employee_id: String(ctx.employee_id || ''),
    job_title: ctx.job_title || '',
    department: ctx.department || '',
    work_email: ctx.work_email || '',
    exit_type: ctx.exit_type || '',
    termination_type: ctx.termination_type_name || '',
    exit_reason: ctx.exit_reason || '',
    notice_date: fmtDate(ctx.notice_date),
    resignation_date: fmtDate(ctx.resignation_date),
    last_working_day: fmtDate(ctx.last_working_day),
    joining_date: fmtDate(ctx.join_date),
    company_name: company.company_name,
    // Settlement figures live in payroll — left blank here for HR to fill in the template
    // or via a future payroll integration.
    unpaid_salary: '', leave_encashment: '', gratuity: '', deductions: '', net_payable: '',
  };
}

/**
 * Generate (and optionally email) the chosen exit documents.
 * @param {{ template_ids:number[], send_email?:boolean }} dto
 */
async function generate(tenant, requestId, dto, actor) {
  const pool = await getTenantPool(tenant.dbName);
  const templateIds = [...new Set((dto.template_ids || []).map(Number).filter(Boolean))];
  if (!templateIds.length) throw ApiError.badRequest('Select at least one document to generate');

  const ctx = await loadContext(pool, requestId);
  const company = await getCompany(tenant);
  const tagMap = buildTagMap(ctx, company);

  // Merge any HR-provided settlement figures into the F&F tags (payroll is not auto-wired).
  if (dto.settlement && typeof dto.settlement === 'object') {
    for (const k of ['unpaid_salary', 'leave_encashment', 'gratuity', 'deductions', 'net_payable']) {
      const v = dto.settlement[k];
      if (v != null && v !== '') tagMap[k] = String(v);
    }
  }

  const dir = path.resolve(env.UPLOAD.dir, 'exit-documents', tenant.dbName, String(requestId));
  fs.mkdirSync(dir, { recursive: true });

  const generated = [];
  for (const tplId of templateIds) {
    const tpl = await lettersRepo.findTemplateById(pool, tplId);
    if (!tpl) continue; // skip unknown / deleted templates silently
    // The cover is the email wrapper, never a generated PDF (it uses {{document_list}}).
    if (String(tpl.name).trim().toLowerCase() === COVER_TEMPLATE_NAME.toLowerCase()) continue;
    // Safety: ensure {{document_list}} never renders literally in a generated document.
    const renderedBody = replacePlaceholders(tpl.body || '', { document_list: '', ...tagMap });
    const pdfBuffer = await generatePdfFromHtml(renderedBody, company);

    const stamp = new Date().toISOString().replace(/[^0-9]/g, '');
    const safe = String(tpl.name).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const diskName = `${safe}_${stamp}.pdf`;
    const displayName = `${tpl.name}.pdf`;
    fs.writeFileSync(path.join(dir, diskName), pdfBuffer);
    const fileUrl = `/uploads/exit-documents/${tenant.dbName}/${requestId}/${diskName}`;

    const { rows } = await pool.query(
      `INSERT INTO exit_request_attachments
         (exit_request_id, stage_id, checklist_item_id, attachment_type, file_url, file_name, mime_type, uploaded_by)
       VALUES ($1, NULL, NULL, $2, $3, $4, 'application/pdf', $5)
       RETURNING id, file_name, file_url, mime_type, uploaded_at`,
      [requestId, ATTACHMENT_TYPE, fileUrl, displayName, actor?.employeeId || null],
    );
    try { await lettersRepo.incrementUsageCount(pool, tplId); } catch (_) { /* non-fatal */ }
    generated.push({
      ...rows[0], template_id: tplId, template_name: tpl.name, buffer: pdfBuffer,
    });
  }

  if (!generated.length) throw ApiError.badRequest('No valid documents could be generated');

  // Optionally email all generated PDFs to the employee in one message.
  let emailed = false;
  let emailTo = ctx.work_email || null;
  let emailError = null;
  if (dto.send_email !== false) {
    if (!ctx.work_email) {
      emailError = 'No work email on file for this employee';
    } else {
      try {
        const { Mailer } = require('../../helpers/mailer/mailer');
        const mailer = await Mailer.getInstance();
        const listHtml = generated.map((g) => `<li>${g.template_name}</li>`).join('');

        // Cover email body comes from the 'Exit Documents Cover' LETTER template (editable in
        // the Letters module) — not hard-coded. Falls back to a default if it is missing.
        let html;
        try {
          const { rows: coverRows } = await pool.query(
            `SELECT body FROM letter_templates
             WHERE name = 'Exit Documents Cover' AND category = 'Exit' AND status = 'Active'
             ORDER BY id DESC LIMIT 1`,
          );
          if (coverRows[0]?.body) {
            html = replacePlaceholders(coverRows[0].body, { ...tagMap, document_list: listHtml });
          }
        } catch (_) { /* fall through to default */ }
        if (!html) {
          html = `
            <p>Dear ${tagMap.employee_name || 'Colleague'},</p>
            <p>Please find attached your exit ${generated.length > 1 ? 'documents' : 'document'} from
               ${company.company_name}:</p>
            <ul>${listHtml}</ul>
            <p>If you have any questions, please reach out to the HR department.</p>
            <p>Regards,<br/>${company.company_name} HR</p>`;
        }
        await mailer.sendRaw({
          to: ctx.work_email,
          subject: `Your exit ${generated.length > 1 ? 'documents' : 'document'} — ${company.company_name}`,
          html,
          attachments: generated.map((g) => ({ filename: g.file_name, content: g.buffer })),
          variables: {
            app_name: company.company_name,
            company_logo: company.company_logo_path
          }
        });
        emailed = true;
      } catch (err) {
        emailError = err.message || 'Failed to send email';
      }
    }
  }

  // Log each as a dispatch (best-effort; never fails the generation).
  for (const g of generated) {
    try {
      await lettersRepo.insertDispatch(pool, {
        templateId: g.template_id,
        employeeId: ctx.employee_id,
        employee: tagMap.employee_name,
        template: g.template_name,
        sentBy: actor?.actorName || actor?.employeeId || null,
        bodySnapshot: null,
        status: emailed ? 'Delivered' : 'Generated',
      });
    } catch (_) { /* dispatch history is non-critical */ }
  }

  // Notify the employee in-app that documents were issued (best-effort).
  try { require('./exitEvents.service').onDocumentsSent(tenant, Number(requestId), emailed).catch((e) => logger.error('[exit] workflow event error', { err: e.message })); }
  catch (_) { /* non-blocking */ }

  return {
    documents: generated.map(({ buffer, ...rest }) => rest),
    emailed,
    email_to: emailTo,
    email_error: emailError,
  };
}

/**
 * Resolve the on-disk path for any stored attachment of this request (download
 * endpoint). Serves generated documents AND employee-uploaded files (e.g. the
 * resignation letter). Access is enforced by the route's authorizeExitAccess.
 */
async function getDownload(tenant, requestId, attachmentId) {
  const pool = await getTenantPool(tenant.dbName);
  const { rows } = await pool.query(
    `SELECT file_url, file_name, mime_type FROM exit_request_attachments
     WHERE id = $1 AND exit_request_id = $2`,
    [attachmentId, requestId],
  );
  if (!rows.length) throw ApiError.notFound('Document not found');
  const row = rows[0];
  const baseDir = path.resolve(env.UPLOAD.dir);
  const rel = String(row.file_url).replace(/^\/uploads\//, '');
  const absPath = path.resolve(baseDir, rel);
  // Containment check: a crafted file_url (e.g. "/uploads/../../etc/passwd" or an absolute
  // path) survives the leading-"/uploads/" strip and would otherwise resolve outside the
  // uploads base. path.relative is ".."-prefixed (or absolute) exactly when absPath escapes.
  const relToBase = path.relative(baseDir, absPath);
  if (relToBase === '' || relToBase.startsWith('..') || path.isAbsolute(relToBase)) {
    throw ApiError.notFound('Document not found');
  }
  if (!fs.existsSync(absPath)) throw ApiError.notFound('Document file is missing on disk');
  return { absPath, fileName: row.file_name, mimeType: row.mime_type || 'application/pdf' };
}

module.exports = { listTemplates, listGenerated, generate, getDownload };

