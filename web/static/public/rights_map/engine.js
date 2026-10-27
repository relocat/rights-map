// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors

/**
 * Rights map rule engine.
 *
 * Pure: no DOM, storage, network or clock access. `today` is injected as 'YYYY-MM'
 * so tests can freeze it. The same JSON contract will be implemented by a Dart
 * evaluator later; tests/js/rights_map/conformance/*.json is that contract.
 * This file has no imports so the browser can load it as a plain module.
 */

/** Per-country result categories; the string values are part of the rules/CSS contract. */
export const STATUS = Object.freeze({
  OK: 'ok', RESTRICTED: 'restricted', BLOCKED: 'blocked', UNKNOWN: 'unknown', NA: 'na', ORIGIN: 'origin',
});
/** Detail cards show at most this many warning badges (the "Checks" part of the rule format). */
export const MAX_WARNINGS = 2;

// Duplicated on purpose: sibling modules cannot import each other without losing the ?v= cache
// buster, so this value is kept in sync with map-app.js and pinned by tests/js/rights_map/shared-constants.test.mjs.
/** Name of the rules group listing the countries the map covers. */
export const COVERED_GROUP = 'COVERED';
const AUTHORITY_GRANULARITY = 'authority';
const NO_DATA_SOURCE = 'none';
const COMMUNITY_SOURCE = 'community';
/** Community figures count only from this many reports; duplicated from authority-metrics.js, pinned by tests. */
export const COMMUNITY_MIN_REPORTS = 5;
const MONTH_DIGITS = 2;
const ELIGIBLE_FROM_PATTERN = /^(\w+) \+ (\d+)y$/;
const MILESTONE_ELIGIBLE = 'eligible_from';
const MILESTONE_APPLY = 'apply';
const MILESTONE_DECISION = 'decision';
const NOTE_PLACEHOLDER_PATTERN = /\{(\w+)\}/g;
/** Checklist states of one requirement; the string values are part of the UI/conformance contract. */
export const REQUIREMENT_STATE = Object.freeze({
  MET: 'met', UNMET: 'unmet', UNANSWERED: 'unanswered', INFO: 'info',
});
const LEVER_ROLE = 'lever';
// Duplicated on purpose (see COVERED_GROUP): equals TYPE_ENUM in factset-store.js.
/** Fact type of a value chosen from a fixed option list. */
export const ENUM_FACT_TYPE = 'enum';
const MONTHS_PER_YEAR = 12;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const YEAR_PATTERN = /^(\d{4})$/;
const RELATIVE_TODAY_PATTERN = /^today([+-])(\d+)([my])$/;
const FUTURE_SIGN = '+';
const YEAR_UNIT = 'y';
const MILESTONE_PREFIX = 'milestone:';
/** Rank given to a value that is not an option of an ordered enum; never orderable. */
const UNORDERABLE_RANK = -1;
const COMPARATORS = Object.freeze({
  lt: (left, right) => left < right,
  lte: (left, right) => left <= right,
  gt: (left, right) => left > right,
  gte: (left, right) => left >= right,
});

/**
 * Convert a month or year string to a sortable month number.
 * @param {string} value 'YYYY-MM' → year*12 + month-1; 'YYYY' → year*12
 * @returns {number} the month number, or NaN for any other input
 */
export function monthIndex(value) {
  const text = String(value);
  const month = MONTH_PATTERN.exec(text);
  if (month) return Number(month[1]) * MONTHS_PER_YEAR + Number(month[2]) - 1;
  const year = YEAR_PATTERN.exec(text);
  if (year) return Number(year[1]) * MONTHS_PER_YEAR;
  return Number.NaN;
}

/**
 * Convert a month number back to its 'YYYY-MM' string (inverse of `monthIndex` for months).
 * @param {number} index year*12 + month-1
 * @returns {string} 'YYYY-MM'
 */
export function formatMonthIndex(index) {
  const year = Math.floor(index / MONTHS_PER_YEAR);
  const month = String((index % MONTHS_PER_YEAR) + 1).padStart(MONTH_DIGITS, '0');
  return `${year}-${month}`;
}

