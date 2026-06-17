'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');

class PayrollEngineService {
  // ── Salary Components ──────────────────────────────────────────────────────

  async listComponents(dbName, filters = {}) {
    const pool = await getTenantPool(dbName);
    let query = `SELECT * FROM salary_components`;
    const params = [];

    if (!filters.all) {
      query += ` WHERE is_active = TRUE`;
    }

    query += ` ORDER BY display_order ASC, id ASC`;

    const { rows } = await pool.query(query, params);
    return rows;
  }

  async createComponent(dbName, data) {
    const pool = await getTenantPool(dbName);
    const {
      name,
      component_type,
      calculation_type,
      calculation_basis,
      default_value,
      is_taxable,
      is_statutory,
      display_order,
    } = data;

    if (!name || !component_type || !calculation_type) {
      throw new ApiError(400, 'name, component_type and calculation_type are required');
    }

    const { rows } = await pool.query(
      `INSERT INTO salary_components
         (name, component_type, calculation_type, calculation_basis,
          default_value, is_taxable, is_statutory, is_active, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8)
       RETURNING *`,
      [
        name,
        component_type,
        calculation_type,
        calculation_basis || null,
        default_value || 0,
        is_taxable !== undefined ? Boolean(is_taxable) : false,
        is_statutory !== undefined ? Boolean(is_statutory) : false,
        display_order || 0,
      ],
    );
    return rows[0];
  }

  async updateComponent(dbName, id, data) {
    const pool = await getTenantPool(dbName);
    const {
      name,
      component_type,
      calculation_type,
      calculation_basis,
      default_value,
      is_taxable,
      is_statutory,
      is_active,
      display_order,
    } = data;

    const { rows } = await pool.query(
      `UPDATE salary_components SET
         name = COALESCE($1, name),
         component_type = COALESCE($2, component_type),
         calculation_type = COALESCE($3, calculation_type),
         calculation_basis = COALESCE($4, calculation_basis),
         default_value = COALESCE($5, default_value),
         is_taxable = COALESCE($6, is_taxable),
         is_statutory = COALESCE($7, is_statutory),
         is_active = COALESCE($8, is_active),
         display_order = COALESCE($9, display_order),
         updated_at = NOW()
       WHERE id = $10
       RETURNING *`,
      [
        name || null,
        component_type || null,
        calculation_type || null,
        calculation_basis !== undefined ? calculation_basis : null,
        default_value !== undefined ? default_value : null,
        is_taxable !== undefined ? Boolean(is_taxable) : null,
        is_statutory !== undefined ? Boolean(is_statutory) : null,
        is_active !== undefined ? Boolean(is_active) : null,
        display_order !== undefined ? display_order : null,
        id,
      ],
    );

    if (!rows[0]) throw new ApiError(404, 'Salary component not found');
    return rows[0];
  }

