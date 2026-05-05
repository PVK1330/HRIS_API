'use strict';

const fs = require('fs');
const path = require('path');

const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const logger = require('../../utils/logger');
const repo = require('./settings.repository');

/**
 * Settings module — business logic.
 *
 * Translates between the API's camelCase contract and the `key/value/group`
 * rows stored in `public.settings`. All raw SQL lives in the repository.
 */

/* -------------------- camelCase <-> snake_case mappings -------------------- */

const GROUP_KEY_MAP = {
  general: {
    defaultLanguage:     'default_language',
    timezone:            'timezone',
    dateFormat:          'date_format',
    dateSelectorFormat:  'date_selector_format',
    renewalGracePeriod:  'renewal_grace_period',
    termsOfService:      'terms_of_service',
  },
  company: {
    companyName:      'company_name',
    address:          'company_address',
    city:             'company_city',
    state:            'company_state',
    zip:              'company_zip',
    country:          'company_country',
    telephone:        'company_telephone',
  },
  email: {
    systemEmail:     'system_email',
    systemFromName:  'system_from_name',
    emailDelivery:   'email_delivery',
    smtpHost:        'smtp_host',
    smtpPort:        'smtp_port',
    smtpUsername:    'smtp_username',
    smtpPassword:    'smtp_password',
    smtpEncryption:  'smtp_encryption',
  },
  logo: {
    largeLogo:  'logo_large',
    smallLogo:  'logo_small',
    favicon:    'logo_favicon',
  },
};

const VALID_GROUPS = Object.keys(GROUP_KEY_MAP);

function assertValidGroup(group) {
  if (!VALID_GROUPS.includes(group)) {
    throw new ApiError(404, `Settings group not found: ${group}`);
  }
}

/** snake_case -> camelCase, scoped to a known group. */
function rowsToCamel(group, rows) {
  const reverse = Object.entries(GROUP_KEY_MAP[group]).reduce(
    (acc, [camel, snake]) => ({ ...acc, [snake]: camel }),
    {}
  );
  const out = {};
  for (const r of rows) {
    const camel = reverse[r.key];
    if (camel) out[camel] = r.value == null ? '' : r.value;
  }
  // Make sure every expected camel key is present, even if the row doesn't exist yet.
  for (const camel of Object.keys(GROUP_KEY_MAP[group])) {
    if (!(camel in out)) out[camel] = '';
  }
  return out;
}

/* -------------------- Generic getters / setters -------------------- */

async function getSetting(key) {
  const row = await repo.findSettingByKey(key);
  return row ? row.value : null;
}

async function upsertSetting(key, value, group) {
  if (!key) throw new ApiError(400, 'key is required');
  return repo.upsertSetting({ key, value: value == null ? '' : String(value), group });
}

async function getSettingsByGroup(group) {
  assertValidGroup(group);
  const rows = await repo.findSettingsByGroup(group);
  return rowsToCamel(group, rows);
}

async function updateSettingsByGroup(group, data) {
  assertValidGroup(group);
  const map = GROUP_KEY_MAP[group];

  const pairs = [];
  for (const [camel, value] of Object.entries(data || {})) {
    const snake = map[camel];
    if (!snake) continue; // ignore unknown fields silently — strict validators handle them at the route layer
    if (value === undefined) continue;
    pairs.push({ key: snake, value: value == null ? '' : String(value) });
  }

  if (pairs.length === 0) {
    return getSettingsByGroup(group);
  }

  await repo.upsertSettingsByGroup(group, pairs);

  // If email settings changed, invalidate the cached Mailer.
  if (group === 'email') {
    try {
      const { Mailer } = require('../../helpers/mailer/mailer');
      Mailer.invalidate();
    } catch (e) {
      logger.warn(`[settings] Could not invalidate Mailer cache: ${e.message}`);
    }
  }

  return getSettingsByGroup(group);
}

async function getAllSettings() {
  const result = {};
  for (const group of VALID_GROUPS) {
    // eslint-disable-next-line no-await-in-loop
    result[group] = await getSettingsByGroup(group);
  }
  return result;
}

/* -------------------- Specialized: email settings (mask password) -------------------- */

const PASSWORD_MASK = '••••••••';

async function getEmailSettingsMasked() {
  const data = await getSettingsByGroup('email');
  data.smtpPassword = data.smtpPassword ? PASSWORD_MASK : '';
  return data;
}

