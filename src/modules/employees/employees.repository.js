"use strict";

async function findAll(
  pool,
  {
    search = "",
    department = "",
    status = "",
    workMode = "",
    jobTitle = "",
    workLocation = "",
    limit = 20,
    offset = 0,
  } = {},
) {
  const conditions = ["e.deleted_at IS NULL"];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    conditions.push(
      `(e.full_name ILIKE $${n} OR e.emp_id ILIKE $${n} OR e.work_email ILIKE $${n} OR e.job_title ILIKE $${n})`,
    );
  }
  if (department) {
    params.push(department);
    conditions.push(`e.department = $${params.length}`);
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

  const where = `WHERE ${conditions.join(" AND ")}`;
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT
       e.id, e.emp_id, e.full_name, e.first_name, e.last_name,
       e.work_email, e.personal_email, e.phone_number,
       e.job_title, e.department, e.employment_type, e.employment_status,
       e.work_location, e.work_mode, e.join_date, e.profile_image_url,
       e.nationality, e.gender,
       e.rbac_role_id,
       rr.name AS rbac_role_name,
       m.full_name AS manager_name, m.emp_id AS manager_emp_id,
       TO_CHAR(e.created_at, 'DD/MM/YYYY') AS "createdAt",
       TO_CHAR(e.updated_at, 'DD/MM/YYYY') AS "updatedAt"
     FROM employees e
     LEFT JOIN rbac_roles rr ON rr.id = e.rbac_role_id
     LEFT JOIN employees m ON m.id = e.reporting_manager_id AND m.deleted_at IS NULL
     ${where}
     ORDER BY e.full_name ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
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
  } = {},
) {
  const conditions = ["e.deleted_at IS NULL"];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    conditions.push(
      `(e.full_name ILIKE $${n} OR e.emp_id ILIKE $${n} OR e.work_email ILIKE $${n} OR e.job_title ILIKE $${n})`,
    );
  }
  if (department) {
    params.push(department);
    conditions.push(`e.department = $${params.length}`);
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

  const where = `WHERE ${conditions.join(" AND ")}`;
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM employees e ${where}`,
    params,
  );
  return rows[0].total;
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

  const { rows } = await pool.query(
    `INSERT INTO employees (
       emp_id, full_name, first_name, last_name, date_of_birth, gender, nationality,
       personal_email, phone_number, emergency_contact_name, emergency_contact_phone,
       home_address, job_title, department, employment_type, work_location, work_mode,
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
       $40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,$57
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
      department,
      employmentType, // $12–$15
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

async function softDelete(pool, id) {
  const { rowCount } = await pool.query(
    `UPDATE employees SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return rowCount > 0;
}

async function getFilterOptions(pool) {
  const [depts, jobs, locs, modes] = await Promise.all([
    pool.query(
      `SELECT DISTINCT department FROM employees WHERE deleted_at IS NULL ORDER BY department`,
    ),
    pool.query(
      `SELECT DISTINCT job_title FROM employees WHERE deleted_at IS NULL ORDER BY job_title`,
    ),
    pool.query(
      `SELECT DISTINCT work_location FROM employees WHERE deleted_at IS NULL AND work_location IS NOT NULL ORDER BY work_location`,
    ),
    pool.query(
      `SELECT DISTINCT work_mode FROM employees WHERE deleted_at IS NULL AND work_mode IS NOT NULL ORDER BY work_mode`,
    ),
  ]);
  return {
    departments: depts.rows.map((r) => r.department),
    jobTitles: jobs.rows.map((r) => r.job_title),
    workLocations: locs.rows.map((r) => r.work_location),
    workModes: modes.rows.map((r) => r.work_mode),
  };
}

async function getStats(pool) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int                                                          AS total,
       COUNT(*) FILTER (WHERE employment_status = 'Active')::int             AS active,
       COUNT(*) FILTER (WHERE employment_status = 'Probation')::int          AS probation,
       COUNT(*) FILTER (WHERE employment_status = 'Notice Period')::int      AS notice,
       COUNT(*) FILTER (WHERE employment_status = 'On Leave')::int           AS on_leave,
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
  findById,
  findByEmpId,
  findByWorkEmail,
  insert,
  update,
  softDelete,
  getFilterOptions,
  getStats,
  getEmployeeSections,
  syncEmployeeSections,
};
