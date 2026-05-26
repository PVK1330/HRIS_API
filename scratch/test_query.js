const { getTenantPool } = require('../src/config/db');
require('dotenv').config();

async function runTest() {
  try {
    const dbName = 'hris_gaurav_enterprise_1';
    console.log("Connecting to database pool:", dbName);
    const pool = getTenantPool(dbName);
    
    // 1. Fetch some employees
    const { rows: emps } = await pool.query("SELECT id, full_name, department_id FROM employees WHERE deleted_at IS NULL LIMIT 5");
    console.log("Employees:", emps);

    // 2. Fetch some departments
    const { rows: depts } = await pool.query("SELECT id, name, manager_id FROM departments WHERE is_active = true LIMIT 5");
    console.log("Departments:", depts);

    if (emps.length > 0) {
      const targetId = emps[0].id;
      console.log(`Running full findById query for employee ID: ${targetId}...`);
      
      const { rows } = await pool.query(
        `SELECT
           e.*,
           rr.name AS rbac_role_name,
           m.full_name AS manager_name, m.emp_id AS manager_emp_id,
           d.name AS "departmentName",
           d.name AS department_name,
           mgr.id AS "managerId",
           mgr.full_name AS "managerName",
           e.full_name AS "employeeName",
           e.emp_id AS "employeeCode",
           e.work_email AS "email",
           e.phone_number AS "phone",
           e.department_id AS "departmentId",
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
         LEFT JOIN departments d ON e.department_id = d.id
         LEFT JOIN employees mgr ON d.manager_id = mgr.id AND mgr.deleted_at IS NULL
         WHERE e.id = $1 AND e.deleted_at IS NULL`,
        [targetId]
      );
      
      console.log("Query Result:", rows[0] ? {
        id: rows[0].id,
        employeeName: rows[0].employeeName,
        employeeCode: rows[0].employeeCode,
        email: rows[0].email,
        phone: rows[0].phone,
        departmentId: rows[0].departmentId,
        departmentName: rows[0].departmentName,
        managerId: rows[0].managerId,
        managerName: rows[0].managerName
      } : "No employee found");
    } else {
      console.log("No employees in table to test query with.");
    }
  } catch (err) {
    console.error("Test failed with error:", err);
  } finally {
    process.exit();
  }
}

runTest();
