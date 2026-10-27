// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Unit tests for the requirements checklist, the personal estimate, the pilot badge and the
// situation prompt of authority topics. Elements are small fakes; no DOM is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PUBLIC_DIR = join(ROOT, 'web', 'static', 'public', 'rights_map');
const load = (name) => import(pathToFileURL(join(PUBLIC_DIR, name)).href);
const view = await load('ui-wizard-requirements.js');
const situation = await load('ui-wizard-situation.js');
const wizard = await load('ui-wizard.js');
const common = await load('ui-common.js');
const metrics = await load('authority-metrics.js');
const engine = await load('engine.js');
const RULES = JSON.parse(readFileSync(join(PUBLIC_DIR, 'data', 'rules.v1.json'), 'utf8'));
const AUTHORITIES = JSON.parse(readFileSync(join(PUBLIC_DIR, 'data', 'authorities.de.v1.json'), 'utf8'));
const TOPIC = RULES.topics.find((topic) => topic.granularity === 'authority');
const COUNTRY_TOPIC = RULES.topics.find((topic) => topic.granularity !== 'authority');
const BY_AGS = engine.authorityIndex(AUTHORITIES);

const TODAY = '2026-10';
const BERLIN = '11000';
const NO_AUTHORITY = '01001';
const NO_AUTHORITY_NAME = 'Flensburg';
const LABELS = new Map([[NO_AUTHORITY, NO_AUTHORITY_NAME]]);
// Controlled authorities for the estimate card: one with a ranged official wait, one with an
// open-ended figure, one with no figures, and NO_AUTHORITY absent from the index.
const WITH_RANGE_AGS = '99001';
const OPEN_ENDED_AGS = '99002';
const NO_FIGURES_AGS = '99003';
const fixtureAuthority = (ags, times) => ({
  id: `fixture-${ags}`, name: `Fixture ${ags}`, unit: 'unit', covers: [ags], covers_label: 'Fixture',
  mode: { value: null, text: 'Not verified yet', src: 'none' }, times, evidence: [],
});
const FIXTURE_BY_AGS = Object.freeze({
  [WITH_RANGE_AGS]: fixtureAuthority(WITH_RANGE_AGS, {
    wait: { lo: 5, hi: 7, text: '5–7 months', src: 'official', date: TODAY, evidence: [] },
    proc: { lo: 6, hi: 8, text: '6–8 months', src: 'official', date: TODAY, evidence: [] },
    total: { lo: 11, hi: 15, text: '11–15 months', src: 'official', date: TODAY, evidence: [] },
  }),
  [OPEN_ENDED_AGS]: fixtureAuthority(OPEN_ENDED_AGS, {
    wait: { lo: 37, hi: 37, text: '≈ 3 years', src: 'estimate', date: TODAY, evidence: [] },
    proc: { src: 'none' },
    total: { lo: 37, partial: true, text: 'More than 3 years', src: 'estimate', date: TODAY, evidence: [] },
  }),
  [NO_FIGURES_AGS]: fixtureAuthority(NO_FIGURES_AGS, { wait: { src: 'none' }, proc: { src: 'none' }, total: { src: 'none' } }),
});
const FIVE_YEARS_AGO_FACTS = { de_residence_since: '2015' };
const RECENT_FACTS = { de_residence_since: '2024-03' };
const IMPERATIVES = Object.freeze(['Renew', 'You should']);
const SOURCE_NAMES = Object.freeze(['innerHTML', 'factset', 'report']);
const SITUATION_FACTS_TO_ANSWER = TOPIC.uses.length;

/** Minimal element: attributes, listeners, children, focus. */
function fakeElement(tag) {
  const attributes = {};
  const element = {
    tag, attributes, listeners: {}, style: {}, children: [], textContent: '', hidden: false, scrollTop: 0,
    setAttribute(name, value) { attributes[name] = String(value); },
    getAttribute: (name) => attributes[name] ?? null,
    addEventListener(name, handler) { element.listeners[name] = handler; },
    append(...nodes) { element.children.push(...nodes); },
    replaceChildren(...nodes) { element.children = nodes; },
    contains: () => false,
    querySelectorAll: () => [],
    focus() { globalThis.document.activeElement = element; },
  };
  return element;
}

