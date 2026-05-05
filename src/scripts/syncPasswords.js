const { superAdminPool, getTenantPool } = require('../config/db');

async function syncPassword(email) {
  try {
    const res = await superAdminPool.query(
      'SELECT db_name, password_hash FROM public.tenants WHERE admin_email = $1',
      [email]
    );

    if (res.rows.length === 0) {
      console.log('User not found in central DB');
      return;
    }

    const { db_name, password_hash } = res.rows[0];
    const tenantPool = getTenantPool(db_name);

    await tenantPool.query(
      'UPDATE admin_users SET password_hash = $1 WHERE email = $2',
      [password_hash, email]
    );

    console.log(`Successfully synced password for ${email} in database ${db_name}`);
  } catch (err) {
    console.error('Sync failed:', err);
  } finally {
    process.exit();
  }
}

syncPassword('admin@acme.com');
