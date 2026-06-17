'use strict';

const { getTenantPool } = require('../../config/db');
const notify = require('../notifications/notifications.service');

class PayrollService {
    /**
     * Get all employee salaries with employee details
     */
    async getAllSalaries(dbName, filters = {}) {
        const pool = await getTenantPool(dbName);
        const { search, departmentId } = filters;
        let query = `
            SELECT 
                es.*, 
                e.first_name, 
                e.last_name, 
                e.emp_id as emp_code,
                e.work_email as email,
                e.phone_number as phone,
                d.name as department_name,
                e.job_title as designation_name
            FROM employee_salaries es
            JOIN employees e ON es.employee_id = e.id
            LEFT JOIN departments d ON e.department_id = d.id
            WHERE 1=1
        `;
        const params = [];

        if (search) {
            params.push(`%${search}%`);
            query += ` AND (e.first_name ILIKE $${params.length} OR e.last_name ILIKE $${params.length} OR e.emp_id ILIKE $${params.length})`;
        }

        if (departmentId) {
            params.push(departmentId);
            query += ` AND e.department_id = $${params.length}`;
        }

        const result = await pool.query(query, params);
        return result.rows;
    }

    /**
     * Create or update employee salary
     */
    async upsertSalary(dbName, data) {
        const pool = await getTenantPool(dbName);
        const { employee_id, net_salary, earnings, deductions } = data;

        // Validate required fields
        if (!employee_id || isNaN(Number(employee_id))) {
            throw new (require('../../utils/ApiError'))(400, 'employee_id is required and must be a number');
        }
        if (net_salary === undefined || net_salary === null || isNaN(Number(net_salary))) {
            throw new (require('../../utils/ApiError'))(400, 'net_salary is required and must be a number');
        }

        // Verify employee exists in this tenant and is not soft-deleted
        const { rows: empRows } = await pool.query(
            `SELECT id FROM employees WHERE id = $1 AND deleted_at IS NULL`,
            [Number(employee_id)]
        );
        if (!empRows[0]) {
            throw new (require('../../utils/ApiError'))(404, 'Employee not found');
        }

        const query = `
            INSERT INTO employee_salaries (employee_id, net_salary, earnings, deductions)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (employee_id) 
            DO UPDATE SET 
                net_salary = EXCLUDED.net_salary,
                earnings = EXCLUDED.earnings,
                deductions = EXCLUDED.deductions,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `;
        
        const result = await pool.query(query, [employee_id, net_salary, earnings, deductions || '{}']);

        // Inform the employee their compensation record changed (no amounts in the
        // message; salary is sensitive — in-app only, no email).
        if (employee_id) {
            notify.pushNotification({ dbName }, {
                employeeId: Number(employee_id),
                title: 'Compensation Updated',
                message: 'Your salary / compensation details have been updated by HR.',
                type: 'info',
                entityType: 'salary',
                entityId: Number(employee_id),
                redirectUrl: '/employee/payroll',
            }).catch(() => null);
        }

        return result.rows[0];
    }

    /**
     * Delete a salary record by ID
     */
    async deleteSalary(dbName, id) {
        const pool = await getTenantPool(dbName);
        const { rows } = await pool.query(
            `DELETE FROM employee_salaries WHERE id = $1 RETURNING id, employee_id`,
            [Number(id)],
        );
        if (!rows[0]) throw new (require('../../utils/ApiError'))(404, 'Salary record not found');
        return rows[0];
    }

    /**
     * Get all payroll items (additions, deductions, OT)
     */
    async getPayrollItems(dbName, type) {
        const pool = await getTenantPool(dbName);
        let query = `SELECT * FROM payroll_items WHERE 1=1`;
        const params = [];

        if (type) {
            params.push(type);
            query += ` AND type = $${params.length}`;
        }

        const result = await pool.query(query, params);
        return result.rows;
    }

    /**
     * Create payroll item
     */
    async createPayrollItem(dbName, data) {
        const pool = await getTenantPool(dbName);
        const { name, type, category, amount } = data;
        const query = `
            INSERT INTO payroll_items (name, type, category, amount)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `;
        const result = await pool.query(query, [name, type, category, amount]);

        notify.pushNotification({ dbName }, {
            forAdmin: true,
            title: `Payroll Item Created: ${name}`,
            message: `A new payroll ${type || 'item'} "${name}"${category ? ` (${category})` : ''} was added to the payroll configuration.`,
            type: 'info',
            entityType: 'payroll_item',
            entityId: result.rows[0]?.id ?? null,
            redirectUrl: '/admin/payroll',
        }).catch(() => null);

        return result.rows[0];
    }

