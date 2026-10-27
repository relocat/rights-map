// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Unit tests for the report client: the payload carries exactly the allowed
// keys, never facts, and the transport is cookie-free JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODULE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'web', 'static', 'public', 'rights_map',
);
const {
  REPORT_FIELD_KEYS, NETWORK_ERROR_CODE, buildReportPayload, fetchChallenge, submitReport,
} = await import(pathToFileURL(join(MODULE_DIR, 'report-client.js')).href);

const URLS = { challenge: '/map/report/challenge/', submit: '/map/report/' };
const FIELDS = {
  topicId: 'eu-blue-card', country: 'HU', kind: 'rule_changed',
  sourceUrl: 'https://example.org/law', description: 'Threshold changed', sinceMonth: '2026-05',
};
const PROOF = { token: 'tok.sig', counter: 42 };
const ALLOWED_WIRE_KEYS = [
  'topic_id', 'country', 'kind', 'source_url', 'description', 'since_month', 'token', 'counter',
];
const STATUS_CREATED = 201;
const STATUS_BAD_REQUEST = 400;
const STATUS_TOO_MANY = 429;

/** Builds a minimal fetch stub that records the call and returns a canned response. */
function stubFetch(status, body) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetchFn, calls };
}

test('REPORT_FIELD_KEYS lists the six form fields in order', () => {
  assert.deepEqual([...REPORT_FIELD_KEYS], [
    'topicId', 'country', 'kind', 'sourceUrl', 'description', 'sinceMonth',
  ]);
  assert.ok(Object.isFrozen(REPORT_FIELD_KEYS));
});

test('payload keys are exactly the eight allowed keys', () => {
  assert.deepEqual(Object.keys(buildReportPayload(FIELDS, PROOF)).sort(), [...ALLOWED_WIRE_KEYS].sort());
});

test('payload maps every field and the proof', () => {
  const payload = buildReportPayload(FIELDS, PROOF);
  assert.equal(payload.topic_id, FIELDS.topicId);
  assert.equal(payload.since_month, FIELDS.sinceMonth);
  assert.equal(payload.token, PROOF.token);
  assert.equal(payload.counter, PROOF.counter);
});

test('an extra facts argument is ignored, never copied', () => {
  const payload = buildReportPayload({ ...FIELDS, facts: { nationality: 'UA' } }, { ...PROOF, answers: [1] });
  assert.ok(!('facts' in payload));
  assert.ok(!('answers' in payload));
  assert.ok(!JSON.stringify(payload).includes('nationality'));
});

test('submitReport posts cookie-free JSON and maps 201 to ok', async () => {
  const { fetchFn, calls } = stubFetch(STATUS_CREATED, { ok: true });
  const payload = buildReportPayload(FIELDS, PROOF);
  assert.deepEqual(await submitReport(payload, URLS, fetchFn), { ok: true });
  const { url, init } = calls[0];
  assert.equal(url, URLS.submit);
  assert.equal(init.method, 'POST');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(init.body), payload);
});

test('submitReport maps a server error body to its code', async () => {
  const { fetchFn } = stubFetch(STATUS_BAD_REQUEST, { error: { code: 'E-RM02', message: 'x' } });
  assert.deepEqual(await submitReport({}, URLS, fetchFn), { ok: false, code: 'E-RM02' });
  const rateLimited = stubFetch(STATUS_TOO_MANY, { error: { code: 'E-RM03' } });
  assert.deepEqual(await submitReport({}, URLS, rateLimited.fetchFn), { ok: false, code: 'E-RM03' });
});

test('submitReport maps network failure and unreadable bodies to the network code', async () => {
  const failing = async () => { throw new TypeError('offline'); };
  assert.deepEqual(await submitReport({}, URLS, failing), { ok: false, code: NETWORK_ERROR_CODE });
  const unreadable = async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('html'); } });
  assert.deepEqual(await submitReport({}, URLS, unreadable), { ok: false, code: NETWORK_ERROR_CODE });
});

test('fetchChallenge issues a credential-free GET and returns token and bits', async () => {
  const { fetchFn, calls } = stubFetch(200, { token: 'a.b', bits: 14 });
  assert.deepEqual(await fetchChallenge(URLS, fetchFn), { ok: true, token: 'a.b', bits: 14 });
  assert.equal(calls[0].url, URLS.challenge);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.credentials, 'omit');
});

test('fetchChallenge rejects malformed challenges and failures', async () => {
  const malformed = stubFetch(200, { token: 5, bits: 'x' });
  assert.deepEqual(await fetchChallenge(URLS, malformed.fetchFn), { ok: false, code: NETWORK_ERROR_CODE });
  const limited = stubFetch(STATUS_TOO_MANY, { error: { code: 'E-RM03' } });
  assert.deepEqual(await fetchChallenge(URLS, limited.fetchFn), { ok: false, code: 'E-RM03' });
  const failing = async () => { throw new TypeError('offline'); };
  assert.deepEqual(await fetchChallenge(URLS, failing), { ok: false, code: NETWORK_ERROR_CODE });
});

test('neither module imports the fact store or the engine', () => {
  for (const file of ['pow.js', 'report-client.js']) {
    const source = readFileSync(join(MODULE_DIR, file), 'utf8');
    assert.ok(!source.includes('factset-store'), `${file} must not reference factset-store`);
    assert.ok(!source.includes('engine.js'), `${file} must not reference engine.js`);
    assert.ok(!/^\s*import\s/m.test(source), `${file} must have no import statements`);
  }
});
