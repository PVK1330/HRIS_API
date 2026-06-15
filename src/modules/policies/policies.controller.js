'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const ApiError = require('../../utils/ApiError');
const service = require('./policies.service');

const list = asyncHandler(async (req, res) => {
  const policies = await service.listPolicies(req.tenant, req.query);
  return ApiResponse.ok(res, policies, 'Policies retrieved successfully');
});

const getOne = asyncHandler(async (req, res) => {
  const policy = await service.getPolicy(req.tenant, req.params.id);
  return ApiResponse.ok(res, policy, 'Policy retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const policy = await service.createPolicy(req.tenant, req.user, req.body);
  return ApiResponse.created(res, policy, 'Policy created successfully');
});

const update = asyncHandler(async (req, res) => {
  const policy = await service.updatePolicy(req.tenant, req.params.id, req.body, req.user);
  return ApiResponse.ok(res, policy, 'Policy updated successfully');
});

const remove = asyncHandler(async (req, res) => {
  await service.deletePolicy(req.tenant, req.params.id, req.user);
  return ApiResponse.ok(res, null, 'Policy deleted successfully');
});

const getTracking = asyncHandler(async (req, res) => {
  const tracking = await service.getCompliance(req.tenant, req.params.id);
  return ApiResponse.ok(res, tracking, 'Compliance tracking retrieved successfully');
});

const listArchived = asyncHandler(async (req, res) => {
  const policies = await service.listArchivedPolicies(req.tenant);
  return ApiResponse.ok(res, policies, 'Archived policies retrieved successfully');
});

const getArchived = asyncHandler(async (req, res) => {
  const policy = await service.getArchivedPolicy(req.tenant, req.params.id);
  return ApiResponse.ok(res, policy, 'Archived policy retrieved successfully');
});

const getArchivedTracking = asyncHandler(async (req, res) => {
  const tracking = await service.getArchivedCompliance(req.tenant, req.params.id);
  return ApiResponse.ok(res, tracking, 'Archived policy compliance retrieved successfully');
});

const listMine = asyncHandler(async (req, res) => {
  const policies = await service.listMyPolicies(req.tenant, req.user);
  return ApiResponse.ok(res, policies, 'Your policies retrieved successfully');
});

const getMine = asyncHandler(async (req, res) => {
  const policy = await service.getMyPolicy(req.tenant, req.user, req.params.id);
  return ApiResponse.ok(res, policy, 'Policy retrieved successfully');
});

const acknowledge = asyncHandler(async (req, res) => {
  const ack = await service.acknowledgePolicy(req.tenant, req.user, req.params.id);
  const message = ack.alreadyAcknowledged
    ? 'Policy was already acknowledged'
    : 'Policy acknowledged successfully';
  return ApiResponse.ok(res, ack, message);
});

const listCategories = asyncHandler(async (req, res) => {
  const categories = await service.listCategories(req.tenant);
  return ApiResponse.ok(res, categories, 'Categories retrieved successfully');
});

const createCategory = asyncHandler(async (req, res) => {
  const category = await service.createCategory(req.tenant, req.body);
  return ApiResponse.created(res, category, 'Category created successfully');
});

const updateCategory = asyncHandler(async (req, res) => {
  const category = await service.updateCategory(req.tenant, req.params.id, req.body);
  return ApiResponse.ok(res, category, 'Category updated successfully');
});

const deleteCategory = asyncHandler(async (req, res) => {
  await service.deleteCategory(req.tenant, req.params.id);
  return ApiResponse.ok(res, null, 'Category deleted successfully');
});

const uploadFile = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ApiError(400, 'No file uploaded');
  }

  // S3 returns an absolute location; for local disk the file lives under /uploads/policies/.
  const url = req.file.location || `${process.env.API_URL || 'http://localhost:5000'}/uploads/policies/${req.file.filename}`;

  return ApiResponse.ok(res, {
    filename: req.file.key || req.file.filename,
    originalName: req.file.originalname,
    url: url
  }, 'File uploaded successfully');
});

