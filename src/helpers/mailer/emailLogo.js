'use strict';

/**
 * emailLogo — the single source of truth for "which logo goes on this email".
 *
 * Rule (per product requirement):
 *   • Email sent in an ORGANISATION/tenant context  → that org's own logo.
 *   • Email sent in a SUPERADMIN/platform context    → the HRIS platform logo.
 *
 * Logos are stored as relative `/uploads/...` paths (tenant logos in
 * tenant_admin_settings.logo_url, the platform logo in public.settings.logo_large)
 * or, for S3-backed installs, as absolute http(s) URLs.
 *
 * Embedding strategy: prefer a CID inline attachment (the image travels inside the
 * MIME body, so it renders even when an email client blocks remote images and works
 * with no public URL configured). Already-absolute URLs are used as-is. Only when the
 * file can't be found on disk do we fall back to an absolute URL built from a
 * configurable public base.
 */

const fs = require('fs');
const path = require('path');

const env = require('../../config/env');
const logger = require('../../utils/logger');

/** Public base URL where `/uploads` is reachable (used only for the URL fallback). */
function getPublicBaseUrl() {
  const fromEnv =
    process.env.PUBLIC_API_URL ||
    process.env.APP_URL ||
    process.env.API_PUBLIC_URL ||
    process.env.API_URL ||
    '';
  if (fromEnv) return String(fromEnv).replace(/\/+$/, '');
  return `http://localhost:${process.env.PORT || env.PORT || 5000}`;
}

/**
 * Resolve the raw logo source + display name for an email.
 *
 * @param {{dbName?:string, db_name?:string, companyName?:string, name?:string}|null} tenant
 * @returns {Promise<{isOrg:boolean, logo:string, name:string}>}
 *   logo: a '/uploads/...' relative path OR an http(s) URL OR '' when none is set.
 */
async function resolveBranding(tenant) {
  const dbName = tenant && (tenant.dbName || tenant.db_name);

  // ORG context → that organisation's logo + name.
  if (dbName) {
    try {
      const tenantSettingsService = require('../../modules/tenantSettings/tenantSettings.service');
      // Empty baseUrl → keep the logo path relative so CID embedding can find it on disk.
      const settings = await tenantSettingsService.getAdminSettings(dbName, '');
      return {
        isOrg: true,
        logo: (settings && settings.logoUrl) || '',
        name:
          (settings && settings.companyName) ||
          (tenant && (tenant.companyName || tenant.name)) ||
          'Your Organisation',
      };
    } catch (err) {
      logger.debug('[emailLogo] tenant branding lookup failed', { dbName, err: err.message });
      return {
        isOrg: true,
        logo: '',
        name: (tenant && (tenant.companyName || tenant.name)) || 'Your Organisation',
      };
    }
  }

  // SUPERADMIN / platform context → the HRIS logo + name.
  try {
    const settingsService = require('../../modules/settings/settings.service');
    const logos = await settingsService.getSettingsByGroup('logo');
    const company = await settingsService.getSettingsByGroup('company');
    return {
      isOrg: false,
      logo: (logos && logos.largeLogo) || '',
      name: (company && company.companyName) || process.env.APP_NAME || 'HRIS System',
    };
  } catch (err) {
    logger.debug('[emailLogo] platform branding lookup failed', { err: err.message });
    return { isOrg: false, logo: '', name: process.env.APP_NAME || 'HRIS System' };
  }
}

/**
 * Turn a logo source into an `<img>` tag.
 *
 * When the logo is a local `/uploads/...` file AND `attachmentsToMutate` is an array,
 * the file is pushed as a CID inline attachment and the tag references `cid:...`.
 * Returns '' when there is no logo so the caller can fall back to showing a name.
 *
 * @param {string} logo
 * @param {string} alt
 * @param {Array|null} attachmentsToMutate  nodemailer attachments array to append to (for CID)
 * @param {string} [style]
 * @returns {string} an `<img ...>` tag, or '' when no logo is available
 */
function buildLogoImg(logo, alt, attachmentsToMutate, style) {
  if (!logo) return '';
  const imgStyle = style || 'max-height:48px;max-width:160px;display:block;margin:0 auto;';
  const altSafe = String(alt || 'Logo').replace(/"/g, '&quot;');

  // Already an absolute URL (e.g. S3) — use it directly.
  if (/^https?:\/\//i.test(logo)) {
    return `<img src="${logo}" alt="${altSafe}" style="${imgStyle}" />`;
  }

  // Local upload → embed inline via CID when we have an attachments array to mutate.
  if (Array.isArray(attachmentsToMutate)) {
    try {
      const rel = String(logo).replace(/^\/uploads\//, '');
      const diskPath = path.resolve(env.UPLOAD.dir, rel);
      if (fs.existsSync(diskPath)) {
        const cid = `emaillogo-${attachmentsToMutate.length}-${path
          .basename(diskPath)
          .replace(/[^a-zA-Z0-9._-]/g, '')}`;
        attachmentsToMutate.push({ filename: path.basename(diskPath), path: diskPath, cid });
        return `<img src="cid:${cid}" alt="${altSafe}" style="${imgStyle}" />`;
      }
      logger.debug('[emailLogo] logo file not found on disk, using URL fallback', { diskPath });
    } catch (err) {
      logger.debug('[emailLogo] CID attach failed, using URL fallback', { err: err.message });
    }
  }

  // Fallback: absolute URL from the configured public base.
  const base = getPublicBaseUrl();
  const absUrl = `${base}${String(logo).startsWith('/') ? '' : '/'}${logo}`;
  return `<img src="${absUrl}" alt="${altSafe}" style="${imgStyle}" />`;
}

/**
 * One-shot for full-document HTML layouts (onboarding / welcome / password-reset):
 * resolve branding, build the `<img>`, and hand back any CID attachment(s) to pass
 * along to the mail transport.
 *
 * @param {object|null} tenant
 * @param {{style?:string, preferUrl?:boolean}} [opts]
 *   preferUrl: render an absolute URL instead of a CID attachment — use when the
 *   output is shown in a browser (e.g. an HTTP preview), where `cid:` won't load.
 * @returns {Promise<{imgHtml:string, attachments:Array, name:string, isOrg:boolean}>}
 */
async function resolveLogoBlock(tenant, opts = {}) {
  const brand = await resolveBranding(tenant);
  // Passing null (not an array) makes buildLogoImg skip CID and emit an absolute URL.
  const attachments = opts.preferUrl ? null : [];
  const imgHtml = buildLogoImg(brand.logo, brand.name, attachments, opts.style);
  return { imgHtml, attachments: attachments || [], name: brand.name, isOrg: brand.isOrg };
}

module.exports = {
  getPublicBaseUrl,
  resolveBranding,
  buildLogoImg,
  resolveLogoBlock,
};
