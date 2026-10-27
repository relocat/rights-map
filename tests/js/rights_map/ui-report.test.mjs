// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Unit tests for the report dialog's logic. Node has no DOM, so these cover the
// pure parts (validation, failure text, the submission flow with its single
// retry) and read the source text for the privacy invariants. The dialog's
// focus, Escape and double-click behaviour is asserted in the browser suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODULE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'web', 'static', 'public', 'rights_map',
);
const report = await import(pathToFileURL(join(MODULE_DIR, 'ui-report.js')).href);
const proofModule = await import(pathToFileURL(join(MODULE_DIR, 'ui-proof-ahead.js')).href);
const realClient = await import(pathToFileURL(join(MODULE_DIR, 'report-client.js')).href);
const source = readFileSync(join(MODULE_DIR, 'ui-report.js'), 'utf8');

const URLS = { challenge: '/map/report/challenge/', submit: '/map/report/' };
const FIELDS = {
  topicId: 'ua-tp', country: 'HU', kind: 'rule_changed',
  sourceUrl: 'https://example.org/law', description: 'Changed', sinceMonth: '',
};
const SOLVED_COUNTER = 7;
const STUB_BITS = 4;
const STRING_LITERAL = /'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const FORBIDDEN_IN_CODE = [
  /factset/i, /\bfacts\b/, /\banswers\b/i, /innerHTML/, /insertAdjacentHTML/,
  /localStorage/, /sessionStorage/, /indexedDB/, /document\.cookie/, /setAttribute\(\s*''/,
];

/** Client stub: scripted submit results, records every call. */
function stubClient(submitResults) {
  const calls = { challenges: 0, payloads: [] };
  const client = {
    NETWORK_ERROR_CODE: realClient.NETWORK_ERROR_CODE,
    buildReportPayload: realClient.buildReportPayload,
    fetchChallenge: async () => {
      calls.challenges += 1;
      return { ok: true, token: `token-${calls.challenges}`, bits: STUB_BITS };
    },
    submitReport: async (payload) => {
      calls.payloads.push(payload);
      return submitResults.shift();
    },
  };
  return { client, calls };
}
const pow = { solveProofOfWork: async () => SOLVED_COUNTER };
const run = (client, { pow: powOverride = pow, ...extra } = {}) => report.runReportFlow({
  client, reportUrls: URLS, fields: FIELDS, onPhase: () => {}, ...extra,
  proofAhead: proofModule.createProofAhead({ client, pow: powOverride, urls: URLS }),
});

test('validateReportFields requires a link only for "rule changed"', () => {
  assert.ok(report.validateReportFields({ kind: 'rule_changed', sourceUrl: '' }));
  for (const kind of report.KIND_ORDER.filter((value) => value !== report.KIND_REQUIRING_URL)) {
    assert.equal(report.validateReportFields({ kind, sourceUrl: '' }), null, kind);
  }
});

test('validateReportFields rejects text that is not a web address', () => {
  assert.ok(report.validateReportFields({ kind: 'wrong_colour', sourceUrl: 'not a url' }));
  assert.equal(report.validateReportFields({ kind: 'rule_changed', sourceUrl: 'https://example.org/x' }), null);
});

test('describeFailure gives static text with a reference code for server errors only', () => {
  assert.match(report.describeFailure('E-RM03'), /Reference: E-RM03$/);
  assert.doesNotMatch(report.describeFailure('network'), /Reference/);
  assert.equal(report.describeFailure('anything-else'), report.describeFailure('network'));
});

test('runReportFlow sends one payload with the solved counter and reports the phases', async () => {
  const { client, calls } = stubClient([{ ok: true }]);
  const phases = [];
  const result = await run(client, { onPhase: (phase) => phases.push(phase) });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(phases, [report.PHASE.SOLVING, report.PHASE.SENDING]);
  assert.equal(calls.payloads.length, 1);
  assert.equal(calls.payloads[0].counter, SOLVED_COUNTER);
  assert.equal(calls.payloads[0].token, 'token-1');
});

test('E-RM02 triggers exactly one retry with a fresh challenge', async () => {
  const { client, calls } = stubClient([{ ok: false, code: 'E-RM02' }, { ok: true }]);
  assert.deepEqual(await run(client), { ok: true });
  assert.equal(calls.challenges, 2);
  assert.deepEqual(calls.payloads.map((payload) => payload.token), ['token-1', 'token-2']);
});

test('E-RM02 twice ends in the error, not a loop', async () => {
  const { client, calls } = stubClient([{ ok: false, code: 'E-RM02' }, { ok: false, code: 'E-RM02' }, { ok: true }]);
  assert.deepEqual(await run(client), { ok: false, code: 'E-RM02' });
  assert.equal(calls.payloads.length, report.MAX_PROOF_RETRIES + 1);
});

test('other failure codes are not retried', async () => {
  for (const code of ['E-RM01', 'E-RM03', 'E-RM04', 'network']) {
    const { client, calls } = stubClient([{ ok: false, code }, { ok: true }]);
    assert.deepEqual(await run(client), { ok: false, code }, code);
    assert.equal(calls.payloads.length, 1, code);
  }
});

test('a challenge failure is returned without solving or sending', async () => {
  const { client, calls } = stubClient([]);
  client.fetchChallenge = async () => ({ ok: false, code: 'E-RM03' });
  assert.deepEqual(await run(client), { ok: false, code: 'E-RM03' });
  assert.equal(calls.payloads.length, 0);
});

test('a difficulty the solver refuses becomes a network failure', async () => {
  const { client, calls } = stubClient([]);
  const refusing = { solveProofOfWork: async () => { throw new RangeError('too hard'); } };
  assert.deepEqual(await run(client, { pow: refusing }), { ok: false, code: 'network' });
  assert.equal(calls.payloads.length, 0);
});

test('the dialog code never touches facts or storage and builds no HTML from text', () => {
  // The visitor-facing sentences say "answers"; strip string literals before looking for code uses.
  const code = source.replace(STRING_LITERAL, "''");
  for (const forbidden of FORBIDDEN_IN_CODE) assert.doesNotMatch(code, forbidden, String(forbidden));
});

test('both phases read "Sending…", never a bot-wall phrase', () => {
  assert.equal(report.describePhase(report.PHASE.SOLVING), 'Sending…');
  assert.equal(report.describePhase(report.PHASE.SENDING), 'Sending…');
});

test('the privacy policy link target is a named constant', () => {
  assert.equal(report.PRIVACY_POLICY_URL, '/map/report-privacy/');
});