globalThis.document = {
  activeElement: null,
  createElementNS: (_namespace, tag) => fakeElement(tag),
  createTextNode: (value) => ({ textContent: value, children: [] }),
};

function findAll(root, predicate) {
  return [root, ...root.children.flatMap((child) => findAll(child, predicate))].filter(predicate);
}
const textOf = (node) => node.textContent + node.children.map(textOf).join('');
const hasClass = (node, name) => (node.attributes?.class ?? '').split(' ').includes(name);
const byClass = (root, name) => findAll(root, (node) => hasClass(node, name));

function stateFor(facts, ags = null, byAgs = BY_AGS) {
  const authority = ags === null ? undefined : byAgs[ags];
  const context = { factSet: facts, today: TODAY, isConfirmed: metrics.isConfirmed };
  return {
    rules: RULES, topicId: TOPIC.id, today: TODAY, facts, selectedAgs: ags,
    result: engine.evaluate(RULES, TOPIC.id, facts, TODAY),
    authorityResult: authority ? engine.evaluateAuthority(RULES, TOPIC, authority, context) : null,
    districts: { byAgs, labels: LABELS },
  };
}

function rendered(facts, ags = null, byAgs = BY_AGS) {
  const root = fakeElement('div');
  view.createRequirements(root, {}, { common, engine }).render(stateFor(facts, ags, byAgs));
  return root;
}

const requirementText = (root, id) => {
  const index = TOPIC.requirements.findIndex((requirement) => requirement.id === id);
  return textOf(byClass(root, 'rm-requirement')[index]);
};

test('requirementSymbol maps every state to its symbol', () => {
  assert.equal(view.requirementSymbol('met'), '✓');
  assert.equal(view.requirementSymbol('unmet'), '!');
  assert.equal(view.requirementSymbol('unanswered'), '?');
  assert.equal(view.requirementSymbol('info'), '•');
});

test('each requirement state shows its symbol and state word; info items show no state word', () => {
  const root = rendered({ ...FIVE_YEARS_AGO_FACTS, german: 'B1', passport: 'expired' });
  assert.match(requirementText(root, 'residence'), /^✓.*5 years lawful residence.*Met/);
  assert.match(requirementText(root, 'identity'), /^!.*Not met/);
  assert.match(requirementText(root, 'test'), /^\?.*Answer to check/);
  const info = requirementText(root, 'convictions');
  assert.match(info, /^•.*No relevant convictions/);
  assert.doesNotMatch(info, /Met|Not met|Answer to check/);
});

test('an unmet residence note names the month the visitor becomes eligible', () => {
  const root = rendered(RECENT_FACTS);
  assert.match(requirementText(root, 'residence'), /from Mar 2029/);
  assert.doesNotMatch(textOf(root), /\d{4}-\d{2}/);
});

test('checklist and estimate respond to german and de_residence_since changes', () => {
  const before = rendered({ de_residence_since: '2015' });
  assert.match(requirementText(before, 'german'), /Answer to check/);
  const after = rendered({ de_residence_since: '2015', german: 'B1' });
  assert.match(requirementText(after, 'german'), /Met/);
  const headline = (root) => textOf(byClass(root, 'rm-estimate-headline')[0]);
  assert.equal(headline(rendered(FIVE_YEARS_AGO_FACTS)), 'You can apply now');
  assert.equal(headline(rendered(RECENT_FACTS)), 'Earliest application: Mar 2029');
});

test('nat test and livelihood show without lever badges', () => {
  const root = rendered({ ...FIVE_YEARS_AGO_FACTS, de_nat_test: 'yes', de_own_livelihood: 'yes' });
  assert.equal(byClass(root, 'rm-lever-badge').length, 0);
  assert.match(requirementText(root, 'test'), /Met/);
  assert.match(requirementText(root, 'livelihood'), /Met/);
});

