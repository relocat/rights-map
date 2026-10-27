// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Unit tests for the authority card: badge text, time bar, time rows, warnings, evidence links and
// text-only rendering. Elements are small fakes; no DOM is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PUBLIC_DIR = join(ROOT, 'web', 'static', 'public', 'rights_map');
const load = (name) => import(pathToFileURL(join(PUBLIC_DIR, name)).href);
const card = await load('ui-authority.js');
const common = await load('ui-common.js');
const metrics = await load('authority-metrics.js');
const communityClient = await load('community-client.js');
const authorityCommunity = await load('ui-authority-community.js');
const engine = await load('engine.js');
const RULES = JSON.parse(readFileSync(join(PUBLIC_DIR, 'data', 'rules.v1.json'), 'utf8'));
const AUTHORITIES = JSON.parse(readFileSync(join(PUBLIC_DIR, 'data', 'authorities.de.v1.json'), 'utf8'));
const TOPIC = RULES.topics.find((topic) => topic.granularity === 'authority');
const BY_AGS = engine.authorityIndex(AUTHORITIES);

const TODAY = '2026-10';
const TODAY_MONTH = engine.monthIndex(TODAY);
const SCALE = 48;
const LEIPZIG_CITY = '14713';
const BERLIN = '11000';
const NO_AUTHORITY = '01001';
const LEIPZIG_STALE_AGE = 20;
const WARNING_FACTS = { de_residence_since: '2022', passport: 'valid', passport_until: '2026-12' };
const SAFE_FACTS = { de_residence_since: '2022', passport: 'valid', passport_until: '2035-01' };
const LABELS = new Map([[NO_AUTHORITY, 'Flensburg']]);
// Controlled authorities: the "no authority" case must not depend on which districts the shipped
// data happens to cover, so this index deliberately lacks NO_AUTHORITY.
const FIXTURE_COVERED_AGS = '99001';
const FIXTURE_BY_AGS = Object.freeze({
  [FIXTURE_COVERED_AGS]: {
    id: 'fixture-covered', name: 'Fixture authority', unit: 'unit', covers: [FIXTURE_COVERED_AGS], covers_label: 'Fixture',
    mode: { value: null, text: 'Not verified yet', src: 'none' },
    times: { wait: { lo: 3, hi: 4, text: '3–4 months', src: 'official', date: TODAY, evidence: [] }, proc: { src: 'none' }, total: { src: 'none' } },
    evidence: [],
  },
});
const isConfirmedValue = (value) => metrics.isConfirmed(value, TODAY_MONTH);

/** Minimal element: attributes, style, listeners, children, focus. */
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
    querySelector: (selector) => findAll(element, (node) => node.tag === selector)[0] ?? null,
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

function stateFor(ags, facts = SAFE_FACTS, byAgs = BY_AGS) {
  const authority = byAgs[ags];
  const authorityResult = authority
    ? engine.evaluateAuthority(RULES, TOPIC, authority, { factSet: facts, today: TODAY, isConfirmed: metrics.isConfirmed })
    : null;
  return {
    rules: RULES, topicId: TOPIC.id, today: TODAY, facts, selectedAgs: ags, authorityResult,
    districts: { byAgs, labels: LABELS },
  };
}

function mount() {
  const calls = { close: 0 };
  const root = fakeElement('aside');
  const deps = {
    common, engine,
    modules: { 'authority-metrics': metrics, 'community-client': communityClient, 'ui-authority-community': authorityCommunity },
  };
  const view = card.createAuthorityCard(root, { onClose: () => { calls.close += 1; } }, deps);
  return { root, view, calls };
}