/**
 * Topics this client can render: country topics and authority topics alike.
 * Callers that need only one granularity filter with `isAuthorityTopic`.
 * @param {object} rules parsed rules.v1.json
 * @returns {object[]} every topic in rules order
 */
export function supportedTopics(rules) {
  return [...rules.topics];
}

/**
 * Whether a topic colours authorities (districts) rather than countries.
 * @param {object} topic
 * @returns {boolean}
 */
export function isAuthorityTopic(topic) {
  return topic.granularity === AUTHORITY_GRANULARITY;
}

/**
 * Look up a topic by id.
 * @param {object} rules parsed rules.v1.json
 * @param {string} topicId
 * @returns {object} the topic; throws Error('Unknown topic: …') when absent
 */
export function findTopic(rules, topicId) {
  const topic = rules.topics.find((candidate) => candidate.id === topicId);
  if (!topic) throw new Error(`Unknown topic: ${topicId}`);
  return topic;
}

/**
 * Look up a fact definition.
 * @param {object} rules parsed rules.v1.json
 * @param {string} factId
 * @returns {object|undefined} the fact, or undefined when unknown
 */
export function factDefinition(rules, factId) {
  return rules.facts.find((fact) => fact.id === factId);
}

/**
 * Fact ids a topic may read: its `uses` plus each used fact's companion.
 * @param {object} rules parsed rules.v1.json
 * @param {object} topic
 * @returns {Set<string>}
 */
export function topicFactIds(rules, topic) {
  const ids = new Set();
  for (const use of topic.uses) {
    ids.add(use.fact);
    const companion = factDefinition(rules, use.fact)?.companion;
    if (companion) ids.add(companion);
  }
  return ids;
}

/**
 * Required fact ids in `uses` order; a `uses` entry's `required` overrides the fact default.
 * @param {object} rules parsed rules.v1.json
 * @param {object} topic
 * @returns {string[]}
 */
export function requiredFactIds(rules, topic) {
  return topic.uses
    .filter((use) => use.required ?? factDefinition(rules, use.fact)?.required ?? false)
    .map((use) => use.fact);
}

/**
 * Restrict a fact set to what the topic may read (a fact a topic does not declare in `uses` never reaches it), dropping child
 * facts whose parent condition fails (a child answer is meaningless once its parent answer rules it out). Returns a new object.
 * @param {object} rules parsed rules.v1.json
 * @param {object} topic
 * @param {Record<string, string>} factSet
 * @returns {Record<string, string>}
 */
export function scopeFactSet(rules, topic, factSet) {
  const allowed = topicFactIds(rules, topic);
  const scoped = {};
  for (const [factId, value] of Object.entries(factSet)) {
    if (!allowed.has(factId) || value === undefined) continue;
    const parent = factDefinition(rules, factId)?.parent;
    if (parent && factSet[parent.fact] !== parent.equals) continue;
    scoped[factId] = value;
  }
  return scoped;
}

/**
 * The topic's default answers that the visitor has not answered yet, so step 2 opens coloured.
 * Defaults are scoped like answers (in-scope facts only, child facts only while their parent
 * condition holds, judged on answers plus defaults) and never replace an answer already given.
 * @param {object} rules parsed rules.v1.json
 * @param {string} topicId
 * @param {Record<string, string>} factSet the visitor's current answers; never mutated
 * @returns {Record<string, string>} fact id to default value, only for unanswered facts
 */
export function defaultFactsFor(rules, topicId, factSet) {
  const topic = findTopic(rules, topicId);
  const scopedDefaults = scopeFactSet(rules, topic, { ...(topic.defaults ?? {}), ...factSet });
  const unanswered = {};
  for (const [factId, value] of Object.entries(scopedDefaults)) {
    if (factSet[factId] === undefined && Object.hasOwn(topic.defaults ?? {}, factId)) unanswered[factId] = value;
  }
  return unanswered;
}

/**
 * Required facts that are still unanswered after scoping.
 * @param {object} rules parsed rules.v1.json
 * @param {object} topic
 * @param {Record<string, string>} factSet
 * @returns {string[]}
 */
