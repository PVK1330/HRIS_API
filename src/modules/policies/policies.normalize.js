'use strict';

const { parseAudienceConfig, audienceLabel } = require('./policies.audience');

const EMPTY_SECTIONS = {
  introduction: '',
  purpose: '',
  scope: '',
  definitions: '',
  rulesAndProcedures: '',
  examples: '',
  faqs: '',
  exceptions: '',
  contactPerson: '',
};

function parseSections(content, description) {
  let parsed = {};
  if (content) {
    if (typeof content === 'object') parsed = content;
    else {
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = {};
      }
    }
  }
  const sections = parsed.sections || parsed;
  if (sections && typeof sections === 'object' && !Array.isArray(sections)) {
    return { ...EMPTY_SECTIONS, ...sections };
  }
  if (description && !parsed.sections) {
    return { ...EMPTY_SECTIONS, introduction: String(description) };
  }
  return { ...EMPTY_SECTIONS };
}

function parseAttachments(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

function mapPolicyRow(row) {
  if (!row) return null;
  const audienceConfig = parseAudienceConfig(row.audience_config);
  const sections = parseSections(row.content, row.description);
  return {
    ...row,
    ackCount: parseInt(row.ack_count, 10) || 0,
    name: row.title,
    sections,
    audienceConfig,
    audience: audienceLabel(audienceConfig),
    attachments: parseAttachments(row.attachments),
    effectiveDate: row.effective_date,
    reviewDate: row.review_date,
    ackRequired: row.ack_required,
    fileUrl: row.file_url,
    contentVersion: Number(row.content_version || 1),
    publishedAt: row.published_at || null,
    archivedAt: row.archived_at || null,
  };
}

module.exports = {
  EMPTY_SECTIONS,
  parseSections,
  parseAttachments,
  mapPolicyRow,
};
