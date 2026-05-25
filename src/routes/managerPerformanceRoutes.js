'use strict';

const { Router } = require('express');
const { authenticate, loadAuthContext } = require('../middlewares/auth.middleware');
const ctrl = require('../controllers/employeePerformanceController');

const router = Router();
router.use(authenticate, loadAuthContext);

// Manager Performance Review endpoints
router.get('/reviews', ctrl.getManagerReviewList);
router.get('/reviews/:id', ctrl.getManagerReviewById);

// Manager Department endpoint - get the department assigned to this manager
router.get('/department', ctrl.getManagerDepartment);

module.exports = router;
