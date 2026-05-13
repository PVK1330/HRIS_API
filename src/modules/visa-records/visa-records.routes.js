'use strict';

const { Router } = require('express');
const { validateWithJoi } = require('../../middlewares/joiValidate.middleware');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const ApiError = require('../../utils/ApiError');
const { uploadVisaDocuments } = require('../../middlewares/visaUpload.middleware');
const ctrl = require('./visa-records.controller');
const v = require('./visa-records.validator');

const router = Router();
router.use(authenticate, tenantResolver);

function handleMulter(req, res, next) {
  uploadVisaDocuments(req, res, (err) => {
    if (!err) return next();
    if (err instanceof ApiError) return next(err);
    return next(ApiError.badRequest(err.message || 'Upload failed'));
  });
}

router.get('/stats', ctrl.stats);
router.get('/filter-options', ctrl.filterOptions);
router.get('/export', validateWithJoi(v.exportQuery, 'query'), ctrl.exportList);
router.get('/', validateWithJoi(v.listingQuery, 'query'), ctrl.list);
router.get('/:id', validateWithJoi(v.idParam, 'params'), ctrl.getOne);

router.post(
  '/',
  requireRole('admin', 'hr_admin'),
  handleMulter,
  validateWithJoi(v.createBody, 'body'),
  ctrl.create,
);

router.put(
  '/:id',
  requireRole('admin', 'hr_admin'),
  validateWithJoi(v.idParam, 'params'),
  handleMulter,
  validateWithJoi(v.updateBody, 'body'),
  ctrl.update,
);

router.delete('/:id', requireRole('admin', 'hr_admin'), validateWithJoi(v.idParam, 'params'), ctrl.remove);

module.exports = router;
