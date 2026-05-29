'use strict';

const { Router } = require('express');
const { param, body } = require('express-validator');
const multer = require('multer');
const validate = require('../../middlewares/validate.middleware');
const { tenantResolver } = require('../../middlewares/tenant.middleware');
const { candidateOnboardingLimiter } = require('../../middlewares/rateLimit.middleware');
const ApiError = require('../../utils/ApiError');
const env = require('../../config/env');
const ctrl = require('../../modules/employees/onboarding/candidatePublic.controller');

const router = Router();

const MAX_BYTES = 10 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.min(MAX_BYTES, env.UPLOAD.maxSize || MAX_BYTES) },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'].includes(
      file.mimetype,
    );
    if (!ok) return cb(new ApiError(400, 'Only PDF, JPG, or PNG files are allowed'));
    return cb(null, true);
  },
});

function handleUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return next(ApiError.badRequest('File is too large'));
    }
    return next(err);
  });
}

const tokenParam = param('token').isString().trim().isLength({ min: 16, max: 128 });

/** Allow tenant from query string (email links on plain localhost). */
router.use((req, _res, next) => {
  const fromQuery = req.query.tenant;
  if (fromQuery && !req.headers['x-tenant-id'] && !req.headers['x-tenant-domain']) {
    req.headers['x-tenant-id'] = String(fromQuery);
  }
  next();
});

router.use(tenantResolver);
router.use(candidateOnboardingLimiter);

router.get('/:token', [tokenParam], validate, ctrl.getState);
router.get('/:token/offer.pdf', [tokenParam], validate, ctrl.downloadOffer);
router.post('/:token/accept', [tokenParam], validate, ctrl.accept);
router.post('/:token/reject', [tokenParam, body('reason').optional().isString().trim()], validate, ctrl.reject);
router.post(
  '/:token/sign',
  [
    tokenParam,
    body('signatureMode').optional().isString(),
    body('signatureData').optional().isString(),
    body('typedName').optional().isString(),
  ],
  validate,
  ctrl.sign,
);
router.get('/:token/checklist', [tokenParam], validate, ctrl.checklist);
router.post(
  '/:token/checklist/:documentKey/upload',
  [tokenParam, param('documentKey').isString().trim().isLength({ min: 1, max: 64 })],
  validate,
  handleUpload,
  ctrl.uploadDoc,
);

module.exports = router;
