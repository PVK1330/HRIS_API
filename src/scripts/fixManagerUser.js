'use strict';

const db = require('../config/db');
const logger = require('../utils/logger');

async function fixManagerUser() {
  try {
    // Get tenant pool
    const tenantResult = await db.query('SELECT db_name FROM public.tenants LIMIT 1');
    if (!tenantResult.rows.length) {
      throw new Error('No tenants found');
    }
    
    const tenantPool = db.getTenantPool(tenantResult.rows[0].db_name);
    const managerEmail = 'gaurav111@gmail.com';
    
    // Check current status
    const checkBefore = await tenantPool.query(
      `SELECT id, emp_id, work_email, portal_enabled, password_hash IS NOT NULL as has_password, 
              employment_status FROM employees WHERE work_email = $1`,
      [managerEmail]
    );
    
    if (!checkBefore.rows.length) {
      logger.info('Manager user not found');
      process.exit(1);
    }
    
    const user = checkBefore.rows[0];
    logger.info('Before update:', {
      emp_id: user.emp_id,
      work_email: user.work_email,
      portal_enabled: user.portal_enabled,
      has_password: user.has_password,
      employment_status: user.employment_status
    });
    
    // Update portal and status
    await tenantPool.query(
      `UPDATE employees 
       SET portal_enabled = true, employment_status = 'Active'
       WHERE work_email = $1`,
      [managerEmail]
    );
    
    // Verify update
    const checkAfter = await tenantPool.query(
      `SELECT id, emp_id, work_email, portal_enabled, password_hash IS NOT NULL as has_password,
              employment_status FROM employees WHERE work_email = $1`,
      [managerEmail]
    );
    
    const updatedUser = checkAfter.rows[0];
    logger.info('After update:', {
      emp_id: updatedUser.emp_id,
      work_email: updatedUser.work_email,
      portal_enabled: updatedUser.portal_enabled,
      has_password: updatedUser.has_password,
      employment_status: updatedUser.employment_status
    });
    
    logger.info('Manager user is ready for login!');
    logger.info('Credentials:');
    logger.info('  Email: ' + managerEmail);
    logger.info('  Password: gaurav111@gmail.com');
    logger.info('  Endpoint: POST http://localhost:5000/api/v1/auth/login');
    
    process.exit(0);
  } catch (err) {
    logger.error('Error:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  fixManagerUser();
}

module.exports = { fixManagerUser };
