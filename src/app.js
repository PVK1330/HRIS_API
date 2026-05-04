'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const env = require('./config/env');
const ApiResponse = require('./utils/ApiResponse');
const { notFoundHandler, errorHandler } = require('./middlewares/error.middleware');

const superadminRoutes = require('./modules/superadmin/superadmin.routes');
const plansRoutes = require('./modules/superadmin/plans.routes');
const tenantRoutes = require('./modules/tenant/tenant.routes');

const app = express();

/* -------------------- Security & parsers -------------------- */

app.disable('x-powered-by');
app.use(helmet());

const corsOrigins = env.CORS_ORIGINS;
const corsOptions =
  corsOrigins.includes('*')
    ? { origin: true, credentials: true }
    : { origin: corsOrigins, credentials: true };
app.use(cors(corsOptions));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

/* -------------------- Health -------------------- */

app.get('/health', (_req, res) => {
  return ApiResponse.ok(res, { uptime: process.uptime() }, 'OK');
});

/* -------------------- API v1 -------------------- */

app.use('/api/v1/superadmin', superadminRoutes);
app.use('/api/v1/superadmin/plans', plansRoutes);
app.use('/api/v1/tenants', tenantRoutes);

/* -------------------- 404 + Errors -------------------- */

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
