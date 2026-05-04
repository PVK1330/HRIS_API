# Multitenant HRIS Architecture - Node.js + PostgreSQL

## Overview
This document describes the multitenant architecture for the HRIS application using Node.js and PostgreSQL with schema-based tenant isolation.

## Architecture Approach: Schema-Based Multitenancy

### Why Schema-Based?
- **Data Isolation**: Each tenant gets its own PostgreSQL schema
- **Performance**: Efficient queries within schemas
- **Scalability**: Easy to add/remove tenants
- **Security**: Schema-level permissions
- **Cost-Effective**: Single database instance

### Database Structure

```
PostgreSQL Database: hris_db
├── public schema (Superadmin)
│   ├── superadmins
│   ├── tenants
│   ├── subscription_plans
│   ├── tenant_subscriptions
│   └── tenant_settings
├── tenant_123 schema (Tenant A)
│   ├── employees
│   ├── departments
│   ├── attendance
│   ├── leave_requests
│   ├── leave_balances
│   ├── documents
│   ├── document_audit_log
│   ├── performance_reviews
│   ├── expenses
│   ├── expense_approvals
│   ├── onboarding_tasks
│   ├── exit_records
│   ├── asset_returns
│   ├── policies
│   └── policy_acknowledgements
├── tenant_456 schema (Tenant B)
│   └── ... (same tables)
└── ... (more tenant schemas)
```

## Node.js Implementation

### 1. Database Connection Setup

```javascript
// src/config/db.js
const { Pool } = require('pg');
const { env } = require('./env');

// Superadmin connection pool (public schema)
const superadminPool = new Pool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASS,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Tenant connection pool cache
const tenantPools = new Map();

/**
 * Get or create a connection pool for a specific tenant schema
 * @param {string} schemaName - The tenant's schema name
 * @returns {Pool} PostgreSQL connection pool
 */
function getTenantPool(schemaName) {
  if (tenantPools.has(schemaName)) {
    return tenantPools.get(schemaName);
  }

  const pool = new Pool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASS,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  // Set search_path to tenant schema
  pool.on('connect', (client) => {
    client.query(`SET search_path TO ${schemaName}, public`);
  });

  tenantPools.set(schemaName, pool);
  return pool;
}

/**
 * Close all connection pools
 */
async function closeAllPools() {
  await superadminPool.end();
  for (const pool of tenantPools.values()) {
    await pool.end();
  }
  tenantPools.clear();
}

module.exports = {
  superadminPool,
  getTenantPool,
  closeAllPools,
};
```

### 2. Tenant Resolution Middleware

```javascript
// src/middleware/tenant.js
const { superadminPool } = require('../config/db');

/**
 * Resolve tenant from request and attach to context
 * Strategies: Subdomain, Header, or JWT claim
 */
async function tenantResolver(req, res, next) {
  try {
    let tenantIdentifier;

    // Strategy 1: Subdomain (e.g., acme.hriscloud.io)
    const host = req.headers.host;
    if (host && host.includes('.')) {
      const subdomain = host.split('.')[0];
      if (subdomain !== 'www' && subdomain !== 'api') {
        tenantIdentifier = subdomain;
      }
    }

    // Strategy 2: Header (X-Tenant-ID or X-Tenant-Domain)
    if (!tenantIdentifier) {
      tenantIdentifier = req.headers['x-tenant-id'] || req.headers['x-tenant-domain'];
    }

    // Strategy 3: JWT claim (if using JWT auth)
    if (!tenantIdentifier && req.user?.tenantId) {
      tenantIdentifier = req.user.tenantId;
    }

    if (!tenantIdentifier) {
      return res.status(400).json({ error: 'Tenant identifier not found' });
    }

    // Query tenant from superadmin database with timezone settings
    const result = await superadminPool.query(
      'SELECT id, schema_name, status, timezone, date_format, time_format FROM public.tenants WHERE schema_name = $1 OR admin_email = $1',
      [tenantIdentifier]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenant = result.rows[0];

    if (tenant.status !== 'active') {
      return res.status(403).json({ error: 'Tenant is not active' });
    }

    // Attach tenant to request with timezone configuration
    req.tenant = {
      id: tenant.id,
      schemaName: tenant.schema_name,
      identifier: tenantIdentifier,
      timezone: tenant.timezone || 'UTC',
      dateFormat: tenant.date_format || 'DD/MM/YYYY',
      timeFormat: tenant.time_format || '24h',
    };

    next();
  } catch (error) {
    console.error('Tenant resolution error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { tenantResolver };
```

