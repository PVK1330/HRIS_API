'use strict';

const path = require('path');
const fs = require('fs').promises;

const { superAdminPool } = require('../../../config/db');
const env = require('../../../config/env');
const ApiError = require('../../../utils/ApiError');
const logger = require('../../../utils/logger');
const { getTenantPool } = require('../../../config/db');
const { runTenantMigrations } = require('../../tenant/tenant.service');
const empRepo = require('../employees.repository');
const docRepo = require('../documents/documents.repository');
const { assertEmployeeRecordAccess } = require('../../../utils/applyDataScope');
const mailer = require('./onboarding.mailer');
const workflowRepo = require('./onboarding.workflow.repository');
const { WORKFLOW_STATUS, WORKFLOW_STATUS_LABELS } = require('./onboarding.workflow');
const { generateOfferLetterPdf } = require('./offerPdf.generator');
const { resolveCandidatePortalContext, buildCandidateUrls } = require('./candidatePortalUrl');
const notifService = require('../../notifications/notifications.service');
const checklistUtils = require('./utils/onboardingChecklist.utils');
const onboardingEvents = require('./onboardingEvents.service');
const workflowAudit = require('../../workflow/workflowAudit.service');

const _migrationCache = new Map();
async function ensureMigrated(dbName) {
  if (_migrationCache.has(dbName)) return _migrationCache.get(dbName);
  const p = runTenantMigrations(dbName).catch((err) => {
    _migrationCache.delete(dbName);
    throw ApiError.internal('Database setup failed.');
  });
  _migrationCache.set(dbName, p);
  return p;
}

function resolvePool(user) {
  if (!user?.db_name) throw ApiError.unauthorized('Tenant database not found');
  return getTenantPool(user.db_name);
}

