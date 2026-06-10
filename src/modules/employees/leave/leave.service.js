'use strict';

const { getTenantPool } = require('../../../config/db');
const ApiError = require('../../../utils/ApiError');
const { ensureMigrated } = require('../../../utils/tenantMigration');
const empRepo = require('../employees.repository');
const repo = require('./leave.repository');
const carryForward = require('./leaveCarryForward.service');
const { sendSystemNotification } = require('../../notifications/notifications.service');
const { hasPermission } = require('../../../services/authz.service');
const { P } = require('../../../constants/permissions');
const { assertEmployeeRecordAccess } = require('../../../utils/applyDataScope');
const leaveSettingsService = require('../../leaveSettings/leaveSettings.service');
const tenantSettingsService = require('../../tenantSettings/tenantSettings.service');
const exportEngine = require('../attendance/attendanceExport.service');
const attendanceCalc = require('../attendance/attendanceCalculation.service');
const logger = require('../../../utils/logger');
const workflowAudit = require('../../workflow/workflowAudit.service');

function getPool(user) {
  if (!user?.db_name) throw ApiError.unauthorized('Tenant not found');
  return getTenantPool(user.db_name);
}

/**
 * Actor fields for the shared workflow_audit_logs writer. actor_employee_id has an FK to
 * employees(id), so prefer a resolved employee id (or null) — never a raw admin id that
 * might not be an employee. Mirrors the policies / assets audit pattern.
 */
function auditActor(user, auth) {
  return {
    actorEmployeeId: user?.employeeId || auth?.employeeId || user?.id || null,
    actorName: user?.name || user?.full_name || user?.fullName || user?.email || null,
  };
}