  async deleteComponent(dbName, id) {
    const pool = await getTenantPool(dbName);
    const { rows } = await pool.query(
      `UPDATE salary_components SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id],
    );
    if (!rows[0]) throw new ApiError(404, 'Salary component not found');
    return rows[0];
  }

  // ── Salary Structures ──────────────────────────────────────────────────────

  async listStructures(dbName) {
    const pool = await getTenantPool(dbName);
    const { rows } = await pool.query(
      `SELECT
         ss.*,
         COALESCE(
           json_agg(
             json_build_object(
               'id',               ssc.id,
               'component_id',     ssc.component_id,
               'component_name',   sc.name,
               'component_type',   sc.component_type,
               'calculation_type', COALESCE(ssc.calculation_type, sc.calculation_type),
               'value',            ssc.value,
               'display_order',    ssc.display_order,
               'is_active',        ssc.is_active
             ) ORDER BY ssc.display_order ASC, ssc.id ASC
           ) FILTER (WHERE ssc.id IS NOT NULL),
           '[]'
         ) AS components
       FROM salary_structures ss
       LEFT JOIN salary_structure_components ssc ON ssc.structure_id = ss.id AND ssc.is_active = TRUE
       LEFT JOIN salary_components sc ON sc.id = ssc.component_id
       WHERE ss.is_active = TRUE
       GROUP BY ss.id
       ORDER BY ss.id ASC`,
    );
    return rows;
  }

  async createStructure(dbName, data) {
    const pool = await getTenantPool(dbName);
    const { name, description, components = [] } = data;

    if (!name) throw new ApiError(400, 'Structure name is required');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: ssRows } = await client.query(
        `INSERT INTO salary_structures (name, description, is_active)
         VALUES ($1, $2, TRUE)
         RETURNING *`,
        [name, description || null],
      );
      const structure = ssRows[0];

      for (const comp of components) {
        await client.query(
          `INSERT INTO salary_structure_components
             (structure_id, component_id, value, calculation_type, display_order, is_active)
           VALUES ($1, $2, $3, $4, $5, TRUE)`,
          [
            structure.id,
            comp.component_id,
            comp.value || 0,
            comp.calculation_type || null,
            comp.display_order || 0,
          ],
        );
      }

      await client.query('COMMIT');
      return this.getStructureById(pool, structure.id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async updateStructure(dbName, id, data) {
    const pool = await getTenantPool(dbName);
    const { name, description, components } = data;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: existing } = await client.query(
        `SELECT id FROM salary_structures WHERE id = $1 AND is_active = TRUE`,
        [id],
      );
      if (!existing[0]) throw new ApiError(404, 'Salary structure not found');

      await client.query(
        `UPDATE salary_structures
         SET name = COALESCE($1, name),
             description = COALESCE($2, description),
             updated_at = NOW()
         WHERE id = $3`,
        [name || null, description !== undefined ? description : null, id],
      );

      if (Array.isArray(components)) {
        await client.query(
          `DELETE FROM salary_structure_components WHERE structure_id = $1`,
          [id],
        );
        for (const comp of components) {
          await client.query(
            `INSERT INTO salary_structure_components
               (structure_id, component_id, value, calculation_type, display_order, is_active)
             VALUES ($1, $2, $3, $4, $5, TRUE)`,
            [
              id,
              comp.component_id,
              comp.value || 0,
              comp.calculation_type || null,
              comp.display_order || 0,
            ],
          );
        }
      }

      await client.query('COMMIT');
      return this.getStructureById(pool, id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getStructureById(pool, id) {
    const { rows } = await pool.query(
      `SELECT
         ss.*,
         COALESCE(
           json_agg(
             json_build_object(
               'id',               ssc.id,
               'component_id',     ssc.component_id,
               'component_name',   sc.name,
               'component_type',   sc.component_type,
               'calculation_type', COALESCE(ssc.calculation_type, sc.calculation_type),
               'value',            ssc.value,
               'display_order',    ssc.display_order,
               'is_active',        ssc.is_active
             ) ORDER BY ssc.display_order ASC, ssc.id ASC
           ) FILTER (WHERE ssc.id IS NOT NULL),
           '[]'
         ) AS components
       FROM salary_structures ss
       LEFT JOIN salary_structure_components ssc ON ssc.structure_id = ss.id AND ssc.is_active = TRUE
       LEFT JOIN salary_components sc ON sc.id = ssc.component_id
       WHERE ss.id = $1
       GROUP BY ss.id`,
      [id],
    );
    return rows[0] || null;
  }

  async assignStructureToEmployee(dbName, data) {
    const pool = await getTenantPool(dbName);
    const { employee_id, structure_id, effective_from, effective_to, ctc } = data;

    if (!employee_id || !structure_id || !effective_from) {
      throw new ApiError(400, 'employee_id, structure_id and effective_from are required');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Close the previously open assignment one day before the new effective_from
      await client.query(
        `UPDATE employee_salary_structures
         SET effective_to = ($1::date - INTERVAL '1 day')::date
         WHERE employee_id = $2
           AND effective_to IS NULL
           AND id != 0`,
        [effective_from, employee_id],
      );

      const { rows } = await client.query(
        `INSERT INTO employee_salary_structures
           (employee_id, structure_id, effective_from, effective_to, ctc)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          employee_id,
          structure_id,
          effective_from,
          effective_to || null,
          ctc || null,
        ],
      );

