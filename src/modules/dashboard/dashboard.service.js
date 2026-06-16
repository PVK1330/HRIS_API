'use strict';

const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');

/**
 * Return today's date string as YYYY-MM-DD in UTC.
 */
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Build an array of YYYY-MM-DD strings for the last N days (inclusive of today).
 */
function lastNDays(n) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }
  return days;
}

// ─── Attendance Dashboard ─────────────────────────────────────────────────────

/**
 * getAttendanceDashboard(dbName, filters)
 *
 * Returns:
 *  { todayStats, weekTrend, departmentSummary }
 */
async function getAttendanceDashboard(dbName, filters = {}) {
  const pool = getTenantPool(dbName);
  const date = filters.date || todayStr();

  // ── Today Stats ───────────────────────────────────────────────────────────
  const todayStatsQuery = `
    SELECT
      COUNT(*) FILTER (WHERE a.status = 'Present')::int                        AS present,
      COUNT(*) FILTER (WHERE a.status = 'Absent')::int                         AS absent,
      COUNT(*) FILTER (WHERE a.status = 'Late')::int                           AS late,
      COUNT(*) FILTER (WHERE a.status IN ('On Leave', 'Half Day Leave'))::int  AS on_leave,
      COUNT(*)::int                                                              AS total
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    WHERE a.date = $1
      AND e.employment_status NOT IN ('Terminated', 'Resigned')
  `;
  const todayResult = await pool.query(todayStatsQuery, [date]);
  const tr = todayResult.rows[0] || {};
  const todayStats = {
    present:  tr.present  || 0,
    absent:   tr.absent   || 0,
    late:     tr.late     || 0,
    onLeave:  tr.on_leave || 0,
    total:    tr.total    || 0,
  };

  // ── Week Trend (last 7 days) ───────────────────────────────────────────────
  const days = lastNDays(7);
  const weekTrendQuery = `
    SELECT
      a.date::text                                                               AS date,
      COUNT(*) FILTER (WHERE a.status = 'Present')::int                        AS present,
      COUNT(*) FILTER (WHERE a.status = 'Absent')::int                         AS absent
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    WHERE a.date = ANY($1::date[])
      AND e.employment_status NOT IN ('Terminated', 'Resigned')
    GROUP BY a.date
    ORDER BY a.date
  `;
  const weekResult = await pool.query(weekTrendQuery, [days]);

  // Fill in days that have no attendance rows with zeros
  const dayMap = {};
  for (const row of weekResult.rows) {
    dayMap[row.date] = { present: row.present, absent: row.absent };
  }
  const weekTrend = days.map((d) => ({
    date:    d,
    present: dayMap[d]?.present || 0,
    absent:  dayMap[d]?.absent  || 0,
  }));

  // ── Department Summary ────────────────────────────────────────────────────
  const deptQuery = `
    SELECT
      d.name                                                                    AS department_name,
      COUNT(*) FILTER (WHERE a.status = 'Present')::int                        AS present,
      COUNT(e.id)::int                                                          AS total
    FROM departments d
    JOIN employees e ON e.department_id = d.id AND e.employment_status NOT IN ('Terminated', 'Resigned')
    LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = $1
    GROUP BY d.id, d.name
    ORDER BY d.name
  `;
  const deptResult = await pool.query(deptQuery, [date]);
  const departmentSummary = deptResult.rows.map((r) => ({
    department_name: r.department_name,
    present:         r.present,
    total:           r.total,
  }));

  return { todayStats, weekTrend, departmentSummary };
}

// ─── Manager Dashboard ────────────────────────────────────────────────────────

/**
 * getManagerDashboard(dbName, managerId)
 *
 * Returns:
 *  { pendingApprovals, teamAttendanceToday, upcomingLeaves, teamSize }
 */
async function getManagerDashboard(dbName, managerId) {
  if (!managerId) throw new ApiError(400, 'managerId is required');
  const pool = getTenantPool(dbName);
  const date = todayStr();

  // Pending leave approvals for this manager
  const pendingQuery = `
    SELECT COUNT(*)::int AS cnt
    FROM leave_requests
    WHERE reporting_manager_id = $1
      AND status = 'Pending Manager Approval'
  `;
  const pendingResult = await pool.query(pendingQuery, [managerId]);
  const pendingApprovals = pendingResult.rows[0]?.cnt || 0;

  // Team attendance today
  const teamAttendQuery = `
    SELECT
      COUNT(*) FILTER (WHERE a.status = 'Present')::int AS present,
      COUNT(*) FILTER (WHERE a.status = 'Absent')::int  AS absent
    FROM employees e
    LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = $2
    WHERE e.reporting_manager_id = $1
      AND e.employment_status NOT IN ('Terminated', 'Resigned')
  `;
  const teamAttendResult = await pool.query(teamAttendQuery, [managerId, date]);
  const tar = teamAttendResult.rows[0] || {};
  const teamAttendanceToday = {
    present: tar.present || 0,
    absent:  tar.absent  || 0,
  };

  // Upcoming leaves (next 7 days) for the team
  const sevenDaysLater = new Date();
  sevenDaysLater.setUTCDate(sevenDaysLater.getUTCDate() + 7);
  const endDate = sevenDaysLater.toISOString().split('T')[0];

  const upcomingQuery = `
    SELECT
      lr.id,
      lr.employee_id,
      e.first_name,
      e.last_name,
      lr.leave_type,
      lr.from_date::text AS from_date,
      lr.to_date::text   AS to_date,
      lr.status
    FROM leave_requests lr
    JOIN employees e ON e.id = lr.employee_id
    WHERE e.reporting_manager_id = $1
      AND lr.status = 'Approved'
      AND lr.from_date BETWEEN $2::date AND $3::date
    ORDER BY lr.from_date
  `;
  const upcomingResult = await pool.query(upcomingQuery, [managerId, date, endDate]);
  const upcomingLeaves = upcomingResult.rows.map((r) => ({
    id:         r.id,
    employeeId: r.employee_id,
    name:       `${r.first_name} ${r.last_name}`,
    leaveType:  r.leave_type,
    fromDate:   r.from_date,
    toDate:     r.to_date,
    status:     r.status,
  }));

  // Team size
  const teamSizeQuery = `
    SELECT COUNT(*)::int AS cnt
    FROM employees
    WHERE reporting_manager_id = $1
      AND employment_status NOT IN ('Terminated', 'Resigned')
  `;
  const teamSizeResult = await pool.query(teamSizeQuery, [managerId]);
  const teamSize = teamSizeResult.rows[0]?.cnt || 0;

  return { pendingApprovals, teamAttendanceToday, upcomingLeaves, teamSize };
}