/** Tenant handle for the audit writer (it reads dbName / db_name). */
function auditTenant(user) {
  return { dbName: user?.db_name };
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
 * Count working days in [fromDate, toDate] inclusive, excluding non-working days
 * (weekends per the tenant's Work Week setting) and public holidays (per the
 * holiday calendars, including tenant-wide 'Global' ones added via the UI).
 * Falls back to a plain calendar-day count if attendance settings can't be read.
 */
async function calcWorkingDays(pool, fromDate, toDate) {
  const fallback = calcDays(fromDate, toDate);
  try {
    const start = new Date(`${fromDate}T12:00:00Z`);
    const end   = new Date(`${toDate}T12:00:00Z`);
    if (isNaN(start) || isNaN(end) || end < start) return fallback;

    const settings = await attendanceCalc.loadSettings(pool);
    const region = settings?.uk_holiday_region || 'England';

    // Single query for every holiday in the range (configured region or 'Global').
    const { rows } = await pool.query(
      `SELECT TO_CHAR(hd.holiday_date, 'YYYY-MM-DD') AS d
         FROM holiday_dates hd
         JOIN holiday_calendars hc ON hc.id = hd.calendar_id
        WHERE hd.holiday_date BETWEEN $1::date AND $2::date
          AND (hc.region = $3 OR hc.region = 'Global')
          AND hc.is_active = true`,
      [fromDate, toDate, region],
    );
    const holidays = new Set(rows.map((r) => r.d));

    let count = 0;
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const ds = d.toISOString().slice(0, 10);
      if (attendanceCalc.isWeekend(ds, settings)) continue;
      if (holidays.has(ds)) continue;
      count += 1;
    }
    return count;
  } catch (err) {
    logger.warn(`[leave] calcWorkingDays fallback (${fromDate}..${toDate}): ${err.message}`);
    return fallback;
  }
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
    leaveType:  query.leaveType  || '',
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

/**
 * Branded Excel/PDF export of leave requests. Role-scoped automatically: the
 * data-scope on `auth` limits rows to self (employee), team (manager),
 * department (head) or all (HR/admin) — the same scope used by the list view.
 */
async function exportLeave(user, auth, query, format, req) {
  const pool = getPool(user);
  await ensureMigrated(user.db_name);

  const year = parseInt(query.year, 10) || new Date().getFullYear();
  const filters = {
    status: query.status || '',
    year,
    department: query.department || '',
    leaveType: query.leaveType || '',
    search: query.search || '',
    limit: 10000,
    offset: 0,
  };
  const requests = await repo.findAllRequests(pool, filters, auth);
  const rows = requests.map((r) => ({
    employee_name: r.employee_name,
    emp_id: r.emp_id,
    department: r.department,
    leave_type: r.leave_type,
    from_date: r.from_date,
    to_date: r.to_date,
    total_days: r.total_days,
    status: r.status,
    reason: r.reason,
    rejection_reason: r.rejection_reason || '',
  }));

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const branding = await tenantSettingsService.getAdminSettings(user.db_name, baseUrl);
  const generatedBy = user?.fullName || user?.email || 'System';
  const filterParts = Object.entries({
    year, status: filters.status, department: filters.department,
    leaveType: filters.leaveType, search: filters.search,
  }).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
  const filtersSummary = filterParts.length ? filterParts.join(' | ') : 'none';

  if (format === 'excel') {
    const wb = await exportEngine.buildExcel(branding, 'leave', rows, filtersSummary);
    const buffer = await wb.xlsx.writeBuffer();
    return {
      buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `leave-report-${year}.xlsx`,
    };
  }

  const buffer = await exportEngine.buildPdf(branding, 'leave', rows, filtersSummary, generatedBy);
  return { buffer, contentType: 'application/pdf', filename: `leave-report-${year}.pdf` };
}

async function getActiveLeaveTypes(user) {
  const dbName = user.db_name || user.tenantDb;
  const result = await leaveSettingsService.getAllLeaveTypes(dbName);
  return { leaveTypes: result.leaveTypes.filter(t => t.isActive) };
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

  // 4. Calculate total leave days authoritatively on the server, excluding
  //    weekends and public holidays. The client-supplied totalDays is only an
  //    on-screen estimate — it is NOT trusted here, so it cannot be tampered
  //    with to under-deduct the balance.
  const totalDays = await calcWorkingDays(pool, fromDate, toDate);
  if (totalDays <= 0) {
    throw ApiError.badRequest(
      'The selected date range contains no working days (only weekends/holidays).'
    );
  }

  // 5. Overlap check — no two active requests for same employee on same dates
  const overlap = await repo.findOverlappingRequest(pool, data.employeeId, fromDate, toDate);
  if (overlap) {
    throw ApiError.conflict(
      `Employee already has a ${overlap.status.toLowerCase()} leave request ` +
      `(${overlap.leave_type}) overlapping these dates (${overlap.from_date} – ${overlap.to_date})`
    );
  }

  // Notice Period Check — measured in BUSINESS days (weekends + public holidays excluded),
  // using the same working-day calendar (calcWorkingDays) as the leave-day calculation. The
  // notice given = working days from today up to the day BEFORE the leave starts.
  if (leaveTypeCfg.notice_period_required > 0) {
    const todayStr = new Date().toISOString().slice(0, 10);
    let noticeDays = 0;
    if (fromDate > todayStr) {
      const db = new Date(`${fromDate}T12:00:00Z`);
      db.setUTCDate(db.getUTCDate() - 1);
      const dayBeforeStr = db.toISOString().slice(0, 10);
      noticeDays = await calcWorkingDays(pool, todayStr, dayBeforeStr);
    }
    if (noticeDays < leaveTypeCfg.notice_period_required) {
      throw ApiError.badRequest(
        `"${leaveTypeCfg.name}" requires at least ${leaveTypeCfg.notice_period_required} working day(s) of notice. Please select a later date.`
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
    // Days already reserved by the employee's OTHER not-yet-rejected Pending requests of the
    // same type/year. Only Approved days land in balance.used, so without subtracting these an
    // employee could stack several pending requests that together blow past their entitlement.
    const pendingDays = await repo.sumPendingDaysForType(
      pool, data.employeeId, leaveTypeCfg.name, year
    );
    const remaining = (balance.total_allocated + balance.carry_forward) - balance.used - pendingDays;
    if (remaining < totalDays) {
      throw ApiError.badRequest(
        `Insufficient ${leaveTypeCfg.name} balance. ` +
        `Requested: ${totalDays} day(s), Available: ${remaining} day(s)` +
        (pendingDays > 0 ? ` (${pendingDays} day(s) already reserved by pending requests).` : '.')
      );
    }
  }

  // 8. Determine initial status — auto_approval skips Pending;
  //    if the employee has no reporting manager, skip directly to Dept Approval stage.
  const autoApprove = Boolean(leaveTypeCfg.auto_approval);
  let initialStatus = 'Pending Manager Approval';
  if (data.isDraft) {
    initialStatus = 'Draft';
  } else if (autoApprove) {
    initialStatus = 'Approved';
  } else if (!emp.reporting_manager_id) {
    // Escalation: no manager → Department Head is first approver.
    initialStatus = 'Pending Dept Approval';
  }

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
      // Same pending-aware math as the step-7 pre-check, but authoritative under the row lock.
      // Exclude the request we just inserted (it was created Approved, so it's already excluded
      // by status, but pass its id to be explicit/future-proof).
      const pendingDays = await repo.sumPendingDaysForType(
        client, data.employeeId, leaveTypeCfg.name, year, request.id
      );
      const remaining = (balance.total_allocated + balance.carry_forward) - balance.used - pendingDays;
      if (remaining < totalDays) {
        throw ApiError.badRequest(
          `Insufficient ${leaveTypeCfg.name} balance. ` +
          `Requested: ${totalDays} day(s), Available: ${remaining} day(s)` +
          (pendingDays > 0 ? ` (${pendingDays} day(s) already reserved by pending requests).` : '.')
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

  // Audit: record the leave request creation (best-effort, post-commit).
  await workflowAudit.log(auditTenant(user), {
    module: 'leave',
    action: 'create',
    entityType: 'leave_request',
    entityId: request.id,
    ...auditActor(user, auth),
    detail: {
      leaveType: leaveTypeCfg.name,
      totalDays,
      status: initialStatus,
      fromDate,
      toDate,
      autoApproved: autoApprove,
    },
  });

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
    }).catch(err => logger.error('[leave] failed to notify manager', { err: err.message }));
  } else if (initialStatus === 'Approved') {
    await sendSystemNotification(user, {
      employeeId: data.employeeId,
      title: 'Leave Auto-Approved',
      message: `Your request for ${totalDays} day(s) of ${leaveTypeCfg.name} has been auto-approved.`,
      type: 'leave_approved',
      entityType: 'leave',
      entityId: request.id,
      redirectUrl: '/attendance'
    }).catch(err => logger.error('[leave] failed to notify employee', { err: err.message }));
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

// Roles permitted to give the FINAL (HR) approval.
const HR_ROLES = new Set(['admin', 'superadmin', 'hr_admin', 'hr_executive', 'hr']);
// HR-level (final) approval authority. An explicit HR/admin role qualifies, but so
// does a tenant admin or anyone with an organisation-wide (ALL) data scope — those
// users approve org-wide and already hold leave.approve here. Mirrors attendance's
// hasHrApprovalScope so leave doesn't reject full-scope approvers by role string alone.
function isHrActor(user, auth) {
  if (auth?.isTenantAdmin || auth?.scope === 'ALL') return true;
  return HR_ROLES.has(String(user?.role || '').toLowerCase());
}

// A "broad" approver acts by DATA SCOPE (department-wide or org-wide) and so is NOT restricted to
// direct reports at the manager stage. Narrow approvers (TEAM/SELF scope) must be the actual
// reporting manager. Keyed on SCOPE/capability — not a hardcoded role string — so a custom
// approver role is handled by its scope. The old `user.role === 'manager'` check let ANY role
// that wasn't literally 'manager' bypass the direct-report guard entirely.
function hasBroadApprovalScope(user, auth) {
  return isHrActor(user, auth)              // admin / HR / tenant-admin / ALL scope
    || auth?.scope === 'DEPARTMENT'
    || auth?.scope === 'DEPT_MANAGER';
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
    if (isOwnRequest) {
      throw ApiError.forbidden('You cannot approve or reject your own leave request');
    }
  } else if (!isOwnRequest && !hasPermission(auth, P.LEAVE_APPROVE)) {
    throw ApiError.forbidden('You can only manage your own leave requests');
  }

  let newStatus;
  let stage; // 'manager' | 'dept' | 'hr' | undefined

  if (action === 'submit') {
    if (request.status !== 'Draft') {
      throw ApiError.badRequest(`Cannot submit a request with status "${request.status}"`);
    }
    // Escalation on submit — re-check manager assignment at processing time too.
    newStatus = emp.reporting_manager_id
      ? 'Pending Manager Approval'
      : 'Pending Dept Approval';

  } else if (action === 'approve') {
    if (request.status === 'Pending Manager Approval') {
      // Stage 1 — Reporting Manager. Narrow-scope approvers may only approve their OWN direct
      // reports; department/org-scoped approvers act by scope (already gated by data-scope access).
      if (
        !hasBroadApprovalScope(user, auth)
        && Number(request.reporting_manager_id) !== Number(user.employeeId || user.id)
      ) {
        throw ApiError.forbidden('You can only approve requests for your direct reports.');
      }
      newStatus = 'Pending HR Approval';
      stage = 'manager';
    } else if (request.status === 'Pending Dept Approval') {
      // Stage 1b — Department Head (used when the employee has no reporting
      // manager, so the manager stage is skipped). Requires leave-approval
      // permission so an employee cannot self-approve at this stage.
      if (!hasPermission(auth, P.LEAVE_APPROVE)) {
        throw ApiError.forbidden('Department approval requires leave-approval permission');
      }
      newStatus = 'Pending HR Approval';
      stage = 'department';
    } else if (request.status === 'Pending HR Approval') {
      // Stage 2 — HR final approval. HR/admin role, tenant admin, or ALL scope.
      if (!isHrActor(user, auth)) {
        throw ApiError.forbidden('Final approval requires HR/admin role or organisation-wide scope');
      }
      newStatus = 'Approved';
      stage = 'hr';
    } else {
      throw ApiError.badRequest(`Cannot approve a request with status "${request.status}"`);
    }

  } else if (action === 'reject') {
    if (request.status === 'Pending Manager Approval') {
      if (
        !hasBroadApprovalScope(user, auth)
        && Number(request.reporting_manager_id) !== Number(user.employeeId || user.id)
      ) {
        throw ApiError.forbidden('You can only reject requests for your direct reports.');
      }
      newStatus = 'Rejected by Manager';
    } else if (request.status === 'Pending Dept Approval') {
      if (!hasPermission(auth, P.LEAVE_APPROVE)) {
        throw ApiError.forbidden('Department rejection requires leave-approval permission');
      }
      newStatus = 'Rejected by Dept';
    } else if (request.status === 'Pending HR Approval') {
      if (!isHrActor(user, auth)) {
        throw ApiError.forbidden('Final rejection requires HR/admin role or organisation-wide scope');
      }
      newStatus = 'Rejected by HR';
    } else {
      throw ApiError.badRequest(`Cannot reject a request with status "${request.status}"`);
    }

  } else { // cancel
    if (!['Pending Manager Approval', 'Pending Dept Approval', 'Pending HR Approval', 'Approved', 'Draft'].includes(request.status)) {
      throw ApiError.badRequest(`Cannot cancel a request with status "${request.status}"`);
    }
    newStatus = 'Cancelled';
  }

  // Transaction: update status and balance atomically.
  const client = await pool.connect();
  let updated;
  try {
    await client.query('BEGIN');

    updated = await repo.updateRequestStatus(client, id, {
      status:          newStatus,
      stage,
      actorId:         user.id,
      rejectionReason: reason || null,
      remarks:         reason || null,
    });

    // Balance: only the FINAL HR approval deducts; cancelling an Approved leave restores it.
    const leaveTypeCfg = await repo.findActiveLeaveType(client, request.leave_type);
    const isUnpaid     = leaveTypeCfg?.paid_or_unpaid === 'Unpaid';

    if (!isUnpaid) {
      const year       = new Date(request.from_date).getFullYear();
      const annualDays = leaveTypeCfg?.annual_entitlement_days ?? 0;

      if (newStatus === 'Approved') {
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
        // Reverse the deduction in the SAME year it was made (ledger-correct).
        await repo.lockBalanceForUpdate(
          client, request.employee_id, request.leave_type, year, annualDays
        );
        await repo.incrementUsed(client, request.employee_id, request.leave_type, year, -request.total_days);
        // Rollover boundary: if that year is already closed (carry-forward has rolled it into a
        // later year), the freed days are stranded in a stale year — incrementUsed can't push a
        // current-year balance below 0. Recompute the carry chain for this employee+type so the
        // restored remaining propagates into the active year, capped by max_carry_forward.
        const currentYear = new Date().getFullYear();
        if (year < currentYear) {
          await carryForward.reconcileEmployeeCarryForward(
            client, request.employee_id, request.leave_type, year, currentYear
          );
        }
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Audit: record the state transition (approve / reject / cancel / submit). The action name
  // is logged verbatim so approvals and rejections are distinguishable. Best-effort, post-commit.
  await workflowAudit.log(auditTenant(user), {
    module: 'leave',
    action,
    entityType: 'leave_request',
    entityId: Number(id),
    ...auditActor(user, auth),
    detail: {
      fromStatus: request.status,
      toStatus: newStatus,
      stage: stage || null,
      reason: reason || null,
      leaveType: request.leave_type,
      totalDays: request.total_days,
    },
  });

  // Notifications (outside transaction).
  if (action === 'submit') {
    await sendSystemNotification(user, {
      forAdmin: true,
      title: 'New Leave Request',
      message: `A draft leave request for ${request.leave_type} (${request.total_days} days) has been submitted.`,
      type: 'leave_request', entityType: 'leave', entityId: request.id,
      redirectUrl: '/admin/attendance/dashboard'
    }).catch(err => logger.error('[leave] failed to notify admin of draft submission', { err: err.message }));

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
      }).catch(err => logger.error('[leave] failed to notify admin of pending HR approval', { err: err.message }));
    } else if (newStatus === 'Approved') {
      await sendSystemNotification(user, {
        employeeId: request.employee_id,
        title: 'Leave Approved',
        message: `Your leave request for ${request.leave_type} (${request.total_days} days) has been fully approved!`,
        type: 'leave_approved', entityType: 'leave', entityId: request.id,
        redirectUrl: '/attendance'
      }).catch(err => logger.error('[leave] failed to notify employee of approval', { err: err.message }));
    }
  } else if (action === 'reject') {
    await sendSystemNotification(user, {
      employeeId: request.employee_id,
      title: 'Leave Rejected',
      message: `Your leave request for ${request.leave_type} was rejected. Reason: ${reason || 'Not provided'}`,
      type: 'leave_rejected', entityType: 'leave', entityId: request.id,
      redirectUrl: '/attendance'
    }).catch(err => logger.error('[leave] failed to notify employee of rejection', { err: err.message }));
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
  exportLeave,
  getActiveLeaveTypes,
  applyLeave,
  processLeave,
  listBalances,
  runCarryForward,
};
