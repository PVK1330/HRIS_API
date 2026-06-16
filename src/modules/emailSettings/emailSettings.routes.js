'use strict';

const express = require('express');
const router  = express.Router();

const { authenticate, loadAuthContext } = require('../../middlewares/auth.middleware');
const ctrl = require('./emailSettings.controller');

// All email-settings routes require a valid session + tenant context.
// Role enforcement (admin-only) is handled by the auth middleware's
// loadAuthContext (only tenant admins carry the required role in the JWT).
router.use(authenticate, loadAuthContext);

/**
 * GET  /api/v1/admin/settings/email
 * Retrieve current SMTP / email settings.
 */
router.get('/', ctrl.getEmailSettings);

/**
 * PUT  /api/v1/admin/settings/email
 * Update SMTP / email settings.
 * smtp_password in the body is write-only and never echoed back.
 */
router.put('/', ctrl.updateEmailSettings);

/**
 * POST /api/v1/admin/settings/email/test
 * Attempt a live SMTP connection to verify the saved settings.
 */
router.post('/test', ctrl.testEmailSettings);

module.exports = router;