async function updateEmailSettings(input) {
  // Don't overwrite the stored password if the client sent the mask back.
  if (input && input.smtpPassword === PASSWORD_MASK) {
    delete input.smtpPassword;
  }
  await updateSettingsByGroup('email', input);
  return getEmailSettingsMasked();
}

/* -------------------- Logo upload helpers -------------------- */

const LOGO_KEY_BY_TYPE = {
  large:   'logo_large',
  small:   'logo_small',
  favicon: 'logo_favicon',
};

// Resolve from the same env.UPLOAD.dir source-of-truth that multer + the
// /uploads static server use. Otherwise a wrong-path delete-on-overwrite would
// silently no-op while real files pile up.
const LOGO_DIR = path.join(path.resolve(env.UPLOAD.dir), 'logos');

function publicLogoPath(filename) {
  return `/uploads/logos/${filename}`;
}

function absoluteLogoFsPath(relativeOrFilename) {
  if (!relativeOrFilename) return null;
  // Stored as e.g. "/uploads/logos/large-1700000000000.png"
  const trimmed = relativeOrFilename.replace(/^\/+/, '');
  return path.join(__dirname, '..', '..', '..', 'src', trimmed);
}

function safeUnlink(absPath) {
  if (!absPath) return;
  try {
    if (fs.existsSync(absPath)) {
      fs.unlinkSync(absPath);
      logger.info(`[settings] removed old logo file: ${absPath}`);
    }
  } catch (err) {
    logger.warn(`[settings] failed to remove old logo file ${absPath}: ${err.message}`);
  }
}

/**
 * Save the uploaded file's relative path into settings, deleting the previous
 * file (if any) first.
 *
 * @param {'large'|'small'|'favicon'} type
 * @param {{ filename: string }} file  multer file object
 */
async function saveLogo(type, file) {
  const key = LOGO_KEY_BY_TYPE[type];
  if (!key) throw new ApiError(400, `Unknown logo type: ${type}`);
  if (!file || !file.filename) throw new ApiError(400, 'No file uploaded');

  // Delete previous file (best-effort) before overwriting the setting.
  const previous = await repo.findSettingByKey(key);
  if (previous && previous.value) {
    const oldAbs = path.join(LOGO_DIR, path.basename(previous.value));
    safeUnlink(oldAbs);
  }

  const relative = publicLogoPath(file.filename);
  await repo.upsertSetting({ key, value: relative, group: 'logo' });
  return { type, path: relative };
}

function buildLogoUrls(logos, baseUrl) {
  const toUrl = (rel) => (rel ? `${baseUrl}${rel}` : '');
  return {
    largeLogo: toUrl(logos.largeLogo),
    smallLogo: toUrl(logos.smallLogo),
    favicon:   toUrl(logos.favicon),
    raw: {
      largeLogo: logos.largeLogo,
      smallLogo: logos.smallLogo,
      favicon:   logos.favicon,
    },
  };
}

async function getLogos(baseUrl) {
  const logos = await getSettingsByGroup('logo');
  return buildLogoUrls(logos, baseUrl);
}

/* -------------------- Email Templates -------------------- */

async function listEmailTemplates() {
  return repo.findAllEmailTemplates();
}

async function getEmailTemplate(slug) {
  const tpl = await repo.findEmailTemplateBySlug(slug);
  if (!tpl) throw new ApiError(404, `Email template not found: ${slug}`);
  return tpl;
}

async function updateEmailTemplate(slug, patch) {
  const updated = await repo.updateEmailTemplateBySlug(slug, patch || {});
  if (!updated) throw new ApiError(404, `Email template not found: ${slug}`);
  return updated;
}

/* -------------------- Send test email -------------------- */

async function sendTestEmail({ to }) {
  if (!to) throw new ApiError(400, 'sendTo (recipient email) is required');

  const { Mailer } = require('../../helpers/mailer/mailer');
  const mailer = await Mailer.getInstance();

  // Verify SMTP first so failures show a clean reason instead of a 500.
  await mailer.verify();

  return mailer.send({
    to,
    templateSlug: 'test_email',
    variables: {},
  });
}

module.exports = {
  // group ops
  getSettingsByGroup,
  updateSettingsByGroup,
  getAllSettings,
  // single-key ops
  getSetting,
  upsertSetting,
  // email-specific
  getEmailSettingsMasked,
  updateEmailSettings,
  // logos
  saveLogo,
  getLogos,
  // email templates
  listEmailTemplates,
  getEmailTemplate,
  updateEmailTemplate,
  // test mail
  sendTestEmail,
  // constants useful elsewhere
  VALID_GROUPS,
  LOGO_KEY_BY_TYPE,
};
