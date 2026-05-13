'use strict';

const multer = require('multer');
const ApiError = require('../utils/ApiError');

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']);

function fileFilter(_req, file, cb) {
  if (!ALLOWED.has(file.mimetype)) {
    return cb(new ApiError(400, 'Only PDF, JPG, or PNG files are allowed'));
  }
  cb(null, true);
}

/**
 * Multipart fields for visa document uploads (memory storage — service writes to disk).
 */
const uploadVisaDocuments = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter,
}).fields([
  { name: 'passport_scan', maxCount: 1 },
  { name: 'visa_copy', maxCount: 1 },
  { name: 'emirates_id_front', maxCount: 1 },
  { name: 'emirates_id_back', maxCount: 1 },
]);

module.exports = { uploadVisaDocuments, MAX_BYTES };
