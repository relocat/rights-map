// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluate, monthIndex, scopeFactSet, findTopic, supportedTopics, missingRequiredFacts, MAX_WARNINGS, defaultFactsFor,
  isAuthorityTopic, authorityIndex, formatMonthIndex, totalMonths, evaluateAuthority,
  COMMUNITY_MIN_REPORTS,
} from '../../../web/static/public/rights_map/engine.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES = JSON.parse(readFileSync(join(HERE, '..', '..', '..', 'web', 'static', 'public', 'rights_map', 'data', 'rules.v1.json'), 'utf8'));
const CONFORMANCE_DIR = join(HERE, 'conformance');

function countStatuses(statuses) {
  const counts = {};
  for (const { status } of Object.values(statuses)) counts[status] = (counts[status] ?? 0) + 1;
  return counts;
}

/** Compare an authority-topic evaluation with the case's `expect` block. */
function assertAuthorityCase(suite, testCase) {
  const topic = findTopic(RULES, suite.topic);
  const result = evaluate(RULES, suite.topic, testCase.facts, testCase.today);
  const authority = suite.authorities?.[testCase.authority];
  const detail = evaluateAuthority(RULES, topic, authority, { factSet: testCase.facts, today: testCase.today });
  const { expect } = testCase;
  assert.deepEqual(result.statuses, {});
  if (expect.milestones) assert.deepEqual(detail.milestones, expect.milestones);
  if (expect.checkIds) assert.deepEqual(detail.checks.map((c) => c.id), expect.checkIds);
  if (expect.missing) assert.deepEqual(result.missing, expect.missing);
  for (const [id, state] of Object.entries(expect.requirements ?? {})) {
    assert.equal(result.requirements.find((r) => r.id === id)?.state, state, id);
  }
  for (const [id, note] of Object.entries(expect.requirementNotes ?? {})) {
    assert.equal(result.requirements.find((r) => r.id === id)?.note, note, id);
  }
}

for (const file of readdirSync(CONFORMANCE_DIR)) {
  const suite = JSON.parse(readFileSync(join(CONFORMANCE_DIR, file), 'utf8'));
  for (const testCase of suite.cases) {
    test(`${suite.topic}: ${testCase.name}`, () => {
      if (isAuthorityTopic(findTopic(RULES, suite.topic))) return assertAuthorityCase(suite, testCase);
      const result = evaluate(RULES, suite.topic, testCase.facts, testCase.today);
      const { expect } = testCase;
      if (expect.statusCounts) assert.deepEqual(countStatuses(result.statuses), expect.statusCounts);
      for (const [iso2, status] of Object.entries(expect.statuses ?? {})) assert.equal(result.statuses[iso2]?.status, status, iso2);
      for (const [iso2, ruleId] of Object.entries(expect.ruleIds ?? {})) assert.equal(result.statuses[iso2]?.ruleId, ruleId, iso2);
      if (expect.levers) assert.deepEqual(result.levers, expect.levers);
      if (expect.missing) assert.deepEqual(result.missing, expect.missing);
      if (expect.checks) assert.deepEqual(result.checks.map((c) => c.id), expect.checks);
      for (const tipId of expect.tipsInclude ?? []) assert.ok(result.tips.some((t) => t.id === tipId), tipId);
      for (const tipId of expect.tipsExclude ?? []) assert.ok(!result.tips.some((t) => t.id === tipId), tipId);
    });
  }
}

test('monthIndex orders months and years', () => {
  assert.equal(monthIndex('2026-10'), 2026 * 12 + 9);
  assert.equal(monthIndex('2026'), 2026 * 12);
  assert.ok(Number.isNaN(monthIndex('soon')));
});

test('a topic never evaluates a fact outside its uses', () => {
  const scoped = scopeFactSet(RULES, findTopic(RULES, 'eu-blue-card'), { nat: 'UA', degree: 'uni' });
  assert.deepEqual(scoped, { degree: 'uni' });
});

