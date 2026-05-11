'use strict';

const { getTenantPool } = require('../../../config/db');
const ApiError = require('../../../utils/ApiError');
const { runTenantMigrations } = require('../../tenant/tenant.service');
const empRepo = require('../employees.repository');
const repo = require('./leave.repository');

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Calculate working days between two date strings (inclusive).
 * Simple calendar-day count — weekends not excluded (HR can configure).
 */
function calcDays(fromDate, toDate) {
  const from = new Date(fromDate);
  const to   = new Date(toDate);
  if (isNaN(from) || isNaN(to)) return 0;
  const diff = Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(1, diff);
}

/**
 * Ensure a leave_balances row exists for this employee/type/year.
 * If not, seed it from the leave_type's annual_entitlement_days.
 */
async function ensureBalance(pool, employeeId, leaveTypeName, year, annualEntitlementDays) {
  const existing = await repo.getBalanceForType(pool, employeeId, leaveTypeName, year);
  if (existing) return existing;

  // Seed from entitlement
  return repo.upsertBalance(pool, {
    employeeId,
    leaveType:      leaveTypeName,
    year,
    totalAllocated: annualEntitlementDays ?? 0,
    used:           0,
    carryForward:   0,
  });
}

// ─── Employee-scoped: GET /employees/:id/leave ────────────────────────────────

async function getLeave(user, employeeId, query = {}) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);
  const emp = await empRepo.findById(pool, employeeId);
  if (!emp) throw ApiError.notFound('Employee not found');

  const year = parseInt(query.year, 10) || new Date().getFullYear();
  const [requests, balances] = await Promise.all([
    repo.findRequests(pool, employeeId, { status: query.status, year }),
    repo.getBalances(pool, employeeId, year),
  ]);
  return { requests, balances, year };
}

// ─── Admin: GET /leave ────────────────────────────────────────────────────────

async function listLeave(user, query = {}) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const year   = parseInt(query.year, 10) || new Date().getFullYear();
  const limit  = Math.min(100, parseInt(query.limit, 10) || 50);
  const offset = (Math.max(1, parseInt(query.page, 10) || 1) - 1) * limit;

  const filters = {
    status:     query.status     || '',
    year,
    department: query.department || '',
    search:     query.search     || '',
    limit,
    offset,
  };

  const [requests, total, stats] = await Promise.all([
    repo.findAllRequests(pool, filters),
    repo.countAllRequests(pool, filters),
    repo.getStats(pool, year),
  ]);

  return { requests, total, stats, year, limit, page: Math.max(1, parseInt(query.page, 10) || 1) };
}

// ─── Admin: POST /leave ───────────────────────────────────────────────────────

