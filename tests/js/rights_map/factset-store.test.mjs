// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STORAGE_KEY, createFactStore, serializeExport, parseExport, migrateFactSet, FactSetImportError,
} from '../../../web/static/public/rights_map/factset-store.js';
import { scopeFactSet, findTopic } from '../../../web/static/public/rights_map/engine.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES = JSON.parse(readFileSync(join(HERE, '..', '..', '..', 'web', 'static', 'public', 'rights_map', 'data', 'rules.v1.json'), 'utf8'));

/** In-memory Storage double. */
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    raw: data,
  };
}

const throwingStorage = {
  getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); },
};

test('facts persist across store instances', () => {
  const storage = memoryStorage();
  createFactStore(storage, RULES).set('german', 'B1');
  assert.equal(createFactStore(storage, RULES).facts().german, 'B1');
});

test('one fact set — a profile fact set in one topic is seen by every topic using it', () => {
  const store = createFactStore(memoryStorage(), RULES);
  store.set('german', 'B1');
  assert.equal(scopeFactSet(RULES, findTopic(RULES, 'eu-blue-card'), store.facts()).german, 'B1');
  assert.equal(scopeFactSet(RULES, findTopic(RULES, 'de-naturalisation'), store.facts()).german, 'B1');
});

test('storage that throws falls back to memory and reports not persistent', () => {
  const store = createFactStore(throwingStorage, RULES);
  store.set('nat', 'UA');
  assert.equal(store.facts().nat, 'UA');
  assert.equal(store.isPersistent, false);
});

test('corrupt stored JSON yields an empty fact set', () => {
  const store = createFactStore(memoryStorage({ [STORAGE_KEY]: '{not json' }), RULES);
  assert.deepEqual(store.facts(), {});
});

test('clear removes everything from storage', () => {
  const storage = memoryStorage();
  const store = createFactStore(storage, RULES);
  store.set('nat', 'UA');
  store.clear();
  assert.deepEqual(store.facts(), {});
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test('export → import round-trips unchanged', () => {
  const facts = { nat: 'UA', passport: 'valid', passport_until: '2028-03', german: 'A2', ua_exit_proof: 'no' };
  assert.deepEqual(parseExport(serializeExport(facts, RULES), RULES), facts);
});

test('migration renames and maps values; unmapped values become unanswered', () => {
  const rules = structuredClone(RULES);
  rules.fact_schema = 2;
  rules.migrations = [{ from: 1, to: 2, rename: { german_level: 'german' }, map: { german: { 'B1+': 'B1' } } }];
  assert.deepEqual(migrateFactSet({ fact_schema: 1, facts: { german_level: 'B1+' } }, rules), { german: 'B1' });
  assert.deepEqual(migrateFactSet({ fact_schema: 1, facts: { german_level: 'C9' } }, rules), {});
});

test('import rejects the whole file on one invalid value', () => {
  const text = JSON.stringify({ fact_schema: 1, facts: { nat: 'UA', passport_until: '2028-13' } });
  assert.throws(() => parseExport(text, RULES), FactSetImportError);
});

test('import rejects non-JSON and wrong shapes', () => {
  assert.throws(() => parseExport('nope', RULES), FactSetImportError);
  assert.throws(() => parseExport('{"facts": {}}', RULES), FactSetImportError);
  assert.throws(() => parseExport('{"fact_schema": 1, "facts": []}', RULES), FactSetImportError);
});

test('import error messages never echo values', () => {
  const secret = 'ZZ-SECRET';
  try {
    parseExport(JSON.stringify({ fact_schema: 1, facts: { nat: secret } }), RULES);
    assert.fail('expected FactSetImportError');
  } catch (error) {
    assert.ok(error instanceof FactSetImportError);
    assert.ok(!error.message.includes(secret));
  }
});

test('unknown facts are dropped on load', () => {
  const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ fact_schema: 1, facts: { nat: 'UA', legacy: 'x' } }) });
  assert.deepEqual(createFactStore(storage, RULES).facts(), { nat: 'UA' });
});

test('subscribers are notified on every mutation and can unsubscribe', () => {
  const store = createFactStore(memoryStorage(), RULES);
  let calls = 0;
  const unsubscribe = store.subscribe(() => { calls += 1; });
  store.set('nat', 'UA');
  store.unset('nat');
  unsubscribe();
  store.set('nat', 'BY');
  assert.equal(calls, 2);
});

test('import drops unknown fact ids and keeps the known facts', () => {
  const text = JSON.stringify({ fact_schema: 1, facts: { nat: 'UA', legacy: 'x' } });
  assert.deepEqual(parseExport(text, RULES), { nat: 'UA' });
});

test('import rejects a newer schema', () => {
  assert.throws(() => parseExport('{"fact_schema": 99, "facts": {}}', RULES), FactSetImportError);
});

test('stored data of the wrong shape yields an empty fact set without throwing', () => {
  for (const stored of ['{"fact_schema": 1, "facts": []}', '{"fact_schema": "1", "facts": {"nat": "UA"}}', 'null', '[]', '"x"']) {
    assert.deepEqual(createFactStore(memoryStorage({ [STORAGE_KEY]: stored }), RULES).facts(), {}, stored);
  }
});

test('a __proto__ key is never copied on import, load or migration', () => {
  const text = '{"fact_schema": 1, "facts": {"nat": "UA", "__proto__": {"polluted": "yes"}}}';
  const facts = parseExport(text, RULES);
  assert.deepEqual(facts, { nat: 'UA' });
  assert.equal(Object.getPrototypeOf(facts), Object.prototype);
  assert.equal(facts.polluted, undefined);
  const loaded = createFactStore(memoryStorage({ [STORAGE_KEY]: text }), RULES).facts();
  assert.equal(loaded.polluted, undefined);
  const rules = structuredClone(RULES);
  rules.fact_schema = 2;
  rules.migrations = [{ from: 1, to: 2, rename: { nat: '__proto__' }, map: {} }];
  assert.deepEqual(migrateFactSet(JSON.parse(text), rules), {});
});
