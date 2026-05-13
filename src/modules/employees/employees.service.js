"use strict";

const { getTenantPool } = require("../../config/db");

const bcrypt = require("bcryptjs");

const ApiError = require("../../utils/ApiError");
const logger = require("../../utils/logger");
const { sanitizeEmployeePayload } = require("../../utils/sanitize");
const { runTenantMigrations } = require("../tenant/tenant.service");
const repo = require("./employees.repository");
const { sendEmployeeWelcomeEmail } = require("./employees.mailer");

const BCRYPT_ROUNDS = 12;

function omitPassword(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const o = { ...obj };
  delete o.password_hash;
  delete o.passwordHash;
  return o;
}

const _migrationCache = new Map();
async function ensureMigrated(dbName) {
  if (_migrationCache.has(dbName)) return _migrationCache.get(dbName);
  const p = runTenantMigrations(dbName).catch((err) => {
    _migrationCache.delete(dbName);
    throw ApiError.internal("Database setup failed.");
  });
  _migrationCache.set(dbName, p);
  return p;
}

function resolvePool(user) {
  if (!user?.db_name)
    throw ApiError.unauthorized("Tenant database not found in token");
  return getTenantPool(user.db_name);
}

function fmtDateFilter(v) {
  if (v === undefined || v === null || v === "") return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim().slice(0, 10);
}

async function listEmployees(user, query = {}) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, parseInt(query.limit, 10) || 10);
  const offset = (page - 1) * limit;

  const filters = {
    search: query.search || "",
    department: query.department || "",
    status: query.status || "",
    workMode: query.workMode || "",
    jobTitle: query.jobTitle || "",
    workLocation: query.workLocation || "",
    joinDateFrom: fmtDateFilter(query.joinDateFrom),
    joinDateTo: fmtDateFilter(query.joinDateTo),
    sortBy: query.sortBy || "created_at",
    sortOrder: query.sortOrder || "desc",
    limit,
    offset,
  };

  const [records, total, options] = await Promise.all([
    repo.findAll(pool, filters),
    repo.countAll(pool, filters),
    repo.getFilterOptions(pool),
  ]);

  return {
    records,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
    filters: {
      applied: {
        page,
        limit,
        search: filters.search,
        department: filters.department,
        status: filters.status,
        workMode: filters.workMode,
        jobTitle: filters.jobTitle,
        workLocation: filters.workLocation,
        joinDateFrom: filters.joinDateFrom || null,
        joinDateTo: filters.joinDateTo || null,
        sortBy: filters.sortBy,
        sortOrder: String(filters.sortOrder).toLowerCase(),
      },
      options,
    },
  };
}

/** Full employee id / name list for dropdowns (no pagination, capped in repository). */
async function listEmployeesDropdown(user, query = {}) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  const employees = await repo.findAllForDropdown(pool, {
    search: query.search || "",
  });
  return { employees };
}

async function listEmployeesForExport(user, query = {}) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  return repo.findAllForExport(pool, {
    search: query.search || "",
    department: query.department || "",
    status: query.status || "",
    workMode: query.workMode || "",
    jobTitle: query.jobTitle || "",
    workLocation: query.workLocation || "",
    joinDateFrom: fmtDateFilter(query.joinDateFrom),
    joinDateTo: fmtDateFilter(query.joinDateTo),
    sortBy: query.sortBy || "created_at",
    sortOrder: query.sortOrder || "desc",
  });
}

async function getEmployee(user, id) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  const emp = await repo.findById(pool, id);
  if (!emp) throw ApiError.notFound("Employee not found");
  return omitPassword(emp);
}

async function createEmployee(user, data) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);

  const welcomePlain =
    data.portalPassword && String(data.portalPassword).trim()
      ? String(data.portalPassword).trim()
      : "";

  const sanitized = sanitizeEmployeePayload({ ...data });

  if (await repo.findByEmpId(pool, sanitized.empId)) {
    throw ApiError.conflict(`Employee ID "${sanitized.empId}" already exists`);
  }
  if (sanitized.workEmail && (await repo.findByWorkEmail(pool, sanitized.workEmail))) {
    throw ApiError.conflict(`Work email "${sanitized.workEmail}" already in use`);
  }

  if (sanitized.reportingManagerEmpId) {
    const mgr = await repo.findByEmpId(pool, sanitized.reportingManagerEmpId);
    sanitized.reportingManagerId = mgr ? mgr.id : null;
  }

  const payload = { ...sanitized };
  if (data.profileImageBase64 && String(data.profileImageBase64).startsWith("data:image")) {
    payload.profileImageUrl = String(data.profileImageBase64).slice(0, 800000);
  }
  delete payload.profileImageBase64;
  payload.portalEnabled = Boolean(sanitized.portalEnabled);
  payload.rbacRoleId =
    sanitized.rbacRoleId != null && `${sanitized.rbacRoleId}`.trim() !== ""
      ? parseInt(String(sanitized.rbacRoleId), 10)
      : null;
  if (!Number.isInteger(payload.rbacRoleId) || payload.rbacRoleId <= 0) {
    payload.rbacRoleId = null;
  }

  if (sanitized.portalPassword && String(sanitized.portalPassword).trim()) {
    payload.passwordHash = await bcrypt.hash(String(sanitized.portalPassword), BCRYPT_ROUNDS);
    delete payload.portalPassword;
  } else if (payload.portalEnabled === false) {
    payload.passwordHash = null;
  }

  delete payload.portalPassword;

  payload.familyMembers = Array.isArray(payload.familyMembers)
    ? payload.familyMembers
    : [];
  payload.education = Array.isArray(payload.education) ? payload.education : [];
  payload.workExperience = Array.isArray(payload.workExperience)
    ? payload.workExperience
    : [];
  payload.secondaryContact =
    payload.secondaryContact &&
    typeof payload.secondaryContact === "object" &&
    !Array.isArray(payload.secondaryContact)
      ? payload.secondaryContact
      : {};
  payload.isCurrentlyWorking = Boolean(payload.isCurrentlyWorking);

  const created = await repo.insert(pool, { ...payload, createdBy: user.id });
  const employeeId = created?.id;
  if (employeeId) {
    await repo.syncEmployeeSections(pool, employeeId, data);
    const full = await repo.findById(pool, employeeId);
    if (full) {
      if (welcomePlain && full.work_email) {
        try {
          await sendEmployeeWelcomeEmail({
            to: full.work_email,
            firstName: full.first_name || full.full_name || "",
            empId: full.emp_id || "",
            department: full.department || "",
            jobTitle: full.job_title || "",
            joinDate: full.join_date || "",
            username: full.username || full.work_email,
            plainPassword: welcomePlain,
          });
        } catch (mailErr) {
          logger.warn(`Welcome email skipped: ${mailErr.message}`);
        }
      }
      return omitPassword(full);
    }
  }
  return omitPassword(created);
}