test('estimateText covers apply now, a future date, a window, open end, unconfirmed, no district and no data', () => {
  const fmt = common.formatMonthYear;
  const base = { earliestApply: '2026-10', canApplyNow: true, window: null, isConfirmed: false };
  assert.equal(view.estimateText(base, undefined, fmt).headline, 'You can apply now');
  assert.equal(view.estimateText({ ...base, canApplyNow: false, earliestApply: '2027-03' }, undefined, fmt).headline,
    'Earliest application: Mar 2027');
  assert.equal(view.estimateText(base, undefined, fmt).detail, 'Pick a district on the map to add the local waiting time.');
  assert.equal(view.estimateText(base, 'Stadt X', fmt).detail, 'No waiting-time data for this district yet.');
  const window = { from: '2027-05', to: '2027-07', isOpenEnded: false };
  assert.equal(view.estimateText({ ...base, window, isConfirmed: true }, 'Stadt X', fmt).detail,
    'Decision expected between May 2027 and Jul 2027');
  assert.equal(view.estimateText({ ...base, window }, 'Stadt X', fmt).detail,
    'Decision expected between May 2027 and Jul 2027 (unconfirmed)');
  assert.equal(view.estimateText({ ...base, window: { ...window, isOpenEnded: true }, isConfirmed: true }, 'Stadt X', fmt).detail,
    'Decision expected May 2027 or later');
});

test('the estimate card reads the selected district, or says what is missing', () => {
  const detail = (root) => textOf(byClass(root, 'rm-estimate-detail')[0]);
  const renderedFixture = (ags) => rendered(FIVE_YEARS_AGO_FACTS, ags, FIXTURE_BY_AGS);
  assert.match(detail(renderedFixture(null)), /^Pick a district/);
  assert.match(detail(renderedFixture(WITH_RANGE_AGS)), /^Decision expected between .*/);
  assert.match(detail(renderedFixture(OPEN_ENDED_AGS)), /^Decision expected .* or later \(unconfirmed\)$/);
  const noFigures = renderedFixture(NO_FIGURES_AGS);
  assert.equal(detail(noFigures), 'No waiting-time data for this district yet.');
  assert.equal(textOf(byClass(noFigures, 'rm-estimate-where')[0]), `Fixture ${NO_FIGURES_AGS}`);
  const uncovered = renderedFixture(NO_AUTHORITY);
  assert.equal(FIXTURE_BY_AGS[NO_AUTHORITY], undefined);
  assert.equal(detail(uncovered), 'No waiting-time data for this district yet.');
  assert.equal(textOf(byClass(uncovered, 'rm-estimate-where')[0]), NO_AUTHORITY_NAME);
});

test('the view is hidden for country topics and before a topic is chosen', () => {
  const root = fakeElement('div');
  const created = view.createRequirements(root, {}, { common, engine });
  created.render({ ...stateFor({}), topicId: null });
  assert.equal(root.hidden, true);
  created.render({ ...stateFor({}), topicId: COUNTRY_TOPIC.id, result: engine.evaluate(RULES, COUNTRY_TOPIC.id, {}, TODAY) });
  assert.equal(root.hidden, true);
});

test('no rendered text is an imperative from the mockup', () => {
  const text = textOf(rendered({ de_residence_since: '2024-03', passport: 'expired' }, BERLIN));
  for (const phrase of IMPERATIVES) assert.ok(!text.includes(phrase), phrase);
});

test('the situation prompt of an authority topic promises the estimate', () => {
  const root = fakeElement('div');
  const created = situation.createSituation(root, {}, { common, engine, factControls: { buildField: () => null } });
  created.render(stateFor({}));
  const prompt = byClass(root, 'rm-prompt')[0];
  assert.match(textOf(prompt), /^Answer \d+ questions? to see your estimate$/);
  assert.ok(!textOf(prompt).includes('colour the map'));
  assert.ok(SITUATION_FACTS_TO_ANSWER > 0);
});

test('the wizard badges the naturalisation topic as Germany pilot', () => {
  const root = fakeElement('section');
  const parts = {
    createSituation: () => ({ render() {} }), createRequirements: () => ({ render() {} }),
    createProfile: () => ({ render() {} }), createAnswerActions: () => ({ render() {} }),
  };
  const created = wizard.createWizard(root, {}, { common, engine, parts });
  created.render({ ...stateFor({}), topicId: null, step: common.STEP_TOPIC });
  const head = root.children[1];
  const badges = byClass(head, 'rm-badge-pilot');
  assert.equal(badges.length, 1);
  assert.equal(textOf(badges[0]), 'Germany pilot');
});

test('the module source builds text nodes only and has no report or fact-set transport', () => {
  const source = readFileSync(join(PUBLIC_DIR, 'ui-wizard-requirements.js'), 'utf8');
  for (const name of SOURCE_NAMES) assert.ok(!source.includes(name), name);
});