### 3. Timezone Middleware

```javascript
// src/middleware/timezone.js
const { toTenantTime, nowInTenantTime, todayInTenantTime } = require('../utils/timezone');

/**
 * Attach tenant timezone configuration to request
 * This middleware should run after tenantResolver
 */
function timezoneMiddleware(req, res, next) {
  const timezone = req.tenant?.timezone || 'UTC';
  const dateFormat = req.tenant?.dateFormat || 'DD/MM/YYYY';
  const timeFormat = req.tenant?.timeFormat || '24h';

  req.timezone = {
    timezone,
    dateFormat,
    timeFormat,
    toTenantTime: (date, format) => toTenantTime(date, timezone, format),
    now: (format) => nowInTenantTime(timezone, format),
    today: () => todayInTenantTime(timezone),
  };

  res.locals.timezone = req.timezone;
  next();
}

module.exports = { timezoneMiddleware };
```

### 6.1 Timezone Utility Functions

```javascript
// src/utils/timezone.js
const moment = require('moment-timezone');

const SUPPORTED_TIMEZONES = [
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)', offset: '+00:00' },
  { value: 'Asia/Kolkata', label: 'India (IST)', offset: '+05:30' },
  { value: 'America/New_York', label: 'Eastern Time (US & Canada)', offset: '-05:00' },
  { value: 'America/Chicago', label: 'Central Time (US & Canada)', offset: '-06:00' },
  { value: 'America/Denver', label: 'Mountain Time (US & Canada)', offset: '-07:00' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (US & Canada)', offset: '-08:00' },
  { value: 'Europe/London', label: 'London (GMT/BST)', offset: '+00:00' },
  { value: 'Europe/Paris', label: 'Central European Time', offset: '+01:00' },
  { value: 'Europe/Berlin', label: 'Berlin (CET/CEST)', offset: '+01:00' },
  { value: 'Asia/Dubai', label: 'Dubai (GST)', offset: '+04:00' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)', offset: '+09:00' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)', offset: '+08:00' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)', offset: '+11:00' },
  { value: 'Pacific/Auckland', label: 'Auckland (NZST/NZDT)', offset: '+13:00' },
];

// Convert UTC to tenant timezone
function toTenantTime(utcDate, timezone = 'UTC', format = 'YYYY-MM-DD HH:mm:ss') {
  if (!utcDate) return null;
  return moment.utc(utcDate).tz(timezone).format(format);
}

// Convert tenant timezone to UTC
function toUtc(localDate, timezone = 'UTC') {
  if (!localDate) return null;
  return moment.tz(localDate, timezone).utc().toDate();
}

// Get current time in tenant timezone
function nowInTenantTime(timezone = 'UTC', format = 'YYYY-MM-DD HH:mm:ss') {
  return moment().tz(timezone).format(format);
}

// Get today's date in tenant timezone
function todayInTenantTime(timezone = 'UTC') {
  return moment().tz(timezone).format('YYYY-MM-DD');
}

module.exports = {
  SUPPORTED_TIMEZONES,
  toTenantTime,
  toUtc,
  nowInTenantTime,
  todayInTenantTime,
};
```

### 6.2 Updating Tenant Timezone Settings

