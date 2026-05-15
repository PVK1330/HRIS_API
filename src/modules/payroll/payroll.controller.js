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
}

module.exports = new PayrollController();
