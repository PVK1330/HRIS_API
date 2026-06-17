"use strict";

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const {
  generateTenantDbName,
  slugifyOrgNameForDb,
} = require("../../utils/tenantDbName");
const { slugifyTenantName } = require("../../utils/tenantSlug");
const db = require("../../config/db");
const { upsertEntry: upsertIndexEntry } = require("../../utils/userTenantIndex");
const env = require("../../config/env");
const { sendMail } = require("../../utils/mail");
const { renderEmail } = require("../../utils/emailTemplate");
const { resolvePortalLoginUrlFromTenantName } = require("../../utils/portalUrl");
const ApiError = require("../../utils/ApiError");
const logger = require("../../utils/logger");
const repo = require("./tenant.repository");
const { formatDate } = require("../../utils/timezone");
const { getPlatformContext } = require("../../utils/platformSettings");

const SALT_ROUNDS = env.BCRYPT_SALT_ROUNDS;
const TENANT_MIGRATIONS_DIR = path.join(
  __dirname,
  "..",
  "..",
  "migrations",
  "tenants",
);

const TENANT_TRACKING_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS tenant_migrations (
    filename   VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

/** Per-process cache so login is not blocked by 50+ migration checks every request */
const tenantMigrationsReady = new Set();

/**
 * Runs every *.sql file in src/migrations/tenants/ inside the given tenant
 * DATABASE (not schema). Uses a temporary pg.Pool so we don't pollute the
 * cached tenant pool, and tracks applied filenames in a `tenant_migrations`
 * table inside the tenant DB so subsequent runs are idempotent.
 *
 * @param {string} dbName  e.g. "hrs_hris_global_42"
 */
async function runTenantMigrations(dbName) {
  repo.assertSafeDbName(dbName);

  if (tenantMigrationsReady.has(dbName)) {
    return { applied: 0, skipped: 0, cached: true };
  }

  if (!fs.existsSync(TENANT_MIGRATIONS_DIR)) {
    throw new Error(
      `Tenant migrations directory not found: ${TENANT_MIGRATIONS_DIR}`,
    );
  }

  const files = fs
    .readdirSync(TENANT_MIGRATIONS_DIR)
    .filter((f) => f.toLowerCase().endsWith(".sql"))
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
      const { rows } = await client.query(
        "SELECT filename FROM tenant_migrations",
      );
      const alreadyApplied = new Set(rows.map((r) => r.filename));

      for (const file of files) {
        if (alreadyApplied.has(file)) {
          skipped += 1;
          logger.info(
            `[tenant:${dbName}] skip migration (already applied): ${file}`,
          );
          continue;
        }

        const sql = fs.readFileSync(
          path.join(TENANT_MIGRATIONS_DIR, file),
          "utf8",
        );
        if (!sql.trim()) continue;

        logger.info(`[tenant:${dbName}] applying migration ${file}`);
        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query(
            "INSERT INTO tenant_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
            [file],
          );
          await client.query("COMMIT");
          applied += 1;
          logger.info(`[tenant:${dbName}] done migration ${file}`);
        } catch (err) {
          await client.query("ROLLBACK");
          logger.error(
            `[tenant:${dbName}] FAILED migration ${file}`,
            err.message,
          );
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

  tenantMigrationsReady.add(dbName);
  logger.info(
    `[tenant:${dbName}] migrations complete (applied=${applied}, skipped=${skipped})`,
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
        [dbName],
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

function paymentMethodLabel(gateway) {
  const map = {
    stripe: "Stripe",
    paypal: "PayPal",
    razorpay: "Razorpay",
    offline: "Bank Transfer",
    manual: "Manual",
  };
  return map[String(gateway || "").toLowerCase()] || String(gateway || "Manual");
}

async function createTenant({
  name,
  adminEmail,
  adminName,
  adminPassword,
  createdBy,
  plan_id,
  billing_cycle = "monthly",
  payment_gateway = "manual",
  payment_collection = "trial",
  payment_reference = null,
}) {
  const normalizedEmail = String(adminEmail).trim().toLowerCase();
  const cleanName = String(name).trim();
  const cleanAdminName = String(adminName).trim();

  if (!slugifyOrgNameForDb(cleanName)) {
    throw ApiError.badRequest(
      "Organisation name must include at least one letter or number",
    );
  }

  // 1. Cheap uniqueness check (gives a clean 409 instead of a raw PG error).
  const existing = await repo.findTenantByAdminEmail(normalizedEmail);
  if (existing) {
    throw ApiError.conflict("A tenant with this admin email already exists");
  }

  // 2. Reserve tenant id and build db_name: {centralPrefix}_{orgSlug}_{id}
  const reservedTenantId = await repo.reserveTenantId();
  let dbName = generateTenantDbName(cleanName, { tenantId: reservedTenantId });
  repo.assertSafeDbName(dbName);

  const existingDb = await repo.findTenantByDbName(dbName);
  if (existingDb) {
    dbName = generateTenantDbName(cleanName, {
      randomSuffix: `${reservedTenantId}_${crypto.randomBytes(4).toString("hex")}`,
    });
    repo.assertSafeDbName(dbName);
  }

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
      if (err && err.code === "42P04") {
        throw new ApiError(409, "Tenant database already exists");
      }
      logger.error(
        `[tenant] CREATE DATABASE failed for ${dbName}`,
        err.message,
      );
      throw new ApiError(500, "Failed to create tenant database");
    } finally {
      adminClient.release();
    }

    // 4. Plan + trial window
    let planDetails = null;
    if (plan_id) {
      const plansRepo = require("../superadmin/plans.repository");
      planDetails = await plansRepo.findById(plan_id);
    }
    // Trial length: per-plan trial_days takes priority, else the superadmin's
    // global Free Trial setting, else a 14-day fallback.
    let globalTrialDays = 0;
    try {
      const freeTrialRepo = require("../freeTrial/freeTrial.repository");
      const ft = await freeTrialRepo.findSingleton();
      if (ft && ft.trial_enabled && Number(ft.trial_days) > 0) {
        globalTrialDays = Number(ft.trial_days);
      }
    } catch {
      globalTrialDays = 0;
    }
    const trialDays =
      Number(planDetails?.trial_days) > 0
        ? Number(planDetails.trial_days)
        : globalTrialDays > 0
          ? globalTrialDays
          : 14;
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + trialDays);
    const billingCycle =
      String(billing_cycle || "monthly").toLowerCase() === "annual" ? "annual" : "monthly";

    // If payment was collected upfront, the org starts active (never paywalled).
    const initialSubscriptionStatus =
      String(payment_collection || "trial").toLowerCase() === "completed" ? "active" : "trial";

    // 5. Insert into public.tenants (registry in hrs_backend).
    let tenantRow;
    try {
      tenantRow = await repo.insertTenant({
        id: reservedTenantId,
        name: cleanName,
        dbName,
        adminEmail: normalizedEmail,
        adminName: cleanAdminName,
        createdBy,
        planId: plan_id,
        trialEndsAt: trialEndsAt,
        subscriptionStatus: initialSubscriptionStatus,
      });
      tenantInserted = true;
    } catch (err) {
      if (err && err.code === "23505") {
        throw ApiError.conflict(
          "Tenant with this admin email or database already exists",
        );
      }
      throw err;
    }

    // 5.5 Provision Tenant Access Controls based on Plan Features
    if (plan_id) {
      try {
        const plansRepo = require("../superadmin/plans.repository");
        const planFeatures = await plansRepo.getFeatures(plan_id);

        if (planFeatures && planFeatures.length > 0) {
          for (const feature of planFeatures) {
            await repo.insertAccessControl(tenantRow.id, plan_id, feature.id);
          }
          logger.info(
            `[tenant] Provisioned ${planFeatures.length} access controls for tenant ${tenantRow.id} (plan=${plan_id})`,
          );
        }
      } catch (accessErr) {
        logger.error(
          `[tenant] Failed to provision access controls for tenant ${tenantRow.id}:`,
          accessErr.message,
        );
      }
    }

    // 6. Create initial subscription record
    let subscriptionRow = null;
    if (plan_id) {
      try {
        const subStatus =
          String(payment_collection || "trial").toLowerCase() === "completed"
            ? "active"
            : "trial";
        const periodInterval =
          billingCycle === "annual" ? "INTERVAL '1 year'" : "INTERVAL '1 month'";
        const subResult = await db.superAdminPool.query(
          `INSERT INTO public.tenant_subscriptions (
            tenant_id, plan_id, status, billing_cycle,
            current_period_start, current_period_end, trial_end
          ) VALUES ($1, $2, $3, $4, NOW(), NOW() + ${periodInterval}, $5)
          RETURNING id`,
          [tenantRow.id, plan_id, subStatus, billingCycle, trialEndsAt],
        );
        subscriptionRow = subResult.rows[0];
      } catch (subErr) {
        logger.error(
          `Failed to create subscription record for tenant ${tenantRow.id}:`,
          subErr.message,
        );
      }
    }

    // 7. Run tenant migrations inside the new DB.
    await runTenantMigrations(dbName);

    // 7.5 Seed default enterprise exit workflow
    try {
      const seedEnterpriseExitWorkflow = require("../../scripts/seed_enterprise_exit_workflow");
      await seedEnterpriseExitWorkflow(dbName);
    } catch (seedErr) {
      logger.error(`Failed to seed enterprise exit workflow for ${dbName}:`, seedErr.message);
    }

    // 8. Insert admin_users row inside the tenant DB via cached pool.
    const tenantPool = db.getTenantPool(dbName);
    const adminRow = await repo.insertAdminUser(tenantPool, {
      tenantId: tenantRow.id,
      email: normalizedEmail,
      passwordHash,
      name: cleanAdminName,
    });
    if (!adminRow?.id) {
      throw ApiError.internal("Failed to create organization admin account");
    }

    // Populate the central email→tenant index and tenant slug so subsequent logins are O(1).
    const tenantSlug = slugifyTenantName(tenantRow.name);
    await Promise.all([
      upsertIndexEntry(normalizedEmail, tenantRow.id, "admin"),
      tenantSlug
        ? db.superAdminPool.query(
          "UPDATE public.tenants SET slug = $1 WHERE id = $2 AND slug IS NULL",
          [tenantSlug, tenantRow.id],
        ).catch(() => { })
        : Promise.resolve(),
    ]).catch(() => { });

    logger.info(`Tenant created: ${tenantRow.name} (db=${tenantRow.db_name})`);

    let lastPaymentId = null;
    let lastPaymentAmount = 0;

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
      const loginUrl = resolvePortalLoginUrlFromTenantName(name);
      const { html, attachments } = await renderEmail("tenant-welcome", {
        name: name,
        email: adminEmail,
        password: adminPassword,
        loginUrl,
      });

      await sendMail({
        to: adminEmail,
        subject: "Welcome to HRIS - Your Account Credentials",
        text: `Your organization "${name}" has been created.\nLogin URL: ${loginUrl}\nEmail: ${adminEmail}\nPassword: ${adminPassword}`,
        html,
        attachments,
      });
    } catch (mailErr) {
      logger.error("Failed to send welcome email:", mailErr.message);
    }

    // 10. Create and Send Invoice
    if (plan_id && subscriptionRow && planDetails) {
      try {
        if (planDetails) {
          const platform = await getPlatformContext();
          const platformCurrency = platform.currency;
          const platformTz = platform.timezone;
          const amount =
            billingCycle === "annual"
              ? Number(planDetails.annual_price) || 0
              : Number(planDetails.monthly_price) || 0;
          const collection = String(payment_collection || "trial").toLowerCase();
          let paymentStatus = "pending";
          if (collection === "completed") paymentStatus = "completed";
          else if (collection === "trial" && amount <= 0) paymentStatus = "completed";

          const methodLabel = paymentMethodLabel(payment_gateway);
          const refNote = payment_reference
            ? ` Reference: ${String(payment_reference).trim()}`
            : "";

          const paymentResult = await db.superAdminPool.query(
            `INSERT INTO public.payments (
              tenant_id, subscription_id, amount, currency, 
              payment_method, payment_reference, status, billing_start_date, billing_end_date, notes,
              processed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id`,
            [
              tenantRow.id,
              subscriptionRow.id,
              amount,
              platformCurrency,
              methodLabel,
              payment_reference ? String(payment_reference).trim() : null,
              paymentStatus,
              new Date(),
              trialEndsAt,
              `Onboarding invoice — ${planDetails.plan_name} (${billingCycle}) via ${methodLabel}.${refNote}`,
              paymentStatus === "completed" ? new Date() : null,
            ],
          );

          const paymentId = paymentResult.rows[0].id;
          lastPaymentId = paymentId;
          lastPaymentAmount = amount;

          // Send Invoice Email
          const { html: invoiceHtml, attachments: invoiceAttachments } = await renderEmail("invoice", {
            name: cleanAdminName,
            email: normalizedEmail,
            invoiceId: paymentId,
            date: formatDate(new Date(), platformTz, "DD/MM/YYYY"),
            planName: planDetails.plan_name,
            billingCycle: billingCycle === "annual" ? "Annual" : "Monthly",
            currency: platformCurrency,
            amount:
              billingCycle === "annual"
                ? planDetails.annual_price || 0
                : planDetails.monthly_price || 0,
            status:
              planDetails.monthly_price > 0
                ? "PENDING PAYMENT"
                : "PAID (FREE TRIAL)",
            statusMessage:
              planDetails.monthly_price > 0
                ? "This invoice is currently pending payment. Please complete the payment to avoid service interruption after the trial period."
                : "This is a complimentary invoice for your free trial period.",
          });

          await sendMail({
            to: adminEmail,
            subject: `Invoice INV-${paymentId} - ${planDetails.plan_name}`,
            text: `Please find your invoice for ${planDetails.plan_name} attached.`,
            html: invoiceHtml,
            attachments: invoiceAttachments,
          });
        }
      } catch (invErr) {
        logger.error("Failed to generate or send invoice:", invErr.message);
      }
    }

    return {
      ...tenant,
      paymentId: lastPaymentId,
      paymentAmount: lastPaymentAmount,
      subscriptionId: subscriptionRow?.id ?? null,
      planId: plan_id ?? null,
      billingCycle,
    };
  } catch (err) {
    // ---- Cleanup / rollback ----
    if (tenantInserted) {
      try {
        await repo.deleteTenantByDbName(dbName);
      } catch (cleanupErr) {
        logger.error(
          `Failed to delete tenants row for ${dbName}: ${cleanupErr.message}`,
        );
      }
    }
    if (dbCreated) {
      try {
        await dropTenantDatabaseIfExists(dbName);
      } catch (cleanupErr) {
        logger.error(
          `Failed to drop tenant database ${dbName}: ${cleanupErr.message}`,
        );
      }
    }

    if (err instanceof ApiError) throw err;

    if (err && err.code === "23505") {
      throw ApiError.conflict(
        "Tenant with this admin email or database already exists",
      );
    }

    logger.error("createTenant failed", err);
    throw new ApiError(500, "Failed to create tenant");
  }
}

