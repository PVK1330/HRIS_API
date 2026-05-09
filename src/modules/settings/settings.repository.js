"use strict";

const db = require("../../config/db");

/* -------------------- public.settings -------------------- */

async function findAllSettings() {
  const sql = `
    SELECT key, value, "group", created_at, updated_at
    FROM public.settings
    ORDER BY "group" ASC, key ASC
  `;
  const { rows } = await db.query(sql);
  return rows;
}

async function findSettingsByGroup(group) {
  const sql = `
    SELECT key, value, "group"
    FROM public.settings
    WHERE "group" = $1
    ORDER BY key ASC
  `;
  const { rows } = await db.query(sql, [group]);
  return rows;
}

async function findSettingByKey(key) {
  const sql = `
    SELECT key, value, "group"
    FROM public.settings
    WHERE key = $1
    LIMIT 1
  `;
  const { rows } = await db.query(sql, [key]);
  return rows[0] || null;
}

/**
 * Upsert one (key, value, group) row.
 *
 * If the key exists we keep its existing "group" — only the value changes.
 * If the key is new we insert it with the supplied group (required).
 */
async function upsertSetting({ key, value, group }) {
  const sql = `
    INSERT INTO public.settings (key, value, "group")
    VALUES ($1, $2, $3)
    ON CONFLICT (key)
    DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    RETURNING key, value, "group"
  `;
  const { rows } = await db.query(sql, [key, value, group]);
  return rows[0];
}

/**
 * Bulk upsert for a single settings group inside a transaction.
 *
 * @param {string} group
 * @param {Array<{key:string, value:string|null}>} pairs
 */
async function upsertSettingsByGroup(group, pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) return [];
  return db.withTransaction(async (client) => {
    const updated = [];
    for (const { key, value } of pairs) {
      const { rows } = await client.query(
        `INSERT INTO public.settings (key, value, "group")
         VALUES ($1, $2, $3)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
         RETURNING key, value, "group"`,
        [key, value, group],
      );
      updated.push(rows[0]);
    }
    return updated;
  });
}

/* -------------------- public.email_templates -------------------- */

async function findAllEmailTemplates() {
  const sql = `
    SELECT id, slug, name, subject, is_active, created_at, updated_at
    FROM public.email_templates
    ORDER BY name ASC
  `;
  const { rows } = await db.query(sql);
  return rows;
}

async function findEmailTemplateBySlug(slug) {
  const sql = `
    SELECT id, slug, name, subject, body, variables, is_active, created_at, updated_at
    FROM public.email_templates
    WHERE slug = $1
    LIMIT 1
  `;
  const { rows } = await db.query(sql, [slug]);
  return rows[0] || null;
}

/**
 * Partial update — only fields that are not undefined are written.
 *
 * @param {string} slug
 * @param {{ subject?: string, body?: string, isActive?: boolean }} patch
 */
async function updateEmailTemplateBySlug(slug, patch) {
  const sql = `
    UPDATE public.email_templates
       SET subject   = COALESCE($1, subject),
           body      = COALESCE($2, body),
           is_active = COALESCE($3, is_active),
           updated_at = NOW()
     WHERE slug = $4
    RETURNING id, slug, name, subject, body, variables, is_active, created_at, updated_at
  `;
  const params = [
    patch.subject === undefined ? null : patch.subject,
    patch.body === undefined ? null : patch.body,
    patch.isActive === undefined ? null : patch.isActive,
    slug,
  ];
  const { rows } = await db.query(sql, params);
  return rows[0] || null;
}

module.exports = {
  // settings
  findAllSettings,
  findSettingsByGroup,
  findSettingByKey,
  upsertSetting,
  upsertSettingsByGroup,
  // email templates
  findAllEmailTemplates,
  findEmailTemplateBySlug,
  updateEmailTemplateBySlug,
};
