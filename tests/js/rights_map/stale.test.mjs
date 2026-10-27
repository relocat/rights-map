// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Tests for the staleness warning and the disputed legend count: the pure helpers are tested
// directly, without a DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODULE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'web', 'static', 'public', 'rights_map',
);
const load = (name) => import(pathToFileURL(join(MODULE_DIR, name)).href);
const { staleDays, MILLISECONDS_PER_DAY } = await load('ui-detail.js');
const { isDisputed } = await load('status-client.js');
const { countDisputed } = await load('ui-finder.js');

const THRESHOLD_DAYS = 30;
const VERIFIED = '2026-09-01';
const VERIFIED_MS = Date.UTC(2026, 8, 1);
const FAR_FUTURE_DAYS = 1000;
const todayAfter = (days) => VERIFIED_MS + days * MILLISECONDS_PER_DAY;

test('staleDays: 29 and 30 days are fresh, 31 is stale (boundary)', () => {
  assert.equal(staleDays(VERIFIED, todayAfter(29), THRESHOLD_DAYS), null);
  assert.equal(staleDays(VERIFIED, todayAfter(30), THRESHOLD_DAYS), null);
  assert.equal(staleDays(VERIFIED, todayAfter(31), THRESHOLD_DAYS), 31);
});

test('staleDays returns whole days, rounding a partial day down', () => {
  assert.equal(staleDays(VERIFIED, todayAfter(45) + MILLISECONDS_PER_DAY - 1, THRESHOLD_DAYS), 45);
});

test('staleDays: draft, garbage, undefined and impossible dates give null', () => {
  const values = ['draft', 'garbage', '', undefined, null, '2026-9-1', '2026-02-30', '2026-13-01', '2026-09-01T00:00'];
  for (const value of values) {
    assert.equal(staleDays(value, todayAfter(FAR_FUTURE_DAYS), THRESHOLD_DAYS), null, String(value));
  }
});

test('staleDays: a date in the future gives null', () => {
  assert.equal(staleDays(VERIFIED, VERIFIED_MS - MILLISECONDS_PER_DAY, THRESHOLD_DAYS), null);
});

test('staleDays: a missing threshold never warns', () => {
  assert.equal(staleDays(VERIFIED, todayAfter(FAR_FUTURE_DAYS), Number.NaN), null);
});

test('countDisputed counts covered countries with an open report for the topic', () => {
  const state = {
    topicId: 'ua-tp', disputed: { 'ua-tp': ['HU', 'PL'], other: ['DE'] },
    countries: [{ iso2: 'HU' }, { iso2: 'PL' }, { iso2: 'DE' }],
  };
  assert.equal(countDisputed({ isDisputed }, state), 2);
  assert.equal(countDisputed({ isDisputed }, { ...state, disputed: {} }), 0);
});
