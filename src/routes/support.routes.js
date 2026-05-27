'use strict';

const express = require('express');
const { authenticate, loadAuthContext } = require('../middlewares/auth.middleware');
const { tenantResolver } = require('../middlewares/tenant.middleware');
const { uploadSupportFile } = require('../middlewares/upload.middleware');
const supportController = require('../controllers/support.controller');

const router = express.Router();

router.use(authenticate, tenantResolver, loadAuthContext);

router.get('/tickets', supportController.listTickets);
router.post('/tickets', uploadSupportFile('attachment'), supportController.createTicket);
router.get('/tickets/:id', supportController.getTicketById);
router.put('/tickets/:id', uploadSupportFile('attachment'), supportController.updateTicket);
router.delete('/tickets/:id', supportController.deleteTicket);

module.exports = router;
