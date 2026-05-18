'use strict';

const { Router } = require('express');
const {
  authenticate,
  loadAuthContext,
} = require('../middlewares/auth.middleware');
const ctrl = require('../controllers/competencyController');

const router = Router();

// Apply authentication to all routes
router.use(authenticate, loadAuthContext);

// GET /api/v1/competencies/summary or /api/competencies/summary
router.get('/summary', ctrl.getSummary);

// GET /api/v1/competencies or /api/competencies
router.get('/', ctrl.getAllCompetencies);

// POST /api/v1/competencies or /api/competencies
router.post('/', ctrl.createCompetency);

// DELETE /api/v1/competencies/:id or /api/competencies/:id
router.delete('/:id', ctrl.deleteCompetency);

module.exports = router;
