'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const env = require('./config/env');
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
const publicOnboardingRoutes = require('./routes/public/onboardingRoutes');

const { generalLimiter } = require('./middlewares/rateLimit.middleware');

const app = express();

/* -------------------- Security & parsers -------------------- */

app.disable('x-powered-by');
const allowedOrigins = env.CORS_ORIGINS;
const corsOptions = {
  origin: allowedOrigins,
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

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
app.use('/uploads', express.static(UPLOADS_DIR, {
  fallthrough: true,
  maxAge: '1d',
  index: false,
}));

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
app.use('/api/v1/recaptcha', recaptchaRoutes);
app.use('/api/v1/free-trial', freeTrialRoutes);
app.use('/api/v1/account-settings', accountSettingsRoutes);
app.use('/api/v1/currency', currencyRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/public/onboarding', publicOnboardingRoutes);

/* -------------------- 404 + Errors -------------------- */

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
