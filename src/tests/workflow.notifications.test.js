'use strict';

const assert = require('node:assert/strict');

console.log('Workflow notifications & RBAC tests\n');

let passed = 0;
let failed = 0;

function ok(name, fn) {
  try {
    fn();
    console.log(`  OK ${name}`);
    passed += 1;
  } catch (e) {
    console.error(`  FAIL ${name}: ${e.message}`);
    failed += 1;
  }
}

ok('notification history repository exports', () => {
  const repo = require('../modules/notifications/notificationHistory.repository');
  assert.equal(typeof repo.buildHash, 'function');
  assert.equal(typeof repo.wasAlreadySent, 'function');
  assert.equal(typeof repo.recordSent, 'function');
  const h1 = repo.buildHash({
    notificationType: 'onboarding.offer_sent',
    entityType: 'onboarding',
    entityId: 1,
    recipientId: 2,
    sentVia: 'in_app',
    title: 'Offer letter sent to Jane',
  });
  const h2 = repo.buildHash({
    notificationType: 'onboarding.offer_sent',
    entityType: 'onboarding',
    entityId: 1,
    recipientId: 2,
    sentVia: 'in_app',
    title: 'Offer letter sent to Jane',
  });
  assert.equal(h1, h2);
  assert.notEqual(h1, repo.buildHash({
    notificationType: 'onboarding.offer_sent',
    entityType: 'onboarding',
    entityId: 1,
    recipientId: 3,
    sentVia: 'in_app',
    title: 'Offer letter sent to Jane',
  }));
});

ok('notification delivery service exports', () => {
  const delivery = require('../modules/notifications/notificationDelivery.service');
  assert.equal(typeof delivery.sendDedupedInApp, 'function');
  assert.equal(typeof delivery.sendDedupedSystem, 'function');
  assert.equal(typeof delivery.sendDedupedEmailOnly, 'function');
});

ok('onboarding permissions mapped from legacy key', () => {
  const { P, LEGACY_KEY_TO_ACTIONS, permissionSatisfied, expandPermissionKeys } =
    require('../constants/permissions');
  assert.ok(P.ONBOARDING_VIEW);
  assert.ok(P.ONBOARDING_MANAGE);
  const expanded = expandPermissionKeys(['onboarding']);
  assert.ok(permissionSatisfied(expanded, P.ONBOARDING_MANAGE));
  assert.ok(LEGACY_KEY_TO_ACTIONS.onboarding.includes(P.ONBOARDING_VIEW));
});

ok('asset granular permissions exist', () => {
  const { P, expandPermissionKeys, permissionSatisfied } = require('../constants/permissions');
  const expanded = expandPermissionKeys(['assets']);
  assert.ok(permissionSatisfied(expanded, P.ASSETS_VIEW));
  assert.ok(permissionSatisfied(expanded, P.ASSETS_CREATE));
  assert.ok(permissionSatisfied(expanded, P.ASSETS_RETURN));
});

ok('onboarding events service exports', () => {
  const events = require('../modules/employees/onboarding/onboardingEvents.service');
  assert.equal(typeof events.notifyOfferSent, 'function');
  assert.equal(typeof events.notifyHrRejected, 'function');
  assert.equal(typeof events.notifyDocumentReviewed, 'function');
  assert.equal(typeof events.dispatchHandover, 'function');
});

ok('exit events extended handlers', () => {
  const exitEvents = require('../modules/exitManagement/exitEvents.service');
  assert.equal(typeof exitEvents.onSendBack, 'function');
  assert.equal(typeof exitEvents.onCommentAdded, 'function');
  assert.equal(typeof exitEvents.onWithdrawn, 'function');
  assert.equal(typeof exitEvents.onTaskCompleted, 'function');
});

ok('onboarding handover repository resolves by department manager', () => {
  const repo = require('../modules/onboardingHandover/onboardingHandover.repository');
  assert.equal(typeof repo.resolveHandoverRecipients, 'function');
  assert.equal(typeof repo.listAll, 'function');
});

ok('workflow audit service', () => {
  const audit = require('../modules/workflow/workflowAudit.service');
  assert.equal(typeof audit.log, 'function');
});

ok('onboarding routes use onboarding.manage not employee.edit', () => {
  const fs = require('fs');
  const path = require('path');
  const routes = fs.readFileSync(
    path.join(__dirname, '../modules/employees/onboarding/onboarding.routes.js'),
    'utf8',
  );
  assert.ok(routes.includes('ONBOARDING_MANAGE'));
  assert.ok(!routes.includes('EMPLOYEE_EDIT'));
});

ok('assets routes use granular permissions', () => {
  const fs = require('fs');
  const path = require('path');
  const routes = fs.readFileSync(
    path.join(__dirname, '../modules/assets/assets.routes.js'),
    'utf8',
  );
  assert.ok(routes.includes('ASSETS_CREATE'));
  assert.ok(routes.includes('ASSETS_DELETE'));
});

console.log(`\nOverall: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed} passed, ${failed} failed)`);
if (failed > 0) process.exit(1);
