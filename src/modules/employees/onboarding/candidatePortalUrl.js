'use strict';

const { resolvePortalOrigin } = require('../../../utils/portalUrl');

async function resolveCandidatePortalBase(tenantId) {
  return resolvePortalOrigin(tenantId, { withLoginPath: false });
}

function buildCandidateUrls(base, token) {
  const t = encodeURIComponent(token);
  return {
    offerPage: `${base}/onboarding/offer?token=${t}`,
    acceptUrl: `${base}/onboarding/offer?token=${t}&action=accept`,
    rejectUrl: `${base}/onboarding/offer?token=${t}&action=reject`,
    signUrl: `${base}/onboarding/sign?token=${t}`,
    documentsUrl: `${base}/onboarding/documents?token=${t}`,
  };
}

module.exports = { resolveCandidatePortalBase, buildCandidateUrls };
