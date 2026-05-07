'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const crypto = require('crypto');
const db = require('../../config/db');
const env = require('../../config/env');
const { sendMail } = require('../../utils/mail');
const { renderEmail } = require('../../utils/emailTemplate');
const ApiError = require('../../utils/ApiError');
const logger = require('../../utils/logger');
const repo = require('./tenant.repository');

const SALT_ROUNDS = env.BCRYPT_SALT_ROUNDS;
const TENANT_MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations', 'tenants');

const TENANT_TRACKING_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS tenant_migrations (
    filename   VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

/**
 * Runs every *.sql file in src/migrations/tenants/ inside the given tenant
 * DATABASE (not schema). Uses a temporary pg.Pool so we don't pollute the
 * cached tenant pool, and tracks applied filenames in a `tenant_migrations`
 * table inside the tenant DB so subsequent runs are idempotent.
 *
 * @param {string} dbName  e.g. "tenant_ab12_cd34_..."
 */
async function runTenantMigrations(dbName) {
  repo.assertSafeDbName(dbName);

  if (!fs.existsSync(TENANT_MIGRATIONS_DIR)) {
    throw new Error(`Tenant migrations directory not found: ${TENANT_MIGRATIONS_DIR}`);
  }

  const files = fs
    .readdirSync(TENANT_MIGRATIONS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    logger.warn(`No tenant migration files found in ${TENANT_MIGRATIONS_DIR}`);
    return { applied: 0, skipped: 0 };
  }

  // Temporary pool dedicated to running migrations on this tenant DB.
  const tempPool = new Pool({
    user: env.DB.user,
    password: env.DB.password,
    database: dbName,
    host: env.DB.host,
    port: env.DB.port,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
    ssl: env.DB.ssl ? { rejectUnauthorized: false } : false,
  });

  let applied = 0;
  let skipped = 0;

  try {
    const client = await tempPool.connect();
    try {
      await client.query(TENANT_TRACKING_TABLE_SQL);
      const { rows } = await client.query('SELECT filename FROM tenant_migrations');
      const alreadyApplied = new Set(rows.map((r) => r.filename));

      for (const file of files) {
        if (alreadyApplied.has(file)) {
          skipped += 1;
          logger.info(`[tenant:${dbName}] skip migration (already applied): ${file}`);
          continue;
        }

        const sql = fs.readFileSync(path.join(TENANT_MIGRATIONS_DIR, file), 'utf8');
        if (!sql.trim()) continue;

        logger.info(`[tenant:${dbName}] applying migration ${file}`);
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query(
            'INSERT INTO tenant_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
            [file]
          );
          await client.query('COMMIT');
          applied += 1;
          logger.info(`[tenant:${dbName}] done migration ${file}`);
        } catch (err) {
          await client.query('ROLLBACK');
          logger.error(`[tenant:${dbName}] FAILED migration ${file}`, err.message);
          throw err;
        }
      }
    } finally {
      client.release();
    }
  } finally {
    try {
      await tempPool.end();
    } catch (_) {
      // ignore — temp pool is throwaway
    }
  }

  logger.info(
    `[tenant:${dbName}] migrations complete (applied=${applied}, skipped=${skipped})`
  );
  return { applied, skipped };
}

/**
 * Drops a tenant database. Closes any cached tenant pool first and
 * terminates any other lingering connections so PG will allow the drop.
 */
async function dropTenantDatabaseIfExists(dbName) {
  repo.assertSafeDbName(dbName);

  // 1. Release any open connections owned by this app to the tenant DB.
  try {
    await db.closeTenantPool(dbName);
  } catch (e) {
    logger.warn(`Could not close tenant pool for ${dbName}: ${e.message}`);
  }

  // 2. Use the SuperAdmin pool (connected to hrs_backend) to drop the DB.
  const client = await db.superAdminPool.connect();
  try {
    // Best-effort: terminate any other backends still connected to this DB.
    try {
      await client.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName]
      );
    } catch (e) {
      logger.warn(`Could not terminate backends for ${dbName}: ${e.message}`);
    }

    // DROP DATABASE cannot run inside a transaction.
    await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    logger.info(`[tenant] dropped database ${dbName}`);
  } finally {
    client.release();
  }
}

