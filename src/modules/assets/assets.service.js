'use strict';

const repo = require('./assets.repository');
const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const delivery = require('../notifications/notificationDelivery.service');
const notify = require('../notifications/notifications.service');
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

// Notify a previously-assigned employee (and admin) that an asset is no longer
// allocated to them — used for both un-assignment and re-assignment to someone else.
// `asset` is the full row as it was BEFORE the change (so it still carries the holder).
async function notifyAssetUnassigned(tenant, asset) {
  try {
    if (!asset || !asset.employee_id) return;
    const label = asset.type || 'Hardware Equipment';
    const message = `Corporate asset ${asset.asset_id} (${asset.type || ''}), Serial Number: ${asset.serial_number || 'N/A'}, is no longer allocated to you. Please ensure it has been physically returned to IT/Admin.`;

    await notify.sendSystemNotification(tenant, {
      employeeId: asset.employee_id,
      title: `Asset Returned: ${label}`,
      message,
      type: 'info',
      entityType: 'asset',
      entityId: asset.id,
      redirectUrl: '/employee/assets',
      sendEmail: true,
    });

    await notify.pushNotification(tenant, {
      forAdmin: true,
      title: `Asset Return Recorded: ${asset.asset_id}`,
      message: `Asset ${asset.asset_id} (${asset.type || ''}) previously held by ${asset.assigned_to_name || 'an employee'} has been returned to inventory.`,
      type: 'info',
      entityType: 'asset',
      entityId: asset.id,
      redirectUrl: '/admin/assets',
    });
  } catch (err) {
    console.error('Failed to dispatch asset return notifications', err);
  }
}

// Notify the currently-assigned employee that the asset's status/condition changed
// (e.g. moved to Under Maintenance, Lost, Damaged) while still allocated to them.
async function notifyAssetStatusChange(tenant, asset, fromStatus, toStatus) {
  try {
    if (!asset || !asset.employee_id) return;
    const label = asset.type || 'Hardware Equipment';
    await notify.sendSystemNotification(tenant, {
      employeeId: asset.employee_id,
      title: `Asset Status Updated: ${label}`,
      message: `The status of your assigned asset ${asset.asset_id} (${asset.type || ''}) changed from "${fromStatus || 'N/A'}" to "${toStatus}".`,
      type: 'info',
      entityType: 'asset',
      entityId: asset.id,
      redirectUrl: '/employee/assets',
      sendEmail: false,
    });
  } catch (err) {
    console.error('Failed to dispatch asset status-change notification', err);
  }
}

// Notify the previously-assigned employee (and admin) that an asset record was deleted.
async function notifyAssetDeleted(tenant, asset) {
  try {
    if (!asset) return;
    if (asset.employee_id) {
      await notify.sendSystemNotification(tenant, {
        employeeId: asset.employee_id,
        title: `Asset Removed: ${asset.type || 'Hardware Equipment'}`,
        message: `Corporate asset ${asset.asset_id} (${asset.type || ''}) that was assigned to you has been removed from the inventory ledger.`,
        type: 'warning',
        entityType: 'asset',
        entityId: asset.id,
        redirectUrl: '/employee/assets',
        sendEmail: false,
      });
    }
    await notify.pushNotification(tenant, {
      forAdmin: true,
      title: `Asset Deleted: ${asset.asset_id}`,
      message: `Asset ${asset.asset_id} (${asset.type || ''}) has been permanently removed from the inventory ledger.`,
      type: 'warning',
      entityType: 'asset',
      entityId: asset.id,
      redirectUrl: '/admin/assets',
    });
  } catch (err) {
    console.error('Failed to dispatch asset deletion notifications', err);
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

  const prevEmp = previous?.employee_id ? Number(previous.employee_id) : null;
  const assignmentChanged = Object.prototype.hasOwnProperty.call(data, 'employeeId');
  const newEmp = assignmentChanged
    ? (data.employeeId ? Number(data.employeeId) : null)
    : prevEmp;

  // Asset taken away from its previous holder (re-assignment or un-assignment).
  if (prevEmp && prevEmp !== newEmp) {
    if (newEmp) {
      logAssetReassigned(tenant, id, prevEmp, newEmp, actor).catch(() => null);
    } else {
      logAssetReturned(tenant, id, prevEmp, actor, { assetTag: previous.asset_id }).catch(() => null);
    }
    // Inform the previous holder; `previous` still carries their details.
    notifyAssetUnassigned(tenant, previous).catch(() => null);
  }

  // Asset assigned to a (new) holder.
  if (newEmp && newEmp !== prevEmp) {
    handleAssetAssignmentNotifications(tenant, id, actor).catch(() => null);
  }

  // Status/condition changed while the asset stays with the same employee.
  if (newEmp && newEmp === prevEmp && data.status && data.status !== previous?.status) {
    notifyAssetStatusChange(tenant, previous, previous?.status, data.status).catch(() => null);
  }

  return updated;
}

async function deleteAsset(tenant, id) {
  const pool = await getTenantPool(tenant.dbName);
  const existing = await repo.findById(pool, id);
  const deleted = await repo.remove(pool, id);
  if (!deleted) throw new ApiError(404, 'Asset not found');
  if (existing) {
    notifyAssetDeleted(tenant, existing).catch(() => null);
  }
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
