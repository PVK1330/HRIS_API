'use strict';

const { appendScopeToConditions } = require('../../../utils/applyDataScope');
const repo = require('./attendance.repository');
const authz = require('./attendanceAuth.service');

// Stage → human label for the pending-approver column / banners.
const REG_STAGE_LABELS = { manager: 'Reporting Manager', department: 'Department Head', hr: 'HR' };

const REPORT_TYPES = [
  'employee',
  'department',
  'organization',
  'summary',
  'overtime',
  'late',
  'absenteeism',
  'regularization',
  'payroll',
];

function buildFilters(query, auth) {
  const conditions = ['e.deleted_at IS NULL'];
  const params = [];

  if (query.dateFrom) {
    params.push(query.dateFrom);
    conditions.push(`a.date >= $${params.length}::date`);
  }
  if (query.dateTo) {
    params.push(query.dateTo);
    conditions.push(`a.date <= $${params.length}::date`);
  }
  if (!query.dateFrom && !query.dateTo && query.year) {
    params.push(parseInt(query.year, 10));
    conditions.push(`EXTRACT(YEAR FROM a.date) = $${params.length}`);
    if (query.month) {
      params.push(parseInt(query.month, 10));
      conditions.push(`EXTRACT(MONTH FROM a.date) = $${params.length}`);
    }
  }
  if (query.employeeId) {
    params.push(Number(query.employeeId));
    conditions.push(`a.employee_id = $${params.length}`);
  }
  if (query.department) {
    params.push(query.department);
    conditions.push(`e.department = $${params.length}`);
  }
  if (query.designation) {
    params.push(query.designation);
    conditions.push(`e.job_title = $${params.length}`);
  }
  if (query.location) {
    params.push(query.location);
    conditions.push(`e.work_location = $${params.length}`);
  }
  if (query.status) {
    params.push(query.status);
    conditions.push(`a.status = $${params.length}`);
  }
  if (query.shiftId) {
    params.push(Number(query.shiftId));
    conditions.push(`EXISTS (
      SELECT 1 FROM employee_shift_assignments esa
      WHERE esa.employee_id = e.id
        AND esa.shift_id = $${params.length}
        AND esa.effective_from <= a.date
        AND (esa.effective_to IS NULL OR esa.effective_to >= a.date)
    )`);
  }

  return appendScopeToConditions(auth, conditions, params, 'e');
}

