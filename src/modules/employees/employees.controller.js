"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const ApiResponse = require("../../utils/ApiResponse");
const ApiError = require("../../utils/ApiError");
const service = require("./employees.service");
const exportLib = require("./employees.export");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

function exportFilename(entity, ext) {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${entity}_export_${y}-${m}-${day}.${ext}`;
}

// GET /api/v1/employees?page=1&limit=20&search=&department=&status=&workMode=&jobTitle=&workLocation=
const list = asyncHandler(async (req, res) => {
  const result = await service.listEmployees(req.user, req.query, req.auth);
  return ApiResponse.ok(res, result, "Employees retrieved successfully");
});

/** GET /employees/dropdown — full id/name list for selects (no pagination). */
const dropdownList = asyncHandler(async (req, res) => {
  const result = await service.listEmployeesDropdown(req.user, req.query, req.auth);
  return ApiResponse.ok(res, result, "Employees retrieved successfully");
});

const exportList = asyncHandler(async (req, res) => {
  const type = String(req.query.type || "").toLowerCase();
  if (!["pdf", "excel"].includes(type)) {
    throw new ApiError(400, "Query param type must be pdf or excel");
  }
  const { type: _t, ...rest } = req.query;
  const rows = await service.listEmployeesForExport(req.user, rest, req.auth);
  const applied = { ...rest, type };
  if (type === "excel") {
    const name = exportFilename("employees", "xlsx");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    await exportLib.buildExcel(res, rows);
    return undefined;
  }
  const name = exportFilename("employees", "pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  exportLib.buildPDF(res, rows, applied);
  return undefined;
});

const stats = asyncHandler(async (req, res) => {
  const data = await service.getStats(req.user);
  return ApiResponse.ok(res, data, "Stats retrieved successfully");
});

const filterOptions = asyncHandler(async (req, res) => {
  const data = await service.getFilterOptions(req.user);
  return ApiResponse.ok(res, data, "Filter options retrieved successfully");
});

/** GET /employees/designations-for-department?department=Sales */
const designationsForDepartment = asyncHandler(async (req, res) => {
  const department =
    req.query.department || req.query.departmentName || req.query.name || "";
  const data = await service.getDesignationsForDepartment(req.user, department);
  return ApiResponse.ok(res, data, "Designations retrieved successfully");
});

const nextEmpId = asyncHandler(async (req, res) => {
  const nextId = await service.getNextEmployeeId(req.user);
  return ApiResponse.ok(res, { nextEmpId: nextId }, "Next employee ID");
});

const getOne = asyncHandler(async (req, res) => {
  const emp = await service.getEmployee(req.user, req.params.id, req.auth);
  return ApiResponse.ok(
    res,
    { employee: emp },
    "Employee retrieved successfully",
  );
});

const create = asyncHandler(async (req, res) => {
  const emp = await service.createEmployee(req.user, req.body);
  return ApiResponse.created(
    res,
    { employee: emp },
    "Employee created successfully",
  );
});

const update = asyncHandler(async (req, res) => {
  const emp = await service.updateEmployee(req.user, req.params.id, req.body, req.auth);
  return ApiResponse.ok(
    res,
    { employee: emp },
    "Employee updated successfully",
  );
});

// DELETE /api/v1/employees/:id
const remove = asyncHandler(async (req, res) => {
  await service.deleteEmployee(req.user, req.params.id, req.auth);
  return ApiResponse.ok(res, null, "Employee deleted successfully");
});

/** POST /employees/:id/complete-onboarding — activate portal + email credentials */
const completeOnboarding = asyncHandler(async (req, res) => {
  const result = await service.completeOnboardingActivation(
    req.user,
    req.params.id,
    req.auth,
  );
  return ApiResponse.ok(res, result, result.message);
});

const gdprExport = asyncHandler(async (req, res) => {
  const result = await service.getEmployee(req.user, req.user.id, req.auth);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="GDPR_Data_Export_${req.user.id}.pdf"`);

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  doc.pipe(res);

  const logoPath = path.join(__dirname, '../../../../../HRIS/public/HRIS_Logo.png');
  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, 50, 45, { width: 120 });
  }

  doc.fillColor('#0F766E').fontSize(18).text('GDPR Personal Data Export', { align: 'right' });
  doc.moveDown(0.5);
  doc.fillColor('#374151').fontSize(10).text(`Generated On: ${new Date().toLocaleDateString()}`, { align: 'right' });
  doc.text(`Compliance: GDPR Article 15 - Right of access`, { align: 'right' });
  doc.moveDown(3);

  doc.fillColor('#0F766E').fontSize(14).text('Employee Profile', { underline: true });
  doc.moveDown(0.5);
  doc.fillColor('#1e293b').fontSize(11);

  const addField = (label, value) => {
    doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
    doc.font('Helvetica').text(value || 'N/A');
  };

  addField('Full Name', result.full_name || `${result.first_name || ''} ${result.last_name || ''}`.trim());
  addField('Employee ID', result.emp_id);
  addField('Personal Email', result.personal_email);
  addField('Work Email', result.work_email);
  addField('Phone', result.phone_number);
  addField('Job Title', result.job_title);
  addField('Department', result.department);
  addField('Employment Status', result.employment_status);
  addField('Join Date', result.join_date ? new Date(result.join_date).toLocaleDateString() : 'N/A');

  doc.moveDown(2);
  doc.fillColor('#0F766E').fontSize(14).text('Address Information', { underline: true });
  doc.moveDown(0.5);
  doc.fillColor('#1e293b').fontSize(11);
  addField('Present Address', result.present_address);
  addField('Permanent Address', result.permanent_address);

  doc.end();
});

module.exports = {
  list,
  dropdownList,
  exportList,
  stats,
  filterOptions,
  designationsForDepartment,
  nextEmpId,
  getOne,
  create,
  update,
  remove,
  completeOnboarding,
  gdprExport,
};
