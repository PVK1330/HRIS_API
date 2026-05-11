'use strict';

const { getTenantPool } = require('../../../config/db');
const ApiError = require('../../../utils/ApiError');
const { runTenantMigrations } = require('../../tenant/tenant.service');
const empRepo = require('../employees.repository');
const repo = require('./attendance.repository');

const _cache = new Map();
async function ensureMigrated(dbName) {
  if (_cache.has(dbName)) return _cache.get(dbName);
  const p = runTenantMigrations(dbName).catch((err) => {
    _cache.delete(dbName);
    throw ApiError.internal('Database setup failed.');
  });
  _cache.set(dbName, p);
  return p;
}

function getPool(user) {
  if (!user?.db_name) throw ApiError.unauthorized('Tenant not found');
  return getTenantPool(user.db_name);
}

// ─── Employee-scoped: GET /employees/:id/attendance ───────────────────────────

async function getAttendance(user, employeeId, query = {}) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);
  const emp = await empRepo.findById(pool, employeeId);
  if (!emp) throw ApiError.notFound('Employee not found');

  const now   = new Date();
  const year  = parseInt(query.year,  10) || now.getFullYear();
  const month = parseInt(query.month, 10) || now.getMonth() + 1;

  const [records, summary] = await Promise.all([
    repo.findByEmployee(pool, employeeId, { year, month }),
    repo.getSummary(pool, employeeId, year, month),
  ]);
  return { records, summary, year, month };
}

// ─── Admin: GET /attendance ───────────────────────────────────────────────────

async function listAttendance(user, query = {}) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const today  = new Date().toISOString().split('T')[0];
  const date   = query.date       || today;
  const limit  = Math.min(100, parseInt(query.limit, 10) || 50);
  const offset = (Math.max(1, parseInt(query.page, 10) || 1) - 1) * limit;

  const filters = {
    date,
    department:  query.department || '',
    status:      query.status     || '',
    search:      query.search     || '',
    limit,
    offset,
  };

  const [records, total, summary] = await Promise.all([
    repo.findAll(pool, filters),
    repo.countAll(pool, filters),
    repo.getDailySummary(pool, date),
  ]);

  return { records, total, summary, date, limit, page: Math.max(1, parseInt(query.page, 10) || 1) };
}

// ─── Admin: POST /attendance (manual punch) ───────────────────────────────────

async function markAttendance(user, data) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const emp = await empRepo.findById(pool, data.employeeId);
  if (!emp) throw ApiError.notFound('Employee not found');

  // Auto-calculate total hours if both times provided
  let totalHours = data.totalHours ?? null;
  if (!totalHours && data.checkInTime && data.checkOutTime) {
    const [ih, im] = data.checkInTime.split(':').map(Number);
    const [oh, om] = data.checkOutTime.split(':').map(Number);
    const diff = (oh * 60 + om) - (ih * 60 + im);
    if (diff > 0) totalHours = parseFloat((diff / 60).toFixed(2));
  }

  const record = await repo.upsert(pool, { ...data, totalHours });
  return record;
}

// ─── Admin: GET /attendance/pending-regularizations ──────────────────────────

async function getPendingRegularizations(user, query = {}) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);
  const limit  = Math.min(100, parseInt(query.limit, 10) || 50);
  const offset = (Math.max(1, parseInt(query.page, 10) || 1) - 1) * limit;
  const records = await repo.getPendingRegularizations(pool, { limit, offset });
  return { records, total: records.length };
}

// ─── Admin: PATCH /attendance/:id/regularize ─────────────────────────────────

async function regularize(user, id, { action, reason }) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const record = await repo.findById(pool, id);
  if (!record) throw ApiError.notFound('Attendance record not found');
  if (record.regularization_status !== 'Pending') {
    throw ApiError.badRequest('Record is not pending regularization');
  }

  const status = action === 'approve' ? 'Approved' : 'Rejected';
  const updated = await repo.updateRegularization(pool, id, {
    status,
    regularizedBy: user.id,
  });
  return updated;
}

module.exports = {
  getAttendance,
  listAttendance,
  markAttendance,
  getPendingRegularizations,
  regularize,
};