async function resolveHrInboxEmails(user) {
  const fromEnv = String(process.env.ONBOARDING_HR_EMAIL || process.env.HR_SHARED_EMAIL || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  if (fromEnv.length) return fromEnv;

  if (user?.tenant_id) {
    try {
      const { rows } = await superAdminPool.query(
        'SELECT admin_email, name FROM public.tenants WHERE id = $1 LIMIT 1',
        [user.tenant_id],
      );
      if (rows[0]?.admin_email) return [rows[0].admin_email];
      if (rows[0]?.name) return [];
    } catch (err) {
      logger.warn(`Tenant HR email lookup failed: ${err.message}`);
    }
  }
  return [];
}

async function resolveCompanyName(user) {
  if (user?.tenant_id) {
    try {
      const { rows } = await superAdminPool.query(
        'SELECT name FROM public.tenants WHERE id = $1 LIMIT 1',
        [user.tenant_id],
      );
      if (rows[0]?.name) return rows[0].name;
    } catch {
      /* ignore */
    }
  }
  return process.env.COMPANY_NAME || 'Your Company';
}

/**
 * Tenant branding for generated letters: company name, logo, address and
 * contact. Reads tenant_admin_settings (tenant-scoped) and falls back to the
 * registry tenant name. Shape matches what the PDF generator's header expects.
 */
async function resolveCompanyBranding(pool, user) {
  const companyName = await resolveCompanyName(user);
  const branding = {
    company_name: companyName,
    company_logo_path: null,
    company_address: null,
    contact_email: null,
    dbName: user?.db_name,
  };
  try {
    const { rows } = await pool.query(
      `SELECT company_name, logo_url, address, contact_details
         FROM tenant_admin_settings LIMIT 1`,
    );
    const s = rows[0];
    if (s) {
      if (s.company_name && String(s.company_name).trim()) branding.company_name = String(s.company_name).trim();
      if (s.logo_url && String(s.logo_url).trim()) branding.company_logo_path = String(s.logo_url).trim();
      if (s.address && String(s.address).trim()) branding.company_address = String(s.address).trim();
      if (s.contact_details && String(s.contact_details).trim()) branding.contact_email = String(s.contact_details).trim();
    }
  } catch {
    /* tenant_admin_settings may be absent — use the registry name only */
  }
  return branding;
}

function resolveAttachmentPath(fileUrl) {
  if (!fileUrl) return null;
  const rel = String(fileUrl).replace(/^\/uploads\//, '').replace(/^\//, '');
  return path.resolve(env.UPLOAD.dir, rel);
}

const ID_PROOF_TYPES = [
  'passport',
  'emirates id',
  'emirates_id',
  'national id',
  'id proof',
  'identity',
  'visa copy',
];
const RESUME_TYPES = [
  'resume',
  'cv',
  'experience certificate',
  'curriculum',
];
const OFFER_LETTER_TYPES = [
  'offer letter',
  'signed offer',
  'offer',
  'signed offer letter',
  'employment offer',
];

function matchesDocType(documentType, patterns) {
  const t = String(documentType || '').toLowerCase();
  return patterns.some((p) => t.includes(p));
}

async function buildOfferLetterAttachments(documents) {
  const attachments = [];
  const seen = new Set();
  for (const doc of documents) {
    if (!matchesDocType(doc.document_type || doc.documentType, OFFER_LETTER_TYPES)) {
      continue;
    }
    const filePath = resolveAttachmentPath(doc.file_url);
    if (!filePath || seen.has(filePath)) continue;
    try {
      await fs.access(filePath);
      attachments.push({
        filename: doc.file_name || path.basename(filePath),
        path: filePath,
      });
      seen.add(filePath);
    } catch {
      logger.warn(`Offer letter file missing: ${filePath}`);
    }
  }
  return attachments;
}

async function buildIdAndResumeAttachments(documents) {
  const attachments = [];
  const seen = new Set();

  for (const doc of documents) {
    const type = doc.document_type || doc.documentType || '';
    const isId = matchesDocType(type, ID_PROOF_TYPES);
    const isResume = matchesDocType(type, RESUME_TYPES);
    if (!isId && !isResume) continue;

    const filePath = resolveAttachmentPath(doc.file_url);
    if (!filePath || seen.has(filePath)) continue;

    try {
      await fs.access(filePath);
      const filename = doc.file_name || path.basename(filePath);
      attachments.push({ filename, path: filePath });
      seen.add(filePath);
    } catch {
      logger.warn(`Onboarding attachment missing: ${filePath}`);
    }
  }
  return attachments;
}

/**
 * Step 1 = candidate form submitted; step 2 = documents milestone (optional).
 */
async function notifyStepCompleted(user, employeeId, { step = 1 } = {}, auth = null) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);

  const emp = await empRepo.findById(pool, employeeId);
  if (!emp) throw ApiError.notFound('Employee not found');
  if (auth) assertEmployeeRecordAccess(auth, emp);

  const stepNum = Math.max(1, parseInt(String(step), 10) || 1);
  await workflowRepo.patchOnboardingFields(pool, employeeId, { onboarding_step: stepNum });

  const companyName = await resolveCompanyName(user);
  const candidateName = emp.full_name || emp.first_name || 'Candidate';
  const personalEmail = String(emp.personal_email || '').trim();
  const hrEmails = await resolveHrInboxEmails(user);

  let candidateEmailSent = false;
  let hrEmailSent = false;

  if (personalEmail) {
    try {
      await mailer.sendOnboardingStepCompletedToCandidate({
        to: personalEmail,
        candidateName,
        step: stepNum,
        companyName,
      });
      candidateEmailSent = true;
    } catch (err) {
      logger.warn(`Onboarding step email to candidate failed: ${err.message}`);
    }
  }

  if (hrEmails.length) {
    try {
      await mailer.sendOnboardingStepNotifyToHr({
        to: hrEmails.join(', '),
        candidateName,
        empId: emp.emp_id || String(employeeId),
        step: stepNum,
        companyName,
      });
      hrEmailSent = true;
    } catch (err) {
      logger.warn(`Onboarding step email to HR failed: ${err.message}`);
    }
  }

  // Send system notification to HR admins
  try {
    const tenant = { dbName: user.db_name, db_name: user.db_name };
    await notifService.pushNotification(tenant, {
      employeeId: null,
      forAdmin: true,
      title: `Onboarding Step ${stepNum} Completed`,
      message: `Candidate ${candidateName} has completed step ${stepNum} of onboarding.`,
      type: 'info',
      entityType: 'onboarding',
      entityId: employeeId,
      redirectUrl: '/admin/onboarding'
    });
  } catch (err) {
    logger.warn(`Onboarding system notification failed: ${err.message}`);
  }

  return {
    step: stepNum,
    candidateEmailSent,
    hrEmailSent,
    hrRecipients: hrEmails,
    message: candidateEmailSent
      ? `Step ${stepNum} confirmation sent to candidate.`
      : `Step ${stepNum} recorded.${hrEmailSent ? ' HR notified.' : ''}`,
  };
}