test('sourceBadgeText names every source and counts community reports', () => {
  assert.equal(card.sourceBadgeText({ src: 'official' }), 'Official');
  assert.equal(card.sourceBadgeText({ src: 'community', n: 3 }), 'Community · 3');
  assert.equal(card.sourceBadgeText({ src: 'estimate' }), 'Estimate');
  assert.equal(card.sourceBadgeText({ src: 'press' }), 'Press');
  assert.equal(card.sourceBadgeText({ src: 'none' }), 'No data');
  assert.equal(card.sourceBadgeText(undefined), 'No data');
  assert.equal(card.sourceBadgeText({ src: 'unheard-of' }), 'No data');
});

test('timeBarSegments: Berlin has a minimal wait segment and an unconfirmed 8/48 processing segment', () => {
  const { wait, proc } = card.timeBarSegments(BY_AGS[BERLIN].times, SCALE, isConfirmedValue);
  assert.ok(wait.widthFraction > 0 && wait.widthFraction < 1 / SCALE);
  assert.equal(wait.state, 'known');
  assert.equal(proc.widthFraction, 8 / SCALE);
  assert.equal(proc.state, 'unconfirmed');
});

test('timeBarSegments: Leipzig has an unknown processing segment and a stale, unconfirmed wait', () => {
  const { wait, proc } = card.timeBarSegments(BY_AGS[LEIPZIG_CITY].times, SCALE, isConfirmedValue);
  assert.equal(proc.state, 'unknown');
  assert.ok(proc.widthFraction > 0 && proc.widthFraction < 1);
  assert.equal(wait.widthFraction, 37 / SCALE);
  assert.equal(wait.state, 'unconfirmed');
});

test('timeBarSegments caps a figure over the scale at the full width', () => {
  const times = { wait: { src: 'official', lo: 60, hi: 72 }, proc: { src: 'official', lo: SCALE } };
  const { wait, proc } = card.timeBarSegments(times, SCALE, () => true);
  assert.equal(wait.widthFraction, 1);
  assert.equal(proc.widthFraction, 1);
  assert.equal(card.timeBarSegments(undefined, SCALE, () => true).wait.state, 'unknown');
});

test('the Leipzig city card shows stale text on wait and total, the open-ended total and two evidence entries', () => {
  const { root, view } = mount();
  view.render(stateFor(LEIPZIG_CITY));
  const rows = (key) => byClass(root, `rm-time-${key}`)[0];
  const stale = `Official figure ${LEIPZIG_STALE_AGE} months old`;
  assert.ok(textOf(rows('wait')).includes(stale));
  assert.ok(textOf(rows('total')).includes(stale));
  assert.ok(!textOf(rows('proc')).includes('Official figure'));
  assert.ok(textOf(rows('proc')).includes('No data'));
  assert.ok(textOf(rows('total')).includes('or later'));
  assert.ok(textOf(rows('total')).includes('unconfirmed'));
  assert.equal(byClass(root, 'rm-evidence-item').length, 2);
  const links = findAll(root, (node) => node.tag === 'a');
  assert.equal(links.length, 2);
  assert.ok(links.every((link) => link.attributes.href.startsWith('https://') && link.attributes.rel === 'noopener noreferrer'));
  assert.equal(byClass(root, 'rm-time-segment').length, 2);
  assert.match(byClass(root, 'rm-time-segment-wait')[0].style.width, /%$/);
});

test('a community figure from one report never reaches the card (privacy)', () => {
  const leaked = {
    id: 'x', name: 'X', unit: 'u', covers: ['14729'], covers_label: 'c',
    mode: { value: null, text: 'Not verified yet', src: 'none' },
    times: {
      wait: { lo: 10, hi: 12, text: 'LEAKED-WAIT', src: 'community', n: 1, date: '2026-10' },
      proc: { src: 'none' },
      total: { lo: 10, hi: 12, text: 'LEAKED-TOTAL', src: 'community', date: '2026-10' },
    },
    evidence: [],
  };
  const { root, view } = mount();
  view.render({ ...stateFor(LEIPZIG_CITY), selectedAgs: '14729', districts: { byAgs: { 14729: leaked }, labels: LABELS } });
  const text = textOf(root);
  assert.ok(!text.includes('LEAKED'));
  assert.ok(!text.includes('Community'));
  assert.equal(byClass(root, 'rm-time-wait')[0] && textOf(byClass(root, 'rm-time-wait')[0]).includes('No data'), true);
  assert.equal(textOf(byClass(root, 'rm-time-total')[0]).includes('No data'), true);
});

