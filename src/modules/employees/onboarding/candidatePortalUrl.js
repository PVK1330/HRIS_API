'use strict';

const {
  resolvePortalOrigin,
  resolveTenantPortalSlug,
} = require('../../../utils/portalUrl');

async function resolveCandidatePortalBase(tenantId) {
  return resolvePortalOrigin(tenantId, { withLoginPath: false });
}

function buildCandidateUrls(base, token, tenantSlug) {
  const t = encodeURIComponent(token);
  const tenantQ = tenantSlug
    ? `&tenant=${encodeURIComponent(tenantSlug)}`
    : '';
  return {
    offerPage: `${base}/onboarding/offer?token=${t}${tenantQ}`,
    acceptUrl: `${base}/onboarding/offer?token=${t}${tenantQ}&action=accept`,
    rejectUrl: `${base}/onboarding/offer?token=${t}${tenantQ}&action=reject`,
    signUrl: `${base}/onboarding/sign?token=${t}${tenantQ}`,
    documentsUrl: `${base}/onboarding/documents?token=${t}${tenantQ}`,
  };
}

async function resolveCandidatePortalContext(tenantId) {
  const [base, tenantSlug] = await Promise.all([
    resolveCandidatePortalBase(tenantId),
    resolveTenantPortalSlug(tenantId),
  ]);
  return { base, tenantSlug };
}

module.exports = {
  resolveCandidatePortalBase,
  resolveCandidatePortalContext,
  buildCandidateUrls,
};