/**
 * Accepted → email shared HR inbox with ID proof + resume attachments.
 */
async function setApprovalStatus(
  user,
  employeeId,
  { status, rejectionReason } = {},
  auth = null,
) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);

  const emp = await empRepo.findById(pool, employeeId);
  if (!emp) throw ApiError.notFound('Employee not found');
  if (auth) assertEmployeeRecordAccess(auth, emp);

  const raw = String(status || '').trim();
  const normalized =
    raw === 'Approved' || raw === 'Accepted'
      ? 'Accepted'
      : raw === 'Rejected'
        ? 'Rejected'
        : raw === 'Pending'
          ? 'Pending'
          : null;

  if (!normalized) {
    throw ApiError.badRequest('status must be Pending, Accepted, Approved, or Rejected');
  }
  if (normalized === 'Rejected' && !String(rejectionReason || '').trim()) {
    throw ApiError.badRequest('Rejection reason is required');
  }

  if (normalized === 'Rejected') {
    const reason = String(rejectionReason).trim();
    await workflowRepo.patchOnboardingFields(pool, employeeId, {
      onboarding_approval_status: normalized,
      onboarding_workflow_status: WORKFLOW_STATUS.REJECTED,
      onboarding_rejection_reason: reason,
    });
    await pool.query(
      `UPDATE employees SET employment_status = 'Terminated', updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL`,
      [employeeId],
    );
    const tenant = {
      dbName: user.db_name,
      db_name: user.db_name,
      id: user.tenant_id,
      companyName: await resolveCompanyName(user),
    };
    const actor = {
      employeeId: user.employeeId || auth?.employeeId || null,
      actorName: user.full_name || user.name || 'HR',
    };
    await onboardingEvents.notifyHrRejected(tenant, pool, emp, reason, actor);
    return {
      status: normalized,
      hrEmailSent: true,
      message: 'Onboarding rejected. Candidate and HR have been notified.',
    };
  }

  if (normalized === 'Accepted') {
    const nextWorkflow = emp.signed_offer_document_id
      ? WORKFLOW_STATUS.DOCUMENTS_PENDING
      : WORKFLOW_STATUS.ACCEPTED_PENDING_UPLOAD;
    await workflowRepo.patchOnboardingFields(pool, employeeId, {
      onboarding_approval_status: normalized,
      onboarding_workflow_status: nextWorkflow,
      onboarding_rejection_reason: null,
    });
    await pool.query(
      `UPDATE employees SET employment_status = 'Onboarding', updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL`,
      [employeeId],
    );

    const hrEmails = await resolveHrInboxEmails(user);
    if (!hrEmails.length) {
      return {
        status: normalized,
        hrEmailSent: false,
        attachmentCount: 0,
        message:
          'Accepted. Set ONBOARDING_HR_EMAIL in API .env to send ID proof and resume by email.',
      };
    }

    const documents = await docRepo.findByEmployee(pool, employeeId);
    const attachments = await buildIdAndResumeAttachments(documents);
    const companyName = await resolveCompanyName(user);

    let hrEmailSent = false;
    try {
      await mailer.sendOnboardingAcceptedToHr({
        to: hrEmails.join(', '),
        candidateName: emp.full_name || 'Candidate',
        empId: emp.emp_id || String(employeeId),
        department: emp.department,
        jobTitle: emp.job_title,
        personalEmail: emp.personal_email,
        companyName,
        attachments,
      });
      hrEmailSent = true;
    } catch (err) {
      logger.warn(`Onboarding accepted HR email failed: ${err.message}`);
    }

    const tenant = {
      dbName: user.db_name,
      db_name: user.db_name,
      id: user.tenant_id,
      companyName: companyName,
    };
    await workflowAudit.log(tenant, {
      module: 'onboarding',
      action: 'hr_approved',
      entityType: 'employee',
      entityId: employeeId,
      actorEmployeeId: user.employeeId || auth?.employeeId || null,
      actorName: user.full_name || user.name || 'HR',
      detail: { status: normalized },
    });

    return {
      status: normalized,
      hrEmailSent,
      attachmentCount: attachments.length,
      hrRecipients: hrEmails,
      message: hrEmailSent
        ? `Accepted. Email sent to HR with ${attachments.length} attachment(s).`
        : 'Accepted. HR email could not be sent.',
    };
  }

  await workflowRepo.patchOnboardingFields(pool, employeeId, {
    onboarding_approval_status: normalized,
    onboarding_rejection_reason: null,
  });
  return { status: normalized, message: 'Onboarding status updated.' };
}