export function missingRequiredFacts(rules, topic, factSet) {
  const scoped = scopeFactSet(rules, topic, factSet);
  return requiredFactIds(rules, topic).filter((factId) => scoped[factId] === undefined);
}

/**
 * Resolve a rule's `countries` to an ISO2 list.
 * @param {object} rules parsed rules.v1.json
 * @param {string|string[]} countries group name or ISO2 array
 * @returns {string[]}
 */
export function regionsOf(rules, countries) {
  return Array.isArray(countries) ? countries : rules.groups[countries] ?? [];
}

/** Sortable number for a value: option rank for ordered enums, else month number. */
function orderedValue(rules, factId, value) {
  const fact = factDefinition(rules, factId);
  if (fact?.type === ENUM_FACT_TYPE && fact.ordered) {
    return fact.options.findIndex(([code]) => code === value);
  }
  return monthIndex(value);
}

/** Month number for a 'today±N(m|y)' operand, anchored on the injected clock. */
function relativeMonthIndex(relative, today) {
  const [, sign, amount, unit] = relative;
  const months = Number(amount) * (unit === YEAR_UNIT ? MONTHS_PER_YEAR : 1);
  return monthIndex(today) + (sign === FUTURE_SIGN ? months : -months);
}

function operandValue(rules, factId, operand, context) {
  const relative = RELATIVE_TODAY_PATTERN.exec(operand);
  if (relative) return relativeMonthIndex(relative, context.today);
  if (operand.startsWith(MILESTONE_PREFIX)) {
    const milestone = context.milestones[operand.slice(MILESTONE_PREFIX.length)];
    return milestone === undefined ? Number.NaN : monthIndex(milestone);
  }
  return orderedValue(rules, factId, operand);
}

/** Undefined or unorderable operands never match, so unknown input cannot colour a country. */
function comparisonMatches(rules, factId, [operator, operand], value, context) {
  const compare = Object.hasOwn(COMPARATORS, operator) ? COMPARATORS[operator] : undefined;
  const left = orderedValue(rules, factId, value);
  const right = operandValue(rules, factId, operand, context);
  const isOrderable = (rank) => !Number.isNaN(rank) && rank > UNORDERABLE_RANK;
  return Boolean(compare) && isOrderable(left) && isOrderable(right) && compare(left, right);
}

function conditionMatches(rules, factId, condition, value, context) {
  if (value === undefined) return false;
  if (Array.isArray(condition)) return condition.includes(value);
  return Object.entries(condition).every((comparison) =>
    comparisonMatches(rules, factId, comparison, value, context));
}

function whenMatches(rules, when, facts, context) {
  return Object.entries(when).every(([factId, condition]) =>
    conditionMatches(rules, factId, condition, facts[factId], context));
}

/** First matching rule wins per country; a covered country with no rule is 'unknown'. */
function computeStatuses(rules, topic, facts, context) {
  const statuses = {};
  for (const iso2 of rules.groups[COVERED_GROUP]) {
    const rule = topic.rules.find((candidate) =>
      regionsOf(rules, candidate.countries).includes(iso2) && whenMatches(rules, candidate.when, facts, context));
    statuses[iso2] = rule
      ? { status: rule.status, ruleId: rule.id, detail: rule.detail ?? null, draft: rule.draft === true }
      : { status: STATUS.UNKNOWN, ruleId: null, detail: null, draft: false };
  }
  return statuses;
}

function countOk(statuses) {
  return Object.values(statuses).filter(({ status }) => status === STATUS.OK).length;
}

/** For every lever option other than the current one, how many more countries turn 'ok'. */
function computeLevers(rules, topic, facts, context, baseOkCount) {
  const levers = {};
  for (const use of topic.uses.filter((candidate) => candidate.role === LEVER_ROLE)) {
    for (const [optionCode] of factDefinition(rules, use.fact)?.options ?? []) {
      if (facts[use.fact] === optionCode) continue;
      const alternative = { ...facts, [use.fact]: optionCode };
      const delta = countOk(computeStatuses(rules, topic, alternative, context)) - baseOkCount;
      if (delta > 0) (levers[use.fact] ??= {})[optionCode] = delta;
    }
  }
  return levers;
}