async function updateEmployee(user, id, data) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);

  const existing = await repo.findById(pool, id);
  if (!existing) throw ApiError.notFound("Employee not found");

  const sanitized = sanitizeEmployeePayload({ ...data });

  if (sanitized.workEmail && sanitized.workEmail !== existing.work_email) {
    if (await repo.findByWorkEmail(pool, sanitized.workEmail, id)) {
      throw ApiError.conflict(`Work email "${sanitized.workEmail}" already in use`);
    }
  }

  if (sanitized.reportingManagerEmpId) {
    const mgr = await repo.findByEmpId(pool, sanitized.reportingManagerEmpId);
    sanitized.reportingManagerId = mgr ? mgr.id : null;
  }

  const patch = { ...sanitized };
  if (data.profileImageBase64 && String(data.profileImageBase64).startsWith("data:image")) {
    patch.profileImageUrl = String(data.profileImageBase64).slice(0, 800000);
  }
  delete patch.profileImageBase64;

  if (Object.prototype.hasOwnProperty.call(data, "portalEnabled")) {
    patch.portalEnabled = Boolean(data.portalEnabled);
    if (!patch.portalEnabled) {
      patch.passwordHash = null;
    }
  }

  if (data.rbacRoleId !== undefined) {
    patch.rbacRoleId =
      data.rbacRoleId != null && `${data.rbacRoleId}`.trim() !== ""
        ? parseInt(String(data.rbacRoleId), 10)
        : null;
    if (!Number.isInteger(patch.rbacRoleId) || patch.rbacRoleId <= 0) {
      patch.rbacRoleId = null;
    }
  }

  if (data.portalPassword && String(data.portalPassword).trim()) {
    patch.passwordHash = await bcrypt.hash(String(data.portalPassword), BCRYPT_ROUNDS);
  }
  delete patch.portalPassword;

  if (Object.prototype.hasOwnProperty.call(patch, "familyMembers")) {
    patch.familyMembers = Array.isArray(patch.familyMembers)
      ? patch.familyMembers
      : [];
  }
  if (Object.prototype.hasOwnProperty.call(patch, "education")) {
    patch.education = Array.isArray(patch.education) ? patch.education : [];
  }
  if (Object.prototype.hasOwnProperty.call(patch, "workExperience")) {
    patch.workExperience = Array.isArray(patch.workExperience)
      ? patch.workExperience
      : [];
  }
  if (Object.prototype.hasOwnProperty.call(patch, "secondaryContact")) {
    patch.secondaryContact =
      patch.secondaryContact &&
      typeof patch.secondaryContact === "object" &&
      !Array.isArray(patch.secondaryContact)
        ? patch.secondaryContact
        : {};
  }
  if (Object.prototype.hasOwnProperty.call(patch, "isCurrentlyWorking")) {
    patch.isCurrentlyWorking = Boolean(patch.isCurrentlyWorking);
  }

  const updated = await repo.update(pool, id, { ...patch, updatedBy: user.id });
  if (!updated) throw ApiError.notFound("Employee not found");
  await repo.syncEmployeeSections(pool, id, data);
  const full = await repo.findById(pool, id);
  return omitPassword(full || updated);
}

async function deleteEmployee(user, id) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  const existing = await repo.findById(pool, id);
  if (!existing) throw ApiError.notFound("Employee not found");
  const deleted = await repo.softDelete(pool, id);
  if (!deleted) throw ApiError.notFound("Employee not found");
}

async function getFilterOptions(user) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  return repo.getFilterOptions(pool);
}

async function getStats(user) {
  const pool = resolvePool(user);
  await ensureMigrated(user.db_name);
  const row = await repo.getStats(pool);
  return {
    total: row.total,
    active: row.active,
    onLeave: row.on_leave,
    probation: row.probation,
    newThisMonth: row.new_this_month,
    notice: row.notice,
    departments: row.departments,
  };
}

module.exports = {
  listEmployees,
  listEmployeesDropdown,
  listEmployeesForExport,
  getEmployee,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  getFilterOptions,
  getStats,
};
