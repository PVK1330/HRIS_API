'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const env = require('./config/env');
const { createCorsOptions } = require('./config/cors');
const ApiResponse = require('./utils/ApiResponse');
const ApiError = require('./utils/ApiError');
const { notFoundHandler, errorHandler } = require('./middlewares/error.middleware');

const superadminRoutes = require('./modules/superadmin/superadmin.routes');
const plansRoutes = require('./modules/superadmin/plans.routes');
const featuresRoutes = require('./modules/superadmin/features.routes');
const tenantRoutes = require('./modules/tenant/tenant.routes');
const settingsRoutes = require('./modules/settings/settings.routes');
const paymentGatewaysRoutes = require('./modules/paymentGateways/paymentGateways.routes');
const recaptchaRoutes = require('./modules/recaptcha/recaptcha.routes');
const freeTrialRoutes = require('./modules/freeTrial/freeTrial.routes');
const accountSettingsRoutes = require('./modules/accountSettings/accountSettings.routes');
const currencyRoutes = require('./modules/currency/currency.routes');
const authRoutes = require('./modules/auth/auth.routes');
const lettersRoutes = require('./modules/letters/letters.routes');
const employeesRoutes = require('./modules/employees/employees.routes');
const { attendanceAdminRoutes, leaveAdminRoutes } = employeesRoutes;
const messagesRoutes = require('./modules/messages/messages.routes');
const tenantSettingsRoutes = require('./modules/tenantSettings/tenantSettings.routes');
const attendanceSettingsRoutes = require('./modules/attendanceSettings/attendanceSettings.routes');
const assetSettingsRoutes = require('./modules/assetSettings/assetSettings.routes');
const passwordSecurityRoutes = require('./modules/passwordSecurity/passwordSecurity.routes');
const notificationSettingsRoutes = require('./modules/notificationSettings/notificationSettings.routes');
const documentSettingsRoutes = require('./modules/documentSettings/documentSettings.routes');
const sensitiveDataRoutes = require('./modules/sensitiveData/sensitiveData.routes');
const leaveSettingsRoutes = require('./modules/leaveSettings/leaveSettings.routes');
const departmentsRoutes = require('./modules/departments/departments.routes');
const designationsRoutes = require('./modules/designations/designations.routes');
const exitSettingsRoutes = require('./modules/exitSettings/exitSettings.routes');
const exitManagementRoutes = require('./modules/exitManagement/exitManagement.routes');
const exitWorkflowConfigRoutes = require('./modules/exitWorkflowConfig/exitWorkflowConfig.routes');
const visaTypesRoutes = require('./modules/visa-types/visa-types.routes');
const visaRecordsRoutes = require('./modules/visa-records/visa-records.routes');
const publicOnboardingRoutes = require('./routes/public/onboardingRoutes');
const adminDocumentsRoutes = require('./modules/adminDocuments/adminDocuments.routes');
const performanceCyclesRoutes = require('./modules/performanceCycles/performanceCycles.routes');
const competencyRoutes = require('./routes/competencyRoutes');
const employeePerformanceRoutes = require('./routes/employeePerformanceRoutes');
const managerPerformanceRoutes = require('./routes/managerPerformanceRoutes');
const performanceExportRoutes = require('./routes/performance.routes');
const supportRoutes = require('./routes/support.routes');
const superadminSupportRoutes = require('./routes/superadminSupport.routes');
const { getCyclesDropdown, getCompetenciesDropdown } = require('./controllers/employeePerformanceController');
const { authenticate, loadAuthContext } = require('./middlewares/auth.middleware');

const { generalLimiter } = require('./middlewares/rateLimit.middleware');

const app = express();

/* -------------------- Security & parsers -------------------- */

app.disable('x-powered-by');
app.use(cors(createCorsOptions()));

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
}));

// Apply general rate limit to all requests
app.use(generalLimiter);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

/* -------------------- Static uploads -------------------- */

const UPLOADS_DIR = path.resolve(env.UPLOAD.dir);
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
const LOGOS_DIR = path.join(UPLOADS_DIR, 'logos');
if (!fs.existsSync(LOGOS_DIR)) {
  fs.mkdirSync(LOGOS_DIR, { recursive: true });
}
const TENANT_LOGOS_DIR = path.join(UPLOADS_DIR, 'tenant-logos');
if (!fs.existsSync(TENANT_LOGOS_DIR)) {
  fs.mkdirSync(TENANT_LOGOS_DIR, { recursive: true });
}
const SUPERADMIN_LOGOS_DIR = path.join(UPLOADS_DIR, 'superadmin-logos');
if (!fs.existsSync(SUPERADMIN_LOGOS_DIR)) {
  fs.mkdirSync(SUPERADMIN_LOGOS_DIR, { recursive: true });
}
app.use('/uploads', express.static(UPLOADS_DIR, {
  fallthrough: true,
  maxAge: '1d',
  index: false,
}));

