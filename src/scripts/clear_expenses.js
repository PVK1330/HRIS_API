'use strict';

const { Client } = require('pg');
require('dotenv').config();

async function clearExpenses() {
  const masterClient = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || 'gaurav@123',
    database: process.env.DB_NAME || 'hris_master',
  });

  try {
    await masterClient.connect();
    const res = await masterClient.query('SELECT db_name FROM public.tenants');
    
    for (const row of res.rows) {
      console.log(`Clearing expenses for tenant database: ${row.db_name}`);
      const tenantClient = new Client({
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASS || 'gaurav@123',
        database: row.db_name,
      });
      
      try {
        await tenantClient.connect();
        // Clear all previous claims
        await tenantClient.query('TRUNCATE TABLE expenses CASCADE;');
        console.log(`Successfully cleared expenses for ${row.db_name}`);
      } catch (err) {
        console.error(`Failed to clear for ${row.db_name}:`, err.message);
      } finally {
        await tenantClient.end();
      }
    }
  } catch (err) {
    console.error('Failed to run master query:', err);
  } finally {
    await masterClient.end();
  }
}

clearExpenses();
