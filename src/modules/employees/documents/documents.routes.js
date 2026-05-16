'use strict';

const { Router } = require('express');
const { body, param } = require('express-validator');
const validate = require('../../../middlewares/validate.middleware');
const { requirePermission } = require('../../../middlewares/auth.middleware');
const { P } = require('../../../constants/permissions');
const ApiError = require('../../../utils/ApiError');
const { uploadEmployeeDocument } = require('../../../middlewares/employeeDocumentUpload.middleware');
const ctrl = require('./documents.controller');
const multer = require('multer');

const { requireEmployeeScopeAccess } = require('../../../middlewares/employeeScope.middleware');

const router = Router({ mergeParams: true });

router.use(requireEmployeeScopeAccess('employeeId'));

const employeeIdParam = param('employeeId').isInt({ min: 1 });

function handleMulter(req, res, next) {
  uploadEmployeeDocument(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return next(ApiError.badRequest('File is too large'));
    }
    if (err instanceof ApiError) return next(err);
    return next(ApiError.badRequest(err.message || 'Upload failed'));
  });
}

router.get('/catalog', requirePermission(P.DOCUMENT_VIEW), [employeeIdParam], validate, ctrl.listCatalog);

router.get('/', requirePermission(P.DOCUMENT_VIEW), [employeeIdParam], validate, ctrl.list);

router.post(
  '/',
  requirePermission(P.DOCUMENT_UPLOAD),
  [employeeIdParam],
  validate,
  handleMulter,
  [
    body('document_type').trim().notEmpty().isLength({ min: 1, max: 100 }),
    body('document_title').optional({ nullable: true }).trim().isLength({ max: 255 }),
    body('document_number').optional({ nullable: true }).trim().isLength({ max: 100 }),
    body('notes').optional({ nullable: true }).trim().isLength({ max: 5000 }),
    body('issue_date').optional({ checkFalsy: true }).matches(/^\d{4}-\d{2}-\d{2}$/),
    body('expiry_date').optional({ checkFalsy: true }).matches(/^\d{4}-\d{2}-\d{2}$/),
  ],
  validate,
  ctrl.create,
);

module.exports = router;
