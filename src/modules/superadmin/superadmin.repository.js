'use strict';

const db = require('../../config/db');

/**
 * Repository: pure data-access functions for the public.superadmins table.
 * No business logic here — only parameterized SQL.
 */

async function findByEmail(email) {
  const sql = `
    SELECT id, email, password_hash, name, created_at
    FROM public.superadmins
    WHERE email = $1
    LIMIT 1
  `;
  const { rows } = await db.query(sql, [email]);
  return rows[0] || null;
}

async function findById(id) {
  const sql = `
    SELECT id, email, name, created_at
    FROM public.superadmins
    WHERE id = $1
    LIMIT 1
  `;
  const { rows } = await db.query(sql, [id]);
  return rows[0] || null;
}

async function create({ email, passwordHash, name }) {
  const sql = `
    INSERT INTO public.superadmins (email, password_hash, name)
    VALUES ($1, $2, $3)
    RETURNING id, email, name, created_at
  `;
  const { rows } = await db.query(sql, [email, passwordHash, name]);
  return rows[0];
}

module.exports = {
  findByEmail,
  findById,
  create,
};
