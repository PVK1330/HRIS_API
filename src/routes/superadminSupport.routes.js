const express = require('express');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const superadminSupportController = require('../controllers/superadminSupport.controller');

const router = express.Router();

/**
 * Superadmin Support Ticket Routes
 * All routes require SUPERADMIN authentication. These endpoints iterate across
 * every tenant database, so they must never be reachable by a regular tenant
 * user — enforce the superadmin role on the whole router.
 */
router.use(authenticate, requireRole('superadmin'));

// Get statistics for all tickets
router.get('/stats', superadminSupportController.getStats);

// Get all tickets with filtering and pagination
router.get('/', superadminSupportController.listAllTickets);
router.get('/tickets', superadminSupportController.listAllTickets);

// Get single ticket details
router.get('/:id', superadminSupportController.getTicketDetails);
router.get('/tickets/:id', superadminSupportController.getTicketDetails);

// Update ticket fields, status, and assignation
router.patch('/:id', superadminSupportController.updateTicket);
router.patch('/tickets/:id', superadminSupportController.updateTicket);

// Delete ticket
router.delete('/:id', superadminSupportController.deleteTicket);
router.delete('/tickets/:id', superadminSupportController.deleteTicket);

// Update ticket status
router.put('/:id/status', superadminSupportController.updateStatus);
router.put('/tickets/:id/status', superadminSupportController.updateStatus);

// Add reply/response to ticket
router.post('/:id/reply', superadminSupportController.addReply);
router.post('/tickets/:id/reply', superadminSupportController.addReply);

module.exports = router;
