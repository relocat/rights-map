// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Cross-reference checks of the Rights Map rules file (rules.v1.json): unique ids, references
// that point at something that exists, and well-formed conditions. Each problem starts with a
// category tag such as [duplicate], [reference] or [condition].
import { statSync } from 'node:fs';
import { basename, join } from 'node:path';

export const TAG_DUPLICATE = '[duplicate]';
export const TAG_REFERENCE = '[reference]';
export const TAG_CONDITION = '[condition]';
export const TAG_DEFAULT = '[default]';
export const TAG_RANGE = '[range]';

/** Group holding the country codes the map covers (see `groups` in the rules file). */
const COVERED_GROUP = 'COVERED';
/** Entries of a topic that carry a `when` condition. */
const CONDITIONED_COLLECTIONS = ['rules', 'tips', 'checks'];
const COMPARISON_OPERATORS = new Set(['lt', 'lte', 'gt', 'gte']);
/** Fact types a comparison may be applied to (an enum only when `ordered`). */
const COMPARABLE_TYPES = new Set(['month', 'year']);
const MILESTONE_PREFIX = 'milestone:';
const AUTHORITY_GRANULARITY = 'authority';
const AUTHORITIES_FILE_KEY = 'authorities_file';
const ENUM_TYPE = 'enum';
const BOOL_TYPE = 'bool';
const MONTH_TYPE = 'month';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR_PATTERN = /^\d{4}$/;
/** `today`, optionally shifted by N months or years: `today+18m`, `today-1y`. */
const RELATIVE_DATE_PATTERN = /^today([+-]\d+[my])?$/;
const ISO2_PATTERN = /^[A-Z]{2}$/;

/** Return identifiers that occur more than once, each reported once. */
export function findDuplicates(identifiers) {
  const seen = new Set();
  const duplicates = [];
  for (const identifier of identifiers) {
    if (seen.has(identifier) && !duplicates.includes(identifier)) duplicates.push(identifier);
    seen.add(identifier);
  }
  return duplicates;
}

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const optionCodes = (fact) => new Set((fact.options ?? []).map(([code]) => code));
const factsById = (rules) => new Map(rules.facts.map((fact) => [fact.id, fact]));

/** Every rule, tip and check of a topic as `[label, entry]`. */
function conditionedEntries(topic) {
  const entries = [];
  for (const collection of CONDITIONED_COLLECTIONS) {
    for (const entry of topic[collection] ?? []) {
      entries.push([`topic ${topic.id} ${collection.slice(0, -1)} ${entry.id}`, entry]);
    }
  }
  return entries;
}

/** Facts a topic may condition on: its `uses` plus their companions. */
function allowedWhenFacts(topic, factMap) {
  const allowed = new Set(topic.uses.map((use) => use.fact));
  for (const factId of [...allowed]) {
    const companion = factMap.get(factId)?.companion;
    if (companion) allowed.add(companion);
  }
  return allowed;
}

/** Fact ids are unique, and rule ids are unique within each topic. */
function checkUniqueIds(rules) {
  const problems = findDuplicates(rules.facts.map((fact) => fact.id)).map(
    (factId) => `${TAG_DUPLICATE} duplicate fact id ${factId}`,
  );
  for (const topic of rules.topics) {
    const ruleIds = (topic.rules ?? []).map((rule) => rule.id);
    for (const ruleId of findDuplicates(ruleIds)) {
      problems.push(`${TAG_DUPLICATE} topic ${topic.id}: duplicate rule id ${ruleId}`);
    }
  }
  return problems;
}

/** `uses[].fact`, `companion` and `parent.fact` name existing facts. */
function checkFactReferences(rules) {
  const factIds = new Set(rules.facts.map((fact) => fact.id));
  const problems = [];
  for (const fact of rules.facts) {
    const targets = [['companion', fact.companion], ['parent', fact.parent?.fact]];
    for (const [field, target] of targets) {
      if (target !== undefined && !factIds.has(target)) {
        problems.push(`${TAG_REFERENCE} fact ${fact.id}: ${field} references unknown fact ${target}`);
      }
    }
  }
  for (const topic of rules.topics) {
    for (const use of topic.uses) {
      if (!factIds.has(use.fact)) problems.push(`${TAG_REFERENCE} topic ${topic.id}: uses unknown fact ${use.fact}`);
    }
  }
  return problems;
}

