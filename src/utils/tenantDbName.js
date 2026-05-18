"use strict";

const crypto = require("crypto");
const env = require("../config/env");

const PG_DB_NAME_MAX = 63;

/**
 * Prefix derived from the central (superadmin) database name.
 * e.g. hrs_backend -> hrs, hris -> hris
 */
function getCentralDbPrefix() {
  const central = String(env.DB.database || "")
    .trim()
    .toLowerCase();
  if (!central) {
    throw new Error("[tenantDbName] DB_NAME is not configured");
  }

  const underscore = central.indexOf("_");
  const raw =
    underscore > 0 ? central.slice(0, underscore) : central;
  const prefix = raw.replace(/[^a-z0-9]/g, "");

  if (!prefix) {
    throw new Error(
      `[tenantDbName] Could not derive a safe prefix from DB_NAME="${central}"`,
    );
  }

  return prefix;
}

/** Postgres-safe slug from org/tenant display name (underscores). */
function slugifyOrgNameForDb(name) {
  const slug = String(name || "")
    .toLowerCase()
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  return slug;
}

/**
 * Build a tenant database name:
 *   {centralPrefix}_{orgSlug}_{tenantId|randomHex}
 *
 * @param {string} orgName
 * @param {{ tenantId?: number|string, randomSuffix?: string }} [options]
 */
function generateTenantDbName(orgName, options = {}) {
  const prefix = getCentralDbPrefix();
  const slug = slugifyOrgNameForDb(orgName);

  let suffix;
  if (options.tenantId != null && String(options.tenantId).trim() !== "") {
    suffix = String(parseInt(String(options.tenantId), 10));
    if (!Number.isInteger(Number(suffix)) || Number(suffix) <= 0) {
      throw new Error("tenantId must be a positive integer");
    }
  } else if (options.randomSuffix) {
    suffix = String(options.randomSuffix).replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (!suffix) {
      throw new Error("randomSuffix must contain alphanumeric characters");
    }
  } else {
    suffix = crypto.randomBytes(4).toString("hex");
  }

  let dbName;
  if (slug) {
    const reserved = prefix.length + 1 + suffix.length + 1;
    const maxSlugLen = Math.max(1, PG_DB_NAME_MAX - reserved);
    const trimmedSlug = slug.slice(0, maxSlugLen);
    dbName = `${prefix}_${trimmedSlug}_${suffix}`;
  } else {
    // No org slug segment — use central prefix + id/random only (no placeholder org name).
    dbName = `${prefix}_${suffix}`;
  }

  if (dbName.length > PG_DB_NAME_MAX) {
    throw new Error("Generated database name exceeds 63 characters");
  }

  return dbName;
}

function isLegacyTenantDbName(dbName) {
  return /^tenant_[a-z0-9_]+$/i.test(dbName);
}

function isValidTenantDbName(dbName) {
  if (typeof dbName !== "string" || dbName.length > PG_DB_NAME_MAX) {
    return false;
  }

  const central = String(env.DB.database || "").toLowerCase();
  if (dbName.toLowerCase() === central) {
    return false;
  }

  if (isLegacyTenantDbName(dbName)) {
    return true;
  }

  const prefix = getCentralDbPrefix();
  const re = new RegExp(`^${prefix}_[a-z0-9_]+$`, "i");
  return re.test(dbName);
}

module.exports = {
  getCentralDbPrefix,
  slugifyOrgNameForDb,
  generateTenantDbName,
  isValidTenantDbName,
  isLegacyTenantDbName,
  PG_DB_NAME_MAX,
};
