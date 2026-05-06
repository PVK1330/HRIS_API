'use strict';

const { Router } = require('express');
const { body, param } = require('express-validator');

const validate = require('../../middlewares/validate.middleware');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');
const controller = require('./paymentGateways.controller');
const { VALID_SLUGS, MASKED } = require('./paymentGateways.service');

const router = Router();

router.use(authenticate, requireRole('superadmin'));

const slugParam = param('slug')
  .isString()
  .trim()
  .isIn(VALID_SLUGS)
  .withMessage(`slug must be one of: ${VALID_SLUGS.join(', ')}`);

/**
 * Validation helper: skips a string validator when the incoming value is
 * either undefined/empty or the masked placeholder. Keeps the API surface
 * forgiving: clients can re-submit the masked dots without failing.
 */
const ifProvided = (chain) =>
  chain.if((value) => value !== undefined && value !== '' && value !== MASKED);

const stripeCredentialValidators = [
  ifProvided(body('credentials.publishable_key').isString().trim())
    .matches(/^pk_(test|live)_/)
    .withMessage('publishable_key must start with pk_test_ or pk_live_'),
  ifProvided(body('credentials.secret_key').isString().trim())
    .matches(/^sk_(test|live)_/)
    .withMessage('secret_key must start with sk_test_ or sk_live_'),
  ifProvided(body('credentials.webhook_secret').isString().trim())
    .matches(/^whsec_/)
    .withMessage('webhook_secret must start with whsec_'),
];

const paypalCredentialValidators = [
  ifProvided(body('credentials.client_id').isString().trim())
    .isLength({ min: 10 }).withMessage('client_id must be at least 10 chars'),
  ifProvided(body('credentials.client_secret').isString().trim())
    .isLength({ min: 10 }).withMessage('client_secret must be at least 10 chars'),
  ifProvided(body('credentials.mode').isString())
    .isIn(['sandbox', 'live']).withMessage('mode must be sandbox or live'),
];

const razorpayCredentialValidators = [
  ifProvided(body('credentials.key_id').isString().trim())
    .matches(/^rzp_(test|live)_/)
    .withMessage('key_id must start with rzp_test_ or rzp_live_'),
  ifProvided(body('credentials.key_secret').isString().trim())
    .isLength({ min: 10 }).withMessage('key_secret must be at least 10 chars'),
  ifProvided(body('credentials.webhook_secret').isString().trim())
    .isLength({ min: 1 }),
];

const offlineCredentialValidators = [
  ifProvided(body('credentials.bank_name').isString().trim())
    .isLength({ min: 2 }).withMessage('bank_name must be at least 2 chars'),
  ifProvided(body('credentials.account_number').isString().trim())
    .isLength({ min: 5 }).withMessage('account_number must be at least 5 chars')
    .matches(/^[A-Za-z0-9]+$/).withMessage('account_number must be alphanumeric'),
  ifProvided(body('credentials.account_holder').isString().trim())
    .isLength({ min: 2 }).withMessage('account_holder must be at least 2 chars'),
  ifProvided(body('credentials.ifsc_code').isString().trim())
    .matches(/^[A-Z]{4}0[A-Z0-9]{6}$/)
    .withMessage('ifsc_code must match the standard IFSC pattern'),
  ifProvided(body('credentials.instructions').isString())
    .isLength({ max: 500 }).withMessage('instructions max 500 chars'),
];

/**
 * Picks the validator chain that matches the slug at request time. Validators
 * for other gateways are not applied, so a Stripe-specific rule never fires
 * on a PayPal payload.
 */
function credentialValidatorsForSlug(req, _res, next) {
  const slug = req.params.slug;
  let chain;
  switch (slug) {
    case 'stripe':   chain = stripeCredentialValidators; break;
    case 'paypal':   chain = paypalCredentialValidators; break;
    case 'razorpay': chain = razorpayCredentialValidators; break;
    case 'offline':  chain = offlineCredentialValidators; break;
    default:         chain = [];
  }

  // Run each validator in series, then continue.
  let i = 0;
  function runNext(err) {
    if (err) return next(err);
    if (i >= chain.length) return next();
    const v = chain[i++];
    return v(req, _res, runNext);
  }
  return runNext();
}

const updateValidators = [
  slugParam,
  body('isEnabled').optional().isBoolean().toBoolean(),
  body('testMode').optional().isBoolean().toBoolean(),
  body('credentials').optional().isObject().withMessage('credentials must be an object'),
];

/* -------------------- Routes -------------------- */

router.get('/', controller.list);

router.get('/:slug',
  [slugParam],
  validate,
  controller.getOne
);

router.put('/:slug',
  updateValidators,
  validate,                       // validate slug + top-level fields first
  credentialValidatorsForSlug,    // then per-gateway credential rules
  validate,                       // and surface any credential errors
  controller.update
);

router.post('/:slug/test',
  [slugParam],
  validate,
  controller.test
);

module.exports = router;