async function runReport(pool, reportType, scoped, query) {
  const { conditions, params } = scoped;
  const where = conditions.join(' AND ');
  const limit = Math.min(5000, parseInt(query.limit, 10) || 2000);

  if (reportType === 'department') {
    const { rows } = await pool.query(
      `SELECT e.department,
              COUNT(*)::int AS total_records,
              COUNT(*) FILTER (WHERE a.status IN ('Present','Late','Remote','Work From Home'))::int AS present,
              COUNT(*) FILTER (WHERE a.status = 'Absent')::int AS absent,
              COUNT(*) FILTER (WHERE a.is_late = true)::int AS late_count,
              ROUND(COALESCE(SUM(a.overtime_hours), 0)::numeric, 2) AS overtime_hours
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       WHERE ${where}
       GROUP BY e.department
       ORDER BY e.department ASC`,
      params,
    );
    return { rows, reportType };
  }

  if (reportType === 'organization') {
    const { rows } = await pool.query(
      `SELECT
         COUNT(DISTINCT a.employee_id)::int AS employees,
         COUNT(*)::int AS total_records,
         COUNT(*) FILTER (WHERE a.status IN ('Present','Late','Remote','Work From Home'))::int AS present,
         COUNT(*) FILTER (WHERE a.status = 'Absent')::int AS absent,
         COUNT(*) FILTER (WHERE a.is_late = true)::int AS late_count,
         ROUND(COALESCE(SUM(a.overtime_hours), 0)::numeric, 2) AS overtime_hours,
         COUNT(*) FILTER (WHERE a.status = 'On Leave')::int AS leave_days
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       WHERE ${where}`,
      params,
    );
    return { rows, reportType };
  }

  if (reportType === 'summary') {
    const { rows } = await pool.query(
      `SELECT e.id AS employee_id, e.emp_id, e.full_name, e.department, e.job_title,
              COUNT(*)::int AS working_days,
              COUNT(*) FILTER (WHERE a.status IN ('Present','Late','Remote','Work From Home'))::int AS present,
              COUNT(*) FILTER (WHERE a.status = 'Absent')::int AS absent,
              COUNT(*) FILTER (WHERE a.is_late = true)::int AS late_count,
              ROUND(COALESCE(SUM(a.overtime_hours), 0)::numeric, 2) AS overtime_hours,
              COUNT(*) FILTER (WHERE a.status = 'On Leave')::int AS leave_days,
              COUNT(*) FILTER (WHERE a.paid_day = true)::int AS payable_days
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       WHERE ${where}
       GROUP BY e.id, e.emp_id, e.full_name, e.department, e.job_title
       ORDER BY e.full_name ASC
       LIMIT ${limit}`,
      params,
    );
    return { rows, reportType };
  }

  if (reportType === 'overtime') {
    const { rows } = await pool.query(
      `SELECT a.id, TO_CHAR(a.date, 'YYYY-MM-DD') AS date,
              e.emp_id, e.full_name, e.department,
              a.check_in_time, a.check_out_time, a.overtime_hours, a.worked_hours
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       WHERE ${where} AND COALESCE(a.overtime_hours, 0) > 0
       ORDER BY a.date DESC, e.full_name ASC
       LIMIT ${limit}`,
      params,
    );
    return { rows, reportType };
  }

  if (reportType === 'late') {
    const { rows } = await pool.query(
      `SELECT a.id, TO_CHAR(a.date, 'YYYY-MM-DD') AS date,
              e.emp_id, e.full_name, e.department,
              a.check_in_time, a.late_minutes, a.status
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       WHERE ${where} AND (a.is_late = true OR a.status = 'Late')
       ORDER BY a.date DESC
       LIMIT ${limit}`,
      params,
    );
    return { rows, reportType };
  }

  if (reportType === 'absenteeism') {
    const { rows } = await pool.query(
      `SELECT e.id AS employee_id, e.emp_id, e.full_name, e.department,
              COUNT(*) FILTER (WHERE a.status = 'Absent')::int AS absent_days,
              COUNT(*)::int AS total_days
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       WHERE ${where}
       GROUP BY e.id, e.emp_id, e.full_name, e.department
       HAVING COUNT(*) FILTER (WHERE a.status = 'Absent') > 0
       ORDER BY absent_days DESC
       LIMIT ${limit}`,
      params,
    );
    return { rows, reportType };
  }

  if (reportType === 'regularization') {
    const { rows } = await pool.query(
      `SELECT a.id, TO_CHAR(a.date, 'YYYY-MM-DD') AS date,
              e.emp_id, e.full_name, e.department,
              a.regularization_status, a.regularization_reason,
              a.current_approval_level,
              CASE a.reg_current_stage
                WHEN 'manager'    THEN 'Direct Manager'
                WHEN 'department' THEN 'Department Head'
                WHEN 'hr'         THEN 'HR'
                ELSE NULL END AS pending_approver_role
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       WHERE ${where}
         AND a.regularization_status NOT IN ('N/A', '')
       ORDER BY a.date DESC
       LIMIT ${limit}`,
      params,
    );
    return { rows, reportType };
  }

  if (reportType === 'payroll') {
    const scopedEmp = [...params];
    const empConditions = [...conditions];
    if (query.employeeId) {
      const { rows } = await pool.query(
        `SELECT e.id AS employee_id, e.emp_id, e.full_name,
                COUNT(*)::int AS working_days,
                COUNT(*) FILTER (WHERE a.paid_day = true)::int AS payable_days,
                COUNT(*) FILTER (WHERE a.is_late = true)::int AS late_count,
                ROUND(COALESCE(SUM(a.overtime_hours), 0)::numeric, 2) AS overtime_hours,
                COUNT(*) FILTER (WHERE a.status = 'On Leave')::int AS leave_days
         FROM attendance a
         JOIN employees e ON e.id = a.employee_id
         WHERE ${empConditions.join(' AND ')}
         GROUP BY e.id, e.emp_id, e.full_name`,
        scopedEmp,
      );
      return { rows, reportType };
    }
    const { rows } = await pool.query(
      `SELECT e.id AS employee_id, e.emp_id, e.full_name, e.department,
              COUNT(*)::int AS working_days,
              COUNT(*) FILTER (WHERE a.paid_day = true)::int AS payable_days,
              COUNT(*) FILTER (WHERE a.is_late = true)::int AS late_count,
              ROUND(COALESCE(SUM(a.overtime_hours), 0)::numeric, 2) AS overtime_hours,
              COUNT(*) FILTER (WHERE a.status = 'On Leave')::int AS leave_days
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       WHERE ${where}
       GROUP BY e.id, e.emp_id, e.full_name, e.department
       ORDER BY e.full_name ASC
       LIMIT ${limit}`,
      params,
    );
    return { rows, reportType };
  }

  // employee (default detail)
  const { rows } = await pool.query(
    `SELECT a.id, TO_CHAR(a.date, 'YYYY-MM-DD') AS date,
            e.emp_id, e.full_name, e.department, e.job_title, e.work_location,
            a.check_in_time, a.check_out_time, a.work_mode, a.status,
            a.worked_hours, a.total_hours, a.overtime_hours, a.is_late,
            a.regularization_status, a.paid_day
     FROM attendance a
     JOIN employees e ON e.id = a.employee_id
     WHERE ${where}
     ORDER BY a.date DESC, e.full_name ASC
     LIMIT ${limit}`,
    params,
  );
  return { rows, reportType: 'employee' };
}

