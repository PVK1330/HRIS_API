const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const superadminSupportController = require('../controllers/superadminSupport.controller');

const router = express.Router();

/**
 * Superadmin Support Ticket Routes
 * All routes require superadmin authentication
 * Middleware: authenticate
 */

// Get statistics for all tickets
router.get('/stats', authenticate, superadminSupportController.getStats);

// Get all tickets with filtering and pagination
router.get('/', authenticate, superadminSupportController.listAllTickets);

// Get single ticket details
router.get('/:id', authenticate, superadminSupportController.getTicketDetails);

// Update ticket status
router.put('/:id/status', authenticate, superadminSupportController.updateStatus);

// Add reply/response to ticket
router.post('/:id/reply', authenticate, superadminSupportController.addReply);

module.exports = router;
