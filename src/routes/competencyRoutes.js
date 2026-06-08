'use strict';

const { Router } = require('express');
const {
  authenticate,
  loadAuthContext,
  requirePermission,
} = require('../middlewares/auth.middleware');
const { P } = require('../constants/permissions');
const ctrl = require('../controllers/competencyController');

const router = Router();

// Apply authentication to all routes
router.use(authenticate, loadAuthContext);

// GET /api/v1/competencies/summary or /api/competencies/summary
router.get('/summary', requirePermission(P.PERFORMANCE_VIEW), ctrl.getSummary);

// GET /api/v1/competencies or /api/competencies
router.get('/', requirePermission(P.PERFORMANCE_VIEW), ctrl.getAllCompetencies);

// POST /api/v1/competencies or /api/competencies
router.post('/', requirePermission(P.PERFORMANCE_MANAGE), ctrl.createCompetency);

// PUT /api/v1/competencies/:id or /api/competencies/:id
router.put('/:id', requirePermission(P.PERFORMANCE_MANAGE), ctrl.updateCompetency);

// DELETE /api/v1/competencies/:id or /api/competencies/:id
router.delete('/:id', requirePermission(P.PERFORMANCE_MANAGE), ctrl.deleteCompetency);

module.exports = router;