// ─── Payroll Dashboard ────────────────────────────────────────────────────────

/**
 * getPayrollDashboard(dbName)
 *
 * Returns:
 *  { currentPeriod, runStatus, totalPayroll, employeeCount }
 */
async function getPayrollDashboard(dbName) {
  const pool = getTenantPool(dbName);

  // Latest pay period
  const periodQuery = `
    SELECT *
    FROM pay_periods
    ORDER BY period_year DESC, period_month DESC
    LIMIT 1
  `;
  const periodResult = await pool.query(periodQuery);
  const currentPeriod = periodResult.rows[0] || null;

  // Latest payroll run
  const runQuery = `
    SELECT *
    FROM payroll_runs
    ORDER BY initiated_at DESC
    LIMIT 1
  `;
  const runResult = await pool.query(runQuery);
  const latestRun = runResult.rows[0] || null;

  // Total active employees
  const empCountQuery = `
    SELECT COUNT(*)::int AS cnt
    FROM employees
    WHERE employment_status NOT IN ('Terminated', 'Resigned')
  `;
  const empCountResult = await pool.query(empCountQuery);
  const employeeCount = empCountResult.rows[0]?.cnt || 0;

  return {
    currentPeriod,
    runStatus:     latestRun?.status     || null,
    totalPayroll:  latestRun?.total_net  || null,
    employeeCount,
  };
}

// ─── Leave Dashboard ──────────────────────────────────────────────────────────

/**
 * getLeaveDashboard(dbName, filters)
 *
 * Returns:
 *  { pendingRequests, approvedThisMonth, leaveByType, recentRequests }
 */
async function getLeaveDashboard(dbName, filters = {}) {
  const pool = getTenantPool(dbName);

  const now = new Date();
  const year  = filters.year  || now.getUTCFullYear();
  const month = filters.month || (now.getUTCMonth() + 1);

  // Pending requests (all time)
  const pendingQuery = `
    SELECT COUNT(*)::int AS cnt
    FROM leave_requests
    WHERE status IN ('Pending', 'Pending Manager Approval', 'Pending HR Approval')
  `;
  const pendingResult = await pool.query(pendingQuery);
  const pendingRequests = pendingResult.rows[0]?.cnt || 0;

  // Approved this calendar month
  const approvedQuery = `
    SELECT COUNT(*)::int AS cnt
    FROM leave_requests
    WHERE status = 'Approved'
      AND EXTRACT(YEAR  FROM from_date) = $1
      AND EXTRACT(MONTH FROM from_date) = $2
  `;
  const approvedResult = await pool.query(approvedQuery, [year, month]);
  const approvedThisMonth = approvedResult.rows[0]?.cnt || 0;

  // Leave breakdown by type (this month)
  const byTypeQuery = `
    SELECT leave_type, COUNT(*)::int AS count
    FROM leave_requests
    WHERE EXTRACT(YEAR  FROM from_date) = $1
      AND EXTRACT(MONTH FROM from_date) = $2
    GROUP BY leave_type
    ORDER BY count DESC
  `;
  const byTypeResult = await pool.query(byTypeQuery, [year, month]);
  const leaveByType = byTypeResult.rows.map((r) => ({
    leave_type: r.leave_type,
    count:      r.count,
  }));

  // Last 10 requests with employee names
  const recentQuery = `
    SELECT
      lr.id,
      lr.employee_id,
      e.first_name,
      e.last_name,
      lr.leave_type,
      lr.from_date::text AS from_date,
      lr.to_date::text   AS to_date,
      lr.status,
      lr.created_at
    FROM leave_requests lr
    JOIN employees e ON e.id = lr.employee_id
    ORDER BY lr.created_at DESC
    LIMIT 10
  `;
  const recentResult = await pool.query(recentQuery);
  const recentRequests = recentResult.rows.map((r) => ({
    id:         r.id,
    employeeId: r.employee_id,
    name:       `${r.first_name} ${r.last_name}`,
    leaveType:  r.leave_type,
    fromDate:   r.from_date,
    toDate:     r.to_date,
    status:     r.status,
    createdAt:  r.created_at,
  }));

  return { pendingRequests, approvedThisMonth, leaveByType, recentRequests };
}

module.exports = {
  getAttendanceDashboard,
  getManagerDashboard,
  getPayrollDashboard,
  getLeaveDashboard,
};
