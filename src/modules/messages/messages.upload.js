'use strict';

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');

const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'application/zip',
  'application/x-zip-compressed',
]);

const MAX_FILE_BYTES = (parseInt(process.env.MESSAGE_UPLOAD_MAX_MB, 10) || 15) * 1024 * 1024;

const storage = multer.diskStorage({
  destination(req, _file, cb) {
    const tenantDb = req.user?.db_name || 'default';
    const dir = path.resolve(env.UPLOAD.dir, 'messages', tenantDb);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const base = path.basename(file.originalname || 'file', ext)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 80);
    cb(null, `${Date.now()}-${base}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter(_req, file, cb) {
    const mime = (file.mimetype || '').toLowerCase();
    if (ALLOWED_MIMES.has(mime)) return cb(null, true);
    cb(new Error('File type not allowed. Use images, PDF, Word, Excel, TXT, or ZIP.'));
  },
});

function messageFileMiddleware(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(ApiError.badRequest(`File too large (max ${MAX_FILE_BYTES / (1024 * 1024)}MB)`));
    }
    return next(ApiError.badRequest(err.message || 'Upload failed'));
  });
}

function inferMessageType(mime) {
  if (String(mime || '').startsWith('image/')) return 'image';
  return 'file';
}

module.exports = {
  messageFileMiddleware,
  inferMessageType,
  MAX_FILE_BYTES,
};