      await client.query('COMMIT');
      return rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ── Pay Periods ────────────────────────────────────────────────────────────

  async listPayPeriods(dbName) {
    const pool = await getTenantPool(dbName);
    const { rows } = await pool.query(
      `SELECT * FROM pay_periods
       ORDER BY period_year DESC, period_month DESC`,
    );
    return rows;
  }

  async createPayPeriod(dbName, data) {
    const pool = await getTenantPool(dbName);
    const { period_name, period_year, period_month, start_date, end_date } = data;

    if (!period_year || !period_month || !start_date || !end_date) {
      throw new ApiError(400, 'period_year, period_month, start_date and end_date are required');
    }

    // Validate no duplicate (year, month)
    const { rows: existing } = await pool.query(
      `SELECT id FROM pay_periods WHERE period_year = $1 AND period_month = $2`,
      [period_year, period_month],
    );
    if (existing.length > 0) {
      throw new ApiError(409, `Pay period for ${period_year}-${String(period_month).padStart(2, '0')} already exists`);
    }

    const { rows } = await pool.query(
      `INSERT INTO pay_periods (period_name, period_year, period_month, start_date, end_date, status)
       VALUES ($1, $2, $3, $4, $5, 'OPEN')
       RETURNING *`,
      [
        period_name || `${period_year}-${String(period_month).padStart(2, '0')}`,
        period_year,
        period_month,
        start_date,
        end_date,
      ],
    );
    return rows[0];
  }

  // ── Payroll Runs ───────────────────────────────────────────────────────────

