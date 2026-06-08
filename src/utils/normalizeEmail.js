'use strict';

/**
 * Normalize a login identifier for consistent DB comparison.
 * For Gmail / Googlemail addresses, dots in the local part are stripped because
 * Gmail treats j.o.h.n@gmail.com and john@gmail.com as the same inbox.
 */
function normalizeLoginId(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s.includes('@')) return s;
  const at = s.lastIndexOf('@');
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return `${local.replace(/\./g, '')}@${domain}`;
  }
  return s;
}

/**
 * SQL CASE expression: `col` matches the normalized login identifier `param`.
 * Handles Gmail dot-equivalence at the database level.
 *
 * @param {string} col   - SQL column reference (e.g. 'work_email', 'e.email')
 * @param {string} param - Positional parameter placeholder (default '$1')
 */
function sqlEmailMatchesLogin(col, param = '$1') {
  return `(
    LOWER(TRIM(${col})) = ${param}
    OR (
      ${param} LIKE '%@gmail.com'
      AND RIGHT(LOWER(TRIM(${col})), 10) = '@gmail.com'
      AND regexp_replace(split_part(LOWER(TRIM(${col})), '@', 1), '\\.', '', 'g') || '@gmail.com' = ${param}
    )
    OR (
      ${param} LIKE '%@googlemail.com'
      AND RIGHT(LOWER(TRIM(${col})), 14) = '@googlemail.com'
      AND regexp_replace(split_part(LOWER(TRIM(${col})), '@', 1), '\\.', '', 'g') || '@googlemail.com' = ${param}
    )
  )`;
}

module.exports = { normalizeLoginId, sqlEmailMatchesLogin };