const exportPolicy = asyncHandler(async (req, res) => {
  const { format = 'excel' } = req.query; // excel, pdf, csv
  const policy = await service.getPolicy(req.tenant, req.params.id);
  const tracking = await service.getCompliance(req.tenant, req.params.id);
  const employees = await service.getPolicyTargetEmployees(req.tenant, policy);

  const exportService = require('./policies.export');
  let buffer, contentType, filename;

  if (format === 'pdf') {
    buffer = await exportService.exportToPDF(policy, tracking, employees);
    contentType = 'application/pdf';
    filename = `policy-${policy.id}-${policy.title.replace(/\s+/g, '-').toLowerCase()}.pdf`;
  } else if (format === 'csv') {
    const csv = exportService.exportToCSV(policy, tracking, employees);
    buffer = Buffer.from(csv, 'utf-8');
    contentType = 'text/csv';
    filename = `policy-${policy.id}-${policy.title.replace(/\s+/g, '-').toLowerCase()}.csv`;
  } else {
    const workbook = await exportService.exportToExcel(policy, tracking, employees);
    buffer = await workbook.xlsx.writeBuffer();
    contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    filename = `policy-${policy.id}-${policy.title.replace(/\s+/g, '-').toLowerCase()}.xlsx`;
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  return res.end(buffer);
});

const importPolicies = asyncHandler(async (req, res) => {
  const { format = 'json' } = req.query; // json or csv
  let policies = [];

  if (format === 'csv') {
    if (!req.file) {
      throw new ApiError(400, 'CSV file is required');
    }
    const csvContent = req.file.buffer.toString('utf-8');
    const importService = require('./policies.import');
    policies = importService.parseCSV(csvContent);
  } else {
    // JSON payload in body
    if (!Array.isArray(req.body)) {
      throw new ApiError(400, 'Import payload must be an array of policies or a CSV file');
    }
    const importService = require('./policies.import');
    policies = importService.validateJSONImport(req.body);
  }

  // Bulk create policies
  const results = await service.bulkCreatePolicies(req.tenant, req.user, policies);

  return ApiResponse.ok(res, {
    imported: results.success.length,
    failed: results.failed.length,
    policies: results.success,
    errors: results.failed,
  }, `${results.success.length} policies imported successfully`);
});

const exportBatch = asyncHandler(async (req, res) => {
  const { policyIds = [], format = 'excel' } = req.body;

  if (!Array.isArray(policyIds) || policyIds.length === 0) {
    throw new ApiError(400, 'policyIds array is required');
  }

  if (policyIds.length > 10) {
    throw new ApiError(400, 'Maximum 10 policies can be exported at once');
  }

  const exportService = require('./policies.export');
  const policies = [];
  const allTracking = [];
  const allEmployees = [];
  const employeeSet = new Set();

  // Collect data for all policies
  for (const policyId of policyIds) {
    const policy = await service.getPolicy(req.tenant, policyId);
    const tracking = await service.getCompliance(req.tenant, policyId);
    const employees = await service.getPolicyTargetEmployees(req.tenant, policy);

    policies.push(policy);
    allTracking.push({ policyId, tracking });
    employees.forEach((e) => employeeSet.add(JSON.stringify(e)));
  }

  const uniqueEmployees = Array.from(employeeSet).map((e) => JSON.parse(e));

  let buffer, contentType, filename;

  if (format === 'csv') {
    // Batch CSV with all policies
    const header = ['Policy ID', 'Policy Title', 'Employee ID', 'Name', 'Email', 'Department', 'Status', 'Acknowledged At', 'Version'];
    const rows = [];
    allTracking.forEach(({ policyId, tracking }) => {
      const policy = policies.find((p) => p.id === policyId);
      tracking.forEach((ack) => {
        const emp = uniqueEmployees.find((e) => e.id === (ack.employeeId || ack.employee_id));
        rows.push([
          policyId,
          policy?.title || '—',
          ack.employeeId || ack.employee_id,
          emp?.fullName || emp?.full_name || emp?.name || '—',
          emp?.email || '—',
          emp?.departmentName || emp?.department_name || '—',
          ack.status || 'Pending',
          ack.acknowledgedAt || ack.acknowledged_at ? new Date(ack.acknowledgedAt || ack.acknowledged_at).toLocaleDateString() : '—',
          ack.acknowledgedVersion || ack.acknowledged_version || '—',
        ]);
      });
    });

    const csv = [header.map((h) => `"${h}"`).join(','), ...rows.map((r) => r.map((v) => `"${v}"`).join(','))].join('\n');
    buffer = Buffer.from(csv, 'utf-8');
    contentType = 'text/csv';
    filename = 'policies-batch.csv';
  } else {
    // Batch Excel with one sheet per policy
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();

    allTracking.forEach(({ policyId, tracking }) => {
      const policy = policies.find((p) => p.id === policyId);
      const sheetName = (policy?.title || 'Policy').substring(0, 31); // Max 31 chars for sheet name
      const sheet = workbook.addWorksheet(sheetName);

      sheet.columns = [
        { header: 'Employee ID', key: 'employeeId', width: 12 },
        { header: 'Name', key: 'employeeName', width: 25 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Department', key: 'department', width: 20 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'Acknowledged At', key: 'acknowledgedAt', width: 20 },
      ];

      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };

      tracking.forEach((ack, idx) => {
        const emp = uniqueEmployees.find((e) => e.id === (ack.employeeId || ack.employee_id));
        const row = sheet.addRow({
          employeeId: ack.employeeId || ack.employee_id,
          employeeName: emp?.fullName || emp?.full_name || emp?.name || '—',
          email: emp?.email || '—',
          department: emp?.departmentName || emp?.department_name || '—',
          status: ack.status || 'Pending',
          acknowledgedAt: ack.acknowledgedAt || ack.acknowledged_at ? new Date(ack.acknowledgedAt || ack.acknowledged_at).toLocaleDateString() : '—',
        });

        if (idx % 2 === 0) {
          row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
        }
      });
    });

    buffer = await workbook.xlsx.writeBuffer();
    contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    filename = 'policies-batch.xlsx';
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  return res.end(buffer);
});

module.exports = {
  list,
  getOne,
  listMine,
  getMine,
  create,
  update,
  remove,
  getTracking,
  listArchived,
  getArchived,
  getArchivedTracking,
  acknowledge,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  uploadFile,
  exportPolicy,
  importPolicies,
  exportBatch,
};