test('passport expired drops passport_until', () => {
  const scoped = scopeFactSet(RULES, findTopic(RULES, 'ua-tp'), { passport: 'expired', passport_until: '2030-01' });
  assert.equal(scoped.passport_until, undefined);
});

test('companion fact is in scope when its parent is in uses', () => {
  const scoped = scopeFactSet(RULES, findTopic(RULES, 'ua-tp'), { passport: 'valid', passport_until: '2030-01' });
  assert.equal(scoped.passport_until, '2030-01');
});

test('undefined facts never match, so no colours until required facts are answered', () => {
  const result = evaluate(RULES, 'ua-tp', {}, '2026-10');
  assert.deepEqual(result.statuses, {});
  assert.deepEqual(missingRequiredFacts(RULES, findTopic(RULES, 'ua-tp'), {}), ['nat', 'ua_military_obligation', 'ua_holds_tp']);
});

const TP_DEFAULTS = { nat: 'UA', ua_military_obligation: 'yes', ua_holds_tp: 'no' };

test('defaultFactsFor fills every unanswered default, and the topic then evaluates coloured', () => {
  const defaults = defaultFactsFor(RULES, 'ua-tp', {});
  assert.deepEqual(defaults, TP_DEFAULTS);
  assert.deepEqual(evaluate(RULES, 'ua-tp', defaults, '2026-10').missing, []);
});

test('defaultFactsFor keeps the visitor answer and returns only the rest', () => {
  assert.deepEqual(defaultFactsFor(RULES, 'ua-tp', { nat: 'OTHER' }), { ua_military_obligation: 'yes', ua_holds_tp: 'no' });
  assert.deepEqual(defaultFactsFor(RULES, 'ua-tp', TP_DEFAULTS), {});
});

test('defaultFactsFor ignores facts the topic does not use and topics without defaults', () => {
  const rules = structuredClone(RULES);
  findTopic(rules, 'eu-blue-card').defaults.nat = 'UA';
  assert.deepEqual(defaultFactsFor(rules, 'eu-blue-card', {}), { degree: 'uni', bc_job_offer: 'no' });
  assert.deepEqual(defaultFactsFor(RULES, 'de-naturalisation', {}), {});
});

test('defaultFactsFor never applies a child fact whose parent condition fails', () => {
  const rules = structuredClone(RULES);
  const topic = findTopic(rules, 'ua-tp');
  topic.defaults.ua_holds_tp = 'yes';
  rules.facts.find((fact) => fact.id === 'ua_holds_tp').parent = { fact: 'nat', equals: 'OTHER' };
  assert.equal(Object.hasOwn(defaultFactsFor(rules, 'ua-tp', {}), 'ua_holds_tp'), false);
  assert.equal(defaultFactsFor(rules, 'ua-tp', { nat: 'OTHER' }).ua_holds_tp, 'yes');
});

test('supportedTopics lists every topic, including the authority topic', () => {
  assert.deepEqual(supportedTopics(RULES).map((t) => t.id), ['ua-tp', 'eu-blue-card', 'de-naturalisation']);
  assert.deepEqual(supportedTopics(RULES).filter(isAuthorityTopic).map((t) => t.id), ['de-naturalisation']);
});

test('authorityIndex maps each covered AGS and rejects a duplicate', () => {
  const index = authorityIndex([{ id: 'a', covers: ['14713', '14729'] }, { id: 'b', covers: ['11000'] }]);
  assert.deepEqual(Object.keys(index).sort(), ['11000', '14713', '14729']);
  assert.equal(index['14729'].id, 'a');
  assert.throws(() => authorityIndex([{ id: 'a', covers: ['11000'] }, { id: 'b', covers: ['11000'] }]), RangeError);
});

test('formatMonthIndex inverts monthIndex', () => {
  assert.equal(formatMonthIndex(monthIndex('2030-02')), '2030-02');
  assert.equal(formatMonthIndex(monthIndex('2027-12')), '2027-12');
});

