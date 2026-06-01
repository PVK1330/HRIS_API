require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '.env') });
const jwt = require('jsonwebtoken');
const payload = { id:1, role:'superadmin', email:'superadmin@hris.com', db_name:'hris_gaurav_enterprise_1' };
if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET not found in env');
  process.exit(1);
}
console.log(jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' }));