/**
 * Step 1: Generate offer PDF, issue candidate token, email Accept/Reject links.
 */
async function sendOfferLetter(
  user,
  employeeId,
  { dateOfOffer, offerExpiryDate, currency, annualCtc } = {},
  auth = null,
) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);

  const emp = await empRepo.findById(pool, employeeId);
  if (!emp) throw ApiError.notFound('Employee not found');
  if (auth) assertEmployeeRecordAccess(auth, emp);

  const personalEmail = String(emp.personal_email || '').trim();
  if (!personalEmail) {
    throw ApiError.badRequest('Personal email is required to send the offer letter');
  }

  const branding = await resolveCompanyBranding(pool, user);
  const companyName = branding.company_name;
  const offerDate = dateOfOffer || new Date().toISOString().slice(0, 10);

  const pdf = await generateOfferLetterPdf({
    uploadDir: env.UPLOAD.dir,
    employeeId,
    empId: emp.emp_id,
    companyName,
    candidateName: emp.full_name,
    candidateEmail: emp.personal_email,
    candidatePhone: emp.phone_number,
    jobTitle: emp.job_title,
    department: emp.department,
    joinDate: emp.join_date,
    annualCtc: annualCtc ?? emp.salary ?? null,
    currency: currency || null,
    dateOfOffer: offerDate,
    offerExpiryDate: offerExpiryDate || null,
    employmentType: emp.employment_type,
    managerName: emp.manager_name,
    pool,
    tenant: branding,
  });

  const docRow = await docRepo.insertDocument(pool, {
    employee_id: employeeId,
    document_type: 'Offer Letter',
    document_title: pdf.fileName,
    document_number: null,
    issue_date: null,
    expiry_date: null,
    file_url: pdf.relativeUrl,
    file_name: pdf.fileName,
    file_size: pdf.fileSize,
    file_mime_type: 'application/pdf',
    notes: 'System-generated offer letter',
  });

  let token = String(emp.onboarding_token || '').trim();
  const expiresAt = emp.onboarding_token_expires_at
    ? new Date(emp.onboarding_token_expires_at)
    : null;
  const tokenStillValid =
    token && expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt > new Date();

  if (!tokenStillValid) {
    ({ token } = await workflowRepo.issueOnboardingToken(pool, employeeId));
  }

  await workflowRepo.patchOnboardingFields(pool, employeeId, {
    onboarding_step: 1,
    onboarding_workflow_status: WORKFLOW_STATUS.OFFER_SENT,
    onboarding_approval_status: 'Pending',
    offer_letter_document_id: docRow.id,
    ...(tokenStillValid
      ? {}
      : { onboarding_token: token }),
  });

  // Build the candidate's role-based document checklist now (when the offer is
  // sent), so it's ready and we can show the required documents in the email.
  // Idempotent — re-seeding on acceptance is a no-op.
  let requiredDocuments = [];
  try {
    await workflowRepo.seedChecklist(pool, employeeId);
    const items = await workflowRepo.listChecklist(pool, employeeId);
    requiredDocuments = items
      .filter((i) => i.is_mandatory !== false)
      .map((i) => i.document_label)
      .filter(Boolean);
  } catch (err) {
    logger.warn(`Could not seed document checklist at offer send: ${err.message}`);
  }

  const { base, tenantSlug } = await resolveCandidatePortalContext(user.tenant_id);
  const urls = buildCandidateUrls(base, token, tenantSlug);
  const attachments = [
    { filename: pdf.fileName, path: pdf.filePath },
  ];

  try {
    await mailer.sendOfferLetterToCandidate({
      to: personalEmail,
      candidateName: emp.full_name || 'Candidate',
      companyName,
      jobTitle: emp.job_title,
      department: emp.department,
      joinDate: emp.join_date,
      currency: currency || null,
      annualCtc: annualCtc ?? emp.salary ?? null,
      dateOfOffer: offerDate,
      offerExpiryDate: offerExpiryDate || null,
      acceptUrl: urls.acceptUrl,
      rejectUrl: urls.rejectUrl,
      requiredDocuments,
      attachments,
    });
  } catch (err) {
    logger.warn(`Offer letter email failed: ${err.message}`);
    throw ApiError.internal('Could not send offer letter email');
  }

  const tenant = {
    dbName: user.db_name,
    db_name: user.db_name,
    id: user.tenant_id,
    companyName,
  };
  await onboardingEvents.notifyOfferSent(tenant, pool, emp, {
    employeeId: user.employeeId || auth?.employeeId || null,
    actorName: user.full_name || user.name || 'HR',
  });

  return {
    emailSent: true,
    attachmentCount: 1,
    to: personalEmail,
    workflowStatus: WORKFLOW_STATUS.OFFER_SENT,
    workflowStatusLabel: WORKFLOW_STATUS_LABELS[WORKFLOW_STATUS.OFFER_SENT],
    tokenExpiresInDays: 30,
    message: `Offer letter PDF sent to ${personalEmail} with Accept and Reject actions.`,
  };
}

