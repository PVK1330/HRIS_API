'use strict';

const { Router } = require('express');
const { authenticate, loadAuthContext } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const { uploadFile } = require('../../middlewares/upload.middleware');
const ctrl = require('./expenses.controller');

const router = Router();

// Apply authentication, tenant resolving, and authorization context to all routes
router.use(authenticate, tenantResolver, loadAuthContext);

// Get statistics / summary (must be defined BEFORE /:id parameter)
router.get('/statistics', ctrl.getStats);
router.get('/summary', ctrl.getStats);

// Get all claims with pagination, search, and filter
router.get('/', ctrl.list);

// Create new expense claim with receipt upload (both /create and root POST)
router.post('/create', uploadFile('receipt', 'receipt'), ctrl.create);
router.post('/', uploadFile('receipt', 'receipt'), ctrl.create);

// Get single claim by ID
router.get('/:id', ctrl.getOne);

// Update claim (draft / rejected — fields as JSON)
router.patch('/:id', ctrl.update);

// Update claim status
router.put('/:id/status', ctrl.updateStatus);

// Delete claim
router.delete('/:id', ctrl.remove);

module.exports = router;
