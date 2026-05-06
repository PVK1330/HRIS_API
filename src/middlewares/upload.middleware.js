'use strict';

const fs = require('fs');
const path = require('path');
const multer = require('multer');

const env = require('../config/env');
const ApiError = require('../utils/ApiError');

// Resolve the logos dir from the same source of truth as express.static in
// app.js (env.UPLOAD.dir), so multer writes to exactly the directory that
// /uploads serves. Without this, files land somewhere static can't see.
const UPLOADS_DIR = path.resolve(env.UPLOAD.dir);
const LOGO_DIR = path.join(UPLOADS_DIR, 'logos');
const MAX_SIZE_MB = Math.round(env.UPLOAD.maxSize / (1024 * 1024)) || 2;
const MAX_SIZE_BYTES = env.UPLOAD.maxSize;

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.svg', '.ico']);
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

function ensureLogoDir() {
  if (!fs.existsSync(LOGO_DIR)) {
    fs.mkdirSync(LOGO_DIR, { recursive: true });
  }
}

/**
 * Build a multer instance whose filename is `<type>-<timestamp>.<ext>`.
 *
 * `type` comes from req.params.type (set in the route via :type) or from a
 * route-bound prefix (e.g. via .single() being mounted under a path that
 * already encodes it). We default to `logo` so a plain field name still
 * works in case a route forgets to set req.params.type.
 */
const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    try {
      ensureLogoDir();
      cb(null, LOGO_DIR);
    } catch (err) {
      cb(err);
    }
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const type = (req.params && req.params.type) || req.logoType || 'logo';
    const safeType = String(type).replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'logo';
    cb(null, `${safeType}-${Date.now()}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXT.has(ext) || !ALLOWED_MIME.has(file.mimetype)) {
    return cb(
      new ApiError(
        400,
        `Invalid file type. Allowed: ${[...ALLOWED_EXT].join(', ')}`
      )
    );
  }
  cb(null, true);
}

const uploader = multer({
  storage,
  limits: { fileSize: MAX_SIZE_BYTES, files: 1 },
  fileFilter,
});

/**
 * Express middleware factory: returns a handler that uploads a single file
 * under field name `logo`, transforms multer errors into ApiError instances,
 * and stores the logo `type` (large/small/favicon) on req before storage.
 *
 * Usage:
 *   router.post('/large', uploadLogo('large'), controller.uploadLogo)
 */
function uploadLogo(type) {
  const single = uploader.single('logo');
  return function uploadLogoMiddleware(req, res, next) {
    req.logoType = type;
    single(req, res, function handleMulter(err) {
      if (!err) return next();
      if (err instanceof ApiError) return next(err);
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(
            new ApiError(400, `File is too large. Max size is ${MAX_SIZE_MB}MB`)
          );
        }
        return next(new ApiError(400, `Upload error: ${err.message}`));
      }
      return next(new ApiError(400, err.message || 'File upload failed'));
    });
  };
}

module.exports = {
  uploadLogo,
  LOGO_DIR,
  MAX_SIZE_MB,
};
