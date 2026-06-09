'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');

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
const holidaysRoutes = require('./modules/holidays/holidays.routes');
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
const onboardingSettingsRoutes = require('./modules/onboardingHandover/onboardingHandover.routes');
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
const { authenticate, authenticateUpload, loadAuthContext } = require('./middlewares/auth.middleware');

const { generalLimiter } = require('./middlewares/rateLimit.middleware');

const app = express();

/* -------------------- Security & parsers -------------------- */

// Trust the reverse proxy (if configured) so req.ip is the real client IP from
// X-Forwarded-For. Without this, behind a proxy every user shares the proxy's
// single IP and the rate limiter throttles them all together. Defaults to false
// (direct connection); set TRUST_PROXY=1 in production behind one proxy hop.
app.set('trust proxy', env.TRUST_PROXY);

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
app.use(cookieParser());

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
// Harden every static upload response. SVG uploads are blocked at the multer
// filter (see upload.middleware.js), but these headers neutralize any
// already-stored SVG/HTML and prevent MIME-sniffing as defense-in-depth:
//  - nosniff: a mislabeled file can't be reinterpreted as an active type
//  - script-src/object-src 'none': blocks active content on every response
//  - For risky text-based formats (SVG/XML/HTML) that can carry embedded JS,
//    additionally apply `default-src 'none'` + `sandbox` (no allow-scripts) so
//    that even direct navigation to the file cannot execute script. CSP on a
//    subresource only applies when the file is the top-level document, so
//    inline <img> embedding of legitimate images is unaffected. The strict
//    sandbox is scoped away from PDFs/docs to preserve inline preview.
const RISKY_STATIC_EXT = new Set(['.svg', '.svgz', '.xml', '.html', '.htm', '.xhtml']);

function setUploadHeaders(res, filePath) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const ext = path.extname(filePath || '').toLowerCase();
  if (RISKY_STATIC_EXT.has(ext)) {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'none'; object-src 'none'; sandbox",
    );
    res.setHeader('Content-Disposition', 'attachment');
  } else {
    res.setHeader('Content-Security-Policy', "script-src 'none'; object-src 'none'");
  }
}

const STATIC_OPTS = {
  fallthrough: true,
  maxAge: '1d',
  index: false,
  setHeaders: setUploadHeaders,
};

// Public branding assets — logos are shown on login / branding screens before
// any user is authenticated, so they stay open. These specific mounts come
// FIRST so they win over the private catch-all below.
app.use('/uploads/logos', express.static(LOGOS_DIR, STATIC_OPTS));
app.use('/uploads/tenant-logos', express.static(TENANT_LOGOS_DIR, STATIC_OPTS));
app.use('/uploads/superadmin-logos', express.static(SUPERADMIN_LOGOS_DIR, STATIC_OPTS));

// Everything else under /uploads is private (offer letters, candidate ID docs,
// exit/resignation letters, message attachments, policy files, etc.). Require a
// valid JWT, accepted via the Authorization header OR a `?token=` query param
// (browsers can't set headers on <img>/document requests). See CC-1.
app.use('/uploads', authenticateUpload, express.static(UPLOADS_DIR, STATIC_OPTS));

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
app.use('/api/v1/tenant-billing', require('./modules/billing/tenantBilling.routes'));
app.use('/api/v1/recaptcha', recaptchaRoutes);
app.use('/api/v1/free-trial', freeTrialRoutes);
app.use('/api/v1/account-settings', accountSettingsRoutes);
app.use('/api/v1/currency', currencyRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/letters', lettersRoutes);
app.use('/api/v1/employees', employeesRoutes);
app.use('/api/v1/attendance', attendanceAdminRoutes);
app.use('/api/v1/holidays', holidaysRoutes);
app.use('/api/v1/leave', leaveAdminRoutes);
// Standalone dropdowns (placed BEFORE general routers to avoid wildcard matching)
app.get('/api/v1/performance-cycles/dropdown', authenticate, loadAuthContext, getCyclesDropdown);
app.get('/api/v1/competencies/dropdown', authenticate, loadAuthContext, getCompetenciesDropdown);

app.use('/api/v1/performance-cycles', performanceCyclesRoutes);
app.use('/api/v1/competencies', competencyRoutes);

// Employee Performance Assessment endpoints
app.use('/api/v1/employee-performance', employeePerformanceRoutes);

// Performance Export endpoints
app.use('/api/v1/performance', performanceExportRoutes);

// Manager Performance Review endpoints
app.use('/api/v1/manager/performance', managerPerformanceRoutes);

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
app.use('/api/v1/admin/settings/onboarding', onboardingSettingsRoutes);
app.use('/api/v1/admin/documents', adminDocumentsRoutes);
app.use('/api/v1/admin/payroll', require('./modules/payroll/payroll.routes'));
app.use('/api/v1/public/onboarding', publicOnboardingRoutes);
app.use('/api/v1/support', supportRoutes);
app.use('/api/v1/admin/support', supportRoutes);
app.use('/api/v1/superadmin/support', superadminSupportRoutes);
app.use(
  '/api/v1/public/candidate-onboarding',
  require('./routes/public/candidateOnboardingRoutes'),
);

/* -------------------- 404 + Errors -------------------- */

app.use(notFoundHandler);
app.use(errorHandler);

/* -------------------- Startup: email→tenant index backfill -------------------- */

setImmediate(() => {
  require('./utils/userTenantIndex')
    .backfillAll()
    .catch((err) => {
      require('./utils/logger').warn(
        '[startup] userTenantIndex backfill failed — O(N) scan remains as fallback:',
        err.message,
      );
    });
});

module.exports = app;