async function getOnboardingChecklist(user, employeeId, auth = null) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  const emp = await empRepo.findById(pool, employeeId);
  if (!emp) throw ApiError.notFound('Employee not found');
  if (auth) assertEmployeeRecordAccess(auth, emp);
  const items = await workflowRepo.listChecklist(pool, employeeId);
  const mandatory = items.filter((i) => i.is_mandatory);
  const uploadedCount = items.filter((i) => i.upload_status === 'Uploaded').length;
  const approvedCount = checklistUtils.getApprovedDocuments(items).length;
  const mandatoryCount = mandatory.length;

  const response = {
    employeeId,
    workflowStatus: emp.onboarding_workflow_status,
    workflowStatusLabel:
      WORKFLOW_STATUS_LABELS[emp.onboarding_workflow_status] ||
      emp.onboarding_workflow_status,
    signedOfferOnFile: Boolean(emp.signed_offer_document_id),
    signedOfferFileUrl: null,
    checklist: items,
    progress: {
      uploadedCount,
      approvedCount,
      mandatoryCount,
      allMandatoryApproved: mandatoryCount > 0 && approvedCount === mandatoryCount,
      allMandatoryUploaded:
        mandatoryCount > 0 &&
        mandatory.every((i) => i.upload_status === 'Uploaded'),
    },
  };

  if (emp.signed_offer_document_id) {
    try {
      const { rows } = await pool.query('SELECT file_url FROM documents WHERE id = $1', [emp.signed_offer_document_id]);
      if (rows.length > 0) {
        response.signedOfferFileUrl = rows[0].file_url;
      }
    } catch(err) {}
  }
  return response;
}

