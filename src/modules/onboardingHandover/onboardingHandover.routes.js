'use strict';

const { Router } = require('express');
const { authenticate, loadAuthContext, requireAnyPermission } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const { requireOrgSettingsAccess } = require('../../middlewares/orgSettingsAccess.middleware');
const { P } = require('../../constants/permissions');
const ctrl = require('./onboardingHandover.controller');

const router = Router();

router.use(authenticate, tenantResolver, loadAuthContext);

router.get(
  '/handover-rules',
  requireAnyPermission(P.ONBOARDING_VIEW, P.ONBOARDING_MANAGE, 'system-settings'),
  ctrl.list,
);

router.use(requireOrgSettingsAccess);

router.post('/handover-rules', requireAnyPermission(P.ONBOARDING_MANAGE, 'system-settings'), ctrl.create);
router.put('/handover-rules/:id', requireAnyPermission(P.ONBOARDING_MANAGE, 'system-settings'), ctrl.update);
router.delete('/handover-rules/:id', requireAnyPermission(P.ONBOARDING_MANAGE, 'system-settings'), ctrl.remove);

module.exports = router;
