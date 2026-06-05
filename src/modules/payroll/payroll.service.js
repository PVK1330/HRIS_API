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
}

module.exports = new PayrollService();