test('a figure that is fresh or exempt carries neither stale nor unconfirmed text', () => {
  const { root, view } = mount();
  view.render(stateFor(BERLIN));
  const wait = byClass(root, 'rm-time-wait')[0];
  assert.ok(!textOf(wait).includes('Official figure'));
  assert.ok(!textOf(wait).includes('unconfirmed'));
  assert.ok(textOf(byClass(root, 'rm-time-proc')[0]).includes('unconfirmed'));
  assert.ok(!textOf(byClass(root, 'rm-time-proc')[0]).includes('or later'));
});

const COMMUNITY_ENTRY = Object.freeze({
  nBand: '5-9', nMin: 5,
  total: { median: 12, q1: 9, q3: 15 }, wait: { median: 6, q1: 3, q3: 6 }, proc: { median: 6, q1: 3, q3: 6 },
});

test('community-only metrics headline "About M months" with the Community badge and the count line; sourced ones keep their text', () => {
  const { root, view } = mount();
  view.render({ ...stateFor(FIXTURE_COVERED_AGS, SAFE_FACTS, FIXTURE_BY_AGS), community: { 'fixture-covered': COMMUNITY_ENTRY } });
  const total = byClass(root, 'rm-time-total')[0];
  assert.match(textOf(total), /About 12 months/);
  assert.ok(!textOf(total).includes('No data'));
  assert.ok(byClass(total, 'rm-source-community').length >= 1);
  assert.ok(textOf(total).includes('5–9 reports · typically 9–15'));
  const proc = byClass(root, 'rm-time-proc')[0];
  assert.match(textOf(proc), /About 6 months/);
  assert.ok(textOf(proc).includes('5–9 reports · typically 3–6'));
  const wait = byClass(root, 'rm-time-wait')[0];
  assert.ok(textOf(wait).includes('3–4 months'));
  assert.ok(!textOf(wait).includes('About'));
  assert.ok(textOf(wait).includes('Community'));
});

test('without a community entry the missing total still reads No data', () => {
  const { root, view } = mount();
  view.render(stateFor(FIXTURE_COVERED_AGS, SAFE_FACTS, FIXTURE_BY_AGS));
  assert.ok(textOf(byClass(root, 'rm-time-total')[0]).includes('No data'));
});

test('buildTimeRow renders a missing figure as No data', () => {
  const row = card.buildTimeRow({ common, modules: { 'authority-metrics': metrics } }, 'proc', undefined, TODAY_MONTH);
  assert.ok(textOf(row).includes('No data'));
  assert.equal(byClass(row, 'rm-time-unconfirmed').length, 0);
});

test('a non-https url renders as text, never as a link', () => {
  const authority = structuredClone(BY_AGS[BERLIN]);
  authority.evidence[0].url = 'javascript:alert(1)';
  authority.evidence[1].url = 'http://insecure.example/page';
  const state = stateFor(BERLIN);
  state.districts = { byAgs: { [BERLIN]: authority }, labels: LABELS };
  const { root, view } = mount();
  view.render(state);
  assert.equal(findAll(root, (node) => node.tag === 'a').length, 1);
  assert.ok(textOf(root).includes(authority.evidence[0].title));
});

test('evidence text containing markup stays a text node', () => {
  const authority = structuredClone(BY_AGS[BERLIN]);
  const payload = '<script>alert(1)</script>';
  authority.evidence[0].text = payload;
  authority.name = payload;
  const state = stateFor(BERLIN);
  state.districts = { byAgs: { [BERLIN]: authority }, labels: LABELS };
  const { root, view } = mount();
  view.render(state);
  assert.ok(textOf(root).includes(payload));
  assert.equal(findAll(root, (node) => node.tag === 'script').length, 0);
});

