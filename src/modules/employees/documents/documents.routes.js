'use strict';

const { Router } = require('express');
const { body, param } = require('express-validator');
const validate = require('../../../middlewares/validate.middleware');
const { requireRole } = require('../../../middlewares/auth.middleware');
const ApiError = require('../../../utils/ApiError');
const { uploadEmployeeDocument } = require('../../../middlewares/employeeDocumentUpload.middleware');
const ctrl = require('./documents.controller');
const multer = require('multer');

const router = Router({ mergeParams: true });

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

router.get('/catalog', [employeeIdParam], validate, ctrl.listCatalog);

router.get('/', [employeeIdParam], validate, ctrl.list);

router.post(
  '/',
  requireRole('superadmin', 'admin', 'hr_admin', 'hr_executive'),
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
