'use strict';

const fs = require('fs');
const path = require('path');

async function getBranding(tenant) {
  const defaults = {
    companyName: process.env.COMPANY_NAME || 'Company',
    logoBuffer: null,
    logoExt: 'png',
  };
  try {
    const { getTenantPool } = require('../config/db');
    const env = require('../config/env');
    const pool = getTenantPool(tenant.db_name);
    const { rows } = await pool.query(
      'SELECT company_name, logo_url FROM tenant_admin_settings ORDER BY id LIMIT 1',
    );
    const row = rows[0];
    if (!row) return defaults;
    const companyName = row.company_name || defaults.companyName;
    let logoBuffer = null;
    let logoExt = 'png';
    if (row.logo_url) {
      const relPath = String(row.logo_url).replace(/^\/uploads\//, '');
      const uploadBase = (env.UPLOAD && env.UPLOAD.dir) ? env.UPLOAD.dir : path.join(__dirname, '..', 'uploads');
      const absPath = path.resolve(process.cwd(), uploadBase, relPath);
      if (fs.existsSync(absPath)) {
        logoBuffer = fs.readFileSync(absPath);
        const ext = path.extname(row.logo_url).toLowerCase().replace('.', '');
        logoExt = ext === 'jpg' ? 'jpeg' : (ext || 'png');
      }
    }
    return { companyName, logoBuffer, logoExt };
  } catch (_) {
    return defaults;
  }
}

module.exports = { getBranding };
