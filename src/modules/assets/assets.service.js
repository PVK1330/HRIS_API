'use strict';

const repo = require('./assets.repository');
const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const delivery = require('../notifications/notificationDelivery.service');
const workflowAudit = require('../workflow/workflowAudit.service');

async function handleAssetAssignmentNotifications(tenant, assetId, actor = {}) {
  try {
    const pool = await getTenantPool(tenant.dbName);
    const asset = await repo.findById(pool, assetId);
    if (!asset || !asset.employee_id) return;

    const title = `Asset Assigned: ${asset.type || 'Hardware Equipment'}`;
    const message = `You have been assigned corporate asset ${asset.asset_id} (${asset.type || ''}) with Serial Number: ${asset.serial_number || 'N/A'}. Allocation status: Assigned.`;

    await delivery.sendDedupedInApp(tenant, {
      employeeId: asset.employee_id,
      title,
      message,
      type: 'info',
      entityType: 'asset',
      entityId: assetId,
      redirectUrl: '/admin/assets',
    }, {
      notificationType: 'assets.assigned',
      entityType: 'asset',
      entityId: assetId,
      recipientId: asset.employee_id,
    });

    await delivery.sendDedupedInApp(tenant, {
      forAdmin: true,
      title: `Asset Handover Notice: ${asset.assigned_to_name}`,
      message: `Asset ${asset.asset_id} (${asset.type || ''}) has been allocated to ${asset.assigned_to_name} (${asset.assigned_to_code}).`,
      type: 'info',
      entityType: 'asset',
      entityId: assetId,
      redirectUrl: '/admin/assets',
    }, {
      notificationType: 'assets.assigned.admin',
      entityType: 'asset',
      entityId: assetId,
      recipientId: null,
    });

    // 3. Dispatch Email Notice to assigned person's corporate inbox and admin
    const { sendMail } = require('../../utils/mail');
    
    const mailHtml = (recipientName) => `
      <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #0f766e;">Corporate Asset Allocation Notice</h2>
        <p>Dear <strong>${recipientName}</strong>,</p>
        <p>${message}</p>
        <table style="width: 100%; margin-top: 15px; border-collapse: collapse;">
          <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 8px; font-weight: bold;">Asset Tag</td>
            <td style="padding: 8px;">${asset.asset_id}</td>
          </tr>
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 8px; font-weight: bold;">Category / Type</td>
            <td style="padding: 8px;">${asset.type || '-'}</td>
          </tr>
          <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 8px; font-weight: bold;">Serial Number</td>
            <td style="padding: 8px;">${asset.serial_number || 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding: 8px; font-weight: bold;">Assigned Personnel</td>
            <td style="padding: 8px; color: #0f766e; font-weight: bold;">${asset.assigned_to_name} (${asset.assigned_to_code})</td>
          </tr>
        </table>
        <p style="margin-top: 20px; font-size: 12px; color: #64748b;">This notification confirms formal hardware ledger updating within the HRIS inventory center.</p>
      </div>
    `;

    if (asset.work_email) {
      await sendMail({
        to: asset.work_email,
        subject: `Corporate Asset Handover Notice: ${asset.asset_id}`,
        text: `Dear ${asset.assigned_to_name},\n\n${message}\n\nPlease verify receipt and adhere to organizational hardware policy standards.\n\nRegards,\nHR & IT Operations`,
        html: mailHtml(asset.assigned_to_name)
      }).catch(err => console.error('Asset assignment mail error:', err));
    }

    if (tenant?.adminEmail) {
      await sendMail({
        to: tenant.adminEmail,
        subject: `[Admin Ledger] Asset Handover Completed: ${asset.asset_id}`,
        text: `Dear Administrator,\n\nAsset ${asset.asset_id} has been formally allocated to ${asset.assigned_to_name} (${asset.assigned_to_code}).\n\nRegards,\nHR & IT Operations`,
        html: mailHtml(tenant.name || 'Company Administrator')
      }).catch(err => console.error('Admin asset assignment mail error:', err));
    }

    await workflowAudit.log(tenant, {
      module: 'assets',
      action: 'assigned',
      entityType: 'asset',
      entityId: assetId,
      actorEmployeeId: actor.employeeId || null,
      actorName: actor.actorName || null,
      detail: { assetTag: asset.asset_id, employeeId: asset.employee_id },
    });
  } catch (err) {
    console.error('Failed to dispatch asset allocation notifications', err);
  }
}

async function logAssetReturned(tenant, assetId, employeeId, actor = {}, detail = {}) {
  await workflowAudit.log(tenant, {
    module: 'assets',
    action: 'returned',
    entityType: 'asset',
    entityId: assetId,
    actorEmployeeId: actor.employeeId || null,
    actorName: actor.actorName || null,
    detail: { ...detail, employeeId },
  });
}

async function logAssetReassigned(tenant, assetId, fromEmployeeId, toEmployeeId, actor = {}) {
  await workflowAudit.log(tenant, {
    module: 'assets',
    action: 'reassigned',
    entityType: 'asset',
    entityId: assetId,
    actorEmployeeId: actor.employeeId || null,
    actorName: actor.actorName || null,
    detail: { fromEmployeeId, toEmployeeId },
  });
}

async function listAssets(tenant) {
  const pool = await getTenantPool(tenant.dbName);
  return repo.findAll(pool);
}

async function getAsset(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const asset = await repo.findById(pool, id);
  if (!asset) throw new ApiError(404, 'Asset not found');
  return asset;
}

async function createAsset(tenant, data, actor = {}) {
  const pool = await getTenantPool(tenant.dbName);
  if (!data.assetId) {
    const assets = await repo.findAll(pool);
    const lastId = assets.length > 0 ? assets[0].asset_id : 'AST-000';
    const nextNum = parseInt(lastId.split('-')[1]) + 1;
    data.assetId = `AST-${String(nextNum).padStart(3, '0')}`;
  }
  const created = await repo.create(pool, data);
  if (created && data.employeeId) {
    handleAssetAssignmentNotifications(tenant, created.id, actor).catch(() => null);
  }
  return created;
}

async function updateAsset(tenant, id, data, actor = {}) {
  const pool = await getTenantPool(tenant.dbName);
  const previous = await repo.findById(pool, id);
  const updated = await repo.update(pool, id, data);
  if (!updated) throw new ApiError(404, 'Asset not found');
  if (data.employeeId) {
    if (previous?.employee_id && Number(previous.employee_id) !== Number(data.employeeId)) {
      logAssetReassigned(tenant, id, previous.employee_id, data.employeeId, actor).catch(() => null);
    }
    handleAssetAssignmentNotifications(tenant, id, actor).catch(() => null);
  }
  return updated;
}

async function deleteAsset(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const deleted = await repo.remove(pool, id);
  if (!deleted) throw new ApiError(404, 'Asset not found');
  return true;
}

module.exports = {
  listAssets,
  getAsset,
  createAsset,
  updateAsset,
  deleteAsset,
  logAssetReturned,
  logAssetReassigned,
};
