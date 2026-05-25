'use strict';

const db = require('../config/db');
const logger = require('../utils/logger');

async function checkEmployee() {
  try {
    const tenantResult = await db.query('SELECT db_name FROM public.tenants LIMIT 1');
    const tenantPool = db.getTenantPool(tenantResult.rows[0].db_name);
    
    const check = await tenantPool.query(
      `SELECT id, emp_id, work_email, portal_enabled, password_hash, employment_status
       FROM employees WHERE work_email = $1`,
      ['gaurav111@gmail.com']
    );
    
    logger.info('Found rows:', check.rows.length);
    check.rows.forEach((row, idx) => {
      logger.info(`Row ${idx}:`, {
        id: row.id,
        emp_id: row.emp_id,
        work_email: row.work_email,
        portal_enabled: row.portal_enabled,
        password_hash: row.password_hash ? row.password_hash.substring(0, 20) + '...' : 'NULL',
        employment_status: row.employment_status
      });
    });
    
    process.exit(0);
  } catch (err) {
    logger.error('Error:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  checkEmployee();
}

module.exports = { checkEmployee };
