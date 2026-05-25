const fs = require('fs');
const path = 'c:/Users/pkk22/OneDrive/Desktop/TECHNOWEB/HRIS PROJECT/HRIS_PROJECT/HRIS_API/src/middlewares/upload.middleware.js';
let content = fs.readFileSync(path, 'utf8');

if (!content.includes("require('multer-s3')")) {
  const requires = `const aws = require('../config/aws');\nconst multerS3 = require('multer-s3');\n`;
  content = content.replace("const multer = require('multer');", "const multer = require('multer');\n" + requires);
}

// Replace tenantLogoStorage
const tenantLogoS3 = `const tenantLogoStorage = aws.isS3Configured
  ? multerS3({
      s3: aws.s3Client,
      bucket: aws.bucketName,
      key: function (req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        const tenantId = req.tenant?.id != null ? String(req.tenant.id) : 'unknown';
        cb(null, \`tenant-logos/\${tenantId}-\${Date.now()}\${ext}\`);
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
        cb(null, \`\${tenantId}-\${Date.now()}\${ext}\`);
      },
    });`;

content = content.replace(/const tenantLogoStorage = multer\.diskStorage\(\{[\s\S]*?\}\);/m, tenantLogoS3);

// Replace storage
const genericS3 = `const storage = aws.isS3Configured
  ? multerS3({
      s3: aws.s3Client,
      bucket: aws.bucketName,
      key: function (req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        const type = (req.params && req.params.type) || req.logoType || 'logo';
        const safeType = String(type).replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'logo';
        cb(null, \`logos/\${safeType}-\${Date.now()}\${ext}\`);
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
        cb(null, \`\${safeType}-\${Date.now()}\${ext}\`);
      },
    });`;

content = content.replace(/const storage = multer\.diskStorage\(\{[\s\S]*?\}\);/m, genericS3);

// Replace superadminLogoStorage
const superadminS3 = `const superadminLogoStorage = aws.isS3Configured
  ? multerS3({
      s3: aws.s3Client,
      bucket: aws.bucketName,
      key: function (req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        const type = (req.params && req.params.type) || req.logoType || 'logo';
        const safeType = String(type).replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'logo';
        cb(null, \`superadmin-logos/\${safeType}-\${Date.now()}\${ext}\`);
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
        cb(null, \`superadmin-\${safeType}-\${Date.now()}\${ext}\`);
      },
    });`;

content = content.replace(/const superadminLogoStorage = multer\.diskStorage\(\{[\s\S]*?\}\);/m, superadminS3);

fs.writeFileSync(path, content);
console.log('Done refactoring upload.middleware.js');
