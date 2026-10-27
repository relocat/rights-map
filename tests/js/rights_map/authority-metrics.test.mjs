// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  METRIC, STALE_OFFICIAL_MONTHS, COMMUNITY_MIN_REPORTS, metricMonths, bucketIndex, ageInMonths,
  isStale, isConfirmed, districtPaint, districtLabels, monthsText,
  publishableValue,
} from '../../../web/static/public/rights_map/authority-metrics.js';
import { monthIndex } from '../../../web/static/public/rights_map/engine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const readJson = (...parts) => JSON.parse(readFileSync(join(ROOT, ...parts), 'utf8'));
const RULES = readJson('web', 'static', 'public', 'rights_map', 'data', 'rules.v1.json');
const AUTHORITIES = readJson('web', 'static', 'public', 'rights_map', 'data', 'authorities.de.v1.json').authorities;
const DISTRICTS = readJson('web', 'static', 'geo', 'v1', 'l2', 'DE.json');
const BUCKETS = RULES.topics.find((topic) => topic.colour).colour.buckets_months;
const TODAY = monthIndex('2026-10');
const CONTEXT = { todayMonth: TODAY, bucketsMonths: BUCKETS };
const authorityOf = (ags) => AUTHORITIES.find((authority) => authority.covers.includes(ags));

test('bucket edges follow the thresholds strictly', () => {
  const expected = [[6, 0], [7, 1], [12, 1], [13, 2], [24, 2], [25, 3], [36, 3], [37, 4]];
  for (const [months, bucket] of expected) assert.equal(bucketIndex(months, BUCKETS), bucket, `${months} months`);
});

test('metricMonths uses the upper bound and rejects unusable values', () => {
  assert.equal(metricMonths({ src: 'none' }), null);
  assert.equal(metricMonths({ src: 'official', hi: 9 }), null);
  assert.equal(metricMonths(undefined), null);
  assert.equal(metricMonths({ src: 'estimate', lo: 7, hi: 9 }), 9);
  assert.equal(metricMonths({ src: 'official', lo: 37, partial: true }), 37);
  assert.equal(metricMonths({ src: 'official', lo: 0, hi: 0 }), 0);
});

test('ageInMonths reads both date forms and tolerates garbage', () => {
  assert.equal(ageInMonths({ date: '2025-10-31' }, TODAY), 12);
  assert.equal(ageInMonths({ date: '2025-10' }, TODAY), 12);
  assert.equal(ageInMonths({ date: 'soon' }, TODAY), null);
  assert.equal(ageInMonths({}, TODAY), null);
});

test('an official figure is stale after 12 months, not at 12, unless exempt', () => {
  assert.equal(STALE_OFFICIAL_MONTHS, 12);
  assert.equal(isStale({ src: 'official', date: '2025-10' }, TODAY), false);
  assert.equal(isStale({ src: 'official', date: '2025-09' }, TODAY), true);
  assert.equal(isStale({ src: 'official', date: '2020-01', stale_exempt: true }, TODAY), false);
  assert.equal(isStale({ src: 'official' }, TODAY), true, 'undated official fails closed');
  assert.equal(isStale({ src: 'estimate', date: '2020-01' }, TODAY), false, 'only official goes stale');
});

test('confirmation rule per source kind', () => {
  assert.equal(isConfirmed({ src: 'official', date: '2026-01' }, TODAY), true);
  assert.equal(isConfirmed({ src: 'official', date: '2025-01' }, TODAY), false);
  assert.equal(isConfirmed({ src: 'official', date: '2020-01', stale_exempt: true }, TODAY), true);
  assert.equal(COMMUNITY_MIN_REPORTS, 5);
  assert.equal(isConfirmed({ src: 'community', n: 4, date: '2026-10' }, TODAY), false);
  assert.equal(isConfirmed({ src: 'community', n: 5, date: '2026-10' }, TODAY), true);
  assert.equal(isConfirmed({ src: 'estimate', date: '2026-10' }, TODAY), false);
  assert.equal(isConfirmed({ src: 'press', date: '2026-10' }, TODAY), false);
  assert.equal(isConfirmed(undefined, TODAY), false);
});

test('shipped data: Leipzig city and Berlin paint as designed, Landkreis Leipzig has no data', () => {
  assert.deepEqual(districtPaint(authorityOf('14713'), METRIC.TOTAL, CONTEXT), { bucket: 4, isConfirmed: false });
  assert.deepEqual(districtPaint(authorityOf('11000'), METRIC.TOTAL, CONTEXT), { bucket: 1, isConfirmed: false });
  assert.deepEqual(districtPaint(authorityOf('14729'), METRIC.WAIT, CONTEXT), { bucket: null, isConfirmed: false });
});

test('community figures from fewer than five reports are "no data" everywhere (privacy)', () => {
  const community = (n) => ({ lo: 10, hi: 12, text: '10–12 months', src: 'community', date: '2026-10', ...(n === undefined ? {} : { n }) });
  const authority = (n) => ({ times: { wait: community(n) } });
  const none = { bucket: null, isConfirmed: false };
  for (const n of [undefined, 0, 1, COMMUNITY_MIN_REPORTS - 1]) {
    assert.deepEqual(publishableValue(community(n)), { src: 'none' }, `n=${n}`);
    assert.equal(metricMonths(community(n)), null, `n=${n}`);
    assert.deepEqual(districtPaint(authority(n), METRIC.WAIT, CONTEXT), none, `n=${n}`);
  }
  assert.equal(publishableValue(community(COMMUNITY_MIN_REPORTS)).src, 'community');
  assert.equal(metricMonths(community(COMMUNITY_MIN_REPORTS)), 12);
  assert.equal(districtPaint(authority(COMMUNITY_MIN_REPORTS), METRIC.WAIT, CONTEXT).bucket, 1);
});

test('publishableValue leaves other sources untouched', () => {
  const official = { src: 'official', lo: 3 };
  assert.equal(publishableValue(official), official);
  assert.equal(publishableValue(undefined), undefined);
});

test('shipped data holds no community figure below the minimum', () => {
  for (const authority of AUTHORITIES) {
    for (const value of Object.values(authority.times)) {
      if (value.src === 'community') assert.ok(value.n >= COMMUNITY_MIN_REPORTS, authority.id);
    }
  }
});

test('districtPaint gives no data without authority, figure or a known metric', () => {
  const none = { bucket: null, isConfirmed: false };
  assert.deepEqual(districtPaint(undefined, METRIC.TOTAL, CONTEXT), none);
  assert.deepEqual(districtPaint(authorityOf('14713'), METRIC.PROC, CONTEXT), none);
  assert.deepEqual(districtPaint(authorityOf('14713'), 'bogus', CONTEXT), none);
  assert.deepEqual(districtPaint(authorityOf('14713'), '__proto__', CONTEXT), none);
});

test('districtLabels disambiguates only duplicate names', () => {
  const labels = districtLabels(DISTRICTS);
  assert.equal(labels.get('14713'), 'Leipzig (city)');
  assert.equal(labels.get('14729'), 'Leipzig (district)');
  assert.equal(labels.get('11000'), 'Berlin');
  assert.equal(labels.size, DISTRICTS.features.length);
});

test('monthsText reads whole years as years', () => {
  assert.equal(monthsText(7), '7 months');
  assert.equal(monthsText(1), '1 month');
  assert.equal(monthsText(0), '0 months');
  assert.equal(monthsText(12), '1 year');
  assert.equal(monthsText(36), '3 years');
  assert.equal(monthsText(37), '37 months');
});
