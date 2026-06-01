const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '.env') });

const JWT_SECRET = process.env.JWT_SECRET;
const BASE = `http://localhost:${process.env.PORT || 5000}`;
const TENANT = '1';

function createToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

(async () => {
  try {
    const adminPayload = { id: 9999, role: 'admin', email: 'admin@tenant.test', tenant_id: TENANT, db_name: 'hris_gaurav_enterprise_1' };
    const superPayload = { id: 1, role: 'superadmin', email: 'superadmin@hris.com', db_name: 'hris_gaurav_enterprise_1' };

    const adminToken = createToken(adminPayload);
    const superToken = createToken(superPayload);

    console.log('ADMIN_TOKEN=' + adminToken);
    console.log('SUPER_TOKEN=' + superToken);

    // Create ticket as Admin
    const createRes = await axios.post(
      `${BASE}/api/support/tickets`,
      {
        adminName: 'Test Admin',
        subject: 'Test ticket from automated script (debug)',
        category: 'General',
        priority: 'High',
        description: 'This is a test ticket created by automated test script (debug)',
      },
      {
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'x-tenant-id': TENANT,
        },
      }
    );

    console.log('Create response status:', createRes.status);
    const ticket = createRes.data.data;
    console.log('Created ticket id:', ticket.id);

    const notifRes1 = await axios.get(`${BASE}/api/v1/notifications`, {
      headers: { Authorization: `Bearer ${superToken}` },
    });
    console.log('SuperAdmin notifications count:', Array.isArray(notifRes1.data.data) ? notifRes1.data.data.length : 0);
    console.log('Latest notification (superadmin):', notifRes1.data.data[0] || null);

    console.log('Test script finished');
  } catch (err) {
    console.error('Test script error:', err.response ? err.response.data || err.response.statusText : err.message);
    process.exit(1);
  }
})();