  async initPayrollRun(dbName, payPeriodId, user) {
    const pool = await getTenantPool(dbName);

    // 1. Check period exists and is OPEN
    const { rows: periods } = await pool.query(
      `SELECT * FROM pay_periods WHERE id = $1`,
      [payPeriodId],
    );
    if (!periods[0]) throw new ApiError(404, 'Pay period not found');
    const period = periods[0];
    if (period.status !== 'OPEN') {
      throw new ApiError(400, `Pay period is ${period.status}; only OPEN periods can be processed`);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 2. INSERT payroll_runs (status=DRAFT)
      const runName = `Payroll Run - ${period.period_name || `${period.period_year}-${String(period.period_month).padStart(2, '0')}`}`;
      const { rows: runRows } = await client.query(
        `INSERT INTO payroll_runs
           (pay_period_id, run_name, status, total_employees, total_gross, total_deductions, total_net, initiated_by)
         VALUES ($1, $2, 'DRAFT', 0, 0, 0, 0, $3)
         RETURNING *`,
        [payPeriodId, runName, user.id || null],
      );
      const run = runRows[0];

      // 3. Get all active employees
      const { rows: employees } = await client.query(
        `SELECT e.id, e.first_name, e.last_name, es.net_salary, es.earnings, es.deductions
         FROM employees e
         LEFT JOIN employee_salaries es ON es.employee_id = e.id
         WHERE e.employment_status NOT IN ('Terminated', 'Resigned')`,
      );

      // Calculate working days in period from start_date to end_date
      const startDate = new Date(period.start_date);
      const endDate = new Date(period.end_date);
      let workingDays = 0;
      const cur = new Date(startDate);
      while (cur <= endDate) {
        const dow = cur.getDay(); // 0=Sun, 6=Sat
        if (dow !== 0 && dow !== 6) workingDays++;
        cur.setDate(cur.getDate() + 1);
      }

      let totalGross = 0;
      let totalNet = 0;
      let totalEmployees = 0;

      for (const emp of employees) {
        // Get lop_days from lop_records for this period
        const { rows: lopRows } = await client.query(
          `SELECT COALESCE(SUM(lop_days), 0)::numeric AS lop_days
           FROM lop_records
           WHERE employee_id = $1 AND pay_period_id = $2`,
          [emp.id, payPeriodId],
        );
        const lopDays = parseFloat(lopRows[0]?.lop_days || 0);
        const payDays = Math.max(0, workingDays - lopDays);

        const grossSalary = parseFloat(emp.net_salary || 0);
        const netSalary = grossSalary; // placeholder; deductions applied separately

        await client.query(
          `INSERT INTO payroll_run_employees
             (run_id, employee_id, pay_days, lop_days, ot_hours,
              gross_salary, total_earnings, total_deductions, net_salary,
              earnings, deductions, status)
           VALUES ($1, $2, $3, $4, 0, $5, $5, 0, $6, $7, $8, 'PENDING')`,
          [
            run.id,
            emp.id,
            payDays,
            lopDays,
            grossSalary,
            netSalary,
            emp.earnings ? JSON.stringify(emp.earnings) : '{}',
            emp.deductions ? JSON.stringify(emp.deductions) : '{}',
          ],
        );

        totalGross += grossSalary;
        totalNet += netSalary;
        totalEmployees++;
      }

      // 4. Update payroll_run totals
      await client.query(
        `UPDATE payroll_runs SET
           total_employees = $1,
           total_gross = $2,
           total_deductions = 0,
           total_net = $3
         WHERE id = $4`,
        [totalEmployees, totalGross, totalNet, run.id],
      );

      // Update pay period status to PROCESSING
      await client.query(
        `UPDATE pay_periods SET status = 'PROCESSING' WHERE id = $1`,
        [payPeriodId],
      );

      await client.query('COMMIT');

      // 5. Return run with summary
      return this.getPayrollRun(dbName, run.id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async listPayrollRuns(dbName, filters = {}) {
    const pool = await getTenantPool(dbName);
    let where = 'WHERE 1=1';
    const params = [];

    if (filters.status) {
      params.push(filters.status);
      where += ` AND pr.status = $${params.length}`;
    }

    if (filters.pay_period_id) {
      params.push(filters.pay_period_id);
      where += ` AND pr.pay_period_id = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT
         pr.*,
         pp.period_name, pp.period_year, pp.period_month,
         pp.start_date, pp.end_date, pp.status AS period_status
       FROM payroll_runs pr
       JOIN pay_periods pp ON pp.id = pr.pay_period_id
       ${where}
       ORDER BY pr.id DESC`,
      params,
    );
    return rows;
  }

  async getPayrollRun(dbName, runId) {
    const pool = await getTenantPool(dbName);

    const { rows: runRows } = await pool.query(
      `SELECT
         pr.*,
         pp.period_name, pp.period_year, pp.period_month,
         pp.start_date, pp.end_date, pp.status AS period_status
       FROM payroll_runs pr
       JOIN pay_periods pp ON pp.id = pr.pay_period_id
       WHERE pr.id = $1`,
      [runId],
    );
    if (!runRows[0]) throw new ApiError(404, 'Payroll run not found');

    const { rows: empRows } = await pool.query(
      `SELECT
         pre.*,
         e.first_name, e.last_name, e.emp_id AS emp_code,
         e.work_email AS email,
         d.name AS department_name,
         e.job_title AS designation
       FROM payroll_run_employees pre
       JOIN employees e ON e.id = pre.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE pre.run_id = $1
       ORDER BY e.first_name ASC, e.last_name ASC`,
      [runId],
    );

    return { ...runRows[0], employees: empRows };
  }

  async approvePayrollRun(dbName, runId, user) {
    const pool = await getTenantPool(dbName);

    const { rows: existing } = await pool.query(
      `SELECT * FROM payroll_runs WHERE id = $1`,
      [runId],
    );
    if (!existing[0]) throw new ApiError(404, 'Payroll run not found');

    const run = existing[0];
    if (!['DRAFT', 'PROCESSING', 'COMPLETED'].includes(run.status)) {
      throw new ApiError(400, `Cannot approve a run in status: ${run.status}`);
    }

    const { rows } = await pool.query(
      `UPDATE payroll_runs
       SET status = 'APPROVED',
           approved_by = $1,
           approved_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [user.id || null, runId],
    );
    return rows[0];
  }

  async generatePayslips(dbName, runId) {
    const pool = await getTenantPool(dbName);

    // Verify run exists
    const { rows: runRows } = await pool.query(
      `SELECT pr.*, pp.period_year, pp.period_month, pp.id AS period_id
       FROM payroll_runs pr
       JOIN pay_periods pp ON pp.id = pr.pay_period_id
       WHERE pr.id = $1`,
      [runId],
    );
    if (!runRows[0]) throw new ApiError(404, 'Payroll run not found');
    const run = runRows[0];

    const { rows: runEmps } = await pool.query(
      `SELECT * FROM payroll_run_employees WHERE run_id = $1`,
      [runId],
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const created = [];
      for (const re of runEmps) {
        const yr = String(run.period_year);
        const mo = String(run.period_month).padStart(2, '0');
        const payslipNumber = `PAY-${yr}${mo}-${re.employee_id}`;

        // Upsert: avoid duplicate payslips for the same run_employee
        const { rows: psRows } = await client.query(
          `INSERT INTO payslips
             (run_employee_id, employee_id, pay_period_id, payslip_number, is_published, published_at)
           VALUES ($1, $2, $3, $4, TRUE, NOW())
           ON CONFLICT (run_employee_id) DO UPDATE
             SET is_published = TRUE, published_at = COALESCE(payslips.published_at, NOW())
           RETURNING *`,
          [re.id, re.employee_id, run.period_id, payslipNumber],
        );
        created.push(psRows[0]);
      }

      // Mark run as COMPLETED after payslip generation
      await client.query(
        `UPDATE payroll_runs SET status = 'COMPLETED' WHERE id = $1 AND status NOT IN ('APPROVED','PAID')`,
        [runId],
      );

      await client.query('COMMIT');
      return { generated: created.length, payslips: created };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getEmployeePayslips(dbName, employeeId) {
    const pool = await getTenantPool(dbName);
    const { rows } = await pool.query(
      `SELECT
         p.*,
         pp.period_name, pp.period_year, pp.period_month,
         pp.start_date, pp.end_date,
         pre.pay_days, pre.lop_days, pre.ot_hours,
         pre.gross_salary, pre.total_earnings, pre.total_deductions, pre.net_salary,
         pre.earnings, pre.deductions
       FROM payslips p
       JOIN payroll_run_employees pre ON pre.id = p.run_employee_id
       JOIN pay_periods pp ON pp.id = p.pay_period_id
       WHERE p.employee_id = $1 AND p.is_published = TRUE
       ORDER BY pp.period_year DESC, pp.period_month DESC`,
      [employeeId],
    );
    return rows;
  }

  async getPayslipDetail(dbName, payslipId, employeeId) {
    const pool = await getTenantPool(dbName);

    const { rows } = await pool.query(
      `SELECT
         p.*,
         pp.period_name, pp.period_year, pp.period_month,
         pp.start_date, pp.end_date,
         pre.pay_days, pre.lop_days, pre.ot_hours,
         pre.gross_salary, pre.total_earnings, pre.total_deductions, pre.net_salary,
         pre.earnings, pre.deductions,
         e.first_name, e.last_name, e.emp_id AS emp_code,
         e.work_email AS email, e.job_title AS designation,
         d.name AS department_name
       FROM payslips p
       JOIN payroll_run_employees pre ON pre.id = p.run_employee_id
       JOIN pay_periods pp ON pp.id = p.pay_period_id
       JOIN employees e ON e.id = p.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE p.id = $1`,
      [payslipId],
    );

    if (!rows[0]) throw new ApiError(404, 'Payslip not found');

    // Assert access: employees can only see their own payslips
    if (
      employeeId &&
      parseInt(String(rows[0].employee_id), 10) !== parseInt(String(employeeId), 10)
    ) {
      throw new ApiError(403, 'Access denied: you can only view your own payslips');
    }

    return rows[0];
  }
}

module.exports = new PayrollEngineService();
