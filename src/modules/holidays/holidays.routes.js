'use strict';

const { Router } = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../middlewares/validate.middleware');
const {
  authenticate,
  loadAuthContext,
  requireAnyPermission,
} = require('../../middlewares/auth.middleware');
const { P } = require('../../constants/permissions');
const ctrl = require('./holidays.controller');

const router = Router();
router.use(authenticate, loadAuthContext);

const viewPerm = requireAnyPermission(
  P.ATTENDANCE_SETTINGS_VIEW,
  P.ATTENDANCE_SETTINGS_MANAGE,
  P.ATTENDANCE_MANAGE,
  P.ATTENDANCE_VIEW_ALL,
);

const managePerm = requireAnyPermission(P.ATTENDANCE_SETTINGS_MANAGE, P.ATTENDANCE_MANAGE);

router.get('/', viewPerm, ctrl.list);
router.get('/:calendarId', viewPerm, [param('calendarId').isInt()], validate, ctrl.detail);
router.post('/seed', managePerm, [
  body('year').optional().isInt({ min: 2020, max: 2100 }),
  body('regions').optional().isArray(),
], validate, ctrl.seed);
router.post('/:calendarId/dates', managePerm, [
  param('calendarId').isInt(),
  body('holidayDate').isDate(),
  body('name').isString().trim().notEmpty(),
], validate, ctrl.createDate);
router.patch('/dates/:id', managePerm, [
  param('id').isInt(),
  body('holidayDate').optional().isDate(),
  body('name').optional().isString().trim(),
], validate, ctrl.updateDate);
router.delete('/dates/:id', managePerm, [param('id').isInt()], validate, ctrl.removeDate);

module.exports = router;
