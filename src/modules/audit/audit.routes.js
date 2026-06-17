'use strict';

const { Router } = require('express');
const { authenticate, loadAuthContext, requirePermission } = require('../../middlewares/auth.middleware');
const { P } = require('../../constants/permissions');
const controller = require('./audit.controller');

const router = Router();

// All audit routes require authentication, tenant context, and AUDIT_VIEW permission
router.use(authenticate, loadAuthContext, requirePermission(P.AUDIT_VIEW));

/**
 * GET /api/v1/admin/audit/logs
 * Paginated, filterable audit log list.
 */
router.get('/logs', controller.getLogs);

/**
 * GET /api/v1/admin/audit/modules
 * Distinct module names recorded in audit_logs.
 */
router.get('/modules', controller.getModules);

/**
 * GET /api/v1/admin/audit/actions
 * Distinct action names, optionally filtered by ?module=<name>.
 */
router.get('/actions', controller.getActions);

module.exports = router;

// Also export the service logAction helper for use by other modules
module.exports.logAction = require('./audit.service').logAction;
