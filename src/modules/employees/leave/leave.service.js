'use strict';

const { getTenantPool } = require('../../../config/db');
const ApiError = require('../../../utils/ApiError');
const { runTenantMigrations } = require('../../tenant/tenant.service');
const empRepo = require('../employees.repository');
const repo = require('./leave.repository');
const carryForward = require('./leaveCarryForward.service');
const { sendSystemNotification } = require('../../notifications/notifications.service');
const { hasPermission } = require('../../../services/authz.service');
const { P } = require('../../../constants/permissions');
const { assertEmployeeRecordAccess } = require('../../../utils/applyDataScope');

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

async function listLeave(user, auth, query = {}) {
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
    repo.findAllRequests(pool, filters, auth),
    repo.countAllRequests(pool, filters, auth),
    repo.getStats(pool, year, auth),
  ]);

  return { requests, total, stats, year, limit, page: Math.max(1, parseInt(query.page, 10) || 1) };
}

// ─── Admin: POST /leave ───────────────────────────────────────────────────────

async function applyLeave(user, auth, data) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  // 1. Employee must exist and be within data scope
  const emp = await empRepo.findById(pool, data.employeeId);
  if (!emp) throw ApiError.notFound('Employee not found');
  assertEmployeeRecordAccess(auth, emp);

  const canApplyForOthers = hasPermission(auth, P.LEAVE_APPROVE)
    || auth?.scope === 'ALL'
    || auth?.isTenantAdmin;
  if (!canApplyForOthers && auth?.employeeId) {
    data.employeeId = auth.employeeId;
  }

  // 2. Leave type must be active in this tenant's settings
  let leaveTypeCfg;
  if (data.leaveTypeId) {
    leaveTypeCfg = await repo.findActiveLeaveTypeById(pool, data.leaveTypeId);
  } else if (data.leaveType) {
    leaveTypeCfg = await repo.findActiveLeaveType(pool, data.leaveType);
  }

  if (!leaveTypeCfg) {
    const validTypes = await repo.getActiveLeaveTypes(pool);
    throw ApiError.badRequest(
      `Invalid or inactive leave type.` +
      (validTypes.length
        ? ` Valid types: ${validTypes.join(', ')}`
        : ' No active leave types configured — add them in Settings → Leave Settings.')
    );
  }
  
  // Normalize the name so the database continues to record the text name properly
  data.leaveType = leaveTypeCfg.name;

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

  // Notice Period Check
  if (leaveTypeCfg.notice_period_required > 0) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const from = new Date(fromDate);
    const diffDays = Math.ceil((from - today) / (1000 * 60 * 60 * 24));
    if (diffDays < leaveTypeCfg.notice_period_required) {
      throw ApiError.badRequest(
        `"${leaveTypeCfg.name}" requires at least ${leaveTypeCfg.notice_period_required} days of notice. Please select a later date.`
      );
    }
  }

  // Gender Restriction Check
  if (leaveTypeCfg.gender_restriction && leaveTypeCfg.gender_restriction !== 'Both') {
    if (!emp.gender || String(emp.gender).toLowerCase() !== String(leaveTypeCfg.gender_restriction).toLowerCase()) {
      throw ApiError.badRequest(
        `"${leaveTypeCfg.name}" is restricted to ${leaveTypeCfg.gender_restriction} employees.`
      );
    }
  }

  // Probation Restriction Check
  if (leaveTypeCfg.probation_restriction) {
    if (emp.probation_end_date && new Date(fromDate) < new Date(emp.probation_end_date)) {
      throw ApiError.badRequest(
        `"${leaveTypeCfg.name}" cannot be applied for dates during your probation period.`
      );
    }
  }

  // Minimum Service Months Check
  if (leaveTypeCfg.minimum_service_months > 0 && emp.join_date) {
    const joinDate = new Date(emp.join_date);
    const monthsOfService = (new Date(fromDate).getFullYear() - joinDate.getFullYear()) * 12 + (new Date(fromDate).getMonth() - joinDate.getMonth());
    if (monthsOfService < leaveTypeCfg.minimum_service_months) {
      throw ApiError.badRequest(
        `"${leaveTypeCfg.name}" requires a minimum of ${leaveTypeCfg.minimum_service_months} months of service. You will be eligible after completing this tenure.`
      );
    }
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
  let initialStatus = 'Pending Manager Approval';
  if (data.isDraft) initialStatus = 'Draft';
  else if (autoApprove) initialStatus = 'Approved';

  // 9 + 10. Insert request, and (if auto-approved) deduct balance — atomically and
  // under a row lock so concurrent applies can't both pass the balance check and
  // over-deduct (lost-update race). The pre-check at step 7 is advisory UX only;
  // the authoritative check happens here under FOR UPDATE.
  const deductOnApply = autoApprove && !isUnpaid && leaveTypeCfg.annual_entitlement_days > 0;
  const client = await pool.connect();
  let request;
  try {
    await client.query('BEGIN');

    request = await repo.insertRequest(client, {
      ...data,
      leaveType:  leaveTypeCfg.name,   // canonical casing
      totalDays,
      status:     initialStatus,
    });

    if (deductOnApply) {
      const balance = await repo.lockBalanceForUpdate(
        client, data.employeeId, leaveTypeCfg.name, year, leaveTypeCfg.annual_entitlement_days
      );
      const remaining = (balance.total_allocated + balance.carry_forward) - balance.used;
      if (remaining < totalDays) {
        throw ApiError.badRequest(
          `Insufficient ${leaveTypeCfg.name} balance. ` +
          `Requested: ${totalDays} day(s), Available: ${remaining} day(s).`
        );
      }
      await repo.incrementUsed(client, data.employeeId, leaveTypeCfg.name, year, totalDays);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // 11. Notifications
  if (initialStatus === 'Pending Manager Approval') {
    // Notify Manager
    await sendSystemNotification(user, {
      forAdmin: true,
      title: 'New Leave Request',
      message: `${emp.full_name || 'An employee'} applied for ${totalDays} day(s) of ${leaveTypeCfg.name}.`,
      type: 'leave_request',
      entityType: 'leave',
      entityId: request.id,
      redirectUrl: '/admin/attendance/dashboard'
    }).catch(err => console.error('Failed to notify manager:', err));
  } else if (initialStatus === 'Approved') {
    await sendSystemNotification(user, {
      employeeId: data.employeeId,
      title: 'Leave Auto-Approved',
      message: `Your request for ${totalDays} day(s) of ${leaveTypeCfg.name} has been auto-approved.`,
      type: 'leave_approved',
      entityType: 'leave',
      entityId: request.id,
      redirectUrl: '/attendance'
    }).catch(err => console.error('Failed to notify employee:', err));
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

// Roles permitted to give the FINAL (HR) approval. Tenant admins / superadmins act as HR.
const HR_ROLES = new Set(['admin', 'superadmin', 'hr_admin', 'hr_executive', 'hr']);
function isHrActor(user) {
  return HR_ROLES.has(String(user?.role || '').toLowerCase());
}

/**
 * Two-stage approval workflow:
 *   Pending          --approve(manager)-->  Manager_Approved
 *   Manager_Approved --approve(HR)------->  Approved   (balance deducted here, HR-only)
 *   Any Stage Before Approved --reject--> Rejected
 *   Any Stage --cancel--> Cancelled (restore balance if was Approved)
 */
async function processLeave(user, auth, id, { action, reason }) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const request = await repo.findRequestById(pool, id);
  if (!request) throw ApiError.notFound('Leave request not found');

  const emp = await empRepo.findById(pool, request.employee_id);
  if (!emp) throw ApiError.notFound('Employee not found');
  assertEmployeeRecordAccess(auth, emp);

  if (!['approve', 'reject', 'cancel', 'submit'].includes(action)) {
    throw ApiError.badRequest('action must be approve, reject, cancel, or submit');
  }

  const isOwnRequest = Number(auth?.employeeId) === Number(request.employee_id);
  if (action === 'approve' || action === 'reject') {
    if (!hasPermission(auth, P.LEAVE_APPROVE)) {
      throw ApiError.forbidden('Leave approval permission required');
    }
    // SECURITY: segregation of duties — an approver may never approve/reject their
    // own leave request, even with LEAVE_APPROVE (mirrors attendance self-approval guard).
    if (isOwnRequest) {
      throw ApiError.forbidden('You cannot approve or reject your own leave request');
    }
  } else if (!isOwnRequest && !hasPermission(auth, P.LEAVE_APPROVE)) {
    throw ApiError.forbidden('You can only manage your own leave requests');
  }

  let newStatus;
  let stage; // 'manager' | 'hr' | undefined

  if (action === 'submit') {
    if (request.status !== 'Draft') {
      throw ApiError.badRequest(`Cannot submit a request with status "${request.status}"`);
    }
    newStatus = 'Pending Manager Approval';
  } else if (action === 'approve') {
    if (request.status === 'Pending Manager Approval') {
      // Stage 1 — manager approval
      if (user.role === 'manager' && Number(request.reporting_manager_id) !== Number(user.employeeId || user.id)) {
        throw ApiError.forbidden('You can only approve requests for your direct reports.');
      }
      newStatus = 'Pending HR Approval';
      stage = 'manager';
    } else if (request.status === 'Pending HR Approval') {
      // Stage 2 — HR final approval. Restricted to HR/admin roles.
      if (!isHrActor(user)) {
        throw ApiError.forbidden('Final approval requires an HR or admin role');
      }
      newStatus = 'Approved';
      stage = 'hr';
    } else {
      throw ApiError.badRequest(`Cannot approve a request with status "${request.status}"`);
    }
  } else if (action === 'reject') {
    if (request.status === 'Pending Manager Approval') {
      if (user.role === 'manager' && Number(request.reporting_manager_id) !== Number(user.employeeId || user.id)) {
        throw ApiError.forbidden('You can only reject requests for your direct reports.');
      }
      newStatus = 'Rejected by Manager';
    } else if (request.status === 'Pending HR Approval') {
      if (!isHrActor(user)) {
        throw ApiError.forbidden('Final rejection requires an HR or admin role');
      }
      newStatus = 'Rejected by HR';
    } else {
      throw ApiError.badRequest(`Cannot reject a request with status "${request.status}"`);
    }
  } else { // cancel
    if (!['Pending Manager Approval', 'Pending HR Approval', 'Approved', 'Draft'].includes(request.status)) {
      throw ApiError.badRequest(`Cannot cancel a request with status "${request.status}"`);
    }
    newStatus = 'Cancelled';
  }

  // Transaction for updating status and balances atomically
  const client = await pool.connect();
  let updated;
  try {
    await client.query('BEGIN');

    updated = await repo.updateRequestStatus(client, id, {
      status:          newStatus,
      stage,
      actorId:         user.id,
      rejectionReason: reason || null,
    });

    // ── Balance logic — only the FINAL approval consumes balance ────────────────
    const leaveTypeCfg = await repo.findActiveLeaveType(client, request.leave_type);
    const isUnpaid     = leaveTypeCfg?.paid_or_unpaid === 'Unpaid';

    if (!isUnpaid) {
      const year       = new Date(request.from_date).getFullYear();
      const annualDays = leaveTypeCfg?.annual_entitlement_days ?? 0;

      if (newStatus === 'Approved') {
        // Deduct days — leave is now consuming the balance. Lock the row first so two
        // concurrent final approvals can't both read a stale `used` and under-deduct.
        const balance = await repo.lockBalanceForUpdate(
          client, request.employee_id, request.leave_type, year, annualDays
        );
        const remaining = (balance.total_allocated + balance.carry_forward) - balance.used;
        if (remaining < request.total_days) {
          throw ApiError.badRequest(
            `Insufficient ${request.leave_type} balance to approve. ` +
            `Requested: ${request.total_days} day(s), Available: ${remaining} day(s).`
          );
        }
        await repo.incrementUsed(client, request.employee_id, request.leave_type, year, request.total_days);
      } else if (newStatus === 'Cancelled' && request.status === 'Approved') {
        // Restore days — previously approved leave is being cancelled. Atomic decrement
        // (clamped at 0) under lock, symmetric with the deduction above.
        await repo.lockBalanceForUpdate(
          client, request.employee_id, request.leave_type, year, annualDays
        );
        await repo.incrementUsed(client, request.employee_id, request.leave_type, year, -request.total_days);
      }
      // Reject, or cancel before final approval → no balance change (never deducted).
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Send Workflow Notifications (Outside transaction)
  if (action === 'submit') {
    await sendSystemNotification(user, {
      forAdmin: true,
      title: 'New Leave Request',
      message: `A draft leave request for ${request.leave_type} (${request.total_days} days) has been submitted for manager approval.`,
      type: 'leave_request',
      entityType: 'leave',
      entityId: request.id,
      redirectUrl: '/admin/attendance/dashboard'
    }).catch(err => console.error(err));
  } else if (action === 'approve') {
    if (newStatus === 'Pending HR Approval') {
      await sendSystemNotification(user, {
        forAdmin: true,
        title: 'Leave Pending HR Approval',
        message: `Leave request for ${request.leave_type} (${request.total_days} days) has been approved by the manager and awaits HR final approval.`,
        type: 'leave_request',
        entityType: 'leave',
        entityId: request.id,
        redirectUrl: '/admin/attendance/dashboard'
      }).catch(err => console.error(err));
    } else if (newStatus === 'Approved') {
      await sendSystemNotification(user, {
        employeeId: request.employee_id,
        title: 'Leave Approved',
        message: `Your leave request for ${request.leave_type} (${request.total_days} days) has been fully approved!`,
        type: 'leave_approved',
        entityType: 'leave',
        entityId: request.id,
        redirectUrl: '/attendance'
      }).catch(err => console.error(err));
    }
  } else if (action === 'reject') {
    await sendSystemNotification(user, {
      employeeId: request.employee_id,
      title: 'Leave Rejected',
      message: `Your leave request for ${request.leave_type} was rejected. Reason: ${reason || 'Not provided'}`,
      type: 'leave_rejected',
      entityType: 'leave',
      entityId: request.id,
      redirectUrl: '/attendance'
    }).catch(err => console.error(err));
  }

  return updated;
}

// ─── Admin: GET /leave/balances ───────────────────────────────────────────────

async function listBalances(user, auth, query = {}) {
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
  }, auth);
  return { balances: rows, year };
}

// ─── Admin: POST /leave/carry-forward ─────────────────────────────────────────
// Manually roll unused balances into a target leave year for this tenant. The same
// logic runs automatically via the yearly cron; this lets HR trigger / re-run it.
async function runCarryForward(user, { year } = {}) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);
  const targetYear = parseInt(year, 10) || new Date().getFullYear();
  return carryForward.processCarryForward(pool, targetYear);
}

module.exports = {
  getLeave,
  listLeave,
  applyLeave,
  processLeave,
  listBalances,
  runCarryForward,
};