/**
 * Creates a brand-new tenant on a SEPARATE PostgreSQL database.
 *
 * Flow:
 *   1. Pre-flight uniqueness check on public.tenants.admin_email.
 *   2. Generate db_name = tenant_<uuid_without_dashes>.
 *   3. CREATE DATABASE <db_name> via superAdminPool (NOT inside a transaction).
 *   4. INSERT INTO public.tenants (hrs_backend) — stores db_name.
 *   5. Run tenant migrations inside the new DB (admin_users, roles, ...).
 *   6. INSERT admin_users row inside the tenant DB via getTenantPool(db_name).
 *
 * Cleanup: if any step after CREATE DATABASE fails, the tenants registry
 * row is removed and the new database is dropped, so partial state never
 * lingers.
 */
async function createTenant({ name, adminEmail, adminName, adminPassword, createdBy, plan_id }) {
  const normalizedEmail = String(adminEmail).trim().toLowerCase();
  const cleanName = String(name).trim();
  const cleanAdminName = String(adminName).trim();

  // 1. Cheap uniqueness check (gives a clean 409 instead of a raw PG error).
  const existing = await repo.findTenantByAdminEmail(normalizedEmail);
  if (existing) {
    throw ApiError.conflict('A tenant with this admin email already exists');
  }

  // 2. Generate safe db_name (system-generated UUID — interpolation is safe).
  const dbName = `tenant_${uuidv4().replace(/-/g, '_')}`;
  if (dbName.length > 63) {
    throw ApiError.internal('Generated database name exceeds 63 characters');
  }
  repo.assertSafeDbName(dbName);

  const passwordHash = await bcrypt.hash(adminPassword, SALT_ROUNDS);

  let dbCreated = false;
  let tenantInserted = false;

  try {
    // 3. CREATE DATABASE — must NOT be inside a transaction.
    const adminClient = await db.superAdminPool.connect();
    try {
      await adminClient.query(`CREATE DATABASE "${dbName}"`);
      dbCreated = true;
      logger.info(`[tenant] created database ${dbName}`);
    } catch (err) {
      if (err && err.code === '42P04') {
        throw new ApiError(409, 'Tenant database already exists');
      }
      logger.error(`[tenant] CREATE DATABASE failed for ${dbName}`, err.message);
      throw new ApiError(500, 'Failed to create tenant database');
    } finally {
      adminClient.release();
    }

    // 4. Calculate trial end date (14 days from now)
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    // 5. Insert into public.tenants (registry in hrs_backend).
    let tenantRow;
    try {
      tenantRow = await repo.insertTenant({
        name: cleanName,
        dbName,
        adminEmail: normalizedEmail,
        adminName: cleanAdminName,
        createdBy,
        planId: plan_id,
        trialEndsAt: trialEndsAt,
      });
      tenantInserted = true;
    } catch (err) {
      if (err && err.code === '23505') {
        throw ApiError.conflict(
          'Tenant with this admin email or database already exists'
        );
      }
      throw err;
    }

    // 5.5 Provision Tenant Access Controls based on Plan Features
    if (plan_id) {
      try {
        const plansRepo = require('../superadmin/plans.repository');
        const planFeatures = await plansRepo.getFeatures(plan_id);
        
        if (planFeatures && planFeatures.length > 0) {
          for (const feature of planFeatures) {
            await repo.insertAccessControl(tenantRow.id, plan_id, feature.id);
          }
          logger.info(`[tenant] Provisioned ${planFeatures.length} access controls for tenant ${tenantRow.id} (plan=${plan_id})`);
        }
      } catch (accessErr) {
        logger.error(`[tenant] Failed to provision access controls for tenant ${tenantRow.id}:`, accessErr.message);
      }
    }

    // 6. Create initial subscription record
    let subscriptionRow = null;
    if (plan_id) {
      try {
        const subResult = await db.superAdminPool.query(
          `INSERT INTO public.tenant_subscriptions (
            tenant_id, plan_id, status, billing_cycle,
            current_period_start, current_period_end, trial_end
          ) VALUES ($1, $2, 'trial', 'monthly', NOW(), NOW() + INTERVAL '14 days', $3)
          RETURNING id`,
          [tenantRow.id, plan_id, trialEndsAt]
        );
        subscriptionRow = subResult.rows[0];
      } catch (subErr) {
        logger.error(`Failed to create subscription record for tenant ${tenantRow.id}:`, subErr.message);
      }
    }

    // 7. Run tenant migrations inside the new DB.
    await runTenantMigrations(dbName);

    // 8. Insert admin_users row inside the tenant DB via cached pool.
    const tenantPool = db.getTenantPool(dbName);
    await repo.insertAdminUser(tenantPool, {
      tenantId: tenantRow.id,
      email: normalizedEmail,
      passwordHash,
      name: cleanAdminName,
    });

    logger.info(`Tenant created: ${tenantRow.name} (db=${tenantRow.db_name})`);

    const tenant = {
      id: tenantRow.id,
      name: tenantRow.name,
      dbName: tenantRow.db_name,
      adminEmail: tenantRow.admin_email,
      status: tenantRow.status,
      createdAt: tenantRow.created_at,
    };

    // 9. Send Credentials Email
    try {
      const html = await renderEmail('tenant-welcome', {
        name: name,
        email: adminEmail,
        password: adminPassword
      });

      await sendMail({
        to: adminEmail,
        subject: 'Welcome to HRIS - Your Account Credentials',
        text: `Your organization "${name}" has been created.\nEmail: ${adminEmail}\nPassword: ${adminPassword}`,
        html
      });
    } catch (mailErr) {
      logger.error('Failed to send welcome email:', mailErr.message);
    }

    // 10. Create and Send Invoice
    if (plan_id && subscriptionRow) {
      try {
        const plansRepo = require('../superadmin/plans.repository');
        const planDetails = await plansRepo.findById(plan_id);

        if (planDetails) {
          // Create a payment record as an "invoice"
          const paymentResult = await db.superAdminPool.query(
            `INSERT INTO public.payments (
              tenant_id, subscription_id, amount, currency, 
              payment_method, status, billing_start_date, billing_end_date, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id`,
            [
              tenantRow.id,
              subscriptionRow.id,
              planDetails.monthly_price || 0,
              'AED', // Default currency
              'Manual',
              planDetails.monthly_price > 0 ? 'pending' : 'completed',
              new Date(),
              trialEndsAt,
              `Onboarding Invoice for ${planDetails.plan_name}`
            ]
          );

          const paymentId = paymentResult.rows[0].id;

          // Send Invoice Email
          const invoiceHtml = await renderEmail('invoice', {
            name: cleanAdminName,
            email: normalizedEmail,
            invoiceId: paymentId,
            date: new Date().toLocaleDateString(),
            planName: planDetails.plan_name,
            billingCycle: 'Monthly',
            currency: 'AED',
            amount: planDetails.monthly_price || 0,
            status: planDetails.monthly_price > 0 ? 'PENDING PAYMENT' : 'PAID (FREE TRIAL)',
            statusMessage: planDetails.monthly_price > 0 
              ? 'This invoice is currently pending payment. Please complete the payment to avoid service interruption after the trial period.'
              : 'This is a complimentary invoice for your free trial period.'
          });

          await sendMail({
            to: adminEmail,
            subject: `Invoice INV-${paymentId} - ${planDetails.plan_name}`,
            text: `Please find your invoice for ${planDetails.plan_name} attached.`,
            html: invoiceHtml
          });
        }
      } catch (invErr) {
        logger.error('Failed to generate or send invoice:', invErr.message);
      }
    }

    return tenant;
  } catch (err) {
    // ---- Cleanup / rollback ----
    if (tenantInserted) {
      try {
        await repo.deleteTenantByDbName(dbName);
      } catch (cleanupErr) {
        logger.error(
          `Failed to delete tenants row for ${dbName}: ${cleanupErr.message}`
        );
      }
    }
    if (dbCreated) {
      try {
        await dropTenantDatabaseIfExists(dbName);
      } catch (cleanupErr) {
        logger.error(
          `Failed to drop tenant database ${dbName}: ${cleanupErr.message}`
        );
      }
    }

    if (err instanceof ApiError) throw err;

    if (err && err.code === '23505') {
      throw ApiError.conflict('Tenant with this admin email or database already exists');
    }

    logger.error('createTenant failed', err);
    throw new ApiError(500, 'Failed to create tenant');
  }
}