/**
 * Evaluate one topic for one fact set.
 * Levers are computed only when no required fact is missing, so a lever option
 * can never be the thing that makes a required fact defined.
 * An authority topic returns no statuses, levers or checks (the map colours from authority data and
 * checks need the selected authority, see `evaluateAuthority`); it adds `requirements` and `milestones`.
 * @param {object} rules parsed rules.v1.json
 * @param {string} topicId
 * @param {Record<string, string>} factSet the whole fact set; scoped here, never mutated
 * @param {string} today 'YYYY-MM', supplied by the caller
 * @returns {{statuses: object, levers: object, tips: object[], checks: object[], missing: string[],
 *   requirements?: object[], milestones?: object}}
 */
export function evaluate(rules, topicId, factSet, today) {
  const topic = findTopic(rules, topicId);
  const facts = scopeFactSet(rules, topic, factSet);
  // Without an authority there is no `decision` milestone, so a check naming it never matches.
  // A port (Dart) must keep the rule: a missing milestone never matches.
  const milestones = isAuthorityTopic(topic) ? deriveMilestones(topic, facts, { today }, undefined) : {};
  const context = { today, milestones };
  const missing = missingRequiredFacts(rules, topic, factSet);
  const tips = (topic.tips ?? []).filter((tip) => whenMatches(rules, tip.when, facts, context));
  if (isAuthorityTopic(topic)) {
    const requirements = evaluateRequirements(rules, topic, facts, context);
    return { statuses: {}, levers: {}, tips, checks: [], missing, requirements, milestones };
  }
  const checks = matchingChecks(rules, topic, facts, context);
  if (missing.length > 0) return { statuses: {}, levers: {}, tips, checks, missing };
  const statuses = computeStatuses(rules, topic, facts, context);
  const levers = computeLevers(rules, topic, facts, context, countOk(statuses));
  return { statuses, levers, tips, checks, missing };
}

/** The topic's checks whose condition holds, capped at MAX_WARNINGS. */
function matchingChecks(rules, topic, facts, context) {
  return (topic.checks ?? [])
    .filter((check) => whenMatches(rules, check.when, facts, context))
    .slice(0, MAX_WARNINGS);
}

/**
 * Map every covered AGS to its authority.
 * @param {{authorities: object[]}|object[]} authorities the authorities file or its `authorities` array
 * @returns {Record<string, object>} AGS → authority; throws RangeError when an AGS is covered twice
 */
export function authorityIndex(authorities) {
  const list = Array.isArray(authorities) ? authorities : authorities.authorities;
  const index = {};
  for (const authority of list) {
    for (const ags of authority.covers) {
      if (Object.hasOwn(index, ags)) throw new RangeError(`AGS covered twice: ${ags}`);
      index[ags] = authority;
    }
  }
  return index;
}

/**
 * Months from application to decision, as the UPPER bound of the range: the only
 * consumer is the passport warning, and underestimating the wait would hide that risk.
 * An open-ended value (no `hi`) uses `lo`.
 * @param {object|undefined} authority
 * @returns {number|undefined} undefined when the total is unknown (src 'none' or no `lo`)
 */
export function totalMonths(authority) {
  const total = authority?.times?.total;
  if (!total || total.src === NO_DATA_SOURCE || typeof total.lo !== 'number') return undefined;
  // Privacy: an under-reported community figure must not feed the estimate (fail closed on a missing n).
  if (total.src === COMMUNITY_SOURCE && !(total.n >= COMMUNITY_MIN_REPORTS)) return undefined;
  return total.hi ?? total.lo;
}

/**
 * Derive the topic's milestones as 'YYYY-MM' strings. Only defined milestones are present, so a
 * check naming a missing one never matches.
 * @param {object} topic authority topic; `derived.eligible_from` reads "<fact> + <N>y"
 * @param {Record<string, string>} facts scoped facts
 * @param {{today: string}} context
 * @param {object|undefined} authority supplies the `decision` milestone through its total
 * @returns {{eligible_from?: string, apply?: string, decision?: string}}
 */
