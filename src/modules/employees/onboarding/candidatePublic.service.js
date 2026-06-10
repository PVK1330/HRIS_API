'use strict';

const path = require('path');
const fs = require('fs').promises;
const { getTenantPool } = require('../../../config/db');
const env = require('../../../config/env');
const ApiError = require('../../../utils/ApiError');
const logger = require('../../../utils/logger');
const { runTenantMigrations } = require('../../tenant/tenant.service');
const empRepo = require('../employees.repository');
const docRepo = require('../documents/documents.repository');
const docService = require('../documents/documents.service');
const { generateOfferLetterPdf } = require('./offerPdf.generator');
const { generateSignedOfferPdf } = require('./signedOfferPdf.generator');
const workflowRepo = require('./onboarding.workflow.repository');
const { WORKFLOW_STATUS } = require('./onboarding.workflow');
const mailer = require('./onboarding.mailer');
const { resolveCandidatePortalContext, buildCandidateUrls } = require('./candidatePortalUrl');
const notifService = require('../../notifications/notifications.service');
const { getHROrAdminRecipients } = require('./utils/onboardingRecipients.utils');
const { sendOfferRejectedNotification } = require('./onboardingNotification.service');
const workflowAudit = require('../../workflow/workflowAudit.service');

async function ensureMigrated(dbName) {
  await runTenantMigrations(dbName).catch(() => {
    /* migrations may already be applied; do not block candidate links */
  });
}

function tenantUser(tenant) {
  return { db_name: tenant.dbName, tenant_id: tenant.id };
}

async function resolveCompanyName(tenant) {
  return tenant.name || process.env.COMPANY_NAME || 'Your Company';
}

function publicCandidateView(emp) {
  return {
    candidateId: emp.id,
    empId: emp.emp_id,
    name: emp.full_name,
    jobTitle: emp.job_title,
    department: emp.department,
    joinDate: emp.join_date,
    workflowStatus: emp.onboarding_workflow_status,
    workflowStatusLabel: emp.onboarding_workflow_status,
    approvalStatus: emp.onboarding_approval_status,
    step: emp.onboarding_step,
  };
}



async function createOnboardingReviewTask(pool, assigneeId, title, description, dueDateIso) {
  const { rows } = await pool.query(
    `SELECT id FROM tasks
     WHERE is_deleted = false
       AND status != 'Completed'
       AND assignee_id = $1
       AND title = $2
     LIMIT 1`,
    [assigneeId, title],
  );
  if (rows[0]?.id) return rows[0].id;
  const { rows: created } = await pool.query(
    `INSERT INTO tasks (title, description, priority, status, due_date, assignee_id, assigner_id)
     VALUES ($1, $2, 'High', 'Pending', $3, $4, NULL)
     RETURNING id`,
    [title, description, dueDateIso, assigneeId],
  );
  return created[0]?.id || null;
}

async function notifyAndAssignOnboardingTask(tenant, pool, emp, eventType = 'accepted') {
  const owners = await getHROrAdminRecipients(pool);
  if (!owners.length) return;

  const candidateName = emp.full_name || 'Candidate';
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 3);
  const dueDateIso = dueDate.toISOString().slice(0, 10);

  const title = eventType === 'uploaded'
    ? `Review uploaded onboarding documents: ${candidateName}`
    : `Follow-up onboarding acceptance: ${candidateName}`;
  const description = eventType === 'uploaded'
    ? `${candidateName} uploaded onboarding documents. Please review and approve the checklist documents.`
    : `${candidateName} accepted and signed the offer. Please monitor onboarding documents and complete HR review.`;
  const stepNum = eventType === 'uploaded' ? 3 : 1;
  const companyName = await resolveCompanyName(tenant);
  const notifiedEmails = new Set();

  for (const owner of owners) {
    try {
      const taskId = await createOnboardingReviewTask(pool, owner.id, title, description, dueDateIso);
      await notifService.pushNotification(
        { dbName: tenant.dbName, db_name: tenant.dbName },
        {
          employeeId: owner.id,
          title,
          message: description,
          type: 'info',
          entityType: 'onboarding',
          entityId: emp.id,
          redirectUrl: taskId ? `/admin/tasks/${taskId}` : '/admin/onboarding',
        },
      );

      // Email every authorized owner so they are alerted even if not online.
      const to = String(owner.work_email || '').trim().toLowerCase();
      if (to && !notifiedEmails.has(to)) {
        await mailer.sendOnboardingStepNotifyToHr({
          to,
          candidateName,
          empId: emp.emp_id || String(emp.id || ''),
          step: stepNum,
          companyName,
        });
        notifiedEmails.add(to);
      }
    } catch (_) {
      // Non-blocking for candidate journey
    }
  }

  try {
    await notifService.pushNotification(
      { dbName: tenant.dbName, db_name: tenant.dbName },
      {
        forAdmin: true,
        title,
        message: description,
        type: 'info',
        entityType: 'onboarding',
        entityId: emp.id,
        redirectUrl: '/admin/onboarding',
      },
    );
  } catch (_) {
    // Non-blocking
  }
}

