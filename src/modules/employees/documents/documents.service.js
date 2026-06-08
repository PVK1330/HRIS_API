'use strict';

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const { getTenantPool } = require('../../../config/db');
const env = require('../../../config/env');
const ApiError = require('../../../utils/ApiError');
const { ensureMigrated } = require('../../../utils/tenantMigration');
const empRepo = require('../employees.repository');
const repo = require('./documents.repository');
const { assertEmployeeRecordAccess } = require('../../../utils/applyDataScope');

function pool(user) {
  if (!user?.db_name) throw ApiError.unauthorized('Tenant not found');
  return getTenantPool(user.db_name);
}

async function getDocuments(user, employeeId, auth = null) {
  const p = pool(user);
  await ensureMigrated(user.db_name);
  const emp = await empRepo.findById(p, employeeId);
  if (!emp) throw ApiError.notFound('Employee not found');
  if (auth) assertEmployeeRecordAccess(auth, emp);

  // Onboarding HR approval lives on onboarding_checklist; keep documents.status in sync for profile UI.
  try {
    await repo.syncAllApprovedFromChecklist(p, employeeId);
    const wf = String(emp.onboarding_workflow_status || '').toLowerCase();
    if (wf === 'onboarding_complete') {
      await repo.markDocumentsApproved(
        p,
        [emp.offer_letter_document_id, emp.signed_offer_document_id],
        employeeId,
      );
    }
  } catch {
    /* onboarding tables may not exist on very old tenants */
  }

  const documents = await repo.findByEmployee(p, employeeId);
  return { documents };
}

async function listCatalogTypes(user, employeeId, auth = null) {
  const p = pool(user);
  await ensureMigrated(user.db_name);
  const emp = await empRepo.findById(p, employeeId);
  if (!emp) throw ApiError.notFound('Employee not found');
  if (auth) assertEmployeeRecordAccess(auth, emp);
  const types = await repo.listActiveDocumentTypes(p);
  return { types };
}

function toDateOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

const aws = require('../../../config/aws');

async function persistEmployeeDocFile(employeeId, file) {
  if (!file || !file.buffer) return null;
  const ext = path.extname(file.originalname || '').toLowerCase();
  const allowed = ['.pdf', '.jpg', '.jpeg', '.png'];
  const extFinal = allowed.includes(ext) ? ext : '.pdf';
  const fname = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${extFinal}`;

  if (aws.isS3Configured) {
    return await aws.uploadBuffer(`employee-docs/${employeeId}/${fname}`, file.buffer, file.mimetype);
  }

  const base = path.resolve(env.UPLOAD.dir);
  const dir = path.join(base, 'employee-docs', String(employeeId));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fname), file.buffer);
  return `/uploads/employee-docs/${employeeId}/${fname}`;
}

async function createDocument(user, employeeId, body, file, auth = null) {
  if (!file || !file.buffer) {
    throw ApiError.badRequest('File is required (field name: file)');
  }
  const p = pool(user);
  await ensureMigrated(user.db_name);
  const emp = await empRepo.findById(p, employeeId);
  if (!emp) throw ApiError.notFound('Employee not found');
  if (auth) assertEmployeeRecordAccess(auth, emp);

  const document_type = String(body.document_type || '').trim();
  if (!document_type) throw ApiError.badRequest('document_type is required');

  const document_title = String(body.document_title || document_type).trim().slice(0, 255);
  const document_number = body.document_number != null && body.document_number !== ''
    ? String(body.document_number).trim().slice(0, 100)
    : null;
  const notes = body.notes != null && body.notes !== ''
    ? String(body.notes).trim().slice(0, 5000)
    : null;
  const issue_date = toDateOrNull(body.issue_date);
  const expiry_date = toDateOrNull(body.expiry_date);

  const file_url = await persistEmployeeDocFile(employeeId, file);
  const file_name = String(file.originalname || 'document').slice(0, 255);
  const file_size = file.size != null ? Number(file.size) : file.buffer.length;
  const file_mime_type = file.mimetype || null;

  const created = await repo.insertDocument(p, {
    employee_id: parseInt(String(employeeId), 10),
    document_type: document_type.slice(0, 100),
    document_title,
    document_number,
    issue_date,
    expiry_date,
    file_url,
    file_name,
    file_size,
    file_mime_type,
    notes,
  });

  const actorName = user.email || null;
  await repo.insertAudit(p, {
    document_id: created.id,
    actor_id: ['employee', 'hr_admin', 'hr_executive', 'manager'].includes(String(user.role))
      ? user.id
      : null,
    actor_name: actorName,
    detail: `Uploaded by ${user.role}: ${actorName || user.id}`,
  });

  return { document: created };
}

module.exports = { getDocuments, listCatalogTypes, createDocument };
