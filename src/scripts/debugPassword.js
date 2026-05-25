'use strict';

const bcrypt = require('bcrypt');
const db = require('../config/db');
const logger = require('../utils/logger');

async function debugPassword() {
  try {
    const tenantResult = await db.query('SELECT db_name FROM public.tenants LIMIT 1');
    const tenantPool = db.getTenantPool(tenantResult.rows[0].db_name);
    
    const managerEmail = 'gaurav111@gmail.com';
    const plainPassword = 'gaurav111@gmail.com';
    
    // Get the stored password hash
    const check = await tenantPool.query(
      `SELECT password_hash FROM employees WHERE work_email = $1`,
      [managerEmail]
    );
    
    if (!check.rows.length) {
      logger.error('User not found');
      process.exit(1);
    }
    
    const storedHash = check.rows[0].password_hash;
    logger.info('Stored hash:', storedHash.substring(0, 20) + '...');
    logger.info('Password to test:', plainPassword);
    
    // Test if password matches
    const matches = await bcrypt.compare(plainPassword, storedHash);
    logger.info('Password matches:', matches);
    
    if (!matches) {
      logger.error('Password does not match! Regenerating...');
      const SALT_ROUNDS = 12;
      const newHash = await bcrypt.hash(plainPassword, SALT_ROUNDS);
      logger.info('New hash:', newHash);
      
      // Update database with new hash
      await tenantPool.query(
        `UPDATE employees SET password_hash = $1 WHERE work_email = $2`,
        [newHash, managerEmail]
      );
      logger.info('Database updated with new hash');
      
      // Verify new hash
      const verify = await bcrypt.compare(plainPassword, newHash);
      logger.info('New hash verifies:', verify);
    }
    
    process.exit(0);
  } catch (err) {
    logger.error('Error:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  debugPassword();
}

module.exports = { debugPassword };