test('totalMonths: upper bound, lo when open-ended, undefined without data', () => {
  assert.equal(totalMonths({ times: { total: { lo: 37, partial: true } } }), 37);
  assert.equal(totalMonths({ times: { total: { lo: 7, hi: 9 } } }), 9);
  assert.equal(totalMonths({ times: { total: { src: 'none' } } }), undefined);
  assert.equal(totalMonths({ times: { total: { src: 'official' } } }), undefined);
  assert.equal(totalMonths(undefined), undefined);
});

test('evaluate on an authority topic returns requirements and milestones but no statuses', () => {
  const result = evaluate(RULES, 'de-naturalisation', { de_residence_since: '2022' }, '2026-10');
  assert.deepEqual([result.statuses, result.levers, result.checks], [{}, {}, []]);
  assert.equal(result.milestones.apply, '2027-01');
  assert.equal(result.milestones.decision, undefined);
  assert.equal(result.requirements.length, findTopic(RULES, 'de-naturalisation').requirements.length);
});

const NATURALISATION = findTopic(RULES, 'de-naturalisation');
const BERLIN = { covers: ['11000'], times: { total: { lo: 7, hi: 9, src: 'estimate' } } };
const ESTIMATE_FACTS = { de_residence_since: '2022' };

test('a fact outside uses never reaches a requirement', () => {
  const facts = { de_residence_since: '2015', degree: 'uni', nat: 'UA' };
  const { requirements } = evaluate(RULES, 'de-naturalisation', facts, '2026-10');
  assert.deepEqual(requirements.map((r) => r.state), evaluate(RULES, 'de-naturalisation', { de_residence_since: '2015' }, '2026-10')
    .requirements.map((r) => r.state));
  const probe = structuredClone(RULES);
  findTopic(probe, 'de-naturalisation').requirements[1].met = { degree: ['uni'] };
  assert.equal(evaluate(probe, 'de-naturalisation', { de_residence_since: '2015', degree: 'uni' }, '2026-10').requirements[1].state, 'unanswered');
});

test('a milestone:decision check never matches without an authority', () => {
  const detail = evaluateAuthority(RULES, NATURALISATION, undefined, {
    factSet: { de_residence_since: '2022', passport: 'valid', passport_until: '2026-12' }, today: '2026-10',
  });
  assert.ok(!detail.checks.some((check) => check.id === 'nat-passport-before-decision'));
  assert.equal(detail.estimate.window, null);
  assert.equal(detail.estimate.isConfirmed, false);
});

test('estimate: window spans apply+lo to apply+hi and confirmation comes from the context helper', () => {
  const context = { factSet: ESTIMATE_FACTS, today: '2026-10', isConfirmed: (value, todayIndex) => value.hi === 9 && todayIndex === monthIndex('2026-10') };
  const { estimate } = evaluateAuthority(RULES, NATURALISATION, BERLIN, context);
  assert.deepEqual(estimate, {
    earliestApply: '2027-01', canApplyNow: false, window: { from: '2027-08', to: '2027-10', isOpenEnded: false }, isConfirmed: true,
  });
  assert.equal(evaluateAuthority(RULES, NATURALISATION, BERLIN, { ...context, isConfirmed: undefined }).estimate.isConfirmed, false);
});

test('estimate ignores a community total from fewer than five reports (privacy)', () => {
  const total = { lo: 10, hi: 12, src: 'community' };
  const authorityWith = (n) => ({ covers: ['14729'], times: { total: n === undefined ? total : { ...total, n } } });
  const context = { factSet: ESTIMATE_FACTS, today: '2026-10' };
  for (const n of [undefined, 1, COMMUNITY_MIN_REPORTS - 1]) {
    assert.equal(totalMonths(authorityWith(n)), undefined, `n=${n}`);
    assert.equal(evaluateAuthority(RULES, NATURALISATION, authorityWith(n), context).estimate.window, null, `n=${n}`);
  }
  assert.equal(totalMonths(authorityWith(COMMUNITY_MIN_REPORTS)), 12);
});

