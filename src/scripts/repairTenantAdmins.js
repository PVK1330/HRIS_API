"use strict";

/**
 * Ensures each tenant DB has an admin_users row for public.tenants.admin_email.
 * When an employee exists with the same email, copies their password_hash.
 *
 * Usage: node src/scripts/repairTenantAdmins.js
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const { Pool } = require("pg");
const { hashPassword } = require("../utils/password");

async function main() {
  const central = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
  });

  const { rows: tenants } = await central.query(
    `SELECT id, name, db_name, admin_email, admin_name
     FROM public.tenants
     WHERE status = 'active'`,
  );

  for (const t of tenants) {
    const email = String(t.admin_email || "").trim().toLowerCase();
    if (!email) {
      console.warn(`[skip] tenant ${t.id} has no admin_email`);
      continue;
    }

    const tenantPool = new Pool({
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 5432,
      database: t.db_name,
    });

    try {
      const existing = await tenantPool.query(
        `SELECT id FROM admin_users WHERE LOWER(TRIM(email)) = $1 LIMIT 1`,
        [email],
      );
      if (existing.rows.length > 0) {
        console.log(`[ok] ${t.db_name} admin_users already has ${email}`);
        continue;
      }

      const emp = await tenantPool.query(
        `SELECT full_name, password_hash FROM employees
         WHERE deleted_at IS NULL AND LOWER(TRIM(work_email)) = $1
         LIMIT 1`,
        [email],
      );

      let passwordHash = emp.rows[0]?.password_hash;
      if (!passwordHash) {
        const temp = process.env.REPAIR_ADMIN_TEMP_PASSWORD || "ChangeMe123!";
        passwordHash = await hashPassword(temp);
        console.warn(
          `[repair] ${t.db_name}: no employee password for ${email}; using temp password (set REPAIR_ADMIN_TEMP_PASSWORD)`,
        );
      }

      await tenantPool.query(
        `INSERT INTO admin_users (tenant_id, email, password_hash, name, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [t.id, email, passwordHash, t.admin_name || t.name || "Organization Admin"],
      );
      console.log(`[fixed] ${t.db_name} created admin_users for ${email}`);
    } catch (err) {
      console.error(`[error] ${t.db_name}:`, err.message);
    } finally {
      await tenantPool.end();
    }
  }

  await central.end();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { main };
