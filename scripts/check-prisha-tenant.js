'use strict';

const { superAdminPool, getTenantPool } = require('../src/config/db');
const { slugifyTenantName } = require('../src/utils/tenantSlug');
const { comparePassword } = require('../src/utils/password');

async function main() {
  const { rows } = await superAdminPool.query(
    `SELECT id, name, db_name, admin_email, status
     FROM public.tenants
     WHERE name ILIKE '%Prisha%'
     ORDER BY id DESC
     LIMIT 3`,
  );
  console.log('tenants:', JSON.stringify(rows, null, 2));

  const testPasswords = [
    'akansha310.agale@gmail.com',
    'akansha310agale@gmail.com',
  ];

  for (const t of rows) {
    console.log('slug:', slugifyTenantName(t.name));
    const pool = getTenantPool(t.db_name);
    const admins = await pool.query(
      `SELECT id, email, status, password_hash FROM admin_users`,
    );
    console.log('admin_users:', admins.rows.map((r) => ({ id: r.id, email: r.email, status: r.status })));
    for (const admin of admins.rows) {
      for (const pw of testPasswords) {
        const ok = await comparePassword(pw, admin.password_hash);
        if (ok) console.log(`  password match for ${admin.email}: "${pw}"`);
      }
    }
  }
  await superAdminPool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
