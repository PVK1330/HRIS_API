'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

test('uk-bank-holidays.json includes all UK regions for configured years', () => {
  const raw = fs.readFileSync(
    path.join(__dirname, '../data/uk-bank-holidays.json'),
    'utf8',
  );
  const config = JSON.parse(raw);
  assert.ok(config.regions.includes('England'));
  assert.ok(config.regions.includes('Scotland'));
  assert.ok(config.regions.includes('Wales'));
  assert.ok(config.regions.includes('Northern Ireland'));
  const years = Object.keys(config.years);
  assert.ok(years.length >= 1);
  for (const y of years) {
    for (const region of config.regions) {
      assert.ok(Array.isArray(config.years[y][region]), `${y} ${region} must be array`);
    }
  }
});

test('seedFromConfig rejects unknown year', async () => {
  const service = require('../modules/holidays/holidays.service');
  const fakePool = {};
  await assert.rejects(
    () => service.seedFromConfig(fakePool, { year: 1999 }),
    /No holiday seed data/,
  );
});
