'use strict';

const bcrypt = require('bcrypt');
const db = require('../config/db');
const logger = require('../utils/logger');

const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12;

async function resetManagerPassword() {
  try {
    const tenantResult = await db.query('SELECT db_name FROM public.tenants LIMIT 1');
    if (!tenantResult.rows.length) {
      throw new Error('No tenants found');
    }
    
    const tenantPool = db.getTenantPool(tenantResult.rows[0].db_name);
    const managerEmail = 'gaurav111@gmail.com';
    const managerPassword = 'gaurav111@gmail.com';
    
    // Hash the new password
    const passwordHash = await bcrypt.hash(managerPassword, SALT_ROUNDS);
    
    // Update the user with new password and enable portal
    await tenantPool.query(
      `UPDATE employees 
       SET password_hash = $1, portal_enabled = true, employment_status = 'Active'
       WHERE work_email = $2`,
      [passwordHash, managerEmail]
    );
    
    // Verify
    const check = await tenantPool.query(
      `SELECT emp_id, work_email, portal_enabled, password_hash IS NOT NULL as has_password,
              employment_status FROM employees WHERE work_email = $1`,
      [managerEmail]
    );
    
    if (check.rows.length === 0) {
      throw new Error('User not found after update');
    }
    
    const user = check.rows[0];
    logger.info('✓ Manager password reset successfully');
    logger.info('User details:');
    logger.info('  Employee ID:', user.emp_id);
    logger.info('  Email:', user.work_email);
    logger.info('  Portal Enabled:', user.portal_enabled);
    logger.info('  Password Hash Set:', user.has_password);
    logger.info('  Employment Status:', user.employment_status);
    logger.info('');
    logger.info('Login Credentials:');
    logger.info('  Email: gaurav111@gmail.com');
    logger.info('  Password: gaurav111@gmail.com');
    logger.info('  Endpoint: POST http://localhost:5000/api/v1/auth/login');
    
    process.exit(0);
  } catch (err) {
    logger.error('Error:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  resetManagerPassword();
}

module.exports = { resetManagerPassword };
