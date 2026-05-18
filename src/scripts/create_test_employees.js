'use strict';

const db = require('../config/db');
const logger = require('../utils/logger');

async function createTestData() {
  await db.assertDbConnection();
  
  // 1. Fetch all tenants
  const { rows: tenants } = await db.query('SELECT id, name, db_name, admin_email FROM public.tenants');
  logger.info(`Found ${tenants.length} tenants in master DB.`);

  for (const tenant of tenants) {
    logger.info(`Seeding test data for tenant: ${tenant.name} (DB: ${tenant.db_name})`);
    const pool = db.getTenantPool(tenant.db_name);

    try {
      // A. Seed Competencies
      const { rows: existingComps } = await pool.query('SELECT id FROM competencies WHERE deleted_at IS NULL');
      if (existingComps.length === 0) {
        logger.info(`No competencies found for ${tenant.name}. Seeding default competencies...`);
        const competencies = [
          'Work Quality',
          'Productivity',
          'Communication',
          'Collaboration',
          'Leadership',
          'Technical Skill',
          'Problem Solving'
        ];
        for (const compName of competencies) {
          await pool.query(
            'INSERT INTO competencies (competency_name, created_by) VALUES ($1, $2) ON CONFLICT (competency_name) DO NOTHING',
            [compName, 1]
          );
        }
        logger.info(`Seeded ${competencies.length} competencies successfully.`);
      } else {
        logger.info(`${existingComps.length} competencies already exist for ${tenant.name}. Skipping competency seeding.`);
      }

      // B. Seed Performance Cycles
      const { rows: existingCycles } = await pool.query('SELECT id FROM performance_cycles WHERE deleted_at IS NULL');
      if (existingCycles.length === 0) {
        logger.info(`No performance cycles found for ${tenant.name}. Seeding default cycles...`);
        const cycles = [
          { name: 'Q1 2026', start: '2026-01-01', end: '2026-03-31', deadline: '2026-04-05', status: 'ACTIVE' },
          { name: 'Q2 2026', start: '2026-04-01', end: '2026-06-30', deadline: '2026-07-05', status: 'ACTIVE' },
          { name: 'H1 2026', start: '2026-01-01', end: '2026-06-30', deadline: '2026-07-15', status: 'ACTIVE' },
          { name: 'Annual 2026', start: '2026-01-01', end: '2026-12-31', deadline: '2027-01-15', status: 'UPCOMING' }
        ];
        for (const cyc of cycles) {
          await pool.query(
            `INSERT INTO performance_cycles 
             (cycle_name, start_date, end_date, submission_deadline, status, created_by) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [cyc.name, new Date(cyc.start), new Date(cyc.end), new Date(cyc.deadline), cyc.status, 1]
          );
        }
        logger.info(`Seeded ${cycles.length} performance cycles successfully.`);
      } else {
        logger.info(`${existingCycles.length} performance cycles already exist for ${tenant.name}. Skipping cycle seeding.`);
      }

      // C. Seed Employees
      const { rows: existingEmployees } = await pool.query('SELECT id FROM employees WHERE deleted_at IS NULL');
      if (existingEmployees.length === 0) {
        logger.info(`No employees found for ${tenant.name}. Seeding default employees...`);
        const employees = [
          {
            empId: 'EMP-001',
            fullName: 'John Doe',
            firstName: 'John',
            lastName: 'Doe',
            personalEmail: 'john.doe.personal@gmail.com',
            workEmail: 'john.doe@acme.com',
            phoneNumber: '1234567890',
            jobTitle: 'Senior Software Engineer',
            department: 'Engineering',
            employmentType: 'Full-time',
            workLocation: 'HQ - Dubai',
            workMode: 'On-site',
            joinDate: '2024-01-15',
            salary: 8500,
            employmentStatus: 'Active',
            isCurrentlyWorking: true
          },
          {
            empId: 'EMP-002',
            fullName: 'Jane Smith',
            firstName: 'Jane',
            lastName: 'Smith',
            personalEmail: 'jane.smith.personal@gmail.com',
            workEmail: 'jane.smith@acme.com',
            phoneNumber: '0987654321',
            jobTitle: 'Lead Product Manager',
            department: 'Product Management',
            employmentType: 'Full-time',
            workLocation: 'Remote - USA',
            workMode: 'Remote',
            joinDate: '2024-05-20',
            salary: 9500,
            employmentStatus: 'Active',
            isCurrentlyWorking: true
          },
          {
            empId: 'EMP-003',
            fullName: 'Alex Johnson',
            firstName: 'Alex',
            lastName: 'Johnson',
            personalEmail: 'alex.j.personal@gmail.com',
            workEmail: 'alex.johnson@acme.com',
            phoneNumber: '1122334455',
            jobTitle: 'Talent Acquisition Manager',
            department: 'Human Resources',
            employmentType: 'Full-time',
            workLocation: 'HQ - Dubai',
            workMode: 'Hybrid',
            joinDate: '2024-08-01',
            salary: 7000,
            employmentStatus: 'Active',
            isCurrentlyWorking: true
          }
        ];

        for (const emp of employees) {
          await pool.query(
            `INSERT INTO employees (
               emp_id, full_name, first_name, last_name, personal_email, work_email,
               phone_number, job_title, department, employment_type, work_location,
               work_mode, join_date, salary, employment_status, is_currently_working, created_by
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
            [
              emp.empId,
              emp.fullName,
              emp.firstName,
              emp.lastName,
              emp.personalEmail,
              emp.workEmail,
              emp.phoneNumber,
              emp.jobTitle,
              emp.department,
              emp.employmentType,
              emp.workLocation,
              emp.workMode,
              new Date(emp.joinDate),
              emp.salary,
              emp.employmentStatus,
              emp.isCurrentlyWorking,
              1
            ]
          );
        }
        logger.info(`Seeded ${employees.length} employees successfully.`);
      } else {
        logger.info(`${existingEmployees.length} employees already exist for ${tenant.name}. Skipping employee seeding.`);
      }

    } catch (err) {
      logger.error(`Error seeding tenant ${tenant.name}:`, err);
    } finally {
      await db.closeTenantPool(tenant.db_name);
    }
  }
}

(async () => {
  try {
    await createTestData();
    await db.pool.end();
    logger.info('Test data seeding completed successfully.');
    process.exit(0);
  } catch (err) {
    logger.error('Seeding process failed:', err);
    try { await db.pool.end(); } catch (_) {}
    process.exit(1);
  }
})();
