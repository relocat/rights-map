// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Unit tests for the disputed-status client: best effort, never throws, never sends anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODULE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'web', 'static', 'public', 'rights_map',
);
const { fetchDisputedStatus, isDisputed } = await import(pathToFileURL(join(MODULE_DIR, 'status-client.js')).href);

const URL_PATH = '/map/status.json';
const TOPIC = 'ua-tp';
const OTHER_TOPIC = 'eu-blue-card';
const STATUS_OK = 200;
const STATUS_SERVER_ERROR = 500;
const DISPUTED = { [TOPIC]: ['HU', 'PL'] };

const respond = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('fetchDisputedStatus returns the disputed map', async () => {
  assert.deepEqual(await fetchDisputedStatus(URL_PATH, respond(STATUS_OK, { disputed: DISPUTED })), DISPUTED);
});

test('fetchDisputedStatus requests the bare URL without credentials', async () => {
  const calls = [];
  await fetchDisputedStatus(URL_PATH, async (url, init) => {
    calls.push({ url, init });
    return respond(STATUS_OK, { disputed: {} })();
  });
  assert.equal(calls[0].url, URL_PATH);
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.body, undefined);
});

test('fetchDisputedStatus returns an empty map on a network error', async () => {
  const failing = async () => { throw new TypeError('Failed to fetch'); };
  assert.deepEqual(await fetchDisputedStatus(URL_PATH, failing), {});
});

test('fetchDisputedStatus returns an empty map on a non-200 answer', async () => {
  assert.deepEqual(await fetchDisputedStatus(URL_PATH, respond(STATUS_SERVER_ERROR, { disputed: DISPUTED })), {});
});

test('fetchDisputedStatus returns an empty map on invalid JSON', async () => {
  const badJson = async () => ({ ok: true, status: STATUS_OK, json: async () => { throw new SyntaxError('bad json'); } });
  assert.deepEqual(await fetchDisputedStatus(URL_PATH, badJson), {});
});

test('fetchDisputedStatus returns an empty map when the body has the wrong shape', async () => {
  const wrongShapes = [null, [], { disputed: null }, { disputed: [] }, { disputed: { [TOPIC]: 'HU' } }, { disputed: { [TOPIC]: [1] } }, {}];
  for (const body of wrongShapes) {
    assert.deepEqual(await fetchDisputedStatus(URL_PATH, respond(STATUS_OK, body)), {});
  }
});

test('fetchDisputedStatus lets a programming error surface', async () => {
  const broken = async () => { throw new RangeError('bug'); };
  await assert.rejects(fetchDisputedStatus(URL_PATH, broken), RangeError);
});

test('isDisputed: hit, miss, empty and undefined', () => {
  assert.equal(isDisputed(DISPUTED, TOPIC, 'HU'), true);
  assert.equal(isDisputed(DISPUTED, TOPIC, 'DE'), false);
  assert.equal(isDisputed(DISPUTED, OTHER_TOPIC, 'HU'), false);
  assert.equal(isDisputed({}, TOPIC, 'HU'), false);
  assert.equal(isDisputed(undefined, TOPIC, 'HU'), false);
  assert.equal(isDisputed(null, TOPIC, 'HU'), false);
});

test('isDisputed ignores inherited object keys', () => {
  assert.equal(isDisputed({}, 'constructor', 'HU'), false);
  assert.equal(isDisputed({}, '__proto__', 'HU'), false);
});

test('status-client does not import the fact store or the engine', () => {
  const source = readFileSync(join(MODULE_DIR, 'status-client.js'), 'utf8');
  assert.doesNotMatch(source, /factset|engine\.js|facts|answers/i);
});
