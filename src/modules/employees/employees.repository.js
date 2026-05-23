"use strict";

const { applyEmployeeListScope } = require("../../utils/applyDataScope");
const { formatEmpId } = require("../../utils/empIdFormat");

/**
 * Resolve departments.id from departmentId and/or department name string.
 */
async function resolveDepartmentId(pool, { departmentId, departmentName } = {}) {
  const rawId = departmentId ?? null;
  if (rawId != null && String(rawId).trim() !== "") {
    const id = parseInt(String(rawId), 10);
    if (Number.isInteger(id) && id > 0) {
      const { rows } = await pool.query(
        `SELECT id, name FROM departments WHERE id = $1 AND is_active = true LIMIT 1`,
        [id],
      );
      if (rows[0]) {
        return { id: rows[0].id, name: rows[0].name };
      }
    }
  }

  const name = String(departmentName || "").trim();
  if (!name) return { id: null, name: null };

  const { rows } = await pool.query(
    `SELECT id, name FROM departments
     WHERE is_active = true
       AND (
         LOWER(TRIM(name)) = LOWER(TRIM($1))
         OR LOWER(TRIM(COALESCE(code, ''))) = LOWER(TRIM($1))
         OR id::text = $1
       )
     LIMIT 1`,
    [name],
  );
  if (rows[0]) {
    return { id: rows[0].id, name: rows[0].name };
  }
  return { id: null, name };
}