test('the passport warning shows for the Leipzig case with the decision month filled and not for Berlin', () => {
  const leipzigCity = mount();
  leipzigCity.view.render(stateFor(LEIPZIG_CITY, WARNING_FACTS));
  const warnings = byClass(leipzigCity.root, 'rm-warning');
  assert.ok(warnings.length >= 1);
  assert.ok(warnings.every((warning) => warning.attributes.role === 'status'));
  const text = warnings.map(textOf).join(' ');
  assert.ok(text.includes('Dec 2026'));
  assert.ok(text.includes('Feb 2030'));
  assert.ok(!text.includes('{'));
  const berlin = mount();
  berlin.view.render(stateFor(BERLIN, SAFE_FACTS));
  assert.equal(byClass(berlin.root, 'rm-warning').length, 0);
});

test('a district without an authority shows only its label, the empty text and the disclaimer', () => {
  const { root, view } = mount();
  view.render(stateFor(NO_AUTHORITY, SAFE_FACTS, FIXTURE_BY_AGS));
  assert.equal(FIXTURE_BY_AGS[NO_AUTHORITY], undefined);
  assert.equal(textOf(root.querySelector('h2')), 'Flensburg');
  assert.ok(textOf(root).includes('No authority data for this district yet.'));
  assert.ok(textOf(root).includes('General information, not legal advice.'));
  assert.equal(byClass(root, 'rm-time-row').length, 0);
  assert.equal(byClass(root, 'rm-evidence-item').length, 0);
});

test('the card lists the topic legal notes and the disclaimer after the evidence', () => {
  const { root, view } = mount();
  view.render(stateFor(BERLIN));
  const notes = findAll(root, (node) => node.tag === 'li' && TOPIC.legal_notes.includes(node.textContent));
  assert.equal(notes.length, TOPIC.legal_notes.length);
  assert.ok(textOf(root).endsWith('General information, not legal advice.'));
});

test('the heading takes focus when the selection changes and keeps it on other re-renders', () => {
  const { root, view } = mount();
  view.render(stateFor(BERLIN));
  const heading = () => root.querySelector('h2');
  assert.equal(heading().attributes.tabindex, '-1');
  assert.equal(globalThis.document.activeElement, heading());
  globalThis.document.activeElement = null;
  view.render(stateFor(BERLIN));
  assert.equal(globalThis.document.activeElement, null);
  view.render(stateFor(LEIPZIG_CITY));
  assert.equal(globalThis.document.activeElement, heading());
});

test('the card hides without a selected district and the close button calls onClose', () => {
  const { root, view, calls } = mount();
  view.render(stateFor(BERLIN));
  assert.equal(root.hidden, false);
  const close = findAll(root, (node) => node.attributes['aria-label'] === 'Close authority detail')[0];
  close.listeners.click();
  assert.equal(calls.close, 1);
  view.render({ ...stateFor(BERLIN), selectedAgs: null });
  assert.equal(root.hidden, true);
});

test('the module never uses innerHTML and reaches no fact store or report module (the report button only calls the injected opener)', () => {
  const source = readFileSync(join(PUBLIC_DIR, 'ui-authority.js'), 'utf8');
  for (const forbidden of ['innerHTML', 'insertAdjacentHTML', 'factset', 'ui-report', 'report-client', 'pow']) {
    assert.ok(!source.toLowerCase().includes(forbidden.toLowerCase()), forbidden);
  }
});