async function getByToken(tenant, token) {
  const pool = getTenantPool(tenant.dbName);
  await ensureMigrated(tenant.dbName);
  const emp = await workflowRepo.findByToken(pool, token);
  if (!emp) throw ApiError.notFound('Invalid or expired onboarding link');
  return publicCandidateView(emp);
}

async function acceptOffer(tenant, token) {
  const pool = getTenantPool(tenant.dbName);
  await ensureMigrated(tenant.dbName);
  const emp = await workflowRepo.findByToken(pool, token);
  if (!emp) throw ApiError.notFound('Invalid or expired onboarding link');
  if (emp.onboarding_workflow_status === WORKFLOW_STATUS.REJECTED) {
    throw ApiError.badRequest('This offer was rejected');
  }
  if (emp.onboarding_workflow_status === WORKFLOW_STATUS.ONBOARDING_COMPLETE) {
    throw ApiError.badRequest('Onboarding is already complete');
  }
  // Idempotency: a second click on the accept link must NOT re-run the acceptance side
  // effects (HR task assignment + audit). Current decision state lives on the employee row
  // (loaded via findByToken). If already accepted, just hand back the sign URL again.
  if (emp.onboarding_approval_status === 'Accepted') {
    const { base, tenantSlug } = await resolveCandidatePortalContext(tenant.id);
    const urls = buildCandidateUrls(base, token, tenantSlug);
    return {
      ...publicCandidateView(emp),
      workflowStatus: emp.onboarding_workflow_status,
      signUrl: urls.signUrl,
      alreadyProcessed: true,
      message: 'Offer already accepted.',
    };
  }

  await workflowRepo.setWorkflowFields(pool, emp.id, {
    onboarding_approval_status: 'Accepted',
    onboarding_workflow_status: WORKFLOW_STATUS.ACCEPTED_PENDING_UPLOAD,
    onboarding_step: 1,
  });

  const { base, tenantSlug } = await resolveCandidatePortalContext(tenant.id);
  const urls = buildCandidateUrls(base, token, tenantSlug);
  await notifyAndAssignOnboardingTask(tenant, pool, emp, 'accepted');
  await workflowAudit.log(tenant, {
    module: 'onboarding',
    action: 'offer_accepted',
    entityType: 'employee',
    entityId: emp.id,
    detail: { source: 'candidate_portal' },
  });
  return {
    ...publicCandidateView(emp),
    workflowStatus: WORKFLOW_STATUS.ACCEPTED_PENDING_UPLOAD,
    signUrl: urls.signUrl,
    message: 'Offer accepted. Please sign the offer letter.',
  };
}