async function reviewChecklistItem(
  user,
  employeeId,
  itemId,
  { hrReviewStatus, hrReviewComment } = {},
  auth = null,
) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  const emp = await empRepo.findById(pool, employeeId);
  if (!emp) throw ApiError.notFound('Employee not found');
  if (auth) assertEmployeeRecordAccess(auth, emp);

  const normalized = String(hrReviewStatus || '').trim();
  if (!['Approved', 'Rejected', 'Pending'].includes(normalized)) {
    throw ApiError.badRequest('hrReviewStatus must be Approved, Rejected, or Pending');
  }
  if (normalized === 'Rejected' && !String(hrReviewComment || '').trim()) {
    throw ApiError.badRequest('Comment is required when rejecting a document');
  }

  await workflowRepo.reviewChecklistItem(pool, itemId, {
    hrReviewStatus: normalized,
    hrReviewComment,
  });

  const items = await workflowRepo.listChecklist(pool, employeeId);
  const targetItem = items.find((i) => String(i.id) === String(itemId));
  if (normalized === 'Approved' || normalized === 'Rejected') {
    const tenant = {
      dbName: user.db_name,
      db_name: user.db_name,
      id: user.tenant_id,
      companyName: await resolveCompanyName(user),
    };
    // Fire-and-forget: notifications/emails (candidate + every HR owner) are
    // slow SMTP calls and must not block the HR's Approve/Reject response.
    onboardingEvents
      .notifyDocumentReviewed(tenant, pool, emp, targetItem, normalized, hrReviewComment, {
        employeeId: user.employeeId || auth?.employeeId || null,
        actorName: user.full_name || user.name || 'HR',
      })
      .catch((err) => logger.warn(`[onboarding] document-review notify failed: ${err.message}`));
  }

  return { message: 'Document review updated.' };
}

/**
 * Step 3 complete: all mandatory docs approved → activate employee & welcome email.
 */
async function completeOnboardingWorkflow(user, employeeId, auth = null) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  const emp = await empRepo.findById(pool, employeeId);
  if (!emp) throw ApiError.notFound('Employee not found');
  if (auth) assertEmployeeRecordAccess(auth, emp);

  if (emp.onboarding_approval_status !== 'Accepted') {
    throw ApiError.badRequest(
      'Candidate must accept the offer before onboarding can be completed',
    );
  }
  if (emp.onboarding_workflow_status === WORKFLOW_STATUS.REJECTED) {
    throw ApiError.badRequest('Cannot complete a rejected onboarding');
  }
  if (!emp.signed_offer_document_id) {
    throw ApiError.badRequest(
      'Signed offer letter is required. Candidate must sign or HR must upload the signed offer.',
    );
  }

  const allApproved = await workflowRepo.allMandatoryChecklistApproved(pool, employeeId);
  if (!allApproved) {
    throw ApiError.badRequest(
      'All mandatory documents must be uploaded and approved by HR before completion',
    );
  }

  const docRepo = require('../documents/documents.repository');
  await docRepo.syncAllApprovedFromChecklist(pool, employeeId);
  await docRepo.markDocumentsApproved(
    pool,
    [emp.offer_letter_document_id, emp.signed_offer_document_id],
    employeeId,
  );

  await workflowRepo.setWorkflowFields(pool, employeeId, {
    onboarding_workflow_status: WORKFLOW_STATUS.ONBOARDING_COMPLETE,
    onboarding_step: 3,
  });

  const empService = require('../employees.service');
  const activation = await empService.completeOnboardingActivation(user, employeeId, auth);

  try {
    const tenant = {
      dbName: user.db_name,
      db_name: user.db_name,
      id: user.tenant_id,
      companyName: await resolveCompanyName(user),
    };
    await onboardingEvents.dispatchHandover(tenant, pool, employeeId, emp);
  } catch (err) {
    logger.warn(`Onboarding handover notification failed: ${err.message}`);
  }

  return {
    workflowStatus: WORKFLOW_STATUS.ONBOARDING_COMPLETE,
    workflowStatusLabel: WORKFLOW_STATUS_LABELS[WORKFLOW_STATUS.ONBOARDING_COMPLETE],
    ...activation,
    message:
      activation.message ||
      'Onboarding complete. Employee is active in the directory and welcome email sent.',
  };
}

