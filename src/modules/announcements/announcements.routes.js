'use strict';

const express = require('express');
const router = express.Router();
const controller = require('./announcements.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');

router.use(authenticate, tenantResolver);

function requireAnnouncementAdmin(req, res, next) {
  const roles = ['admin', 'hr_admin', 'hr_executive'];
  if (!roles.includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: 'Only HR admins can manage announcements' });
  }
  next();
}

router.get('/', controller.getAll);
router.get('/stats', controller.getStats);
router.post('/', requireAnnouncementAdmin, controller.create);
router.put('/:id', requireAnnouncementAdmin, controller.update);
router.delete('/:id', requireAnnouncementAdmin, controller.remove);

module.exports = router;
