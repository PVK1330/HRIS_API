'use strict';

const { Router } = require('express');
const { validateWithJoi } = require('../../middlewares/joiValidate.middleware');
const { authenticate } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const { loadUserContext, authorizeExitAccess } = require('../exitManagement/exitAuth.middleware');
const ctrl = require('./exitWorkflowConfig.controller');
const v = require('./exitWorkflowConfig.validator');

const router = Router();

// Workflow configuration is ORG-ADMIN only (authorizeExitAccess action:'config').
router.use(authenticate, tenantResolver, loadUserContext, authorizeExitAccess({ action: 'config' }));

router.get('/options', ctrl.options)

// Clearance-item catalog — registered before /:workflowId so the literal path is not
// captured as a workflow id.
router.get('/clearance-items', ctrl.listClearanceItems);
router.post('/clearance-items', validateWithJoi(v.createClearanceItemBody, 'body'), ctrl.createClearanceItem);
router.put('/clearance-items/:itemId', validateWithJoi(v.clearanceItemIdParam, 'params'), validateWithJoi(v.updateClearanceItemBody, 'body'), ctrl.updateClearanceItem);
router.delete('/clearance-items/:itemId', validateWithJoi(v.clearanceItemIdParam, 'params'), ctrl.removeClearanceItem);

router.get('/', ctrl.list);
router.post('/', validateWithJoi(v.createWorkflowBody, 'body'), ctrl.create);
router.get('/:workflowId', validateWithJoi(v.workflowIdParam, 'params'), ctrl.getOne);
router.put('/:workflowId', validateWithJoi(v.workflowIdParam, 'params'), validateWithJoi(v.updateWorkflowBody, 'body'), ctrl.update);
router.put('/:workflowId/activate', validateWithJoi(v.workflowIdParam, 'params'), ctrl.setDefault);
router.delete('/:workflowId', validateWithJoi(v.workflowIdParam, 'params'), ctrl.remove);

module.exports = router;
