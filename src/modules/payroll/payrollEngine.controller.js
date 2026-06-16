'use strict';

const payrollEngineService = require('./payrollEngine.service');
const ApiResponse = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');

// ── Salary Components ────────────────────────────────────────────────────────

const listComponents = asyncHandler(async (req, res) => {
  const { db_name } = req.user;
  const filters = { all: req.query.all === 'true' };
  const data = await payrollEngineService.listComponents(db_name, filters);
  return ApiResponse.ok(res, data, 'Salary components fetched successfully');
});

const createComponent = asyncHandler(async (req, res) => {
  const { db_name } = req.user;
  const data = await payrollEngineService.createComponent(db_name, req.body);
  return ApiResponse.created(res, data, 'Salary component created successfully');
});

const updateComponent = asyncHandler(async (req, res) => {
  const { db_name } = req.user;
  const { id } = req.params;
  const data = await payrollEngineService.updateComponent(db_name, id, req.body);
  return ApiResponse.ok(res, data, 'Salary component updated successfully');
});

const deleteComponent = asyncHandler(async (req, res) => {
  const { db_name } = req.user;
  const { id } = req.params;
  const data = await payrollEngineService.deleteComponent(db_name, id);
  return ApiResponse.ok(res, data, 'Salary component deactivated successfully');
});

// ── Salary Structures ────────────────────────────────────────────────────────

const listStructures = asyncHandler(async (req, res) => {
  const { db_name } = req.user;
  const data = await payrollEngineService.listStructures(db_name);
  return ApiResponse.ok(res, data, 'Salary structures fetched successfully');
});

const createStructure = asyncHandler(async (req, res) => {
  const { db_name } = req.user;
  const data = await payrollEngineService.createStructure(db_name, req.body);
  return ApiResponse.created(res, data, 'Salary structure created successfully');
});

const updateStructure = asyncHandler(async (req, res) => {
  const { db_name } = req.user;
  const { id } = req.params;
  const data = await payrollEngineService.updateStructure(db_name, id, req.body);
  return ApiResponse.ok(res, data, 'Salary structure updated successfully');
});

const assignStructureToEmployee = asyncHandler(async (req, res) => {
  const { db_name } = req.user;
  const data = await payrollEngineService.assignStructureToEmployee(db_name, req.body);
  return ApiResponse.created(res, data, 'Salary structure assigned to employee successfully');
});

// ── Pay Periods ──────────────────────────────────────────────────────────────

const listPayPeriods = asyncHandler(async (req, res) => {
  const { db_name } = req.user;
  const data = await payrollEngineService.listPayPeriods(db_name);
  return ApiResponse.ok(res, data, 'Pay periods fetched successfully');
});

const createPayPeriod = asyncHandler(async (req, res) => {
  const { db_name } = req.user;
  const data = await payrollEngineService.createPayPeriod(db_name, req.body);
  return ApiResponse.created(res, data, 'Pay period created successfully');
});

// ── Payroll Runs ─────────────────────────────────────────────────────────────

const listPayrollRuns = asyncHandler(async (req, res) => {
  const { db_name } = req.user;
  const filters = {
    status: req.query.status || null,
    pay_period_id: req.query.pay_period_id || null,
  };
  const data = await payrollEngineService.listPayrollRuns(db_name, filters);
  return ApiResponse.ok(res, data, 'Payroll runs fetched successfully');
});

const initPayrollRun = asyncHandler(async (req, res) => {
  const { db_name } = req.user;
  const { pay_period_id } = req.body;
  if (!pay_period_id) {
    return res.status(400).json({ success: false, message: 'pay_period_id is required' });
  }
  const data = await payrollEngineService.initPayrollRun(db_name, pay_period_id, req.user);
  return ApiResponse.created(res, data, 'Payroll run initiated successfully');
});

const getPayrollRun = asyncHandler(async (req, res) => {
  const { db_name } = req.user;
  const { id } = req.params;
  const data = await payrollEngineService.getPayrollRun(db_name, id);
  return ApiResponse.ok(res, data, 'Payroll run fetched successfully');
});

const approvePayrollRun = asyncHandler(async (req, res) => {
  const { db_name } = req.user;
  const { id } = req.params;
  const data = await payrollEngineService.approvePayrollRun(db_name, id, req.user);
  return ApiResponse.ok(res, data, 'Payroll run approved successfully');
});

const generatePayslips = asyncHandler(async (req, res) => {
  const { db_name } = req.user;
  const { id } = req.params;
  const data = await payrollEngineService.generatePayslips(db_name, id);
  return ApiResponse.created(res, data, 'Payslips generated successfully');
});

// ── Payslips ─────────────────────────────────────────────────────────────────

const getEmployeePayslips = asyncHandler(async (req, res) => {
  const { db_name, employeeId } = req.user;
  const data = await payrollEngineService.getEmployeePayslips(db_name, employeeId);
  return ApiResponse.ok(res, data, 'Payslips fetched successfully');
});

const getPayslipDetail = asyncHandler(async (req, res) => {
  const { db_name, employeeId } = req.user;
  const { id } = req.params;
  const data = await payrollEngineService.getPayslipDetail(db_name, id, employeeId);
  return ApiResponse.ok(res, data, 'Payslip fetched successfully');
});

module.exports = {
  listComponents,
  createComponent,
  updateComponent,
  deleteComponent,
  listStructures,
  createStructure,
  updateStructure,
  assignStructureToEmployee,
  listPayPeriods,
  createPayPeriod,
  listPayrollRuns,
  initPayrollRun,
  getPayrollRun,
  approvePayrollRun,
  generatePayslips,
  getEmployeePayslips,
  getPayslipDetail,
};