function buildEmployeeListWhere({
  search = "",
  department = "",
  status = "",
  workMode = "",
  jobTitle = "",
  workLocation = "",
  joinDateFrom = "",
  joinDateTo = "",
  excludeOnboarding = false,
  onboardingOnly = false,
} = {}) {
  const conditions = ["e.deleted_at IS NULL"];
  const params = [];

  if (onboardingOnly) {
    conditions.push(`e.employment_status = 'Onboarding'`);
  } else if (excludeOnboarding && !status) {
    conditions.push(`e.employment_status <> 'Onboarding'`);
  }

  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    conditions.push(
      `(e.full_name ILIKE $${n} OR e.emp_id ILIKE $${n} OR e.work_email ILIKE $${n} OR e.job_title ILIKE $${n} OR COALESCE(e.phone_number::text, '') ILIKE $${n})`,
    );
  }
  if (department) {
    params.push(`%${department}%`);
    conditions.push(`e.department ILIKE $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`e.employment_status = $${params.length}`);
  }
  if (workMode) {
    params.push(workMode);
    conditions.push(`e.work_mode = $${params.length}`);
  }
  if (jobTitle) {
    params.push(jobTitle);
    conditions.push(`e.job_title = $${params.length}`);
  }
  if (workLocation) {
    params.push(workLocation);
    conditions.push(`e.work_location = $${params.length}`);
  }
  if (joinDateFrom) {
    params.push(joinDateFrom);
    conditions.push(`e.join_date >= $${params.length}`);
  }
  if (joinDateTo) {
    params.push(joinDateTo);
    conditions.push(`e.join_date <= $${params.length}`);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
  return { where, params };
}

const ORDER_MAP = {
  created_at: "e.created_at",
  join_date: "e.join_date",
  full_name: "e.full_name",
  employment_status: "e.employment_status",
  job_title: "e.job_title",
  work_email: "e.work_email",
  emp_id: "e.emp_id",
};

function listOrderClause(sortBy, sortOrder) {
  const col = ORDER_MAP[sortBy] || ORDER_MAP.created_at;
  const dir = String(sortOrder || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
  return `${col} ${dir}, e.id ASC`;
}

async function findAll(
  pool,
  {
    search = "",
    department = "",
    status = "",
    workMode = "",
    jobTitle = "",
    workLocation = "",
    joinDateFrom = "",
    joinDateTo = "",
    excludeOnboarding = false,
    onboardingOnly = false,
    sortBy = "created_at",
    sortOrder = "desc",
    limit = 20,
    offset = 0,
    auth = null,
  } = {},
) {
  let { where, params: baseParams } = buildEmployeeListWhere({
    search,
    department,
    status,
    workMode,
    jobTitle,
    workLocation,
    joinDateFrom,
    joinDateTo,
    excludeOnboarding,
    onboardingOnly,
  });
  if (auth) {
    ({ where, params: baseParams } = applyEmployeeListScope(auth, {
      where,
      params: baseParams,
    }));
  }
  const params = [...baseParams, limit, offset];
  const orderSql = listOrderClause(sortBy, sortOrder);

  const { rows } = await pool.query(
    `SELECT
       e.id, e.emp_id, e.full_name, e.first_name, e.last_name,
       e.work_email, e.personal_email, e.phone_number,
       e.job_title, e.department, e.employment_type, e.employment_status,
       e.work_location, e.work_mode, e.join_date, e.profile_image_url,
       e.nationality, e.gender,
       e.onboarding_step, e.onboarding_approval_status, e.onboarding_workflow_status,
       e.rbac_role_id,
       e.portal_enabled,
       e.salary,
       e.grade,
       rr.name AS rbac_role_name,
       m.full_name AS manager_name, m.emp_id AS manager_emp_id,
       TO_CHAR(e.created_at, 'DD/MM/YYYY') AS "createdAt",
       TO_CHAR(e.updated_at, 'DD/MM/YYYY') AS "updatedAt"
     FROM employees e
     LEFT JOIN rbac_roles rr ON rr.id = e.rbac_role_id
     LEFT JOIN employees m ON m.id = e.reporting_manager_id AND m.deleted_at IS NULL
     ${where}
     ORDER BY ${orderSql}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}

const DROPDOWN_MAX = 10000;

/** Minimal columns for selects / modals — full list, no pagination (capped). */
async function findAllForDropdown(pool, { search = "", auth = null } = {}) {
  const conditions = ["e.deleted_at IS NULL", `e.employment_status <> 'Onboarding'`];
  let params = [];
  const q = String(search || "").trim();
  if (q) {
    params.push(`%${q}%`);
    const n = params.length;
    conditions.push(`(e.full_name ILIKE $${n} OR e.emp_id ILIKE $${n})`);
  }
  let where = `WHERE ${conditions.join(" AND ")}`;
  if (auth) {
    ({ where, params } = applyEmployeeListScope(auth, { where, params }));
  }
  params.push(DROPDOWN_MAX);
  const limIdx = params.length;
  const { rows } = await pool.query(
    `SELECT e.id, e.emp_id, e.full_name
     FROM employees e
     ${where}
     ORDER BY e.full_name ASC NULLS LAST, e.id ASC
     LIMIT $${limIdx}`,
    params,
  );
  return rows;
}

async function countAll(
  pool,
  {
    search = "",
    department = "",
    status = "",
    workMode = "",
    jobTitle = "",
    workLocation = "",
    joinDateFrom = "",
    joinDateTo = "",
    excludeOnboarding = false,
    onboardingOnly = false,
    auth = null,
  } = {},
) {
  let { where, params } = buildEmployeeListWhere({
    search,
    department,
    status,
    workMode,
    jobTitle,
    workLocation,
    joinDateFrom,
    joinDateTo,
    excludeOnboarding,
    onboardingOnly,
  });
  if (auth) {
    ({ where, params } = applyEmployeeListScope(auth, { where, params }));
  }
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM employees e ${where}`,
    params,
  );
  return rows[0].total;
}

async function findAllForExport(
  pool,
  {
    search = "",
    department = "",
    status = "",
    workMode = "",
    jobTitle = "",
    workLocation = "",
    joinDateFrom = "",
    joinDateTo = "",
    excludeOnboarding = false,
    onboardingOnly = false,
    sortBy = "created_at",
    sortOrder = "desc",
    auth = null,
  } = {},
) {
  let { where, params: baseParams } = buildEmployeeListWhere({
    search,
    department,
    status,
    workMode,
    jobTitle,
    workLocation,
    joinDateFrom,
    joinDateTo,
    excludeOnboarding,
    onboardingOnly,
  });
  if (auth) {
    ({ where, params: baseParams } = applyEmployeeListScope(auth, {
      where,
      params: baseParams,
    }));
  }
  const orderSql = listOrderClause(sortBy, sortOrder);
  const params = [...baseParams];
  const { rows } = await pool.query(
    `SELECT
       e.id, e.emp_id, e.full_name, e.first_name, e.last_name,
       e.work_email, e.personal_email, e.phone_number,
       e.job_title, e.department, e.employment_type, e.employment_status,
       e.work_location, e.work_mode,
       e.portal_enabled, e.salary, e.grade,
       m.full_name AS manager_name, m.emp_id AS manager_emp_id,
       TO_CHAR(e.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
       TO_CHAR(e.join_date, 'YYYY-MM-DD') AS join_date,
       e.gender, e.nationality, e.marital_status, e.religion,
       e.home_address, e.bank_name, e.bank_account_no, e.ifsc_code, e.branch_address,
       e.passport_number, TO_CHAR(e.passport_expiry, 'YYYY-MM-DD') AS passport_expiry,
       e.emirates_id_number, TO_CHAR(e.emirates_id_expiry, 'YYYY-MM-DD') AS emirates_id_expiry,
       e.visa_type, TO_CHAR(e.visa_expiry_date, 'YYYY-MM-DD') AS visa_expiry_date,
       e.created_at
     FROM employees e
     LEFT JOIN employees m ON m.id = e.reporting_manager_id AND m.deleted_at IS NULL
     ${where}
     ORDER BY ${orderSql}
     LIMIT 50000`,
    params,
  );
  return rows;
}

async function findById(pool, id) {
  const { rows } = await pool.query(
    `SELECT
       e.*,
       rr.name AS rbac_role_name,
       m.full_name AS manager_name, m.emp_id AS manager_emp_id,
       TO_CHAR(e.date_of_birth,      'YYYY-MM-DD') AS date_of_birth,
       TO_CHAR(e.join_date,          'YYYY-MM-DD') AS join_date,
       TO_CHAR(e.probation_end_date, 'YYYY-MM-DD') AS probation_end_date,
       TO_CHAR(e.passport_expiry,    'YYYY-MM-DD') AS passport_expiry,
       TO_CHAR(e.emirates_id_expiry, 'YYYY-MM-DD') AS emirates_id_expiry,
       TO_CHAR(e.visa_expiry_date,   'YYYY-MM-DD') AS visa_expiry_date,
       TO_CHAR(e.created_at, 'DD/MM/YYYY') AS "createdAt",
       TO_CHAR(e.updated_at, 'DD/MM/YYYY') AS "updatedAt"
     FROM employees e
     LEFT JOIN rbac_roles rr ON rr.id = e.rbac_role_id
     LEFT JOIN employees m ON m.id = e.reporting_manager_id AND m.deleted_at IS NULL
     WHERE e.id = $1 AND e.deleted_at IS NULL`,
    [id],
  );
  const emp = rows[0] || null;
  if (!emp) return null;
  delete emp.password_hash;

  const sections = await getEmployeeSections(pool, id);
  return { ...emp, ...sections };
}

async function findByEmpId(pool, empId) {
  const { rows } = await pool.query(
    `SELECT id FROM employees WHERE emp_id = $1 AND deleted_at IS NULL`,
    [empId],
  );
  return rows[0] || null;
}

/** Next sequential emp_id: "EMP-1", "EMP-2", … */
async function getNextEmpId(pool) {
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(
       CASE
         WHEN TRIM(emp_id) ~ '^[0-9]+$' THEN TRIM(emp_id)::bigint
         WHEN TRIM(emp_id) ~ '[0-9]+' THEN (regexp_match(TRIM(emp_id), '([0-9]+)'))[1]::bigint
         ELSE NULL
       END
     ), 0) + 1 AS next_id
     FROM employees
     WHERE deleted_at IS NULL AND emp_id IS NOT NULL AND TRIM(emp_id) <> ''`,
  );
  return formatEmpId(rows[0]?.next_id ?? 1);
}

async function findByWorkEmail(pool, email, excludeId = null) {
  const params = [email];
  const exclude = excludeId ? ` AND id <> $2` : "";
  if (excludeId) params.push(excludeId);
  const { rows } = await pool.query(
    `SELECT id FROM employees WHERE work_email = $1 AND deleted_at IS NULL${exclude}`,
    params,
  );
  return rows[0] || null;
}

async function insert(pool, data) {
  const {
    empId,
    fullName,
    firstName,
    lastName,
    dateOfBirth,
    gender,
    nationality,
    personalEmail,
    phoneNumber,
    emergencyContactName,
    emergencyContactPhone,
    homeAddress,
    jobTitle,
    department,
    departmentId,
    employmentType,
    workLocation,
    workMode,
    reportingManagerId,
    joinDate,
    probationEndDate,
    workEmail,
    salary,
    employmentStatus,
    grade,
    costCenter,
    maritalStatus,
    dependents,
    passportNumber,
    passportExpiry,
    emiratesIdNumber,
    emiratesIdExpiry,
    visaType,
    visaExpiryDate,
    sponsoringEntity,
    countryOfResidence,
    profileImageUrl,
    bio,
    createdBy,
    careerHistory,
    awardsSummary,
    promotionHistory,
    rbacRoleId,
    portalEnabled,
    passwordHash,
    username,
    religion,
    employmentSpouse,
    bankName,
    bankAccountNo,
    ifscCode,
    branchAddress,
    familyMembers,
    secondaryContact,
    education,
    workExperience,
    isCurrentlyWorking,
  } = data;

  const fm = Array.isArray(familyMembers) ? familyMembers : [];
  const sc =
    secondaryContact && typeof secondaryContact === "object" && !Array.isArray(secondaryContact)
      ? secondaryContact
      : {};
  const edu = Array.isArray(education) ? education : [];
  const wx = Array.isArray(workExperience) ? workExperience : [];

  const deptResolved = await resolveDepartmentId(pool, {
    departmentId,
    departmentName: department,
  });
  const departmentIdValue = deptResolved.id;
  const departmentLabel =
    deptResolved.name || (department != null ? String(department).trim() : null) || null;

  const { rows } = await pool.query(
    `INSERT INTO employees (
       emp_id, full_name, first_name, last_name, date_of_birth, gender, nationality,
       personal_email, phone_number, emergency_contact_name, emergency_contact_phone,
       home_address, job_title, department, department_id, employment_type, work_location, work_mode,
       reporting_manager_id, join_date, probation_end_date, work_email, salary,
       employment_status, grade, cost_center, marital_status, dependents,
       passport_number, passport_expiry, emirates_id_number, emirates_id_expiry,
       visa_type, visa_expiry_date, sponsoring_entity, country_of_residence,
       profile_image_url, bio, created_by, updated_by,
       career_history, awards_summary, promotion_history,
       rbac_role_id, portal_enabled, password_hash,
       username, religion, employment_spouse, bank_name, bank_account_no, ifsc_code, branch_address,
       family_members, secondary_contact, education, work_experience, is_currently_working
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
       $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,
       $40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,$57,$58
     )
     RETURNING id, emp_id, full_name, job_title, department, employment_status,
               work_email, work_location, work_mode,
               rbac_role_id,
               TO_CHAR(join_date, 'YYYY-MM-DD') AS join_date,
               TO_CHAR(created_at, 'DD/MM/YYYY') AS "createdAt"`,
    [
      empId,
      fullName,
      firstName || null,
      lastName || null, // $1–$4
      dateOfBirth || null,
      gender || null,
      nationality || null, // $5–$7
      personalEmail || null,
      phoneNumber || null, // $8–$9
      emergencyContactName || null,
      emergencyContactPhone || null, // $10–$11
      homeAddress || null,
      jobTitle,
      departmentLabel,
      departmentIdValue,
      employmentType, // $12–$16
      workLocation || null,
      workMode || null, // $16–$17
      reportingManagerId || null,
      joinDate,
      probationEndDate || null, // $18–$20
      workEmail,
      salary || null,
      employmentStatus || "Active", // $21–$23
      grade || null,
      costCenter || null,
      maritalStatus || null, // $24–$26
      dependents || null, // $27
      passportNumber || null,
      passportExpiry || null, // $28–$29
      emiratesIdNumber || null,
      emiratesIdExpiry || null, // $30–$31
      visaType || null,
      visaExpiryDate || null, // $32–$33
      sponsoringEntity || null,
      countryOfResidence || null, // $34–$35
      profileImageUrl || null,
      bio || null, // $36–$37
      createdBy || null,
      createdBy || null, // $38–$39
      careerHistory || null,
      awardsSummary || null,
      promotionHistory || null, // $40–$42
      rbacRoleId ?? null,
      portalEnabled ?? false,
      passwordHash ?? null,
      username != null && String(username).trim() !== ""
        ? String(username).trim()
        : null,
      religion != null && String(religion).trim() !== ""
        ? String(religion).trim()
        : null,
      employmentSpouse != null && String(employmentSpouse).trim() !== ""
        ? String(employmentSpouse).trim()
        : null,
      bankName != null && String(bankName).trim() !== ""
        ? String(bankName).trim()
        : null,
      bankAccountNo != null && String(bankAccountNo).trim() !== ""
        ? String(bankAccountNo).trim()
        : null,
      ifscCode != null && String(ifscCode).trim() !== ""
        ? String(ifscCode).trim()
        : null,
      branchAddress != null && String(branchAddress).trim() !== ""
        ? String(branchAddress).trim()
        : null,
      JSON.stringify(fm),
      JSON.stringify(sc),
      JSON.stringify(edu),
      JSON.stringify(wx),
      Boolean(isCurrentlyWorking),
    ],
  );
  return rows[0];
}

async function update(pool, id, data) {
  if ("department" in data || "departmentId" in data) {
    const deptResolved = await resolveDepartmentId(pool, {
      departmentId: data.departmentId,
      departmentName: data.department,
    });
    if (deptResolved.name) data.department = deptResolved.name;
    data.departmentId = deptResolved.id;
  }

  const allowed = [
    "full_name",
    "first_name",
    "last_name",
    "date_of_birth",
    "gender",
    "nationality",
    "personal_email",
    "phone_number",
    "emergency_contact_name",
    "emergency_contact_phone",
    "home_address",
    "job_title",
    "department",
    "department_id",
    "employment_type",
    "work_location",
    "work_mode",
    "reporting_manager_id",
    "join_date",
    "probation_end_date",
    "work_email",
    "salary",
    "employment_status",
    "grade",
    "cost_center",
    "marital_status",
    "dependents",
    "passport_number",
    "passport_expiry",
    "emirates_id_number",
    "emirates_id_expiry",
    "visa_type",
    "visa_expiry_date",
    "sponsoring_entity",
    "country_of_residence",
    "profile_image_url",
    "bio",
    "updated_by",
    "career_history",
    "awards_summary",
    "promotion_history",
    "rbac_role_id",
    "portal_enabled",
    "password_hash",
    "username",
    "religion",
    "employment_spouse",
    "bank_name",
    "bank_account_no",
    "ifsc_code",
    "branch_address",
    "family_members",
    "secondary_contact",
    "education",
    "work_experience",
    "is_currently_working",
  ];

  const camelToSnake = {
    fullName: "full_name",
    firstName: "first_name",
    lastName: "last_name",
    dateOfBirth: "date_of_birth",
    gender: "gender",
    nationality: "nationality",
    personalEmail: "personal_email",
    phoneNumber: "phone_number",
    emergencyContactName: "emergency_contact_name",
    emergencyContactPhone: "emergency_contact_phone",
    homeAddress: "home_address",
    jobTitle: "job_title",
    department: "department",
    departmentId: "department_id",
    employmentType: "employment_type",
    workLocation: "work_location",
    workMode: "work_mode",
    reportingManagerId: "reporting_manager_id",
    joinDate: "join_date",
    probationEndDate: "probation_end_date",
    workEmail: "work_email",
    salary: "salary",
    employmentStatus: "employment_status",
    grade: "grade",
    costCenter: "cost_center",
    maritalStatus: "marital_status",
    dependents: "dependents",
    passportNumber: "passport_number",
    passportExpiry: "passport_expiry",
    emiratesIdNumber: "emirates_id_number",
    emiratesIdExpiry: "emirates_id_expiry",
    visaType: "visa_type",
    visaExpiryDate: "visa_expiry_date",
    sponsoringEntity: "sponsoring_entity",
    countryOfResidence: "country_of_residence",
    profileImageUrl: "profile_image_url",
    bio: "bio",
    updatedBy: "updated_by",
    careerHistory: "career_history",
    awardsSummary: "awards_summary",
    promotionHistory: "promotion_history",
    rbacRoleId: "rbac_role_id",
    portalEnabled: "portal_enabled",
    passwordHash: "password_hash",
    username: "username",
    religion: "religion",
    employmentSpouse: "employment_spouse",
    bankName: "bank_name",
    bankAccountNo: "bank_account_no",
    ifscCode: "ifsc_code",
    branchAddress: "branch_address",
    familyMembers: "family_members",
    secondaryContact: "secondary_contact",
    education: "education",
    workExperience: "work_experience",
    isCurrentlyWorking: "is_currently_working",
  };

  const fields = [];
  const params = [];

  for (const [key, col] of Object.entries(camelToSnake)) {
    if (key in data && allowed.includes(col)) {
      let val = data[key] ?? null;
      if (col === "family_members" || col === "education" || col === "work_experience") {
        val = Array.isArray(val) ? val : [];
        val = JSON.stringify(val);
      }
      if (col === "secondary_contact") {
        val =
          val && typeof val === "object" && !Array.isArray(val)
            ? val
            : {};
        val = JSON.stringify(val);
      }
      if (col === "is_currently_working") {
        val = Boolean(val);
      }
      params.push(val);
      fields.push(`${col} = $${params.length}`);
    }
  }

  if (!fields.length) return findById(pool, id);

  params.push(id);
  const { rows } = await pool.query(
    `UPDATE employees SET ${fields.join(", ")}
     WHERE id = $${params.length} AND deleted_at IS NULL
     RETURNING id, emp_id, full_name, job_title, department, employment_status,
               work_email, work_location, work_mode,
               TO_CHAR(join_date, 'YYYY-MM-DD') AS join_date,
               TO_CHAR(updated_at, 'DD/MM/YYYY') AS "updatedAt"`,
    params,
  );
  return rows[0] || null;
}

async function completeOnboardingActivation(pool, id, { passwordHash, username }) {
  const { rows } = await pool.query(
    `UPDATE employees SET
       employment_status = 'Active',
       portal_enabled = true,
       password_hash = $2,
       username = COALESCE(NULLIF(TRIM(username), ''), $3),
       onboarding_completed_at = NOW(),
       portal_invite_sent_at = NOW(),
       updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id, emp_id, full_name, first_name, work_email, username, job_title, department,
               employment_status, portal_enabled,
               TO_CHAR(join_date, 'YYYY-MM-DD') AS join_date,
               TO_CHAR(onboarding_completed_at, 'YYYY-MM-DD HH24:MI') AS onboarding_completed_at`,
    [id, passwordHash, username],
  );
  return rows[0] || null;
}

async function softDelete(pool, id) {
  const { rowCount } = await pool.query(
    `UPDATE employees SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return rowCount > 0;
}

async function getFilterOptions(pool) {
  const [deptTable, empDept, jobsDesig, jobsEmp, locs, modes, statuses] = await Promise.all([
    pool.query(
      `SELECT name FROM departments WHERE is_active = true ORDER BY name ASC`,
    ),
    pool.query(
      `SELECT DISTINCT department FROM employees WHERE deleted_at IS NULL AND department IS NOT NULL ORDER BY department`,
    ),
    pool.query(
      `SELECT DISTINCT name AS job_title FROM designations WHERE is_active = true ORDER BY name`,
    ),
    pool.query(
      `SELECT DISTINCT job_title FROM employees WHERE deleted_at IS NULL AND job_title IS NOT NULL ORDER BY job_title`,
    ),
    pool.query(
      `SELECT DISTINCT work_location FROM employees WHERE deleted_at IS NULL AND work_location IS NOT NULL ORDER BY work_location`,
    ),
    pool.query(
      `SELECT DISTINCT work_mode FROM employees WHERE deleted_at IS NULL AND work_mode IS NOT NULL ORDER BY work_mode`,
    ),
    pool.query(
      `SELECT DISTINCT employment_status FROM employees WHERE deleted_at IS NULL AND employment_status IS NOT NULL ORDER BY employment_status`,
    ),
  ]);

  const deptNames = new Set();
  for (const r of deptTable.rows) if (r.name) deptNames.add(r.name);
  for (const r of empDept.rows) if (r.department) deptNames.add(r.department);
  const departments = [...deptNames].sort((a, b) => a.localeCompare(b));

  const [deptRecordsRes, designationRowsRes] = await Promise.all([
    pool.query(
      `SELECT id, name FROM departments WHERE is_active = true ORDER BY name ASC`,
    ),
    pool.query(
      `SELECT ds.id, ds.name, ds.department_id,
              COALESCE(d.name, ds.department_name) AS department_name
       FROM designations ds
       LEFT JOIN departments d ON d.id = ds.department_id
       WHERE COALESCE(ds.is_active, true) = true
         AND LOWER(COALESCE(ds.status, 'active')) = 'active'
       ORDER BY d.name NULLS LAST, ds.name ASC`,
    ),
  ]);

  const jobSet = new Set();
  for (const r of jobsDesig.rows) if (r.job_title) jobSet.add(r.job_title);
  for (const r of jobsEmp.rows) if (r.job_title) jobSet.add(r.job_title);
  const jobTitles = [...jobSet].sort((a, b) => a.localeCompare(b));

  return {
    departments,
    departmentRecords: deptRecordsRes.rows,
    designations: designationRowsRes.rows,
    jobTitles,
    workLocations: locs.rows.map((r) => r.work_location),
    workModes: modes.rows.map((r) => r.work_mode),
    statuses: statuses.rows.map((r) => r.employment_status),
  };
}

async function getDesignationsForDepartment(pool, departmentName) {
  const dept = String(departmentName || "").trim();
  if (!dept) return [];

  const { rows } = await pool.query(
    `SELECT ds.id, ds.name, ds.department_id,
            COALESCE(d.name, ds.department_name) AS department_name
     FROM designations ds
     LEFT JOIN departments d ON d.id = ds.department_id
     WHERE COALESCE(ds.is_active, true) = true
       AND LOWER(COALESCE(ds.status, 'active')) = 'active'
       AND (
         LOWER(TRIM(COALESCE(d.name, ''))) = LOWER(TRIM($1))
         OR LOWER(TRIM(COALESCE(ds.department_name, ''))) = LOWER(TRIM($1))
       )
     ORDER BY ds.name ASC`,
    [dept],
  );
  return rows;
}

async function getStats(pool) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int                                                          AS total,
       COUNT(*) FILTER (WHERE employment_status = 'Active')::int             AS active,
       COUNT(*) FILTER (WHERE employment_status = 'Probation')::int          AS probation,
       COUNT(*) FILTER (WHERE employment_status = 'Notice Period')::int      AS notice,
       COUNT(*) FILTER (WHERE employment_status = 'On Leave')::int           AS on_leave,
       COUNT(*) FILTER (
         WHERE join_date >= date_trunc('month', CURRENT_DATE)::date
           AND join_date < (date_trunc('month', CURRENT_DATE) + interval '1 month')::date
       )::int                                                                 AS new_this_month,
       COUNT(DISTINCT department)::int                                        AS departments
     FROM employees WHERE deleted_at IS NULL`,
  );
  return rows[0];
}

async function getEmployeeSections(pool, employeeId) {
  const [docs, bank, addresses, emergency, experience, education, salary] =
    await Promise.all([
      pool.query(
        `SELECT id, document_type, document_name, document_number,
                TO_CHAR(issued_date, 'YYYY-MM-DD') AS issued_date,
                TO_CHAR(expiry_date, 'YYYY-MM-DD') AS expiry_date,
                file_url, notes
         FROM employee_documents
         WHERE employee_id = $1
         ORDER BY id ASC`,
        [employeeId],
      ),
      pool.query(
        `SELECT bank_name, account_holder, account_number, ifsc_code, swift_code, iban, branch_name, branch_address
         FROM employee_bank_details
         WHERE employee_id = $1
         LIMIT 1`,
        [employeeId],
      ),
      pool.query(
        `SELECT id, address_type, line1, line2, city, state, country, postal_code, is_primary
         FROM employee_addresses
         WHERE employee_id = $1
         ORDER BY is_primary DESC, id ASC`,
        [employeeId],
      ),
      pool.query(
        `SELECT id, contact_name, relationship, phone_primary, phone_secondary, email, address, is_primary
         FROM employee_emergency_contacts
         WHERE employee_id = $1
         ORDER BY is_primary DESC, id ASC`,
        [employeeId],
      ),
      pool.query(
        `SELECT id, company_name, designation,
                TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
                TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
                is_current, notes
         FROM employee_experience
         WHERE employee_id = $1
         ORDER BY id ASC`,
        [employeeId],
      ),
      pool.query(
        `SELECT id, institution_name, course_name, specialization,
                TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
                TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
                grade
         FROM employee_education
         WHERE employee_id = $1
         ORDER BY id ASC`,
        [employeeId],
      ),
      pool.query(
        `SELECT currency, basic_salary, allowances, deductions, net_salary, payment_frequency,
                TO_CHAR(effective_from, 'YYYY-MM-DD') AS effective_from
         FROM employee_salary
         WHERE employee_id = $1
         LIMIT 1`,
        [employeeId],
      ),
    ]);

  return {
    documents: docs.rows,
    bank_details: bank.rows[0] || null,
    addresses: addresses.rows,
    emergency_contacts: emergency.rows,
    experiences: experience.rows,
    education_details: education.rows,
    salary_details: salary.rows[0] || null,
  };
}

async function syncEmployeeSections(pool, employeeId, data = {}) {
  const {
    documents = [],
    bankDetails = null,
    addresses = [],
    emergencyContacts = [],
    educationDetails = [],
    experienceDetails = [],
    salaryDetails = null,
  } = data;

  if (Array.isArray(documents)) {
    await pool.query(`DELETE FROM employee_documents WHERE employee_id = $1`, [employeeId]);
    for (const d of documents) {
      await pool.query(
        `INSERT INTO employee_documents
          (employee_id, document_type, document_name, document_number, issued_date, expiry_date, file_url, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          employeeId,
          d?.documentType || null,
          d?.documentName || null,
          d?.documentNumber || null,
          d?.issuedDate || null,
          d?.expiryDate || null,
          d?.fileUrl || null,
          d?.notes || null,
        ],
      );
    }
  }

  if (bankDetails && typeof bankDetails === "object") {
    await pool.query(
      `INSERT INTO employee_bank_details
        (employee_id, bank_name, account_holder, account_number, ifsc_code, swift_code, iban, branch_name, branch_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (employee_id) DO UPDATE SET
         bank_name=EXCLUDED.bank_name, account_holder=EXCLUDED.account_holder,
         account_number=EXCLUDED.account_number, ifsc_code=EXCLUDED.ifsc_code,
         swift_code=EXCLUDED.swift_code, iban=EXCLUDED.iban,
         branch_name=EXCLUDED.branch_name, branch_address=EXCLUDED.branch_address,
         updated_at=NOW()`,
      [
        employeeId,
        bankDetails.bankName || null,
        bankDetails.accountHolder || null,
        bankDetails.accountNumber || null,
        bankDetails.ifscCode || null,
        bankDetails.swiftCode || null,
        bankDetails.iban || null,
        bankDetails.branchName || null,
        bankDetails.branchAddress || null,
      ],
    );
  }

  if (Array.isArray(addresses)) {
    await pool.query(`DELETE FROM employee_addresses WHERE employee_id = $1`, [employeeId]);
    for (const a of addresses) {
      await pool.query(
        `INSERT INTO employee_addresses
          (employee_id, address_type, line1, line2, city, state, country, postal_code, is_primary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          employeeId,
          a?.addressType || "home",
          a?.line1 || null,
          a?.line2 || null,
          a?.city || null,
          a?.state || null,
          a?.country || null,
          a?.postalCode || null,
          Boolean(a?.isPrimary),
        ],
      );
    }
  }

  if (Array.isArray(emergencyContacts)) {
    await pool.query(`DELETE FROM employee_emergency_contacts WHERE employee_id = $1`, [employeeId]);
    for (const c of emergencyContacts) {
      await pool.query(
        `INSERT INTO employee_emergency_contacts
          (employee_id, contact_name, relationship, phone_primary, phone_secondary, email, address, is_primary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          employeeId,
          c?.contactName || null,
          c?.relationship || null,
          c?.phonePrimary || null,
          c?.phoneSecondary || null,
          c?.email || null,
          c?.address || null,
          Boolean(c?.isPrimary),
        ],
      );
    }
  }

  if (Array.isArray(educationDetails)) {
    await pool.query(`DELETE FROM employee_education WHERE employee_id = $1`, [employeeId]);
    for (const e of educationDetails) {
      await pool.query(
        `INSERT INTO employee_education
          (employee_id, institution_name, course_name, specialization, start_date, end_date, grade)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          employeeId,
          e?.institutionName || null,
          e?.courseName || null,
          e?.specialization || null,
          e?.startDate || null,
          e?.endDate || null,
          e?.grade || null,
        ],
      );
    }
  }

  if (Array.isArray(experienceDetails)) {
    await pool.query(`DELETE FROM employee_experience WHERE employee_id = $1`, [employeeId]);
    for (const ex of experienceDetails) {
      await pool.query(
        `INSERT INTO employee_experience
          (employee_id, company_name, designation, start_date, end_date, is_current, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          employeeId,
          ex?.companyName || null,
          ex?.designation || null,
          ex?.startDate || null,
          ex?.endDate || null,
          Boolean(ex?.isCurrent),
          ex?.notes || null,
        ],
      );
    }
  }

  if (salaryDetails && typeof salaryDetails === "object") {
    await pool.query(
      `INSERT INTO employee_salary
        (employee_id, currency, basic_salary, allowances, deductions, net_salary, payment_frequency, effective_from)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (employee_id) DO UPDATE SET
         currency=EXCLUDED.currency, basic_salary=EXCLUDED.basic_salary, allowances=EXCLUDED.allowances,
         deductions=EXCLUDED.deductions, net_salary=EXCLUDED.net_salary,
         payment_frequency=EXCLUDED.payment_frequency, effective_from=EXCLUDED.effective_from,
         updated_at=NOW()`,
      [
        employeeId,
        salaryDetails.currency || "AED",
        salaryDetails.basicSalary ?? null,
        salaryDetails.allowances ?? null,
        salaryDetails.deductions ?? null,
        salaryDetails.netSalary ?? null,
        salaryDetails.paymentFrequency || null,
        salaryDetails.effectiveFrom || null,
      ],
    );
  }
}

module.exports = {
  findAll,
  countAll,
  findAllForDropdown,
  findAllForExport,
  findById,
  findByEmpId,
  getNextEmpId,
  findByWorkEmail,
  insert,
  update,
  completeOnboardingActivation,
  softDelete,
  getFilterOptions,
  getDesignationsForDepartment,
  getStats,
  getEmployeeSections,
  syncEmployeeSections,
};
