'use strict';

const bcrypt = require('bcrypt');
const db = require('../config/db');
const logger = require('../utils/logger');
const env = require('../config/env');

const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12;

async function seedManagerUser() {
  // Manager user details
  const managerEmail = 'gaurav111@gmail.com';
  const managerPassword = 'gaurav111@gmail.com';
  const managerName = 'Gaurav Singh';
  
  try {
    // Connect to database
    await db.assertDbConnection();
    
    // Get first tenant from tenants table to use as the working tenant
    const tenantResult = await db.query('SELECT id, db_name FROM public.tenants LIMIT 1');
    if (tenantResult.rows.length === 0) {
      throw new Error('No tenants found in system. Please create a tenant first.');
    }
    
    const tenant = tenantResult.rows[0];
    const tenantPool = db.getTenantPool(tenant.db_name);
    
    logger.info(`[seed:manager] Using tenant: ${tenant.db_name}`);
    
    // Check if employee already exists
    const existingEmployee = await tenantPool.query(
      'SELECT id FROM employees WHERE work_email = $1',
      [managerEmail]
    );
    
    if (existingEmployee.rows.length > 0) {
      logger.info(`[seed:manager] Manager ${managerEmail} already exists — skipping.`);
      return;
    }
    
    // Hash the password
    const passwordHash = await bcrypt.hash(managerPassword, SALT_ROUNDS);
    
    // Generate employee ID
    const empIdResult = await tenantPool.query(
      "SELECT COUNT(*) as count FROM employees WHERE deleted_at IS NULL"
    );
    const nextEmpNum = (empIdResult.rows[0]?.count || 0) + 1;
    const empId = `MGR-${String(nextEmpNum).padStart(4, '0')}`;
    
    // Create employee record
    const insertResult = await tenantPool.query(
      `INSERT INTO employees (
        emp_id, 
        full_name,
        first_name,
        last_name,
        job_title,
        department,
        employment_type,
        work_email,
        work_location,
        join_date,
        employment_status,
        password_hash,
        portal_enabled,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
      RETURNING id, emp_id, work_email`,
      [
        empId,
        managerName,
        'Gaurav',
        'Singh',
        'Manager',
        'Management',
        'Full-Time',
        managerEmail,
        'Dubai',
        new Date().toISOString().split('T')[0],
        'Active',
        passwordHash,
        true
      ]
    );
    
    const employee = insertResult.rows[0];
    
    logger.info(
      `[seed:manager] Manager created successfully:
        - Email: ${employee.work_email}
        - Employee ID: ${employee.emp_id}
        - Database: ${tenant.db_name}
        - Password: ${managerPassword}
        
        You can now login with these credentials!`
    );
    
  } catch (err) {
    logger.error('[seed:manager] failed', err);
    throw err;
  }
}

if (require.main === module) {
  (async () => {
    try {
      await seedManagerUser();
      await db.pool.end();
      process.exit(0);
    } catch (err) {
      logger.error('[seed:manager] Script failed:', err.message);
      try { await db.pool.end(); } catch (_) { }
      process.exit(1);
    }
  })();
}

module.exports = { seedManagerUser };