async function rejectOffer(tenant, token, { reason } = {}) {
  const pool = getTenantPool(tenant.dbName);
  await ensureMigrated(tenant.dbName);
  const emp = await workflowRepo.findByToken(pool, token);
  if (!emp) throw ApiError.notFound('Invalid or expired onboarding link');

  // Idempotency: a second click on the reject link must NOT re-terminate the employee or
  // re-notify HR. Current decision state lives on the employee row (loaded via findByToken).
  if (emp.onboarding_workflow_status === WORKFLOW_STATUS.REJECTED
      || emp.onboarding_approval_status === 'Rejected') {
    return {
      workflowStatus: WORKFLOW_STATUS.REJECTED,
      alreadyProcessed: true,
      message: 'Offer already rejected.',
    };
  }
  if (emp.onboarding_workflow_status === WORKFLOW_STATUS.ONBOARDING_COMPLETE) {
    throw ApiError.badRequest('Onboarding is already complete');
  }

  await workflowRepo.setWorkflowFields(pool, emp.id, {
    onboarding_approval_status: 'Rejected',
    onboarding_workflow_status: WORKFLOW_STATUS.REJECTED,
    onboarding_rejection_reason: reason || 'Candidate declined the offer',
    onboarding_step: 1,
  });
  await pool.query(
    `UPDATE employees SET employment_status = 'Terminated', updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL`,
    [emp.id],
  );

  try {
    const owners = await getHROrAdminRecipients(pool);
    await sendOfferRejectedNotification(tenant, emp.id, emp, owners, reason);
    logger.info(`Offer rejection notifications dispatched for ${emp.id}`);
  } catch (err) {
    logger.warn(`Failed to dispatch offer rejection notification: ${err.message}`);
  }

  await workflowAudit.log(tenant, {
    module: 'onboarding',
    action: 'offer_rejected',
    entityType: 'employee',
    entityId: emp.id,
    detail: { reason: reason || '', source: 'candidate_portal' },
  });

  return { workflowStatus: WORKFLOW_STATUS.REJECTED, message: 'Offer rejected.' };
}