test('estimate: canApplyNow once five years are complete, and an open-ended total is flagged', () => {
  const open = { covers: ['14713'], times: { total: { lo: 37, partial: true, src: 'official' } } };
  const { estimate } = evaluateAuthority(RULES, NATURALISATION, open, { factSet: { de_residence_since: '2015' }, today: '2026-10' });
  assert.equal(estimate.canApplyNow, true);
  assert.deepEqual(estimate.window, { from: '2029-11', to: '2029-11', isOpenEnded: true });
});

test('at most MAX_WARNINGS checks are returned', () => {
  const rules = structuredClone(RULES);
  const topic = findTopic(rules, 'ua-tp');
  topic.checks = [0, 1, 2, 3].map((n) => ({ id: `always-${n}`, when: {}, severity: 'warning', text: 'x' }));
  const result = evaluate(rules, 'ua-tp', { nat: 'UA', ua_military_obligation: 'no', ua_holds_tp: 'no' }, '2026-10');
  assert.equal(result.checks.length, MAX_WARNINGS);
});

test('evaluate is pure: the input fact set is not mutated', () => {
  const facts = Object.freeze({ nat: 'UA', ua_military_obligation: 'yes', ua_exit_proof: 'no', ua_holds_tp: 'no' });
  assert.doesNotThrow(() => evaluate(RULES, 'ua-tp', facts, '2026-10'));
});

const BASE_UA_FACTS = { nat: 'UA', ua_military_obligation: 'no', ua_holds_tp: 'no', passport: 'valid' };

/** Evaluate ua-tp on a clone whose only check has `when`; returns the matched check ids. */
function matchedChecks(when, facts, today = '2026-10') {
  const rules = structuredClone(RULES);
  findTopic(rules, 'ua-tp').checks = [{ id: 'probe', when, severity: 'warning', text: 'x' }];
  return evaluate(rules, 'ua-tp', { ...BASE_UA_FACTS, ...facts }, today).checks.map((c) => c.id);
}

test('an inherited operator name such as "constructor" never matches', () => {
  assert.deepEqual(matchedChecks({ passport_until: { constructor: '2027-01' } }, { passport_until: '2026-12' }), []);
});

test('relative operands: today-Nm and today+Ny', () => {
  assert.deepEqual(matchedChecks({ passport_until: { gt: 'today-6m' } }, { passport_until: '2026-05' }), ['probe']);
  assert.deepEqual(matchedChecks({ passport_until: { gt: 'today-6m' } }, { passport_until: '2026-04' }), []);
  assert.deepEqual(matchedChecks({ passport_until: { gte: 'today+2y' } }, { passport_until: '2028-10' }), ['probe']);
  assert.deepEqual(matchedChecks({ passport_until: { gte: 'today+2y' } }, { passport_until: '2028-09' }), []);
});

test('an unparseable fact value never matches a comparison', () => {
  assert.deepEqual(matchedChecks({ passport_until: { lt: '2030-01' } }, { passport_until: 'soon' }), []);
});

test('an enum value outside the options never matches an ordered comparison', () => {
  const rules = structuredClone(RULES);
  findTopic(rules, 'eu-blue-card').checks = [{ id: 'probe', when: { german: { lt: 'B1' } }, severity: 'warning', text: 'x' }];
  const facts = { degree: 'uni', bc_job_offer: 'yes', german: 'C2' };
  assert.deepEqual(evaluate(rules, 'eu-blue-card', facts, '2026-10').checks, []);
});

test('a missing milestone never matches', () => {
  assert.deepEqual(matchedChecks({ passport_until: { lt: 'milestone:unknown' } }, { passport_until: '2026-12' }), []);
});

test('every status entry has a null detail rather than undefined when the rule has none', () => {
  const rules = structuredClone(RULES);
  for (const rule of findTopic(rules, 'ua-tp').rules) delete rule.detail;
  const { statuses } = evaluate(rules, 'ua-tp', { ...BASE_UA_FACTS }, '2026-10');
  assert.ok(Object.values(statuses).every((entry) => entry.detail === null));
});
