'use strict';

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const aws = require('../config/aws');
const multerS3 = require('multer-s3');


const env = require('../config/env');
const ApiError = require('../utils/ApiError');

// Resolve the logos dir from the same source of truth as express.static in
// app.js (env.UPLOAD.dir), so multer writes to exactly the directory that
// /uploads serves. Without this, files land somewhere static can't see.
const UPLOADS_DIR = path.resolve(env.UPLOAD.dir);
const LOGO_DIR = path.join(UPLOADS_DIR, 'logos');
const TENANT_LOGO_DIR = path.join(UPLOADS_DIR, 'tenant-logos');
const SUPERADMIN_LOGO_DIR = path.join(UPLOADS_DIR, 'superadmin-logos');
const MAX_SIZE_MB = Math.round(env.UPLOAD.maxSize / (1024 * 1024)) || 2;
const MAX_SIZE_BYTES = env.UPLOAD.maxSize;

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.svg', '.ico', '.pdf', '.doc', '.docx', '.xls', '.xlsx']);
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

function ensureLogoDir() {
  if (!fs.existsSync(LOGO_DIR)) {
    fs.mkdirSync(LOGO_DIR, { recursive: true });
  }
}

function ensureTenantLogoDir() {
  if (!fs.existsSync(TENANT_LOGO_DIR)) {
    fs.mkdirSync(TENANT_LOGO_DIR, { recursive: true });
  }
}

const TENANT_LOGO_EXT = new Set(['.png', '.jpg', '.jpeg', '.svg']);
const TENANT_LOGO_MIME = new Set(['image/png', 'image/jpeg', 'image/svg+xml']);

const SUPPORT_UPLOAD_DIR = path.join(UPLOADS_DIR, 'support-attachments');

function ensureSupportUploadDir() {
  if (!fs.existsSync(SUPPORT_UPLOAD_DIR)) {
    fs.mkdirSync(SUPPORT_UPLOAD_DIR, { recursive: true });
  }
}

const supportStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    try {
      ensureSupportUploadDir();
      cb(null, SUPPORT_UPLOAD_DIR);
    } catch (err) {
      cb(err);
    }
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `support-attachment-${Date.now()}${ext}`);
  },
});

const supportUploader = multer({
  storage: supportStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter,
});

function uploadSupportFile(fieldName) {
  const single = supportUploader.single(fieldName);
  return function uploadSupportFileMiddleware(req, res, next) {
    single(req, res, function handleMulter(err) {
      if (!err) return next();
      if (err instanceof ApiError) return next(err);
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(new ApiError(400, 'Attachment must be under 10MB'));
        }
        return next(new ApiError(400, `Upload error: ${err.message}`));
      }
      return next(new ApiError(400, err.message || 'File upload failed'));
    });
  };
}

const tenantLogoStorage = aws.isS3Configured
  ? multerS3({
      s3: aws.s3Client,
      bucket: aws.bucketName,
      key: function (req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        const tenantId = req.tenant?.id != null ? String(req.tenant.id) : 'unknown';
        cb(null, `tenant-logos/${tenantId}-${Date.now()}${ext}`);
      }
    })
  : multer.diskStorage({
      destination(_req, _file, cb) {
        try {
          ensureTenantLogoDir();
          cb(null, TENANT_LOGO_DIR);
        } catch (err) {
          cb(err);
        }
      },
      filename(req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        const tenantId = req.tenant?.id != null ? String(req.tenant.id) : 'unknown';
        cb(null, `${tenantId}-${Date.now()}${ext}`);
      },
    });

function tenantLogoFileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!TENANT_LOGO_EXT.has(ext) || !TENANT_LOGO_MIME.has(file.mimetype)) {
    return cb(new ApiError(400, 'Only PNG, JPG, SVG files are allowed'));
  }
  cb(null, true);
}

const tenantLogoUploader = multer({
  storage: tenantLogoStorage,
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: tenantLogoFileFilter,
});

/**
 * Multer-style `.single(field)` for tenant logo uploads (runs after tenantResolver).
 */
const uploadTenantLogo = {
  single(fieldName) {
    return function tenantLogoUploadMiddleware(req, res, next) {
      const run = tenantLogoUploader.single(fieldName);
      run(req, res, function handleMulter(err) {
        if (!err) return next();
        if (err instanceof ApiError) return next(err);
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return next(new ApiError(400, 'Logo must be under 2MB'));
          }
          return next(new ApiError(400, `Upload error: ${err.message}`));
        }
        return next(new ApiError(400, err.message || 'File upload failed'));
      });
    };
  },
};

/**
 * Build a multer instance whose filename is `<type>-<timestamp>.<ext>`.
 *
 * `type` comes from req.params.type (set in the route via :type) or from a
 * route-bound prefix (e.g. via .single() being mounted under a path that
 * already encodes it). We default to `logo` so a plain field name still
 * works in case a route forgets to set req.params.type.
 */
const storage = aws.isS3Configured
  ? multerS3({
      s3: aws.s3Client,
      bucket: aws.bucketName,
      key: function (req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        const type = (req.params && req.params.type) || req.logoType || 'logo';
        const safeType = String(type).replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'logo';
        cb(null, `logos/${safeType}-${Date.now()}${ext}`);
      }
    })
  : multer.diskStorage({
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

function ensureSuperadminLogoDir() {
  if (!fs.existsSync(SUPERADMIN_LOGO_DIR)) {
    fs.mkdirSync(SUPERADMIN_LOGO_DIR, { recursive: true });
  }
}

const superadminLogoStorage = aws.isS3Configured
  ? multerS3({
      s3: aws.s3Client,
      bucket: aws.bucketName,
      key: function (req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        const type = (req.params && req.params.type) || req.logoType || 'logo';
        const safeType = String(type).replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'logo';
        cb(null, `superadmin-logos/${safeType}-${Date.now()}${ext}`);
      }
    })
  : multer.diskStorage({
      destination(_req, _file, cb) {
        try {
          ensureSuperadminLogoDir();
          cb(null, SUPERADMIN_LOGO_DIR);
        } catch (err) {
          cb(err);
        }
      },
      filename(req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        const type = (req.params && req.params.type) || req.logoType || 'logo';
        const safeType = String(type).replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'logo';
        cb(null, `superadmin-${safeType}-${Date.now()}${ext}`);
      },
    });

const superadminLogoUploader = multer({
  storage: superadminLogoStorage,
  limits: { fileSize: MAX_SIZE_BYTES, files: 1 },
  fileFilter,
});

/**
 * Superadmin platform logos — stored under uploads/superadmin-logos/ (central DB only).
 */
function uploadSuperAdminLogo(type) {
  const single = superadminLogoUploader.single('logo');
  return function uploadSuperAdminLogoMiddleware(req, res, next) {
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

function uploadFile(fieldName, type = 'document') {
  const single = uploader.single(fieldName);
  return function uploadFileMiddleware(req, res, next) {
    req.logoType = type; // reusing storage logic that looks at req.logoType
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
  uploadSuperAdminLogo,
  uploadTenantLogo,
  uploadSupportFile,
  uploadFile,
  LOGO_DIR,
  TENANT_LOGO_DIR,
  SUPERADMIN_LOGO_DIR,
  MAX_SIZE_MB,
};
