// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Unit tests for the community figures: fetching (best effort), validation, text, and the paint
// precedence (a sourced figure always wins; community only fills gaps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchCommunityFigures, parseCommunityBody, formatCommunityRow } from '../../../web/static/public/rights_map/community-client.js';
import { districtPaint, paintedValue } from '../../../web/static/public/rights_map/authority-metrics.js';

const URL_PATH = '/map/community.json';
const STATUS_OK = 200;
const STATUS_SERVER_ERROR = 500;
const BUCKETS = [6, 12, 24, 36];
const TODAY_MONTH = 2026 * 12 + 9;
const FIGURE = { median: 12, q1: 9, q3: 15 };
const BODY = { topic: 'de-naturalisation', authorities: { gap: { n_band: '5-9', total: FIGURE, wait: { median: 6, q1: 3, q3: 6 } } } };
const GAP_AUTHORITY = { id: 'gap', times: { total: { src: 'none' } } };
const OFFICIAL_AUTHORITY = { id: 'gap', times: { total: { src: 'official', lo: 30, hi: 30, date: '2026-09' } } };

const respond = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('fetchCommunityFigures parses the authorities and keeps only the band minimum, never a count', async () => {
  const parsed = await fetchCommunityFigures(URL_PATH, respond(STATUS_OK, BODY));
  assert.deepEqual(parsed.gap.total, FIGURE);
  assert.equal(parsed.gap.nBand, '5-9');
  assert.equal(parsed.gap.nMin, 5);
});

test('fetchCommunityFigures requests the bare URL without credentials', async () => {
  const calls = [];
  await fetchCommunityFigures(URL_PATH, async (...args) => { calls.push(args); return respond(STATUS_OK, BODY)(); });
  assert.deepEqual(calls, [[URL_PATH, { credentials: 'omit' }]]);
});

test('a failed, malformed or empty response yields no data and no throw', async () => {
  assert.deepEqual(await fetchCommunityFigures(URL_PATH, respond(STATUS_SERVER_ERROR, {})), {});
  assert.deepEqual(await fetchCommunityFigures(URL_PATH, respond(STATUS_OK, null)), {});
  assert.deepEqual(await fetchCommunityFigures(URL_PATH, respond(STATUS_OK, { authorities: [] })), {});
  assert.deepEqual(await fetchCommunityFigures(URL_PATH, async () => { throw new TypeError('offline'); }), {});
  assert.deepEqual(await fetchCommunityFigures(URL_PATH, async () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } })), {});
});

test('an unexpected programming error still surfaces', async () => {
  await assert.rejects(fetchCommunityFigures(URL_PATH, async () => { throw new RangeError('bug'); }), RangeError);
});

test('parseCommunityBody drops entries with an unknown band, bad numbers or no metric', () => {
  const parsed = parseCommunityBody({ authorities: {
    badBand: { n_band: '3', total: FIGURE },
    exactCount: { n: 7, total: FIGURE },
    badNumber: { n_band: '5-9', total: { median: 'x', q1: 1, q3: 2 } },
    noMetric: { n_band: '5-9' },
    fraction: { n_band: '5-9', total: { median: 1.5, q1: 0, q3: 3 } },
    good: { n_band: '20+', proc: FIGURE },
  } });
  assert.deepEqual(Object.keys(parsed), ['good']);
  assert.equal(parsed.good.nMin, 20);
});

test('formatCommunityRow shows the band with an en dash and the typical range', () => {
  const { badge, text } = formatCommunityRow({ nBand: '5-9' }, FIGURE);
  assert.equal(badge, 'Community');
  assert.equal(`${badge} ${text}`, 'Community · 5–9 reports: about 12 months (typically 9–15)');
  assert.equal(formatCommunityRow({ nBand: '20+' }, { median: 6, q1: 6, q3: 6 }).text, '· 20+ reports: about 6 months (typically 6)');
});

test('community fills a district that has no sourced figure', () => {
  const community = parseCommunityBody(BODY);
  const paint = districtPaint(GAP_AUTHORITY, 'total', { todayMonth: TODAY_MONTH, bucketsMonths: BUCKETS, community });
  assert.deepEqual(paint, { bucket: 1, isConfirmed: true });
});

test('without community data a gap district stays "no data"', () => {
  const paint = districtPaint(GAP_AUTHORITY, 'total', { todayMonth: TODAY_MONTH, bucketsMonths: BUCKETS, community: {} });
  assert.deepEqual(paint, { bucket: null, isConfirmed: false });
});

test('an official figure always wins over a community figure', () => {
  const community = parseCommunityBody(BODY);
  assert.equal(paintedValue(OFFICIAL_AUTHORITY, 'total', community), OFFICIAL_AUTHORITY.times.total);
  const paint = districtPaint(OFFICIAL_AUTHORITY, 'total', { todayMonth: TODAY_MONTH, bucketsMonths: BUCKETS, community });
  assert.equal(paint.bucket, 3);
});

test('press and estimate figures also win', () => {
  const community = parseCommunityBody(BODY);
  for (const src of ['press', 'estimate']) {
    const authority = { id: 'gap', times: { total: { src, lo: 30 } } };
    assert.equal(paintedValue(authority, 'total', community).src, src);
  }
});

test('the fill is metric-specific: a metric the community does not state stays empty', () => {
  const community = parseCommunityBody(BODY);
  assert.deepEqual(districtPaint(GAP_AUTHORITY, 'proc', { todayMonth: TODAY_MONTH, bucketsMonths: BUCKETS, community }), { bucket: null, isConfirmed: false });
});

const rawFigure = (median, q1, q3) => ({ median, q1, q3 });

test('entries with a __proto__ key, out-of-range, unordered or non-multiple-of-3 figures are dropped', () => {
  const authorities = JSON.parse('{"__proto__": {"n_band": "5-9", "total": {"median": 12, "q1": 9, "q3": 15}}}');
  Object.assign(authorities, {
    'too-big': { n_band: '5-9', wait: rawFigure(123, 9, 126) },
    unordered: { n_band: '5-9', wait: rawFigure(6, 9, 12) },
    'off-step': { n_band: '5-9', wait: rawFigure(7, 6, 9) },
    negative: { n_band: '5-9', wait: rawFigure(3, -3, 6) },
    good: { n_band: '5-9', wait: rawFigure(6, 3, 9) },
  });
  const parsed = parseCommunityBody({ authorities });
  assert.deepEqual(Object.keys(parsed), ['good']);
  assert.equal(Object.getPrototypeOf(parsed), null);
});

test('a total may reach twice the single-report maximum, a wait may not', () => {
  const figure = rawFigure(240, 237, 240);
  const parsed = parseCommunityBody({ authorities: { a: { n_band: '5-9', total: figure, wait: figure } } });
  assert.deepEqual(parsed.a.total, figure);
  assert.equal(parsed.a.wait, undefined);
});