/** Every `countries` entry is a group name or an ISO2 code in `groups.COVERED`. */
function checkCountries(rules) {
  const covered = new Set(rules.groups[COVERED_GROUP] ?? []);
  const problems = [];
  for (const topic of rules.topics) {
    for (const rule of topic.rules ?? []) {
      const entries = typeof rule.countries === 'string' ? [rule.countries] : rule.countries;
      for (const entry of entries) {
        const isKnownGroup = Object.hasOwn(rules.groups, entry);
        const isCoveredCountry = ISO2_PATTERN.test(entry) && covered.has(entry);
        if (!isKnownGroup && !isCoveredCountry) {
          problems.push(`${TAG_REFERENCE} topic ${topic.id} rule ${rule.id}: unknown country or group ${entry}`);
        }
      }
    }
  }
  return problems;
}

/** Every rule `detail.sources` and tip `sources` id exists in `sources`. */
function checkSourceReferences(rules) {
  const known = new Set(Object.keys(rules.sources));
  const problems = [];
  for (const topic of rules.topics) {
    for (const [label, entry] of conditionedEntries(topic)) {
      const cited = [...(entry.detail?.sources ?? []), ...(entry.sources ?? [])];
      for (const source of cited) {
        if (!known.has(source)) problems.push(`${TAG_REFERENCE} ${label}: unknown source ${source}`);
      }
    }
  }
  return problems;
}

/** Every `when` key is a fact the topic uses, or the companion of one. */
function checkWhenFactScope(rules) {
  const factMap = factsById(rules);
  const problems = [];
  for (const topic of rules.topics) {
    const allowed = allowedWhenFacts(topic, factMap);
    for (const [label, entry] of conditionedEntries(topic)) {
      for (const key of Object.keys(entry.when)) {
        if (!allowed.has(key)) problems.push(`${TAG_CONDITION} ${label}: condition on ${key}, which the topic does not use`);
      }
    }
  }
  return problems;
}

/** Whether `operand` is a legal right-hand side for a comparison on `fact`. */
function isValidComparisonOperand(operand, fact, milestones) {
  if (typeof operand !== 'string') return false;
  if (operand.startsWith(MILESTONE_PREFIX)) return milestones.has(operand.slice(MILESTONE_PREFIX.length));
  if (fact.type === ENUM_TYPE) return optionCodes(fact).has(operand);
  if (RELATIVE_DATE_PATTERN.test(operand)) return true;
  return (fact.type === MONTH_TYPE ? MONTH_PATTERN : YEAR_PATTERN).test(operand);
}

/** Problems with one `when` value (an allowed-code list or a comparison object). */
export function conditionProblems(label, fact, condition, milestones) {
  if (Array.isArray(condition)) {
    const codes = optionCodes(fact);
    return condition
      .filter((value) => !codes.has(value))
      .map((value) => `${TAG_CONDITION} ${label}: ${fact.id} has no option code ${JSON.stringify(value)}`);
  }
  if (!isPlainObject(condition)) {
    return [`${TAG_CONDITION} ${label}: condition on ${fact.id} must be a list or a comparison object`];
  }
  const isComparable = COMPARABLE_TYPES.has(fact.type) || (fact.type === ENUM_TYPE && fact.ordered === true);
  if (!isComparable) {
    return [`${TAG_CONDITION} ${label}: comparison on ${fact.id}, which is neither month, year nor an ordered enum`];
  }
  const operators = Object.entries(condition);
  if (operators.length === 0) return [`${TAG_CONDITION} ${label}: comparison with no operator on ${fact.id}`];
  const problems = [];
  for (const [operator, operand] of operators) {
    if (!COMPARISON_OPERATORS.has(operator)) {
      problems.push(`${TAG_CONDITION} ${label}: unknown comparison operator ${operator} on ${fact.id}`);
    } else if (!isValidComparisonOperand(operand, fact, milestones)) {
      problems.push(`${TAG_CONDITION} ${label}: invalid operand ${JSON.stringify(operand)} for ${operator} on ${fact.id}`);
    }
  }
  return problems;
}

/**
 * Condition values are valid option codes or well-formed comparisons. Keys unknown to `facts` are
 * reported by the fact-reference checks, so they are skipped here instead of being reported twice.
 */
function checkConditions(rules) {
  const factMap = factsById(rules);
  const problems = [];
  for (const topic of rules.topics) {
    const milestones = new Set(Object.keys(topic.derived ?? {}));
    for (const [label, entry] of conditionedEntries(topic)) {
      for (const [factId, condition] of Object.entries(entry.when)) {
        if (factMap.has(factId)) problems.push(...conditionProblems(label, factMap.get(factId), condition, milestones));
      }
    }
  }
  return problems;
}