```javascript
// src/routes/tenantSettingsRoutes.js
const express = require('express');
const router = express.Router();
const { superadminPool } = require('../config/db');
const { isValidTimezone } = require('../utils/timezone');

/**
 * PUT /api/tenant/settings/timezone
 * Update tenant timezone configuration
 */
router.put('/timezone', async (req, res) => {
  try {
    const { timezone, dateFormat, timeFormat } = req.body;
    const tenantId = req.tenant.id;

    // Validate timezone
    if (timezone && !isValidTimezone(timezone)) {
      return res.status(400).json({ error: 'Invalid timezone' });
    }

    // Validate date format
    const validDateFormats = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];
    if (dateFormat && !validDateFormats.includes(dateFormat)) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    // Validate time format
    const validTimeFormats = ['12h', '24h'];
    if (timeFormat && !validTimeFormats.includes(timeFormat)) {
      return res.status(400).json({ error: 'Invalid time format' });
    }

    // Update tenant settings
    const result = await superadminPool.query(
      `UPDATE public.tenants
       SET timezone = COALESCE($1, timezone),
           date_format = COALESCE($2, date_format),
           time_format = COALESCE($3, time_format),
           updated_at = NOW()
       WHERE id = $4
       RETURNING id, timezone, date_format, time_format`,
      [timezone, dateFormat, timeFormat, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Error updating timezone settings:', error);
    res.status(500).json({ error: 'Failed to update timezone settings' });
  }
});

/**
 * GET /api/tenant/settings/timezone
 * Get current tenant timezone configuration
 */
router.get('/timezone', async (req, res) => {
  try {
    const tenantId = req.tenant.id;

    const result = await superadminPool.query(
      'SELECT timezone, date_format, time_format FROM public.tenants WHERE id = $1',
      [tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching timezone settings:', error);
    res.status(500).json({ error: 'Failed to fetch timezone settings' });
  }
});

module.exports = router;
```

### 7. Schema Creation on Tenant Signup

```javascript
// src/services/tenantService.js
const { superadminPool, getTenantPool } = require('../config/db');
const fs = require('fs');
const path = require('path');

/**
 * Create a new tenant schema and run migrations
 */
async function createTenantSchema(tenantData) {
  const client = await superadminPool.connect();
  
  try {
    await client.query('BEGIN');

    // Generate unique schema name
    const schemaName = `tenant_${tenantData.id.replace(/-/g, '_')}`;

    // 1. Create schema
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);

    // 2. Insert tenant record
    const result = await client.query(
      `INSERT INTO public.tenants (name, schema_name, admin_email, status, created_by)
       VALUES ($1, $2, $3, 'active', $4)
       RETURNING id`,
      [tenantData.name, schemaName, tenantData.adminEmail, tenantData.createdBy]
    );

    const tenantId = result.rows[0].id;

    // 3. Run tenant migrations in the new schema
    await runTenantMigrations(schemaName);

    // 4. Create default admin user in tenant schema
    await createTenantAdmin(schemaName, tenantData);

    await client.query('COMMIT');

    return { tenantId, schemaName };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Run migration files for a specific tenant schema
 */
async function runTenantMigrations(schemaName) {
  const migrationsDir = path.join(__dirname, '../migrations/tenants');
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const pool = getTenantPool(schemaName);

  for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await pool.query(sql);
  }
}

/**
 * Create default admin user in tenant schema
 */
async function createTenantAdmin(schemaName, tenantData) {
  const pool = getTenantPool(schemaName);
  
  // Hash password (use bcrypt in production)
  const passwordHash = await hashPassword(tenantData.password);

  await pool.query(
    `INSERT INTO employees (emp_id, full_name, work_email, employment_status, job_title, department)
     VALUES ($1, $2, $3, 'Active', 'System Administrator', 'IT')`,
    ['ADM001', tenantData.adminName, tenantData.adminEmail]
  );
}

module.exports = { createTenantSchema };
```

### 8. Repository Pattern for Tenant Data