test('shouldOpenDetailsByDefault: open only when the total is missing but wait or processing is known', () => {
  const known = { src: 'official', lo: 3, text: '3 months', date: '2026-01' };
  const none = { src: 'none' };
  assert.equal(card.shouldOpenDetailsByDefault({ wait: none, proc: none, total: known }), false);
  assert.equal(card.shouldOpenDetailsByDefault({ wait: known, proc: none, total: known }), false);
  assert.equal(card.shouldOpenDetailsByDefault({ wait: known, proc: none, total: none }), true);
  assert.equal(card.shouldOpenDetailsByDefault({ wait: none, proc: known }), true);
  assert.equal(card.shouldOpenDetailsByDefault({ wait: none, proc: none, total: none }), false);
});

const GAP_TEST_ID = 'experience-gap';
const gapLines = (root) => findAll(root, (node) => node.attributes?.['data-testid'] === GAP_TEST_ID);

/** Mounts a card with the experiences switch set and renders the authority, with optional community data. */
function renderWithExperiences(isEnabled, byAgs, ags, community) {
  const root = fakeElement('aside');
  const deps = {
    common, engine, experiencesEnabled: isEnabled, openExperience: () => {},
    modules: { 'authority-metrics': metrics, 'community-client': communityClient, 'ui-authority-community': authorityCommunity },
  };
  card.createAuthorityCard(root, { onClose: () => {} }, deps).render({ ...stateFor(ags, SAFE_FACTS, byAgs), community });
  return root;
}
const noFigureAuthority = (times) => ({ ...FIXTURE_BY_AGS[FIXTURE_COVERED_AGS], times });
const NONE = { src: 'none' };
const GAP_ORDER_FIXTURES = Object.freeze({ official: 'official', press: 'press', estimate: 'estimate' });

test('the invitation line shows only when no figure exists and experiences are on, directly above the button', () => {
  const byAgs = { [FIXTURE_COVERED_AGS]: noFigureAuthority({ wait: NONE, proc: NONE, total: NONE }) };
  const root = renderWithExperiences(true, byAgs, FIXTURE_COVERED_AGS);
  assert.equal(gapLines(root).length, 1);
  assert.equal(textOf(gapLines(root)[0]), 'No waiting time known for this office yet. Went through naturalisation here? Your experience fills the map.');
  const siblings = findAll(root, (node) => node.children.includes(gapLines(root)[0]))[0].children;
  assert.ok(hasClass(siblings[siblings.indexOf(gapLines(root)[0]) + 1], 'rm-experience-button'));
  assert.equal(gapLines(renderWithExperiences(false, byAgs, FIXTURE_COVERED_AGS)).length, 0);
});

test('the invitation line is hidden when any figure exists: official, press, estimate or community', () => {
  for (const source of Object.values(GAP_ORDER_FIXTURES)) {
    const times = { wait: NONE, proc: NONE, total: { lo: 3, hi: 4, text: '3–4 months', src: source, date: TODAY, evidence: [] } };
    const root = renderWithExperiences(true, { [FIXTURE_COVERED_AGS]: noFigureAuthority(times) }, FIXTURE_COVERED_AGS);
    assert.equal(gapLines(root).length, 0, source);
    assert.ok(findAll(root, (node) => hasClass(node, 'rm-experience-button')).length === 1, `${source}: the button stays`);
  }
  const byAgs = { [FIXTURE_COVERED_AGS]: noFigureAuthority({ wait: NONE, proc: NONE, total: NONE }) };
  const root = renderWithExperiences(true, byAgs, FIXTURE_COVERED_AGS, { 'fixture-covered': COMMUNITY_ENTRY });
  assert.equal(gapLines(root).length, 0, 'community');
});

test('hasAnyTimeFigure counts sourced and community figures and ignores "none"', () => {
  assert.equal(card.hasAnyTimeFigure({ wait: NONE, proc: NONE, total: NONE }), false);
  assert.equal(card.hasAnyTimeFigure({ wait: NONE, proc: NONE, total: NONE }, { proc: {} }), true);
  assert.equal(card.hasAnyTimeFigure({ wait: { src: 'press', lo: 2 }, proc: NONE, total: NONE }), true);
});
