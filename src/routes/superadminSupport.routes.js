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
router.get('/tickets', authenticate, superadminSupportController.listAllTickets);

// Get single ticket details
router.get('/:id', authenticate, superadminSupportController.getTicketDetails);
router.get('/tickets/:id', authenticate, superadminSupportController.getTicketDetails);

// Update ticket fields, status, and assignation
router.patch('/:id', authenticate, superadminSupportController.updateTicket);
router.patch('/tickets/:id', authenticate, superadminSupportController.updateTicket);

// Delete ticket
router.delete('/:id', authenticate, superadminSupportController.deleteTicket);
router.delete('/tickets/:id', authenticate, superadminSupportController.deleteTicket);

// Update ticket status
router.put('/:id/status', authenticate, superadminSupportController.updateStatus);
router.put('/tickets/:id/status', authenticate, superadminSupportController.updateStatus);

// Add reply/response to ticket
router.post('/:id/reply', authenticate, superadminSupportController.addReply);
router.post('/tickets/:id/reply', authenticate, superadminSupportController.addReply);

module.exports = router;