async function getDashboard(pool, date, auth) {
  const conditions = ['e.deleted_at IS NULL', 'a.date = $1'];
  const params = [date];
  const scoped = appendScopeToConditions(auth, conditions, params, 'e');
  const where = scoped.conditions.join(' AND ');

  // BUGFIX: alias must be 'e' (not '') so scope fragments render as `e.id = $n`
  // rather than invalid `.id = $n`, which 500'd for any SELF/TEAM/DEPARTMENT user.
  const empScoped = appendScopeToConditions(auth, ['e.deleted_at IS NULL', "e.employment_status IN ('Active', 'Probation', 'Notice Period')"], [], 'e');
  const empWhere = empScoped.conditions.join(' AND ');

  // Scope the 7-day trend the same way as every other dashboard query so a limited-scope
  // user can't read org-wide counts through the trend chart.
  const trendScoped = appendScopeToConditions(
    auth,
    ['e.deleted_at IS NULL', "a.date >= $1::date - INTERVAL '6 days'", 'a.date <= $1::date'],
    [date],
    'e',
  );
  const trendWhere = trendScoped.conditions.join(' AND ');

  const [widgetsRes, totalEmpRes, trendRes, deptRes, lateRes, missingRes] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE a.status IN ('Present','Late', 'Half Day'))::int AS present_today,
         COUNT(*) FILTER (WHERE a.status = 'Absent')::int AS absent_today,
         COUNT(*) FILTER (WHERE a.is_late = true OR a.status = 'Late')::int AS late_today,
         COUNT(*) FILTER (WHERE a.status = 'On Leave')::int AS on_leave,
         COUNT(*) FILTER (WHERE a.work_mode IN ('Remote','Work From Home') OR a.status = 'Work From Home')::int AS work_from_home,
         COUNT(*) FILTER (WHERE a.status = 'Half Day')::int AS half_day,
         COUNT(*) FILTER (WHERE COALESCE(a.overtime_hours, 0) > 0)::int AS overtime_employees,
         COUNT(*) FILTER (WHERE a.overtime_status = 'Pending')::int AS pending_overtime,
         COUNT(*) FILTER (WHERE a.regularization_status = 'Pending')::int AS pending_regularizations
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       WHERE ${where}`,
      scoped.params,
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM employees e WHERE ${empWhere}`, empScoped.params),
    // Daily Trend (Last 7 Days)
    pool.query(`
      SELECT TO_CHAR(a.date, 'YYYY-MM-DD') as date,
             COUNT(*) FILTER (WHERE a.status IN ('Present','Late','Half Day'))::int as present,
             COUNT(*) FILTER (WHERE a.status = 'Absent')::int as absent,
             COUNT(*) FILTER (WHERE a.status = 'On Leave')::int as on_leave
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      WHERE ${trendWhere}
      GROUP BY a.date
      ORDER BY a.date ASC
    `, trendScoped.params),
    // Department Attendance (Today)
    pool.query(`
      SELECT e.department,
             COUNT(*) FILTER (WHERE a.status IN ('Present','Late','Half Day'))::int as present,
             COUNT(*) FILTER (WHERE a.status = 'Absent')::int as absent,
             COUNT(*) FILTER (WHERE a.status = 'On Leave')::int as on_leave
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      WHERE ${where} AND e.department IS NOT NULL
      GROUP BY e.department
    `, scoped.params),
    // Top 5 Late Arrivals
    pool.query(`
      SELECT e.full_name, e.department, a.late_minutes, a.check_in_time
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      WHERE ${where} AND a.is_late = true
      ORDER BY a.late_minutes DESC NULLS LAST
      LIMIT 5
    `, scoped.params),
    // Missing Checkout
    pool.query(`
      SELECT e.full_name, e.department, a.check_in_time
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      WHERE ${where} AND a.check_in_time IS NOT NULL AND a.check_out_time IS NULL
      LIMIT 5
    `, scoped.params)
  ]);

  const w = widgetsRes.rows[0] || {};
  const totalEmployees = totalEmpRes.rows[0]?.total || 0;
  
  return {
    widgets: {
      total_employees: totalEmployees,
      present_today: w.present_today || 0,
      absent_today: w.absent_today || 0,
      late_today: w.late_today || 0,
      on_leave: w.on_leave || 0,
      work_from_home: w.work_from_home || 0,
      half_day: w.half_day || 0,
      overtime_employees: w.overtime_employees || 0,
      pending_overtime: w.pending_overtime || 0,
      pending_regularizations: w.pending_regularizations || 0,
      attendance_rate: totalEmployees > 0 ? Math.round(((w.present_today || 0) / totalEmployees) * 100) : 0
    },
    charts: {
      daily_trend: trendRes.rows,
      department_attendance: deptRes.rows
    },
    insights: {
      top_late: lateRes.rows,
      missing_checkout: missingRes.rows
    }
  };
}