async function updateTenant(id, data) {
  return await repo.updateTenant(id, data);
}

async function deleteTenant(id) {
  const tenant = await repo.findTenantById(id);
  if (!tenant) throw new ApiError(404, "Tenant not found");

  // 1. Delete registry record
  await repo.deleteTenantById(id);

  // 2. Best effort: drop the database
  try {
    await dropTenantDatabaseIfExists(tenant.db_name);
  } catch (err) {
    logger.error(
      `Failed to drop database ${tenant.db_name} during tenant deletion`,
      err.message,
    );
  }
}

async function getAllTenants({
  page = 1,
  limit = 10,
  search = "",
  plan = "",
  status = "",
} = {}) {
  const offset = (page - 1) * limit;
  const [tenants, total] = await Promise.all([
    repo.findAll({ limit, offset, search, plan, status }),
    repo.countAll({ search, plan, status }),
  ]);

  const enrichedTenants = await Promise.all(
    tenants.map(async (t) => {
      let totalEmployees = 0;
      let totalAdmins = 0;
      let totalManagers = 0;
      let lastActivity = null;

      try {
        const tenantPool = db.getTenantPool(t.db_name);
        const countsQuery = await tenantPool.query(`
          SELECT 
            (SELECT COUNT(*) FROM employees WHERE employment_status != 'Terminated') as total_employees,
            (SELECT COUNT(*) FROM admin_users WHERE status = 'active') as total_admins,
            (SELECT COUNT(DISTINCT reporting_manager_id) FROM employees WHERE reporting_manager_id IS NOT NULL) as total_managers,
            (SELECT MAX(created_at) FROM (
              (SELECT created_at FROM employees ORDER BY created_at DESC LIMIT 1)
              UNION ALL
              (SELECT created_at FROM admin_users ORDER BY created_at DESC LIMIT 1)
            ) as combined) as last_activity
        `);

        if (countsQuery.rows.length > 0) {
          totalEmployees = parseInt(countsQuery.rows[0].total_employees, 10);
          totalAdmins = parseInt(countsQuery.rows[0].total_admins, 10);
          totalManagers = parseInt(countsQuery.rows[0].total_managers, 10);
          lastActivity = countsQuery.rows[0].last_activity;
        }
      } catch (err) {
        console.log(`Failed to fetch metrics for tenant db ${t.db_name}: ${err.message}`);
      }

      const totalUsers = totalEmployees;
      const tenant = t;
      console.log("Tenant:", tenant.id, tenant.name, "Total Users:", totalUsers);

      return {
        ...t,
        slug: t.slug,
        totalEmployees,
        totalAdmins,
        totalManagers,
        totalUsers,
        lastActivity,
        // Frontend-friendly aliases requested by requirement
        organizationName: t.name,
        tenantSlug: t.slug,
        planName: t.plan,
        createdAt: t.created_at,
      };
    })
  );

  return { tenants: enrichedTenants, total, page, limit };
}