async function signOffer(tenant, token, { signatureMode, signatureData, typedName }) {
  const pool = getTenantPool(tenant.dbName);
  await ensureMigrated(tenant.dbName);
  const emp = await workflowRepo.findByToken(pool, token);
  if (!emp) throw ApiError.notFound('Invalid or expired onboarding link');
  if (emp.onboarding_approval_status === 'Rejected') {
    throw ApiError.badRequest('Offer was rejected');
  }

  let offerPath = null;
  if (emp.offer_letter_document_id) {
    const docs = await docRepo.findByEmployee(pool, emp.id);
    const offerDoc = docs.find((d) => d.id === emp.offer_letter_document_id);
    if (offerDoc?.file_url) {
      const rel = String(offerDoc.file_url).replace(/^\/uploads\//, '');
      offerPath = path.resolve(env.UPLOAD.dir, rel);
    }
  }

  const companyName = await resolveCompanyName(tenant);
  const signed = await generateSignedOfferPdf({
    uploadDir: env.UPLOAD.dir,
    employeeId: emp.id,
    offerPdfPath: offerPath,
    signatureData,
    signatureMode: signatureMode || 'draw',
    typedName,
    companyName,
    candidateName: emp.full_name,
  });

  const user = tenantUser(tenant);
  const docRow = await docRepo.insertDocument(pool, {
    employee_id: emp.id,
    document_type: 'Signed Offer Letter',
    document_title: signed.fileName,
    document_number: null,
    issue_date: null,
    expiry_date: null,
    file_url: signed.relativeUrl,
    file_name: signed.fileName,
    file_size: signed.fileSize,
    file_mime_type: 'application/pdf',
    notes: 'Digitally signed by candidate',
  });

  await workflowRepo.setWorkflowFields(pool, emp.id, {
    signed_offer_document_id: docRow.id,
    onboarding_workflow_status: WORKFLOW_STATUS.DOCUMENTS_PENDING,
    onboarding_approval_status: 'Accepted',
    onboarding_step: 2,
  });

  await workflowRepo.seedChecklist(pool, emp.id);
  const { base, tenantSlug } = await resolveCandidatePortalContext(tenant.id);
  const urls = buildCandidateUrls(base, token, tenantSlug);
  const personalEmail = String(emp.personal_email || '').trim();

  if (personalEmail) {
    try {
      const checklist = await workflowRepo.listChecklist(pool, emp.id);
      await mailer.sendDocumentChecklistToCandidate({
        to: personalEmail,
        candidateName: emp.full_name,
        companyName,
        documentsUrl: urls.documentsUrl,
        checklist: checklist.map((c) => c.document_label),
      });
    } catch {
      /* non-fatal */
    }
  }

  return {
    workflowStatus: WORKFLOW_STATUS.DOCUMENTS_PENDING,
    documentsUrl: urls.documentsUrl,
    message: 'Offer signed. Please upload required documents.',
  };
}

async function listChecklist(tenant, token) {
  const pool = getTenantPool(tenant.dbName);
  await ensureMigrated(tenant.dbName);
  const emp = await workflowRepo.findByToken(pool, token);
  if (!emp) throw ApiError.notFound('Invalid or expired onboarding link');
  const items = await workflowRepo.listChecklist(pool, emp.id);
  return {
    candidate: publicCandidateView(emp),
    checklist: items.map((c) => ({
      id: c.id,
      documentKey: c.document_key,
      documentLabel: c.document_label,
      isMandatory: c.is_mandatory,
      uploadStatus: c.upload_status,
      hrReviewStatus: c.hr_review_status,
      hrReviewComment: c.hr_review_comment,
    })),
  };
}

async function uploadChecklistDocument(tenant, token, documentKey, file) {
  const pool = getTenantPool(tenant.dbName);
  await ensureMigrated(tenant.dbName);
  const emp = await workflowRepo.findByToken(pool, token);
  if (!emp) throw ApiError.notFound('Invalid or expired onboarding link');
  if (emp.onboarding_workflow_status !== WORKFLOW_STATUS.DOCUMENTS_PENDING) {
    throw ApiError.badRequest('Document upload is not available at this stage');
  }

  const item = await workflowRepo.findChecklistItem(pool, emp.id, documentKey);
  if (!item) throw ApiError.notFound('Checklist item not found');

  const user = tenantUser(tenant);
  const created = await docService.createDocument(
    user,
    emp.id,
    {
      document_type: item.document_label,
      document_title: item.document_label,
      notes: `Onboarding checklist: ${documentKey}`,
    },
    file,
    null,
  );

  await workflowRepo.attachChecklistDocument(pool, emp.id, documentKey, created.document.id);
  await pool.query(
    `UPDATE onboarding_checklist
     SET hr_review_status = 'Pending', updated_at = NOW()
     WHERE employee_id = $1 AND document_key = $2`,
    [emp.id, documentKey],
  );
  await notifyAndAssignOnboardingTask(tenant, pool, emp, 'uploaded');

  return { documentKey, uploadStatus: 'Uploaded', message: 'Document uploaded successfully.' };
}

async function downloadOfferPdf(tenant, token) {
  const pool = getTenantPool(tenant.dbName);
  const emp = await workflowRepo.findByToken(pool, token);
  if (!emp) throw ApiError.notFound('Invalid or expired onboarding link');
  if (!emp.offer_letter_document_id) throw ApiError.notFound('Offer letter not found');
  const docs = await docRepo.findByEmployee(pool, emp.id);
  const offerDoc = docs.find((d) => d.id === emp.offer_letter_document_id);
  if (!offerDoc?.file_url) throw ApiError.notFound('Offer letter file not found');
  if (String(offerDoc.file_url).startsWith('http')) {
    return { url: offerDoc.file_url, fileName: offerDoc.file_name || 'offer-letter.pdf' };
  }
  const rel = String(offerDoc.file_url).replace(/^\/uploads\//, '');
  const filePath = path.resolve(env.UPLOAD.dir, rel);
  try {
    await fs.access(filePath);
  } catch {
    throw ApiError.notFound('Offer letter file missing on server');
  }
  return { filePath, fileName: offerDoc.file_name || 'offer-letter.pdf' };
}

module.exports = {
  getByToken,
  acceptOffer,
  rejectOffer,
  signOffer,
  listChecklist,
  uploadChecklistDocument,
  downloadOfferPdf,
};
