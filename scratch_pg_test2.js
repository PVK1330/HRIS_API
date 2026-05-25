const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: '127.0.0.1',
  database: 'hris_akanksha_tools_moduls_5',
  password: '',
  port: 5432,
});

async function test() {
  try {
    const res = await pool.query(
      `SELECT * FROM employees WHERE employment_status = 'Onboarding' LIMIT 1`
    );
    console.log(res.rows[0]);
  } catch (err) {
    console.error('QUERY ERROR:', err.message);
  } finally {
    await pool.end();
  }
}

test();
