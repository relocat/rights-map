// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Unit tests for the operator default overrides merged into the rules at bootstrap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODULE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'web', 'static', 'public', 'rights_map');
const { applyDefaultOverrides } = await import(pathToFileURL(join(MODULE_DIR, 'map-app.js')).href);

const TP_TOPIC = 'ua-tp';
const BLUE_CARD_TOPIC = 'eu-blue-card';
const FILE_TP_DEFAULTS = Object.freeze({ nat: 'UA', ua_military_obligation: 'yes' });
const FILE_BLUE_CARD_DEFAULTS = Object.freeze({ degree: 'uni' });
const OVERRIDDEN_TP_DEFAULTS = Object.freeze({ nat: 'UA', ua_military_obligation: 'no' });
const MALFORMED_RESPONSES = Object.freeze([
  null, undefined, 'text', 7, [], { [TP_TOPIC]: ['nat'] }, { [TP_TOPIC]: { nat: 3 } }, { [TP_TOPIC]: null },
]);

const buildRules = () => ({
  topics: [
    { id: TP_TOPIC, defaults: { ...FILE_TP_DEFAULTS } },
    { id: BLUE_CARD_TOPIC, defaults: { ...FILE_BLUE_CARD_DEFAULTS } },
  ],
});

test('an override replaces that topic only', () => {
  const rules = buildRules();
  applyDefaultOverrides(rules, { [TP_TOPIC]: OVERRIDDEN_TP_DEFAULTS });
  assert.deepEqual(rules.topics[0].defaults, OVERRIDDEN_TP_DEFAULTS);
  assert.deepEqual(rules.topics[1].defaults, FILE_BLUE_CARD_DEFAULTS);
});

test('a failed or malformed response leaves the file defaults untouched', () => {
  for (const overrides of MALFORMED_RESPONSES) {
    const rules = buildRules();
    applyDefaultOverrides(rules, overrides);
    assert.deepEqual(rules.topics[0].defaults, FILE_TP_DEFAULTS, JSON.stringify(overrides));
  }
});

test('an inherited property name is not mistaken for a topic id', () => {
  const rules = { topics: [{ id: 'constructor', defaults: { nat: 'UA' } }] };
  applyDefaultOverrides(rules, {});
  assert.deepEqual(rules.topics[0].defaults, { nat: 'UA' });
});

const { applyPilotSwitch } = await import(pathToFileURL(join(MODULE_DIR, 'map-app.js')).href);
const AUTHORITY_TOPIC = 'de-naturalisation';
const isAuthorityTopic = (topic) => topic.id === AUTHORITY_TOPIC;
const pilotRules = () => ({ topics: [{ id: TP_TOPIC }, { id: AUTHORITY_TOPIC }, { id: BLUE_CARD_TOPIC }] });

test('the pilot switch off removes only the authority topics', () => {
  const rules = pilotRules();
  applyPilotSwitch(rules, false, isAuthorityTopic);
  assert.deepEqual(rules.topics.map((topic) => topic.id), [TP_TOPIC, BLUE_CARD_TOPIC]);
});

test('the pilot switch on keeps every topic', () => {
  const rules = pilotRules();
  applyPilotSwitch(rules, true, isAuthorityTopic);
  assert.equal(rules.topics.length, pilotRules().topics.length);
});
