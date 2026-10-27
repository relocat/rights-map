// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Unit tests of the Node data validator: every good fixture is clean, every bad fixture yields
// problems of exactly the category it was built to trigger, and the shipped data is clean.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FIXTURE_DIR, REPO_ROOT, schemaDirPath, validatorPath } from './validator-parity/locate.mjs';

const validator = await import(pathToFileURL(validatorPath()).href);
const { isRealAuthorityDate } = await import(
  pathToFileURL(join(validatorPath(), '..', 'authorities-checks.mjs')).href
);
const { findDuplicates } = await import(pathToFileURL(join(validatorPath(), '..', 'rules-checks.mjs')).href);

const GEO_BASE_DIR = join(REPO_ROOT, 'web', 'static', 'geo', 'v1');
const DATA_DIR = join(REPO_ROOT, 'web', 'static', 'public', 'rights_map', 'data');
const COUNTRY = 'DE';
const CATEGORY_TAG = /^\[([a-z]+)\]/;
const schemaDir = schemaDirPath();
const knownAgs = validator.loadKnownAgs(GEO_BASE_DIR, COUNTRY);

/** Sorted distinct category names of `problems`; throws on a problem without a tag. */
function categoriesOf(problems) {
  const categories = problems.map((problem) => {
    const match = CATEGORY_TAG.exec(problem);
    assert.ok(match, `problem without a category tag: ${problem}`);
    return match[1];
  });
  return [...new Set(categories)].sort();
}

/** Run the validator that matches the fixture's `kind`. */
function validateFixture({ kind, document }) {
  return kind === 'rules'
    ? validator.validateRules(document, { dataDir: DATA_DIR, schemaDir })
    : validator.validateAuthorities(document, knownAgs, { schemaDir });
}

const fixtureNames = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith('.json')).sort();

for (const name of fixtureNames) {
  const fixture = JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf-8'));
  test(`fixture ${name}: ${fixture.expect.length === 0 ? 'clean' : fixture.expect.join(', ')}`, () => {
    const problems = validateFixture(fixture);
    assert.deepEqual(categoriesOf(problems), [...fixture.expect].sort(), problems.join('\n'));
  });
}

test('there are good and bad fixtures for both files', () => {
  for (const kind of ['rules', 'authorities']) {
    assert.ok(fixtureNames.includes(`${kind}-good.json`), `${kind}-good.json missing`);
    assert.ok(fixtureNames.some((name) => name.startsWith(`${kind}-bad-`)), `no ${kind}-bad-* fixture`);
  }
});

test('the shipped data is clean', () => {
  const { rulesProblems, authoritiesProblems } = validator.validateRepository(REPO_ROOT, schemaDir);
  assert.deepEqual(rulesProblems, []);
  assert.deepEqual(authoritiesProblems, []);
});

test('rules naming an authorities file are reported when no data directory is given (fail closed)', () => {
  const { document } = JSON.parse(readFileSync(join(FIXTURE_DIR, 'rules-good.json'), 'utf-8'));
  assert.deepEqual(categoriesOf(validator.validateRules(document, { schemaDir })), ['reference']);
});

test('loadKnownAgs reads the ags property of the district layer', () => {
  assert.ok(knownAgs.has('01001'));
  assert.ok(!knownAgs.has('99999'));
});

test('findDuplicates reports each repeated identifier once', () => {
  assert.deepEqual(findDuplicates(['a', 'b', 'a', 'a', 'b', 'c']), ['a', 'b']);
});

test('isRealAuthorityDate accepts days and months and rejects impossible ones', () => {
  for (const good of ['2026-10-27', '2026-10', '2024-02-29']) assert.ok(isRealAuthorityDate(good), good);
  for (const bad of ['2026-02-30', '2025-02-29', '2026-13', '2026-00', '0000-01-01', '26-10-27', 20261027, null]) {
    assert.ok(!isRealAuthorityDate(bad), String(bad));
  }
});
