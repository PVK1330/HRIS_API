'use strict';

const { Router } = require('express');
const { validateWithJoi } = require('../../middlewares/joiValidate.middleware');
const {
  authenticate,
  loadAuthContext,
  requirePermission,
} = require('../../middlewares/auth.middleware');
const { P } = require('../../constants/permissions');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const ApiError = require('../../utils/ApiError');
const { uploadVisaDocuments } = require('../../middlewares/visaUpload.middleware');
const ctrl = require('./visa-records.controller');
const v = require('./visa-records.validator');

const router = Router();
router.use(authenticate, tenantResolver, loadAuthContext);

function handleMulter(req, res, next) {
  uploadVisaDocuments(req, res, (err) => {
    if (!err) return next();
    if (err instanceof ApiError) return next(err);
    return next(ApiError.badRequest(err.message || 'Upload failed'));
  });
}

router.get('/stats', requirePermission(P.VISA_VIEW), ctrl.stats);
router.get('/filter-options', requirePermission(P.VISA_VIEW), ctrl.filterOptions);
router.get('/export', requirePermission(P.VISA_VIEW), validateWithJoi(v.exportQuery, 'query'), ctrl.exportList);
router.get('/', requirePermission(P.VISA_VIEW), validateWithJoi(v.listingQuery, 'query'), ctrl.list);
router.get('/:id', requirePermission(P.VISA_VIEW), validateWithJoi(v.idParam, 'params'), ctrl.getOne);

router.post(
  '/',
  requirePermission(P.VISA_MANAGE),
  handleMulter,
  validateWithJoi(v.createBody, 'body'),
  ctrl.create,
);

router.put(
  '/:id',
  requirePermission(P.VISA_MANAGE),
  validateWithJoi(v.idParam, 'params'),
  handleMulter,
  validateWithJoi(v.updateBody, 'body'),
  ctrl.update,
);

router.delete('/:id', requirePermission(P.VISA_MANAGE), validateWithJoi(v.idParam, 'params'), ctrl.remove);

module.exports = router;
