'use strict';

const { getTenantPool } = require('../../config/db');
const historyRepo = require('./notificationHistory.repository');
const notifService = require('./notifications.service');

async function sendDedupedInApp(tenant, payload, dedupMeta) {
  const dbName = tenant?.dbName || tenant?.db_name;
  if (!dbName) return null;

  const pool = await getTenantPool(dbName);
  const hash = historyRepo.buildHash({
    notificationType: dedupMeta.notificationType,
    entityType: dedupMeta.entityType,
    entityId: dedupMeta.entityId,
    recipientId: dedupMeta.recipientId ?? payload.recipientId ?? payload.employeeId ?? null,
    sentVia: 'in_app',
    title: payload.title,
  });

  if (await historyRepo.wasAlreadySent(pool, hash)) {
    return null;
  }

  const record = await notifService.pushNotification(tenant, payload);
  await historyRepo.recordSent(pool, {
    tenantId: dedupMeta.tenantId ?? tenant?.id ?? null,
    notificationType: dedupMeta.notificationType,
    entityType: dedupMeta.entityType,
    entityId: dedupMeta.entityId,
    recipientId: dedupMeta.recipientId ?? payload.recipientId ?? payload.employeeId ?? null,
    sentVia: 'in_app',
    hash,
  });
  return record;
}

async function sendDedupedSystem(tenant, payload, dedupMeta) {
  const dbName = tenant?.dbName || tenant?.db_name;
  if (!dbName) return null;

  const pool = await getTenantPool(dbName);
  const sentVia = payload.sendEmail ? 'email' : 'in_app';
  const hash = historyRepo.buildHash({
    notificationType: dedupMeta.notificationType,
    entityType: dedupMeta.entityType,
    entityId: dedupMeta.entityId,
    recipientId: dedupMeta.recipientId ?? payload.recipientId ?? payload.employeeId ?? null,
    sentVia,
    title: payload.title,
  });

  if (await historyRepo.wasAlreadySent(pool, hash)) {
    return null;
  }

  const record = await notifService.sendSystemNotification(tenant, payload);
  await historyRepo.recordSent(pool, {
    tenantId: dedupMeta.tenantId ?? tenant?.id ?? null,
    notificationType: dedupMeta.notificationType,
    entityType: dedupMeta.entityType,
    entityId: dedupMeta.entityId,
    recipientId: dedupMeta.recipientId ?? payload.recipientId ?? payload.employeeId ?? null,
    sentVia,
    hash,
  });
  return record;
}

async function sendDedupedEmailOnly(tenant, { to, templateSlug, variables }, dedupMeta) {
  const dbName = tenant?.dbName || tenant?.db_name;
  if (!dbName || !to) return false;

  const pool = await getTenantPool(dbName);
  const hash = historyRepo.buildHash({
    notificationType: dedupMeta.notificationType,
    entityType: dedupMeta.entityType,
    entityId: dedupMeta.entityId,
    recipientId: dedupMeta.recipientId ?? null,
    sentVia: 'email',
    title: templateSlug,
  });

  if (await historyRepo.wasAlreadySent(pool, hash)) {
    return false;
  }

  try {
    const { Mailer } = require('../../helpers/mailer/mailer');
    const mailer = await Mailer.getInstance();
    await mailer.send({ to, templateSlug, variables });
    await historyRepo.recordSent(pool, {
      tenantId: dedupMeta.tenantId ?? tenant?.id ?? null,
      notificationType: dedupMeta.notificationType,
      entityType: dedupMeta.entityType,
      entityId: dedupMeta.entityId,
      recipientId: dedupMeta.recipientId ?? null,
      sentVia: 'email',
      hash,
    });
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  sendDedupedInApp,
  sendDedupedSystem,
  sendDedupedEmailOnly,
  buildHash: historyRepo.buildHash,
};