async function applyLeave(user, data) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  // 1. Employee must exist
  const emp = await empRepo.findById(pool, data.employeeId);
  if (!emp) throw ApiError.notFound('Employee not found');

  // 2. Leave type must be active in this tenant's settings
  const leaveTypeCfg = await repo.findActiveLeaveType(pool, data.leaveType);
  if (!leaveTypeCfg) {
    const validTypes = await repo.getActiveLeaveTypes(pool);
    throw ApiError.badRequest(
      `Invalid or inactive leave type "${data.leaveType}".` +
      (validTypes.length
        ? ` Valid types: ${validTypes.join(', ')}`
        : ' No active leave types configured — add them in Settings → Leave Settings.')
    );
  }

  // 3. Date validation
  const fromDate = data.fromDate;
  const toDate   = data.toDate;
  if (new Date(toDate) < new Date(fromDate)) {
    throw ApiError.badRequest('To date must be on or after from date');
  }

  // 4. Calculate total days
  const totalDays = data.totalDays && parseInt(data.totalDays, 10) > 0
    ? parseInt(data.totalDays, 10)
    : calcDays(fromDate, toDate);

  // 5. Overlap check — no two active requests for same employee on same dates
  const overlap = await repo.findOverlappingRequest(pool, data.employeeId, fromDate, toDate);
  if (overlap) {
    throw ApiError.conflict(
      `Employee already has a ${overlap.status.toLowerCase()} leave request ` +
      `(${overlap.leave_type}) overlapping these dates (${overlap.from_date} – ${overlap.to_date})`
    );
  }

  // 6. Document required check (warn via 400 if flag set and no doc provided)
  if (leaveTypeCfg.document_required && !data.supportingDocumentUrl) {
    throw ApiError.badRequest(
      `"${leaveTypeCfg.name}" requires a supporting document. Please attach one.`
    );
  }

  // 7. Balance check (skip for Unpaid leave — no entitlement needed)
  const year = new Date(fromDate).getFullYear();
  const isUnpaid = leaveTypeCfg.paid_or_unpaid === 'Unpaid';

  if (!isUnpaid && leaveTypeCfg.annual_entitlement_days > 0) {
    const balance = await ensureBalance(
      pool, data.employeeId, leaveTypeCfg.name, year, leaveTypeCfg.annual_entitlement_days
    );
    const remaining = (balance.total_allocated + balance.carry_forward) - balance.used;
    if (remaining < totalDays) {
      throw ApiError.badRequest(
        `Insufficient ${leaveTypeCfg.name} balance. ` +
        `Requested: ${totalDays} day(s), Available: ${remaining} day(s).`
      );
    }
  }

  // 8. Determine initial status — auto_approval skips Pending
  const autoApprove = Boolean(leaveTypeCfg.auto_approval);
  const initialStatus = autoApprove ? 'Approved' : 'Pending';

  // 9. Insert request
  const request = await repo.insertRequest(pool, {
    ...data,
    leaveType:  leaveTypeCfg.name,   // canonical casing
    totalDays,
    status:     initialStatus,
  });

  // 10. If auto-approved, deduct balance immediately
  if (autoApprove && !isUnpaid) {
    const balance = await ensureBalance(
      pool, data.employeeId, leaveTypeCfg.name, year, leaveTypeCfg.annual_entitlement_days
    );
    await repo.upsertBalance(pool, {
      employeeId:     data.employeeId,
      leaveType:      leaveTypeCfg.name,
      year,
      totalAllocated: balance.total_allocated,
      used:           balance.used + totalDays,
      carryForward:   balance.carry_forward,
    });
  }

  return {
    ...request,
    autoApproved:    autoApprove,
    leaveTypeConfig: {
      paidOrUnpaid:    leaveTypeCfg.paid_or_unpaid,
      approver:        leaveTypeCfg.approver,
      documentRequired: leaveTypeCfg.document_required,
      lossOfPayRule:   leaveTypeCfg.loss_of_pay_rule,
    },
  };
}

// ─── Admin: PATCH /leave/:id ──────────────────────────────────────────────────

async function processLeave(user, id, { action, reason }) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const request = await repo.findRequestById(pool, id);
  if (!request) throw ApiError.notFound('Leave request not found');
  if (request.status !== 'Pending') {
    throw ApiError.badRequest(`Cannot ${action} a request with status "${request.status}"`);
  }

  const statusMap = { approve: 'Approved', reject: 'Rejected', cancel: 'Cancelled' };
  const newStatus = statusMap[action];
  if (!newStatus) throw ApiError.badRequest('action must be approve, reject, or cancel');

  const updated = await repo.updateRequestStatus(pool, id, {
    status:          newStatus,
    approvedBy:      user.id,
    rejectionReason: reason || null,
  });

  // Deduct balance on approval
  if (newStatus === 'Approved') {
    const leaveTypeCfg = await repo.findActiveLeaveType(pool, request.leave_type);
    const isUnpaid = leaveTypeCfg?.paid_or_unpaid === 'Unpaid';

    if (!isUnpaid) {
      const year = new Date(request.from_date).getFullYear();
      const annualDays = leaveTypeCfg?.annual_entitlement_days ?? 0;
      const balance = await ensureBalance(
        pool, request.employee_id, request.leave_type, year, annualDays
      );
      await repo.upsertBalance(pool, {
        employeeId:     request.employee_id,
        leaveType:      request.leave_type,
        year,
        totalAllocated: balance.total_allocated,
        used:           balance.used + request.total_days,
        carryForward:   balance.carry_forward,
      });
    }
  }

  return updated;
}

// ─── Admin: GET /leave/balances ───────────────────────────────────────────────

async function listBalances(user, query = {}) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const year   = parseInt(query.year, 10) || new Date().getFullYear();
  const limit  = Math.min(100, parseInt(query.limit, 10) || 50);
  const offset = (Math.max(1, parseInt(query.page, 10) || 1) - 1) * limit;

  const rows = await repo.getAllBalances(pool, year, {
    department: query.department || '',
    search:     query.search     || '',
    limit,
    offset,
  });
  return { balances: rows, year };
}

module.exports = {
  getLeave,
  listLeave,
  applyLeave,
  processLeave,
  listBalances,
};
