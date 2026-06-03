'use strict';

const notifService = require('../../notifications/notifications.service');
const { NOTIFICATION_TYPES } = require('../../../constants/notificationTypes');

/**
 * Send an internal notification to a specific user
 */
async function sendInternalNotification(tenant, { recipientId, title, message, type = 'info', entityId, redirectUrl }) {
  try {
    await notifService.pushNotification(
      { dbName: tenant.dbName, db_name: tenant.dbName },
      {
        employeeId: recipientId,
        forAdmin: false,
        title,
        message,
        type,
        entityType: 'onboarding',
        entityId,
        redirectUrl,
      }
    );
  } catch (err) {
    // Non-blocking
  }
}

/**
 * Send a notification to all admins in the tenant
 */
async function sendAdminNotification(tenant, { title, message, type = 'info', entityId, redirectUrl }) {
  try {
    await notifService.pushNotification(
      { dbName: tenant.dbName, db_name: tenant.dbName },
      {
        forAdmin: true,
        title,
        message,
        type,
        entityType: 'onboarding',
        entityId,
        redirectUrl,
      }
    );
  } catch (err) {
    // Non-blocking
  }
}

/**
 * Send cross-department handover notifications
 */
async function sendHandoverNotification(tenant, employeeId, employee, recipients = []) {
  const title = 'New Employee Onboarding Completed';
  const messageBase = `New employee onboarding completed for ${employee.full_name} (${employee.job_title} - ${employee.department}).`;

  for (const dUser of recipients) {
    let specificMessage = messageBase;
    const dept = String(dUser.department || '').toLowerCase();
    
    if (dept === 'assets' || dept === 'it') {
      specificMessage += ' Please provision laptop, email account, and system access.';
    } else if (dept === 'finance' || dept === 'payroll') {
      specificMessage += ' Please initiate payroll and finance setup.';
    }

    await sendInternalNotification(tenant, {
      recipientId: dUser.id,
      title,
      message: specificMessage,
      type: 'info',
      entityId: employeeId,
      redirectUrl: `/admin/employees/${employeeId}`,
    });
  }
}

/**
 * Notify admins/HR that an offer was rejected
 */
async function sendOfferRejectedNotification(tenant, employeeId, employee, recipients = [], reason = '') {
  const candidateName = employee.full_name || 'Candidate';
  const rejectReasonText = reason ? ` Reason provided: ${reason}` : '';
  const description = `${candidateName} has declined the offer.${rejectReasonText}`;
  const title = `Offer Rejected: ${candidateName}`;
  const redirectUrl = '/admin/onboarding';

  for (const owner of recipients) {
    await sendInternalNotification(tenant, {
      recipientId: owner.id,
      title,
      message: description,
      type: 'error',
      entityId: employeeId,
      redirectUrl,
    });
  }

  await sendAdminNotification(tenant, {
    title,
    message: description,
    type: 'error',
    entityId: employeeId,
    redirectUrl,
  });
}

module.exports = {
  sendInternalNotification,
  sendAdminNotification,
  sendHandoverNotification,
  sendOfferRejectedNotification,
};
