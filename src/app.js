'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const env = require('./config/env');
const ApiResponse = require('./utils/ApiResponse');
const { notFoundHandler, errorHandler } = require('./middlewares/error.middleware');

const superadminRoutes = require('./modules/superadmin/superadmin.routes');
const plansRoutes = require('./modules/superadmin/plans.routes');
const featuresRoutes = require('./modules/superadmin/features.routes');
const tenantRoutes = require('./modules/tenant/tenant.routes');
const settingsRoutes = require('./modules/settings/settings.routes');

const app = express();

/* -------------------- Security & parsers -------------------- */

app.disable('x-powered-by');
// crossOriginResourcePolicy needs to be relaxed so logos/favicons served
// from /uploads can be embedded by the SuperAdmin frontend on a different origin.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

const corsOrigins = env.CORS_ORIGINS;
const corsOptions =
  corsOrigins.includes('*')
    ? { origin: true, credentials: true }
    : { origin: corsOrigins, credentials: true };
app.use(cors(corsOptions));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

/* -------------------- Static uploads -------------------- */

const UPLOADS_DIR = path.join(__dirname, 'uploads');
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

/* -------------------- 404 + Errors -------------------- */

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