```javascript
// src/repositories/employeeRepository.js
const { getTenantPool } = require('../config/db');

class EmployeeRepository {
  /**
   * Get all employees for current tenant
   */
  async findAll(tenantSchema, filters = {}) {
    const pool = getTenantPool(tenantSchema);
    
    let query = 'SELECT * FROM employees WHERE deleted_at IS NULL';
    const params = [];
    let paramIndex = 1;

    if (filters.department) {
      query += ` AND department = $${paramIndex}`;
      params.push(filters.department);
      paramIndex++;
    }

    if (filters.status) {
      query += ` AND employment_status = $${paramIndex}`;
      params.push(filters.status);
      paramIndex++;
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Find employee by ID
   */
  async findById(tenantSchema, employeeId) {
    const pool = getTenantPool(tenantSchema);
    const result = await pool.query(
      'SELECT * FROM employees WHERE id = $1 AND deleted_at IS NULL',
      [employeeId]
    );
    return result.rows[0];
  }

  /**
   * Create new employee
   */
  async create(tenantSchema, employeeData) {
    const pool = getTenantPool(tenantSchema);
    
    const query = `
      INSERT INTO employees (
        emp_id, full_name, job_title, department, employment_type,
        work_location, join_date, work_email, employment_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const values = [
      employeeData.empId,
      employeeData.fullName,
      employeeData.jobTitle,
      employeeData.department,
      employeeData.employmentType,
      employeeData.workLocation,
      employeeData.joinDate,
      employeeData.workEmail,
      employeeData.employmentStatus || 'Active'
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Update employee
   */
  async update(tenantSchema, employeeId, employeeData) {
    const pool = getTenantPool(tenantSchema);
    
    const query = `
      UPDATE employees SET
        full_name = $2,
        job_title = $3,
        department = $4,
        employment_type = $5,
        work_location = $6,
        employment_status = $7,
        updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *
    `;

    const values = [
      employeeId,
      employeeData.fullName,
      employeeData.jobTitle,
      employeeData.department,
      employeeData.employmentType,
      employeeData.workLocation,
      employeeData.employmentStatus
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Soft delete employee
   */
  async softDelete(tenantSchema, employeeId) {
    const pool = getTenantPool(tenantSchema);
    const result = await pool.query(
      'UPDATE employees SET deleted_at = NOW() WHERE id = $1',
      [employeeId]
    );
    return result.rowCount > 0;
  }
}

module.exports = new EmployeeRepository();
```

### 9. Example API Route with Timezone Support

```javascript
// src/routes/employeeRoutes.js
const express = require('express');
const router = express.Router();
const employeeRepository = require('../repositories/employeeRepository');
const { tenantResolver } = require('../middleware/tenant');
const { timezoneMiddleware } = require('../middleware/timezone');

// All routes require tenant resolution and timezone support
router.use(tenantResolver);
router.use(timezoneMiddleware);

/**
 * GET /api/employees
 * Get all employees for current tenant
 */
router.get('/', async (req, res) => {
  try {
    const { schemaName } = req.tenant;
    const filters = {
      department: req.query.department,
      status: req.query.status
    };

    const employees = await employeeRepository.findAll(schemaName, filters);
    res.json({ data: employees });
  } catch (error) {
    console.error('Error fetching employees:', error);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

/**
 * GET /api/employees/:id
 * Get employee by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { schemaName } = req.tenant;
    const employee = await employeeRepository.findById(schemaName, req.params.id);

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    res.json({ data: employee });
  } catch (error) {
    console.error('Error fetching employee:', error);
    res.status(500).json({ error: 'Failed to fetch employee' });
  }
});

/**
 * POST /api/employees
 * Create new employee
 */
router.post('/', async (req, res) => {
  try {
    const { schemaName } = req.tenant;
    const employee = await employeeRepository.create(schemaName, req.body);
    res.status(201).json({ data: employee });
  } catch (error) {
    console.error('Error creating employee:', error);
    res.status(500).json({ error: 'Failed to create employee' });
  }
});

/**
 * PUT /api/employees/:id
 * Update employee
 */
router.put('/:id', async (req, res) => {
  try {
    const { schemaName } = req.tenant;
    const employee = await employeeRepository.update(schemaName, req.params.id, req.body);

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    res.json({ data: employee });
  } catch (error) {
    console.error('Error updating employee:', error);
    res.status(500).json({ error: 'Failed to update employee' });
  }
});

/**
 * DELETE /api/employees/:id
 * Soft delete employee
 */
router.delete('/:id', async (req, res) => {
  try {
    const { schemaName } = req.tenant;
    const deleted = await employeeRepository.softDelete(schemaName, req.params.id);

    if (!deleted) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting employee:', error);
    res.status(500).json({ error: 'Failed to delete employee' });
  }
});

module.exports = router;
```

### 10. Server Setup

```javascript
// src/server.js
const express = require('express');
const cors = require('cors');
const { env } = require('./config/env');
const { assertDbConnection } = require('./config/db');
const employeeRoutes = require('./routes/employeeRoutes');
const { tenantResolver } = require('./middleware/tenant');

const app = express();

// Middleware
app.use(cors({
  origin: env.CORS_ORIGINS.split(','),
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/employees', employeeRoutes);

// Add more routes as needed
// app.use('/api/attendance', attendanceRoutes);
// app.use('/api/leave', leaveRoutes);
// app.use('/api/documents', documentRoutes);

// Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function bootstrap() {
  try {
    // Assert database connection
    await assertDbConnection();
    
    const PORT = env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`[INFO] Server running on port ${PORT}`);
      console.log(`[INFO] Environment: ${env.NODE_ENV}`);
    });
  } catch (error) {
    console.error('[ERROR] Fatal startup error', error);
    process.exit(1);
  }
}

bootstrap();
```

### 11. Tenant Onboarding & Payment Processing

#### Superadmin Onboarding API

```javascript
// src/routes/superadmin/onboardingRoutes.js
const express = require('express');
const router = express.Router();
const { superadminOnboardTenant } = require('../../services/onboardingService');

/**
 * POST /api/superadmin/onboarding/tenant
 * Superadmin onboards a new tenant (Admin company)
 */
router.post('/tenant', async (req, res) => {
  try {
    const superadminId = req.user?.id;
    const result = await superadminOnboardTenant(req.body, superadminId);
    res.status(201).json({ 
      success: true,
      data: result,
      message: 'Tenant onboarded successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

**Request Body:**
```json
{
  "companyName": "Acme Corporation",
  "companyLegalName": "Acme Corp LLC",
  "industry": "Technology",
  "companySize": "51-200",
  "businessType": "LLC",
  "taxId": "TAX123456",
  "registrationNumber": "REG789",
  "website": "https://acme.com",
  "addressLine1": "123 Business Street",
  "addressLine2": "Suite 100",
  "city": "Dubai",
  "state": "Dubai",
  "country": "United Arab Emirates",
  "postalCode": "12345",
  "adminName": "John Smith",
  "adminEmail": "john@acme.com",
  "adminPhone": "+971501234567",
  "planId": "uuid-of-plan",
  "timezone": "Asia/Dubai",
  "dateFormat": "DD/MM/YYYY",
  "timeFormat": "24h",
  "trialDays": 14
}
```

#### Admin Self-Onboarding API

```javascript
// src/routes/public/onboardingRoutes.js
const express = require('express');
const router = express.Router();
const { adminSelfOnboard } = require('../../services/onboardingService');

/**
 * POST /api/public/onboarding/self
 * Admin self-onboarding (creates tenant account)
 */
router.post('/self', async (req, res) => {
  try {
    const result = await adminSelfOnboard(req.body);
    res.status(201).json({ 
      success: true,
      data: result,
      message: 'Account created successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

**Request Body:**
```json
{
  "companyName": "Acme Corporation",
  "adminName": "John Smith",
  "adminEmail": "john@acme.com",
  "adminPhone": "+971501234567",
  "password": "SecurePassword123",
  "planId": "uuid-of-plan",
  "timezone": "Asia/Dubai",
  "dateFormat": "DD/MM/YYYY",
  "timeFormat": "24h"
}
```

#### Manual Payment Processing API

```javascript
// src/routes/superadmin/paymentRoutes.js
const express = require('express');
const router = express.Router();
const { processManualPayment } = require('../../services/paymentService');

/**
 * POST /api/superadmin/payments
 * Process manual payment for tenant
 */
router.post('/', async (req, res) => {
  try {
    const superadminId = req.user?.id;
    const result = await processManualPayment(req.body, superadminId);
    res.status(201).json({ 
      success: true,
      data: result,
      message: 'Payment processed successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

**Request Body:**
```json
{
  "tenantId": "uuid-of-tenant",
  "subscriptionId": "uuid-of-subscription",
  "amount": 790.00,
  "currency": "AED",
  "paymentMethod": "Bank Transfer",
  "paymentReference": "TXN123456789",
  "billingStartDate": "2026-04-01",
  "billingEndDate": "2026-04-30",
  "billingCycle": "monthly",
  "notes": "Payment for April 2026",
  "receiptUrl": "https://storage.example.com/receipt.pdf"
}
```

#### Payment Endpoints

- `POST /api/superadmin/payments` - Process manual payment
- `GET /api/superadmin/payments` - Get all payments (with filters)
- `GET /api/superadmin/payments/stats` - Get payment statistics
- `GET /api/superadmin/payments/:paymentId` - Get payment by ID
- `POST /api/superadmin/payments/:paymentId/refund` - Refund payment
- `GET /api/superadmin/payments/tenant/:tenantId` - Get tenant payments

## Migration Execution

### Running Superadmin Migrations

```bash
# Connect to PostgreSQL
psql -U postgres -d hris_db

# Run migrations in order
\i src/migrations/superadmin/001_create_superadmin_table.sql
\i src/migrations/superadmin/002_create_tenants_table.sql
\i src/migrations/superadmin/003_create_subscription_plans_table.sql
\i src/migrations/superadmin/004_create_tenant_subscriptions_table.sql
\i src/migrations/superadmin/005_create_tenant_settings_table.sql
```

### Running Tenant Migrations (Automated)

Tenant migrations are automatically run when a new tenant is created via the `createTenantSchema` function.

## Security Considerations

1. **Schema Isolation**: Each tenant's data is isolated in its own schema
2. **Row-Level Security**: Add RLS policies for additional security
3. **Connection Pooling**: Use separate pools per tenant to prevent connection leaks
4. **Input Validation**: Validate all inputs to prevent SQL injection
5. **Rate Limiting**: Implement rate limiting per tenant
6. **Audit Logging**: Log all tenant operations

## Performance Optimization

1. **Connection Pooling**: Reuse connections within pools
2. **Indexing**: Add indexes on frequently queried columns
3. **Caching**: Cache tenant metadata and frequently accessed data
4. **Query Optimization**: Use EXPLAIN ANALYZE to optimize slow queries
5. **Partitioning**: Consider table partitioning for large datasets

## Backup Strategy

```bash
# Backup entire database
pg_dump -U postgres hris_db > backup.sql

# Backup specific tenant schema
pg_dump -U postgres -d hris_db -n tenant_123 > tenant_123_backup.sql

# Restore
psql -U postgres -d hris_db < backup.sql
```

## Monitoring

Monitor:
- Connection pool usage
- Query performance
- Tenant-specific metrics
- Database size per schema
- Error rates per tenant

## Scaling Considerations

1. **Database Sharding**: For very large deployments, consider sharding across multiple databases
2. **Read Replicas**: Use read replicas for reporting and analytics
3. **Caching Layer**: Add Redis for session management and caching
4. **Microservices**: Split into separate services for different modules
