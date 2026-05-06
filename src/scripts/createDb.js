'use strict';

const { Client } = require('pg');
const path = require('path');
const dotenv = require('dotenv');

// Load .env
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const dbName = process.env.DB_NAME || 'hris_master';

async function createDatabase() {
  const client = new Client({
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || '',
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: 'postgres',
  });

  try {
    await client.connect();
    const res = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName]
    );

    if (res.rowCount === 0) {
      console.log(`[setup] Database "${dbName}" does not exist. Creating...`);
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log(`[setup] Database "${dbName}" created successfully.`);
    } else {
      console.log(`[setup] Database "${dbName}" already exists.`);
    }
  } catch (err) {
    console.error('[setup] Error creating database:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

createDatabase();
