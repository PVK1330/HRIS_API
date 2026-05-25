'use strict';

const db = require('../config/db');
const logger = require('../utils/logger');
const bcrypt = require('bcrypt');

async function diagnoseAndFix() {
  try {
    const tenantResult = await db.query('SELECT db_name FROM public.tenants LIMIT 1');
    const tenantPool = db.getTenantPool(tenantResult.rows[0].db_name);
    
    const managerEmail = 'gaurav111@gmail.com';
    const managerPassword = 'gaurav111@gmail.com';
    
    // Get employee record
    const empResult = await tenantPool.query(
      `SELECT id, emp_id, work_email, portal_enabled, password_hash, 
              employment_status, first_name, last_name
       FROM employees 
       WHERE work_email = $1`,
      [managerEmail]
    );
    
    if (!empResult.rows.length) {
      logger.error('Manager user not found');
      process.exit(1);
    }
    
    const emp = empResult.rows[0];
    logger.info('Current employee record:');
    logger.info('  ID:', emp.id);
    logger.info('  Emp ID:', emp.emp_id);
    logger.info('  Email:', emp.work_email);
    logger.info('  First Name:', emp.first_name);
    logger.info('  Last Name:', emp.last_name);
    logger.info('  Portal Enabled:', emp.portal_enabled);
    logger.info('  Employment Status:', emp.employment_status);
    logger.info('  Has Password Hash:', emp.password_hash ? 'YES' : 'NO');
    
    if (!emp.password_hash) {
      logger.info('');
      logger.info('Fixing: Password hash is NULL, generating new hash...');
      
      const SALT_ROUNDS = 12;
      const newHash = await bcrypt.hash(managerPassword, SALT_ROUNDS);
      
      await tenantPool.query(
        `UPDATE employees 
         SET password_hash = $1, portal_enabled = true, employment_status = 'Active'
         WHERE id = $2`,
        [newHash, emp.id]
      );
      
      logger.info('✓ Password hash updated');
    }
    
    // Final verification
    const verifyResult = await tenantPool.query(
      `SELECT password_hash FROM employees WHERE id = $1`,
      [emp.id]
    );
    
    if (verifyResult.rows[0] && verifyResult.rows[0].password_hash) {
      const matches = await bcrypt.compare(managerPassword, verifyResult.rows[0].password_hash);
      logger.info('✓ Password verification: ' + (matches ? 'PASS' : 'FAIL'));
    }
    
    logger.info('');
    logger.info('Ready to login:');
    logger.info('  Email: ' + managerEmail);
    logger.info('  Password: ' + managerPassword);
    logger.info('  Endpoint: POST http://localhost:5000/api/v1/auth/login');
    
    process.exit(0);
  } catch (err) {
    logger.error('Error:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  diagnoseAndFix();
}

module.exports = { diagnoseAndFix };