/** Whether `value` is a legal stored answer for `fact` (option code, month or year). */
function isValidDefaultValue(fact, value) {
  if (fact.type === ENUM_TYPE || fact.type === BOOL_TYPE) return optionCodes(fact).has(value);
  return (fact.type === MONTH_TYPE ? MONTH_PATTERN : YEAR_PATTERN).test(value);
}

/** Every topic default names a fact the topic may read, with a valid value. */
function checkDefaults(rules) {
  const factMap = factsById(rules);
  const problems = [];
  for (const topic of rules.topics) {
    const allowed = allowedWhenFacts(topic, factMap);
    for (const [factId, value] of Object.entries(topic.defaults ?? {})) {
      const label = `topic ${topic.id}: default for ${factId}`;
      if (!allowed.has(factId)) {
        problems.push(`${TAG_DEFAULT} ${label}, which the topic does not use`);
      } else if (typeof value !== 'string' || !isValidDefaultValue(factMap.get(factId), value)) {
        problems.push(`${TAG_DEFAULT} ${label} has invalid value ${JSON.stringify(value)}`);
      }
    }
  }
  return problems;
}

/** Topics of authority granularity. */
const authorityTopics = (rules) => rules.topics.filter((topic) => topic.granularity === AUTHORITY_GRANULARITY);

/** Problems with one requirement: the facts it reads, their conditions and its sources. */
function requirementProblems(topic, requirement, factMap, knownSources) {
  const label = `topic ${topic.id} requirement ${requirement.id}`;
  const allowed = allowedWhenFacts(topic, factMap);
  const problems = [];
  for (const [factId, condition] of Object.entries(requirement.met ?? {})) {
    if (!allowed.has(factId)) {
      problems.push(`${TAG_CONDITION} ${label}: condition on ${factId}, which the topic does not use`);
    } else if (factMap.has(factId)) {
      // No milestones: a requirement is judged on answers alone, so a `milestone:` operand is invalid.
      problems.push(...conditionProblems(label, factMap.get(factId), condition, new Set()));
    }
  }
  for (const source of requirement.sources ?? []) {
    if (!knownSources.has(source)) problems.push(`${TAG_REFERENCE} ${label}: unknown source ${source}`);
  }
  return problems;
}

/** Requirements of authority topics are unique, read used facts and cite known sources. */
function checkRequirements(rules) {
  const factMap = factsById(rules);
  const knownSources = new Set(Object.keys(rules.sources));
  const problems = [];
  for (const topic of authorityTopics(rules)) {
    for (const identifier of findDuplicates(topic.requirements.map((requirement) => requirement.id))) {
      problems.push(`${TAG_DUPLICATE} topic ${topic.id}: duplicate requirement id ${identifier}`);
    }
    for (const requirement of topic.requirements) {
      problems.push(...requirementProblems(topic, requirement, factMap, knownSources));
    }
  }
  return problems;
}

/** Whether `fileName` is a bare name of a regular file inside `dataDir`. */
function isSiblingDataFile(dataDir, fileName) {
  if (dataDir === undefined || basename(fileName) !== fileName) return false;
  try {
    return statSync(join(dataDir, fileName)).isFile();
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

/**
 * Authority topics have strictly increasing colour buckets and an authorities file next to the
 * rules. Without `dataDir` the file cannot be found, which is reported (fail closed).
 */
function checkAuthorityTopic(rules, dataDir) {
  const problems = [];
  for (const topic of authorityTopics(rules)) {
    const buckets = topic.colour.buckets_months;
    if (buckets.some((lower, index) => index > 0 && buckets[index - 1] >= lower)) {
      problems.push(`${TAG_RANGE} topic ${topic.id}: colour.buckets_months must be strictly increasing`);
    }
    const fileName = topic[AUTHORITIES_FILE_KEY];
    if (!isSiblingDataFile(dataDir, fileName)) {
      problems.push(
        `${TAG_REFERENCE} topic ${topic.id}: ${AUTHORITIES_FILE_KEY} ${fileName} does not exist next to the rules file`,
      );
    }
  }
  return problems;
}

/** Run every cross-reference check on a rules file that already passed the schema. */
export function rulesCrossChecks(rules, dataDir) {
  return [
    ...checkUniqueIds(rules),
    ...checkFactReferences(rules),
    ...checkCountries(rules),
    ...checkSourceReferences(rules),
    ...checkWhenFactScope(rules),
    ...checkConditions(rules),
    ...checkDefaults(rules),
    ...checkRequirements(rules),
    ...checkAuthorityTopic(rules, dataDir),
  ];
}