async function updateTenant(id, data) {
  return await repo.updateTenant(id, data);
}

async function deleteTenant(id) {
  const tenant = await repo.findTenantById(id);
  if (!tenant) throw new ApiError(404, 'Tenant not found');
  
  // 1. Delete registry record
  await repo.deleteTenantById(id);
  
  // 2. Best effort: drop the database
  try {
    await dropTenantDatabaseIfExists(tenant.db_name);
  } catch (err) {
    logger.error(`Failed to drop database ${tenant.db_name} during tenant deletion`, err.message);
  }
}

async function getAllTenants({ page = 1, limit = 10, search = '', plan = '', status = '' } = {}) {
  const offset = (page - 1) * limit;
  const [tenants, total] = await Promise.all([
    repo.findAll({ limit, offset, search, plan, status }),
    repo.countAll({ search, plan, status })
  ]);
  return { tenants, total, page, limit };
}

async function resetTenantPassword(id, manualPassword = null) {
  const tenant = await repo.findTenantById(id);
  if (!tenant) throw new ApiError(404, 'Tenant not found');

  // 1. Generate or use manual password
  const passwordToUse = manualPassword || crypto.randomBytes(6).toString('hex');
  const passwordHash = await bcrypt.hash(passwordToUse, SALT_ROUNDS);

  // 2. Update Tenant DB
  const tenantPool = db.getTenantPool(tenant.db_name);
  await repo.updateAdminPassword(tenantPool, tenant.admin_email, passwordHash);

  // 3. Send Email
  try {
    const html = await renderEmail('tenant-password-reset', {
      name: tenant.name,
      email: tenant.admin_email,
      password: passwordToUse
    });

    await sendMail({
      to: tenant.admin_email,
      subject: 'HRIS - Password Reset Notification',
      text: `Your password for organization "${tenant.name}" has been reset.\nNew Password: ${passwordToUse}`,
      html
    });
  } catch (mailErr) {
    logger.error('Failed to send reset password email:', mailErr.message);
  }
}