async function uploadSignedOfferByHr(user, employeeId, file, auth = null) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  const emp = await empRepo.findById(pool, employeeId);
  if (!emp) throw ApiError.notFound('Employee not found');
  if (auth) assertEmployeeRecordAccess(auth, emp);
  if (!file?.buffer) throw ApiError.badRequest('File is required');

  const docService = require('../documents/documents.service');
  const created = await docService.createDocument(
    user,
    employeeId,
    {
      document_type: 'Signed Offer Letter',
      document_title: file.originalname || 'Signed Offer Letter',
      notes: 'Uploaded by HR',
    },
    file,
    auth,
  );

  await workflowRepo.setWorkflowFields(pool, employeeId, {
    signed_offer_document_id: created.id,
    onboarding_workflow_status: WORKFLOW_STATUS.DOCUMENTS_PENDING,
    onboarding_step: 2,
    onboarding_approval_status: 'Accepted',
  });
  await workflowRepo.seedChecklist(pool, employeeId);

  // Send system notification to HR admins
  try {
    const tenant = { dbName: user.db_name, db_name: user.db_name };
    await notifService.pushNotification(tenant, {
      employeeId: null,
      forAdmin: true,
      title: `Signed Offer Uploaded for ${emp.full_name || 'Candidate'}`,
      message: `The signed offer letter for ${emp.full_name || 'Candidate'} has been uploaded by HR.`,
      type: 'info',
      entityType: 'onboarding',
      entityId: employeeId,
      redirectUrl: '/admin/onboarding'
    });
  } catch (err) {
    logger.warn(`Onboarding signed offer system notification failed: ${err.message}`);
  }

  return {
    documentId: created.id,
    workflowStatus: WORKFLOW_STATUS.DOCUMENTS_PENDING,
    message: 'Signed offer letter stored. Document checklist is now active.',
  };
}

async function sendPendingDocumentReminder(user, employeeId, auth = null) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  
  const emp = await empRepo.findById(pool, employeeId);
  if (!emp) throw ApiError.notFound('Employee not found');
  if (auth) assertEmployeeRecordAccess(auth, emp);

  const personalEmail = String(emp.personal_email || '').trim();
  if (!personalEmail) {
    throw ApiError.badRequest('Candidate does not have a personal email to send a reminder');
  }

  const items = await workflowRepo.listChecklist(pool, employeeId);
  if (!items || items.length === 0) {
    throw ApiError.badRequest('Candidate has no onboarding checklist items');
  }

  const pendingDocs = checklistUtils.getPendingDocuments(items);
  const rejectedDocs = checklistUtils.getRejectedDocuments(items);

  if (pendingDocs.length === 0 && rejectedDocs.length === 0) {
    throw ApiError.badRequest('Candidate has no pending or rejected documents to remind about');
  }

  const companyName = await resolveCompanyName(user);
  const { base, tenantSlug } = await resolveCandidatePortalContext(user.tenant_id);
  const token = emp.onboarding_token;
  if (!token) throw ApiError.badRequest('Candidate does not have an active onboarding token');
  
  const urls = buildCandidateUrls(base, token, tenantSlug);

  try {
    await mailer.sendMissingDocumentsReminderToCandidate({
      to: personalEmail,
      candidateName: emp.full_name || 'Candidate',
      companyName,
      documentsUrl: urls.documentsUrl,
      pendingDocuments: pendingDocs.map((d) => d.document_label),
      rejectedDocuments: rejectedDocs.map((d) => d.document_label),
    });
    logger.info(`Missing documents reminder sent to candidate ${employeeId} by user ${user.id}`);
  } catch (err) {
    logger.error(`Failed to send missing documents reminder: ${err.message}`);
    throw ApiError.internal('Failed to send reminder email');
  }

  return {
    success: true,
    message: 'Reminder sent successfully',
    pendingDocuments: pendingDocs.map((d) => d.document_label),
    rejectedDocuments: rejectedDocs.map((d) => d.document_label),
  };
}

module.exports = {
  notifyStepCompleted,
  setApprovalStatus,
  sendOfferLetter,
  getOnboardingChecklist,
  reviewChecklistItem,
  completeOnboardingWorkflow,
  uploadSignedOfferByHr,
  sendPendingDocumentReminder,
  WORKFLOW_STATUS,
  WORKFLOW_STATUS_LABELS,
};