export function deriveMilestones(topic, facts, context, authority) {
  const rule = ELIGIBLE_FROM_PATTERN.exec(topic.derived?.[MILESTONE_ELIGIBLE] ?? '');
  const since = rule ? monthIndex(facts[rule[1]] ?? '') : Number.NaN;
  if (Number.isNaN(since)) return {};
  const eligibleFrom = since + Number(rule[2]) * MONTHS_PER_YEAR;
  const apply = Math.max(eligibleFrom, monthIndex(context.today));
  const milestones = {
    [MILESTONE_ELIGIBLE]: formatMonthIndex(eligibleFrom),
    [MILESTONE_APPLY]: formatMonthIndex(apply),
  };
  const months = totalMonths(authority);
  if (months !== undefined) milestones[MILESTONE_DECISION] = formatMonthIndex(apply + months);
  return milestones;
}

/** Fill `{name}` placeholders from the derived milestones; unknown names stay as written. */
function fillNote(note, milestones) {
  return note.replace(NOTE_PLACEHOLDER_PATTERN, (placeholder, name) => milestones[name] ?? placeholder);
}

/** One requirement's state: `unanswered` while any fact it reads is undefined. */
function requirementState(rules, requirement, facts, context) {
  if (requirement.info === true) return REQUIREMENT_STATE.INFO;
  if (Object.keys(requirement.met).some((factId) => facts[factId] === undefined)) return REQUIREMENT_STATE.UNANSWERED;
  return whenMatches(rules, requirement.met, facts, context) ? REQUIREMENT_STATE.MET : REQUIREMENT_STATE.UNMET;
}

/**
 * Checklist of an authority topic, one entry per requirement. Reads only scoped facts, so a fact
 * outside the topic's `uses` can never change a state.
 * @param {object} rules parsed rules.v1.json
 * @param {object} topic authority topic
 * @param {Record<string, string>} facts scoped facts
 * @param {{today: string, milestones: object}} context
 * @returns {{id: string, title: string, state: string, note?: string}[]}
 */
export function evaluateRequirements(rules, topic, facts, context) {
  return (topic.requirements ?? []).map((requirement) => {
    const state = requirementState(rules, requirement, facts, context);
    const isUnmet = state === REQUIREMENT_STATE.UNMET;
    const rawNote = isUnmet ? requirement.note_unmet ?? requirement.note : requirement.note;
    const entry = { id: requirement.id, title: requirement.title, state };
    if (rawNote !== undefined) entry.note = fillNote(rawNote, context.milestones);
    return entry;
  });
}

/** The visitor's earliest application and decision window at one authority. */
function computeEstimate(milestones, authority, context) {
  const total = authority?.times?.total;
  const months = totalMonths(authority);
  const isKnown = milestones.apply !== undefined && months !== undefined;
  const applyIndex = monthIndex(milestones.apply ?? '');
  const window = isKnown ? {
    from: formatMonthIndex(applyIndex + total.lo),
    to: formatMonthIndex(applyIndex + months),
    isOpenEnded: total.hi === undefined,
  } : null;
  const todayIndex = monthIndex(context.today);
  const isConfirmed = isKnown && typeof context.isConfirmed === 'function'
    && context.isConfirmed(total, todayIndex) === true;
  return {
    earliestApply: milestones.apply,
    canApplyNow: milestones.eligible_from !== undefined && monthIndex(milestones.eligible_from) <= todayIndex,
    window,
    isConfirmed,
  };
}

/**
 * Everything the visitor's facts say about one authority: milestones, warnings and estimate.
 * @param {object} rules parsed rules.v1.json
 * @param {object} topic authority topic
 * @param {object|undefined} authority the selected authority, if any
 * @param {{factSet: Record<string, string>, today: string, isConfirmed?: function}} context
 *   `isConfirmed(value, todayMonthIndex)` comes from authority-metrics.js; absent means unconfirmed
 * @returns {{milestones: object, checks: object[], estimate: object}}
 */
export function evaluateAuthority(rules, topic, authority, context) {
  const facts = scopeFactSet(rules, topic, context.factSet);
  const milestones = deriveMilestones(topic, facts, context, authority);
  const checks = matchingChecks(rules, topic, facts, { today: context.today, milestones });
  return { milestones, checks, estimate: computeEstimate(milestones, authority, context) };
}