async function getRegularizationHistory(pool, query, auth) {
  const conditions = [
    `a.regularization_status IN ('Pending','Approved','Rejected')`,
    'e.deleted_at IS NULL',
  ];
  const params = [];
  if (query.status) {
    params.push(query.status);
    conditions.push(`a.regularization_status = $${params.length}`);
  }
  const scoped = appendScopeToConditions(auth, conditions, params, 'e');
  scoped.params.push(auth?.employeeId ?? null);
  const selfIdx = scoped.params.length;
  const limit = Math.min(200, parseInt(query.limit, 10) || 50);
  const offset = (Math.max(1, parseInt(query.page, 10) || 1) - 1) * limit;
  scoped.params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT a.id, TO_CHAR(a.date, 'YYYY-MM-DD') AS date,
            a.regularization_status, a.regularization_reason,
            a.current_approval_level,
            a.reg_current_stage AS pending_stage,
            CASE a.reg_current_stage
              WHEN 'manager'    THEN 'Direct Manager'
              WHEN 'department' THEN 'Department Head'
              WHEN 'hr'         THEN 'HR'
              ELSE NULL END AS pending_approver_role,
            a.regularization_remarks,
            a.manager_approval_status, a.department_approval_status, a.hr_approval_status,
            a.manager_approved_at, a.department_approved_at, a.hr_approved_at,
            mgrapp.full_name AS manager_approver_name,
            deptapp.full_name AS dept_approver_name,
            hrapp.full_name AS hr_approver_name,
            (a.employee_id = $${selfIdx}) AS is_self,
            a.employee_id, e.reporting_manager_id, e.department_id,
            e.full_name AS employee_name, e.emp_id, e.department
     FROM attendance a
     JOIN employees e ON e.id = a.employee_id
     LEFT JOIN employees mgrapp  ON mgrapp.id  = a.manager_approved_by
     LEFT JOIN employees deptapp ON deptapp.id = a.department_approved_by
     LEFT JOIN employees hrapp   ON hrapp.id   = a.hr_approved_by
     WHERE ${scoped.conditions.join(' AND ')}
     ORDER BY a.updated_at DESC
     LIMIT $${scoped.params.length - 1} OFFSET $${scoped.params.length}`,
    scoped.params,
  );

  // Per-record `can_act`: only the responsible approver for the CURRENT stage
  // (reg_current_stage, while still Pending) sees Approve/Reject in the UI.
  const records = rows.map((r) => {
    const stage = r.regularization_status === 'Pending' ? r.pending_stage : null;
    const emp = {
      id: r.employee_id,
      reporting_manager_id: r.reporting_manager_id,
      department_id: r.department_id,
      department: r.department,
    };
    const canAct = stage ? authz.canActOnStage(auth, emp, stage, { employee_id: r.employee_id }) : false;
    return {
      ...r,
      pending_stage_label: stage ? REG_STAGE_LABELS[stage] : null,
      can_act: canAct,
    };
  });
  return { records, total: records.length };
}

module.exports = {
  REPORT_TYPES,
  buildFilters,
  runReport,
  getDashboard,
  getRegularizationHistory,
  findByEmployeeAndDate: repo.findByEmployeeAndDate,
};
