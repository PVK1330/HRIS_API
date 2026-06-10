'use strict';

/** Canonical workflow statuses for HR dashboard and gating. */
const WORKFLOW_STATUS = {
  DRAFT: 'draft',
  OFFER_SENT: 'offer_sent',
  REJECTED: 'rejected',
  ACCEPTED_PENDING_UPLOAD: 'accepted_pending_upload',
  DOCUMENTS_PENDING: 'documents_pending',
  ONBOARDING_COMPLETE: 'onboarding_complete',
};

const WORKFLOW_STATUS_LABELS = {
  [WORKFLOW_STATUS.DRAFT]: 'Draft',
  [WORKFLOW_STATUS.OFFER_SENT]: 'Offer Sent',
  [WORKFLOW_STATUS.REJECTED]: 'Rejected',
  [WORKFLOW_STATUS.ACCEPTED_PENDING_UPLOAD]: 'Accepted — Pending Document Upload',
  [WORKFLOW_STATUS.DOCUMENTS_PENDING]: 'Documents Pending',
  [WORKFLOW_STATUS.ONBOARDING_COMPLETE]: 'Onboarding Complete',
};

const DEFAULT_CHECKLIST = [
  { document_key: 'passport', document_label: 'Passport', is_mandatory: true, sort_order: 1 },
  { document_key: 'national_id', document_label: 'National ID', is_mandatory: true, sort_order: 2 },
  {
    document_key: 'education_certificates',
    document_label: 'Education Certificates',
    is_mandatory: true,
    sort_order: 3,
  },
  {
    document_key: 'experience_letters',
    document_label: 'Experience Letters',
    is_mandatory: true,
    sort_order: 4,
  },
];

const TOKEN_TTL_DAYS = 30;

// Onboarding progresses through exactly three numbered steps:
//   1 = offer sent / accepted / rejected
//   2 = signed offer uploaded (documents milestone)
//   3 = onboarding complete
// onboarding_step is persisted with GREATEST(...) (monotonic), so an out-of-range value
// would stick permanently — callers must validate against this range before writing.
const MIN_ONBOARDING_STEP = 1;
const MAX_ONBOARDING_STEP = 3;

module.exports = {
  WORKFLOW_STATUS,
  WORKFLOW_STATUS_LABELS,
  DEFAULT_CHECKLIST,
  TOKEN_TTL_DAYS,
  MIN_ONBOARDING_STEP,
  MAX_ONBOARDING_STEP,
};
