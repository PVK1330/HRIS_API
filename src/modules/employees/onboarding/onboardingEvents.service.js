'use strict';

const delivery = require('../../notifications/notificationDelivery.service');
const workflowAudit = require('../../workflow/workflowAudit.service');
const { getHROrAdminRecipients } = require('./utils/onboardingRecipients.utils');
const { sendHandoverNotification } = require('./onboardingNotification.service');
const handoverRepo = require('../../onboardingHandover/onboardingHandover.repository');
const { resolveCandidatePortalContext, buildCandidateUrls } = require('./candidatePortalUrl');

function tenantCtx(dbName, tenantId) {
  return { dbName, db_name: dbName, id: tenantId };
}

async function resolveOfferSentRecipients(pool, emp) {
  const recipients = new Map();

  const hrAdmins = await getHROrAdminRecipients(pool);
  for (const u of hrAdmins) recipients.set(u.id, u);

  if (emp.reporting_manager_id) {
    const { rows } = await pool.query(
      `SELECT id, full_name, work_email FROM employees
       WHERE id = $1 AND deleted_at IS NULL`,
      [emp.reporting_manager_id],
    );
    if (rows[0]) recipients.set(rows[0].id, rows[0]);
  }

  if (emp.created_by) {
    const { rows } = await pool.query(
      `SELECT id, full_name, work_email FROM employees
       WHERE id = $1 AND deleted_at IS NULL`,
      [emp.created_by],
    );
    if (rows[0]) recipients.set(rows[0].id, rows[0]);
  }

  return Array.from(recipients.values());
}

async function notifyOfferSent(tenant, pool, emp, actor = {}) {
  const candidateName = emp.full_name || 'Candidate';
  const title = `Offer letter sent to ${candidateName}`;
  const message = title;
  const recipients = await resolveOfferSentRecipients(pool, emp);

  for (const r of recipients) {
    await delivery.sendDedupedSystem(tenant, {
      employeeId: r.id,
      title,
      message,
      type: 'info',
      sendEmail: true,
      emailSubject: title,
      entityType: 'onboarding',
      entityId: emp.id,
      redirectUrl: '/admin/onboarding',
    }, {
      tenantId: tenant.id,
      notificationType: 'onboarding.offer_sent',
      entityType: 'onboarding',
      entityId: emp.id,
      recipientId: r.id,
    });

    await delivery.sendDedupedEmailOnly(
      tenant,
      {
        to: r.work_email,
        templateSlug: 'onboarding_offer_sent_hr',
        variables: {
          recipient_name: r.full_name || 'Colleague',
          candidate_name: candidateName,
          job_title: emp.job_title || '',
          company_name: tenant.companyName || 'Organisation',
        },
      },
      {
        tenantId: tenant.id,
        notificationType: 'onboarding.offer_sent.email',
        entityType: 'onboarding',
        entityId: emp.id,
        recipientId: r.id,
      },
    );
  }

  await workflowAudit.log(tenant, {
    module: 'onboarding',
    action: 'offer_sent',
    entityType: 'employee',
    entityId: emp.id,
    actorEmployeeId: actor.employeeId,
    actorName: actor.actorName,
    detail: { candidateName, recipientCount: recipients.length },
  });
}

async function notifyHrRejected(tenant, pool, emp, reason, actor = {}) {
  const candidateName = emp.full_name || 'Candidate';
  const title = 'Your onboarding application has been rejected.';
  const message = reason ? `${title} Reason: ${reason}` : title;
  const personalEmail = String(emp.personal_email || '').trim();

  await delivery.sendDedupedSystem(tenant, {
    employeeId: emp.id,
    title,
    message,
    type: 'error',
    sendEmail: Boolean(personalEmail),
    emailSubject: title,
    entityType: 'onboarding',
    entityId: emp.id,
    redirectUrl: '/onboarding/offer',
  }, {
    tenantId: tenant.id,
    notificationType: 'onboarding.hr_rejected',
    entityType: 'onboarding',
    entityId: emp.id,
    recipientId: emp.id,
  });

  if (personalEmail) {
    await delivery.sendDedupedEmailOnly(
      tenant,
      {
        to: personalEmail,
        templateSlug: 'onboarding_hr_rejected',
        variables: {
          candidate_name: candidateName,
          reason: reason || 'Not specified',
          company_name: tenant.companyName || 'Organisation',
        },
      },
      {
        tenantId: tenant.id,
        notificationType: 'onboarding.hr_rejected.email',
        entityType: 'onboarding',
        entityId: emp.id,
        recipientId: emp.id,
      },
    );
  }

  const hrOwners = await getHROrAdminRecipients(pool);
  for (const owner of hrOwners) {
    await delivery.sendDedupedInApp(tenant, {
      employeeId: owner.id,
      title: `Onboarding rejected: ${candidateName}`,
      message: `HR rejected onboarding for ${candidateName}.${reason ? ` Reason: ${reason}` : ''}`,
      type: 'warning',
      entityType: 'onboarding',
      entityId: emp.id,
      redirectUrl: '/admin/onboarding',
    }, {
      tenantId: tenant.id,
      notificationType: 'onboarding.hr_rejected.hr',
      entityType: 'onboarding',
      entityId: emp.id,
      recipientId: owner.id,
    });
  }

  await workflowAudit.log(tenant, {
    module: 'onboarding',
    action: 'hr_rejected',
    entityType: 'employee',
    entityId: emp.id,
    actorEmployeeId: actor.employeeId,
    actorName: actor.actorName,
    detail: { reason },
  });
}