async function getTenantFeatures(id) {
  const tenant = await repo.findTenantById(id);
  if (!tenant) throw new ApiError(404, 'Tenant not found');

  const features = await repo.listTenantFeatureAccess(id);
  return features.map((feature) => ({
    id: feature.id,
    name: feature.feature_name,
    code: feature.feature_code,
    description: feature.feature_description,
    sortOrder: feature.feature_sort_order,
    isActive: feature.feature_is_active,
    isEnabled: feature.is_enabled,
    isAssigned: Boolean(feature.access_control_id),
  }));
}

async function updateTenantFeature(id, featureId, isEnabled) {
  const tenant = await repo.findTenantById(id);
  if (!tenant) throw new ApiError(404, 'Tenant not found');

  const feature = await repo.findFeatureById(featureId);
  if (!feature) throw new ApiError(404, 'Feature not found');

  if (!feature.feature_is_active) {
    throw new ApiError(400, 'Cannot assign an inactive feature');
  }

  const access = await repo.upsertTenantFeatureAccess(id, featureId, Boolean(isEnabled));
  return {
    id: access.id,
    tenantId: access.tenant_id,
    featureId: access.feature_id,
    isEnabled: access.is_enabled,
  };
}

module.exports = {
  createTenant,
  runTenantMigrations,
  dropTenantDatabaseIfExists,
  getAllTenants,
  updateTenant,
  deleteTenant,
  resetTenantPassword,
  getTenantFeatures,
  updateTenantFeature,
};
