'use strict';

const multer = require('multer');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']);

function fileFilter(_req, file, cb) {
  if (!ALLOWED.has(file.mimetype)) {
    return cb(new ApiError(400, 'Only PDF, JPG, or PNG files are allowed'));
  }
  cb(null, true);
}

const uploadEmployeeDocument = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.min(MAX_BYTES, env.UPLOAD.maxSize || MAX_BYTES) },
  fileFilter,
}).single('file');

module.exports = { uploadEmployeeDocument, MAX_BYTES };
