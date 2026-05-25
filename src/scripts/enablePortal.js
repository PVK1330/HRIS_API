'use strict';

const db = require('../config/db');
const logger = require('../utils/logger');

async function enablePortal() {
  try {
    const tenantResult = await db.query('SELECT db_name FROM public.tenants LIMIT 1');
    const tenantPool = db.getTenantPool(tenantResult.rows[0].db_name);
    
    await tenantPool.query(
      'UPDATE employees SET portal_enabled = true WHERE work_email = $1',
      ['gaurav111@gmail.com']
    );
    
    const checkResult = await tenantPool.query(
      'SELECT emp_id, work_email, portal_enabled, password_hash FROM employees WHERE work_email = $1',
      ['gaurav111@gmail.com']
    );
    
    logger.info('Portal enabled:', checkResult.rows[0]);
    process.exit(0);
  } catch (err) {
    logger.error('Error:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  enablePortal();
}

module.exports = { enablePortal };