    /**
     * Monthly payroll summary: cross-references attendance + leave data with salaries.
     * month = 'YYYY-MM'
     */
    async getMonthlySummary(dbName, { month }) {
        const pool = await getTenantPool(dbName);
        const [year, mon] = (month || new Date().toISOString().slice(0, 7)).split('-');
        const y = parseInt(year, 10);
        const m = parseInt(mon, 10);
        const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
        const endDate   = new Date(y, m, 0).toISOString().slice(0, 10);

        const { rows } = await pool.query(`
            WITH
            working_days AS (
                SELECT COUNT(*)::int AS total
                FROM generate_series($1::date, $2::date, '1 day'::interval) d
                WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5
            ),
            emp_att AS (
                SELECT
                    a.employee_id,
                    COUNT(CASE WHEN a.status IN ('Present','Late','WFH','Regularization Approved') THEN 1 END)::int AS present_days,
                    COUNT(CASE WHEN a.status = 'Half Day' THEN 1 END)::int                                          AS half_days,
                    COALESCE(SUM(CASE WHEN a.overtime_status = 'Approved' THEN a.overtime_hours ELSE 0 END),0)::numeric AS ot_hours
                FROM attendance a
                WHERE a.date BETWEEN $1::date AND $2::date
                GROUP BY a.employee_id
            ),
            emp_leave AS (
                SELECT
                    lr.employee_id,
                    COALESCE(SUM(
                        LEAST(lr.to_date, $2::date) - GREATEST(lr.from_date, $1::date) + 1
                    ), 0)::int AS paid_leave_days
                FROM leave_requests lr
                JOIN leave_types lt ON lt.id = lr.leave_type_id
                WHERE lr.status = 'Approved'
                  AND lt.paid_or_unpaid = 'Paid'
                  AND lr.from_date <= $2::date AND lr.to_date >= $1::date
                GROUP BY lr.employee_id
            )
            SELECT
                e.id                                          AS employee_id,
                e.first_name,
                e.last_name,
                e.emp_id                                      AS emp_code,
                e.job_title                                   AS designation_name,
                dep.name                                      AS department_name,
                es.net_salary,
                (SELECT total FROM working_days)              AS working_days,
                COALESCE(ea.present_days, 0)                 AS present_days,
                COALESCE(ea.half_days,   0)                  AS half_days,
                COALESCE(el.paid_leave_days, 0)              AS paid_leave_days,
                ROUND(COALESCE(ea.ot_hours, 0), 2)           AS ot_hours,
                -- effective days = present + half*0.5 + paid leaves (capped at working_days)
                LEAST(
                    (SELECT total FROM working_days),
                    COALESCE(ea.present_days,0) + COALESCE(ea.half_days,0)*0.5 + COALESCE(el.paid_leave_days,0)
                )                                             AS effective_days,
                -- LOP = working_days − effective_days (≥ 0)
                GREATEST(0,
                    (SELECT total FROM working_days) -
                    COALESCE(ea.present_days,0) - COALESCE(ea.half_days,0)*0.5 - COALESCE(el.paid_leave_days,0)
                )                                             AS lop_days,
                -- per-day rate
                ROUND(es.net_salary / NULLIF((SELECT total FROM working_days),0), 2) AS per_day_salary,
                -- calculated net pay (LOP-adjusted, no OT premium for simplicity)
                ROUND(
                    es.net_salary / NULLIF((SELECT total FROM working_days),0) *
                    LEAST(
                        (SELECT total FROM working_days),
                        COALESCE(ea.present_days,0) + COALESCE(ea.half_days,0)*0.5 + COALESCE(el.paid_leave_days,0)
                    ),
                    2
                )                                             AS net_pay_calculated
            FROM employees e
            JOIN employee_salaries es  ON es.employee_id = e.id
            LEFT JOIN departments dep  ON dep.id = e.department_id
            LEFT JOIN emp_att ea       ON ea.employee_id = e.id
            LEFT JOIN emp_leave el     ON el.employee_id = e.id
            WHERE e.deleted_at IS NULL
            ORDER BY e.first_name, e.last_name
        `, [startDate, endDate]);

        return {
            month,
            start_date: startDate,
            end_date:   endDate,
            working_days: rows[0]?.working_days ?? 0,
            employees: rows,
        };
    }
}

module.exports = new PayrollService();