async function notifyDocumentReviewed(tenant, pool, emp, item, normalized, hrReviewComment, actor = {}) {
  const candidateName = emp.full_name || 'Candidate';
  const docName = item?.document_label || 'Document';
  const personalEmail = String(emp.personal_email || '').trim();
  const isApproved = normalized === 'Approved';

  const title = isApproved
    ? `Document approved: ${docName}`
    : `Document rejected: ${docName}`;
  const message = isApproved
    ? `Your document "${docName}" has been approved.`
    : `Your document "${docName}" was rejected.${hrReviewComment ? ` Reason: ${hrReviewComment}` : ''}`;

  await delivery.sendDedupedSystem(tenant, {
    employeeId: emp.id,
    title,
    message,
    type: isApproved ? 'success' : 'error',
    sendEmail: Boolean(personalEmail),
    emailSubject: title,
    entityType: 'onboarding',
    entityId: emp.id,
    redirectUrl: '/onboarding/documents',
  }, {
    tenantId: tenant.id,
    notificationType: `onboarding.document_${normalized.toLowerCase()}`,
    entityType: 'onboarding_checklist',
    entityId: item?.id || emp.id,
    recipientId: emp.id,
  });

  if (personalEmail) {
    let reuploadUrl = '';
    if (!isApproved && emp.onboarding_token) {
      try {
        const { base, tenantSlug } = await resolveCandidatePortalContext(tenant.id);
        reuploadUrl = buildCandidateUrls(base, emp.onboarding_token, tenantSlug).documentsUrl;
      } catch {
        reuploadUrl = '';
      }
    }

    await delivery.sendDedupedEmailOnly(
      tenant,
      {
        to: personalEmail,
        templateSlug: isApproved ? 'onboarding_document_approved' : 'onboarding_document_rejected',
        variables: {
          candidate_name: candidateName,
          document_name: docName,
          reason: hrReviewComment || 'Not specified',
          company_name: tenant.companyName || 'Organisation',
          reupload_url: reuploadUrl,
        },
      },
      {
        tenantId: tenant.id,
        notificationType: `onboarding.document_${normalized.toLowerCase()}.email`,
        entityType: 'onboarding_checklist',
        entityId: item?.id || emp.id,
        recipientId: emp.id,
      },
    );
  }

  const hrOwners = await getHROrAdminRecipients(pool);
  for (const owner of hrOwners) {
    if (owner.id === actor.employeeId) continue;
    await delivery.sendDedupedSystem(tenant, {
      employeeId: owner.id,
      title: `Document ${normalized} for ${candidateName}`,
      message: `${docName} was ${normalized.toLowerCase()} by ${actor.actorName || 'HR'}.`,
      type: isApproved ? 'info' : 'warning',
      sendEmail: true,
      emailSubject: `Document ${normalized}: ${candidateName}`,
      entityType: 'onboarding',
      entityId: emp.id,
      redirectUrl: '/admin/onboarding',
    }, {
      tenantId: tenant.id,
      notificationType: `onboarding.document_${normalized.toLowerCase()}.hr`,
      entityType: 'onboarding_checklist',
      entityId: item?.id || emp.id,
      recipientId: owner.id,
    });

    if (owner.work_email) {
      await delivery.sendDedupedEmailOnly(
        tenant,
        {
          to: owner.work_email,
          templateSlug: 'onboarding_document_review_hr',
          variables: {
            recipient_name: owner.full_name || 'Colleague',
            candidate_name: candidateName,
            document_name: docName,
            review_status: normalized,
            company_name: tenant.companyName || 'Organisation',
          },
        },
        {
          tenantId: tenant.id,
          notificationType: `onboarding.document_${normalized.toLowerCase()}.hr.email`,
          entityType: 'onboarding_checklist',
          entityId: item?.id || emp.id,
          recipientId: owner.id,
        },
      );
    }
  }

  await workflowAudit.log(tenant, {
    module: 'onboarding',
    action: isApproved ? 'document_approved' : 'document_rejected',
    entityType: 'onboarding_checklist',
    entityId: item?.id || emp.id,
    actorEmployeeId: actor.employeeId,
    actorName: actor.actorName,
    detail: { documentName: docName, status: normalized, comment: hrReviewComment },
  });
}

async function dispatchHandover(tenant, pool, employeeId, emp) {
  const recipients = await handoverRepo.resolveHandoverRecipients(pool, 'completion');
  await sendHandoverNotification(tenant, employeeId, emp, recipients);
  await workflowAudit.log(tenant, {
    module: 'onboarding',
    action: 'completed',
    entityType: 'employee',
    entityId: employeeId,
    detail: { handoverRecipientCount: recipients.length },
  });
}

module.exports = {
  tenantCtx,
  notifyOfferSent,
  notifyHrRejected,
  notifyDocumentReviewed,
  dispatchHandover,
  resolveOfferSentRecipients,
};
