'use strict';

const assert = require('node:assert/strict');

console.log('Holiday notification deduplication tests\n');

try {
  const repo = require('../modules/holidays/holidayNotificationHistory.repository');
  assert.ok(repo.NOTIFICATION_TYPES.CREATED);
  assert.ok(repo.NOTIFICATION_TYPES.REMINDER);
  assert.equal(typeof repo.wasAlreadySent, 'function');
  assert.equal(typeof repo.recordSent, 'function');
  console.log('  OK history repository exports');
  console.log('\nOverall: PASS');
} catch (e) {
  console.error(`\nFAIL: ${e.message}`);
  process.exit(1);
}