app.use(
  '/uploads/tenant-logos',
  express.static(TENANT_LOGOS_DIR, {
    fallthrough: true,
    maxAge: '1d',
    index: false,
  }),
);

app.use(
  '/uploads/superadmin-logos',
  express.static(SUPERADMIN_LOGOS_DIR, {
    fallthrough: true,
    maxAge: '1d',
    index: false,
  }),
);

/* -------------------- Health -------------------- */

app.get('/health', (_req, res) => {
  return ApiResponse.ok(res, { uptime: process.uptime() }, 'OK');
});

/* -------------------- API v1 -------------------- */

app.use('/api/v1/superadmin', superadminRoutes);
app.use('/api/v1/superadmin/plans', plansRoutes);
app.use('/api/v1/superadmin/features', featuresRoutes);
app.use('/api/v1/tenants', tenantRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/payment-gateways', paymentGatewaysRoutes);
app.use('/api/v1/billing', require('./modules/billing/billing.routes'));
app.use('/api/v1/recaptcha', recaptchaRoutes);
app.use('/api/v1/free-trial', freeTrialRoutes);
app.use('/api/v1/account-settings', accountSettingsRoutes);
app.use('/api/v1/currency', currencyRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/letters', lettersRoutes);
app.use('/api/v1/employees', employeesRoutes);
app.use('/api/v1/attendance', attendanceAdminRoutes);
app.use('/api/v1/leave', leaveAdminRoutes);
// Standalone dropdowns (placed BEFORE general routers to avoid wildcard matching)
app.get('/api/v1/performance-cycles/dropdown', authenticate, loadAuthContext, getCyclesDropdown);
app.get('/api/performance-cycles/dropdown', authenticate, loadAuthContext, getCyclesDropdown);
app.get('/api/v1/competencies/dropdown', authenticate, loadAuthContext, getCompetenciesDropdown);
app.get('/api/competencies/dropdown', authenticate, loadAuthContext, getCompetenciesDropdown);

app.use('/api/v1/performance-cycles', performanceCyclesRoutes);
app.use('/api/v1/competencies', competencyRoutes);
app.use('/api/competencies', competencyRoutes);

// Employee Performance Assessment endpoints
app.use('/api/v1/employee-performance', employeePerformanceRoutes);
app.use('/api/employee-performance', employeePerformanceRoutes);

// Performance Export endpoints
app.use('/api/v1/performance', performanceExportRoutes);
app.use('/api/performance', performanceExportRoutes);

// Manager Performance Review endpoints
app.use('/api/v1/manager/performance', managerPerformanceRoutes);
app.use('/api/manager/performance', managerPerformanceRoutes);

app.use('/api/v1/messages', messagesRoutes);
app.use('/api/v1/admin/settings/assets', assetSettingsRoutes);
app.use('/api/v1/admin/settings/attendance', attendanceSettingsRoutes);
app.use('/api/v1/admin/settings/password-security', passwordSecurityRoutes);
app.use('/api/v1/admin/settings/notifications', notificationSettingsRoutes);
app.use('/api/v1/admin/settings/documents', documentSettingsRoutes);
app.use('/api/v1/admin/settings/sensitive-data', sensitiveDataRoutes);
app.use('/api/v1/admin/settings/leave-types', leaveSettingsRoutes);
app.use('/api/v1/departments', departmentsRoutes);
app.use('/api/v1/assets', require('./modules/assets/assets.routes'));
app.use('/api/v1/tasks', require('./modules/tasks/tasks.routes'));
app.use('/api/v1/notifications', require('./modules/notifications/notifications.routes'));
app.use('/api/v1/policies', require('./modules/policies/policies.routes'));
app.use('/api/v1/expenses', require('./modules/expenses/expenses.routes'));
app.use('/api/v1/expense-categories', require('./modules/expenseCategories/expenseCategories.routes'));
app.use('/api/v1/designations', designationsRoutes);
app.use('/api/v1/visa-types', visaTypesRoutes);
app.use('/api/v1/visa-records', visaRecordsRoutes);
app.use('/api/v1/admin/announcements', require('./modules/announcements/announcements.routes'));
app.use('/api/v1/admin/settings/termination-types', exitSettingsRoutes);
app.use('/api/v1/exit-management', exitManagementRoutes);
app.use('/api/v1/admin/settings/exit-workflows', exitWorkflowConfigRoutes);
app.use('/api/v1/admin/settings', tenantSettingsRoutes);
app.use('/api/v1/admin/documents', adminDocumentsRoutes);
app.use('/api/v1/admin/payroll', require('./modules/payroll/payroll.routes'));
app.use('/api/v1/public/onboarding', publicOnboardingRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/admin/support', supportRoutes);
app.use('/api/superadmin/support', superadminSupportRoutes);
app.use(
  '/api/v1/public/candidate-onboarding',
  require('./routes/public/candidateOnboardingRoutes'),
);

/* -------------------- 404 + Errors -------------------- */

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