async function resetTenantPassword(id, manualPassword = null) {
  const tenant = await repo.findTenantById(id);
  if (!tenant) throw new ApiError(404, "Tenant not found");

  // 1. Generate or use manual password
  const passwordToUse = manualPassword || crypto.randomBytes(6).toString("hex");
  const passwordHash = await bcrypt.hash(passwordToUse, SALT_ROUNDS);

  // 2. Update Tenant DB
  const tenantPool = db.getTenantPool(tenant.db_name);
  await repo.updateAdminPassword(tenantPool, tenant.admin_email, passwordHash);

  // 3. Send Email
  try {
    const loginUrl = resolvePortalLoginUrlFromTenantName(tenant.name);
    const { html, attachments } = await renderEmail("tenant-password-reset", {
      name: tenant.name,
      email: tenant.admin_email,
      password: passwordToUse,
      loginUrl,
    });

    await sendMail({
      to: tenant.admin_email,
      subject: "HRIS - Password Reset Notification",
      text: `Your password for organization "${tenant.name}" has been reset.Login URL: ${loginUrl}New Password: ${passwordToUse}`,
      html,
      attachments,
    });
  } catch (mailErr) {
    logger.error("Failed to send reset password email:", mailErr.message);
  }
}

async function getTenantFeatures(id) {
  const tenant = await repo.findTenantById(id);
  if (!tenant) throw new ApiError(404, "Tenant not found");

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
  if (!tenant) throw new ApiError(404, "Tenant not found");

  const feature = await repo.findFeatureById(featureId);
  if (!feature) throw new ApiError(404, "Feature not found");

  if (!feature.feature_is_active) {
    throw new ApiError(400, "Cannot assign an inactive feature");
  }

  const access = await repo.upsertTenantFeatureAccess(
    id,
    featureId,
    Boolean(isEnabled),
  );
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
