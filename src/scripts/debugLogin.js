"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const { Pool } = require("pg");

async function main() {
  const central = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
  });

  const { rows: tenants } = await central.query(
    `SELECT id, name, db_name, admin_email, status FROM public.tenants ORDER BY id`,
  );
  console.log("Central tenants:", tenants);

  for (const t of tenants) {
    const tenant = new Pool({
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 5432,
      database: t.db_name,
    });
    const admins = await tenant.query(
      `SELECT id, email, status, password_hash IS NOT NULL AS has_password FROM admin_users`,
    );
    const emps = await tenant.query(
      `SELECT id, work_email, username, portal_enabled,
              password_hash IS NOT NULL AS has_pw
       FROM employees WHERE deleted_at IS NULL`,
    ).catch(() => ({ rows: [] }));
    console.log(`\n[${t.db_name}] admins:`, admins.rows);
    console.log(`[${t.db_name}] employees:`, emps.rows);
    await tenant.end();
  }

  await central.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
