// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Unit tests for "Share my experience": the payload carries exactly the allowed keys and
// never an answer, and the month and months validation reports without correcting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODULE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'web', 'static', 'public', 'rights_map',
);
const client = await import(pathToFileURL(join(MODULE_DIR, 'experience-client.js')).href);
const dialog = await import(pathToFileURL(join(MODULE_DIR, 'ui-experience.js')).href);
const fieldControls = await import(pathToFileURL(join(MODULE_DIR, 'ui-fact-controls.js')).href);
const { parseMonthInput, formatMonthYearInput } = fieldControls;
const dialogSource = readFileSync(join(MODULE_DIR, 'ui-experience.js'), 'utf8');

const ALLOWED_WIRE_KEYS = [
  'topic_id', 'authority_id', 'certificate_month', 'wait_months', 'processing_months', 'token', 'counter',
];
const FIELDS = {
  topicId: 'de-naturalisation', authorityId: 'de-bb-barnim', certificateMonth: '2026-03', waitMonths: 3, processingMonths: 11,
};
const PROOF = { token: 'tok.sig', counter: 42 };
const TODAY = new Date(2026, 9, 15);
const EMPTY_FIELDS = { certificateMonth: '2026-03', waitMonths: '', processingMonths: '' };
const TYPED_MONTH_DIGITS = '032026';
const FORBIDDEN_IN_CODE = [/factset/i, /\bfacts\b/, /\banswers\b/i, /innerHTML/, /localStorage/, /sessionStorage/, /document\.cookie/];
const STRING_LITERAL = /'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

test('payload keys are exactly the allowed set', () => {
  const payload = client.buildExperiencePayload(FIELDS, PROOF);
  assert.deepEqual(Object.keys(payload).sort(), [...ALLOWED_WIRE_KEYS].sort());
  assert.deepEqual([...client.EXPERIENCE_PAYLOAD_KEYS].sort(), [...ALLOWED_WIRE_KEYS].sort());
});

test('the payload builder ignores unknown properties such as an answer', () => {
  const payload = client.buildExperiencePayload({ ...FIELDS, nationality: 'UA', facts: { nat: 'UA' } }, PROOF);
  assert.deepEqual(Object.keys(payload).sort(), [...ALLOWED_WIRE_KEYS].sort());
  assert.ok(!JSON.stringify(payload).includes('UA'));
});

test('optional months travel as null, never as an invented number', () => {
  const payload = client.buildExperiencePayload({ ...FIELDS, waitMonths: null, processingMonths: null }, PROOF);
  assert.equal(payload.wait_months, null);
  assert.equal(payload.processing_months, null);
});

test('a valid month with empty optional months is cleaned without errors', () => {
  const { errors, cleaned } = dialog.validateExperienceFields(EMPTY_FIELDS, TODAY, parseMonthInput);
  assert.deepEqual(errors, {});
  assert.deepEqual(cleaned, { certificateMonth: '2026-03', waitMonths: null, processingMonths: null });
});

test('the certificate month is required', () => {
  const { errors, cleaned } = dialog.validateExperienceFields({ ...EMPTY_FIELDS, certificateMonth: '' }, TODAY, parseMonthInput);
  assert.match(errors.certificateMonth, /Choose the month/);
  assert.equal(cleaned, null);
});

test('malformed months are reported and not corrected', () => {
  for (const text of ['2026-13', '2026-00', '26-03', '2026-3', 'March 2026', '2026-03-01']) {
    const { errors } = dialog.validateExperienceFields({ ...EMPTY_FIELDS, certificateMonth: text }, TODAY, parseMonthInput);
    assert.match(errors.certificateMonth, /like 03\/2026/, text);
  }
});

test('a future month is refused and the current month is accepted', () => {
  assert.match(dialog.validateExperienceFields({ ...EMPTY_FIELDS, certificateMonth: '2026-11' }, TODAY, parseMonthInput).errors.certificateMonth, /future/);
  assert.match(dialog.validateExperienceFields({ ...EMPTY_FIELDS, certificateMonth: '2027-01' }, TODAY, parseMonthInput).errors.certificateMonth, /future/);
  assert.deepEqual(dialog.validateExperienceFields({ ...EMPTY_FIELDS, certificateMonth: '2026-10' }, TODAY, parseMonthInput).errors, {});
});

test('a month before the minimum year is refused', () => {
  const tooOld = `${dialog.CERTIFICATE_MONTH_MIN_YEAR - 1}-12`;
  assert.match(dialog.validateExperienceFields({ ...EMPTY_FIELDS, certificateMonth: tooOld }, TODAY, parseMonthInput).errors.certificateMonth, /before/);
});

test('months figures: bounds are inclusive and anything else is refused', () => {
  const bounds = { ...EMPTY_FIELDS, waitMonths: '0', processingMonths: String(dialog.MONTHS_MAX) };
  assert.deepEqual(dialog.validateExperienceFields(bounds, TODAY, parseMonthInput).cleaned.processingMonths, dialog.MONTHS_MAX);
  for (const text of [String(dialog.MONTHS_MAX + 1), '-1', '1.5', 'abc', '1e2']) {
    const { errors } = dialog.validateExperienceFields({ ...EMPTY_FIELDS, waitMonths: text, processingMonths: text }, TODAY, parseMonthInput);
    assert.match(errors.waitMonths, /whole number/, text);
    assert.match(errors.processingMonths, /whole number/, text);
  }
});

test('the dialog source never touches answers, storage or markup injection', () => {
  const code = dialogSource.replace(STRING_LITERAL, "''").replace(/\/\/.*$/gm, '');
  for (const pattern of FORBIDDEN_IN_CODE) assert.doesNotMatch(code, pattern, String(pattern));
});

test('the form notice is the legally reviewed text and links only the words "privacy notice for experiences"', () => {
  const before = 'We use your answer only for the waiting times shown on the map, and only once at least 5 people have answered for this authority. Please don\\\'t add anything that identifies you. Details: ';
  assert.ok(dialogSource.includes(`privacyBeforeLink: '${before}'`));
  assert.ok(dialogSource.includes("privacyLinkLabel: 'privacy notice for experiences'"));
  assert.ok(dialogSource.includes("privacyAfterLink: '.'"));
  assert.equal(dialog.DEFAULT_PRIVACY_URL, '/map/experience-privacy/');
});

test('typing 032026 shows 03/2026 and is sent as 2026-03', () => {
  const shown = formatMonthYearInput(TYPED_MONTH_DIGITS);
  assert.equal(shown, '03/2026');
  const { errors, cleaned } = dialog.validateExperienceFields({ ...EMPTY_FIELDS, certificateMonth: shown }, TODAY, parseMonthInput);
  assert.deepEqual(errors, {});
  assert.equal(cleaned.certificateMonth, '2026-03');
  assert.equal(client.buildExperiencePayload({ ...FIELDS, certificateMonth: cleaned.certificateMonth }, PROOF).certificate_month, '2026-03');
});

test('13/2026 is reported under the month field and nothing is cleaned for sending', () => {
  const { errors, cleaned } = dialog.validateExperienceFields({ ...EMPTY_FIELDS, certificateMonth: '13/2026' }, TODAY, parseMonthInput);
  assert.match(errors.certificateMonth, /like 03\/2026/);
  assert.equal(cleaned, null);
});

test('the month field reuses the passport field helpers instead of copying them', () => {
  assert.doesNotMatch(dialogSource, /replace\(\/\\D/);
  assert.match(dialogSource, /deps\.monthField\.attachMonthFormatting/);
});
