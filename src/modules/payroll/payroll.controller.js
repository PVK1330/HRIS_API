'use strict';

const payrollService = require('./payroll.service');
const ApiResponse = require('../../utils/ApiResponse');
const ApiError = require('../../utils/ApiError');

class PayrollController {
    /**
     * Get all salaries
     */
    async getSalaries(req, res, next) {
        try {
            const { db_name } = req.user;
            const { search, departmentId } = req.query;
            const salaries = await payrollService.getAllSalaries(db_name, { search, departmentId });
            return ApiResponse.ok(res, salaries, 'Salaries fetched successfully');
        } catch (error) {
            next(error);
        }
    }

    /**
     * Upsert salary
     */
    async upsertSalary(req, res, next) {
        try {
            const { db_name } = req.user;
            const salary = await payrollService.upsertSalary(db_name, req.body);
            return ApiResponse.created(res, salary, 'Salary record saved successfully');
        } catch (error) {
            next(error);
        }
    }

    /**
     * Delete salary record
     */
    async deleteSalary(req, res, next) {
        try {
            const { db_name } = req.user;
            const { id } = req.params;
            await payrollService.deleteSalary(db_name, id);
            return ApiResponse.ok(res, null, 'Salary record deleted successfully');
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get payroll items
     */
    async getItems(req, res, next) {
        try {
            const { db_name } = req.user;
            const { type } = req.query;
            const items = await payrollService.getPayrollItems(db_name, type);
            return ApiResponse.ok(res, items, 'Payroll items fetched successfully');
        } catch (error) {
            next(error);
        }
    }

    /**
     * Create payroll item
     */
    async createItem(req, res, next) {
        try {
            const { db_name } = req.user;
            const item = await payrollService.createPayrollItem(db_name, req.body);
            return ApiResponse.created(res, item, 'Payroll item created successfully');
        } catch (error) {
            next(error);
        }
    }

    async getMonthlySummary(req, res, next) {
        try {
            const { db_name } = req.user;
            const { month } = req.query;
            const data = await payrollService.getMonthlySummary(db_name, { month });
            return ApiResponse.ok(res, data, 'Monthly payroll summary fetched');
        } catch (error) {
            next(error);
        }
    }

    async exportSalaries(req, res, next) {
        try {
            const { getBranding } = require('../../utils/exportBranding');
            const exportLib = require('./payroll.export');
            const { db_name } = req.user;
            const type = (req.query.type || 'excel').toLowerCase();
            const today = new Date().toISOString().slice(0, 10);

            const [rows, branding] = await Promise.all([
                payrollService.getAllSalaries(db_name, {
                    search: req.query.search || '',
                    departmentId: req.query.departmentId || null,
                }),
                getBranding({ db_name }),
            ]);

            if (type === 'pdf') {
                res.setHeader('Content-Disposition', `attachment; filename="salary_registry_${today}.pdf"`);
                exportLib.buildSalaryPDF(res, rows, branding);
                return;
            }
            res.setHeader('Content-Disposition', `attachment; filename="salary_registry_${today}.xlsx"`);
            await exportLib.buildSalaryExcel(res, rows, branding);
            res.end();
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new PayrollController();
