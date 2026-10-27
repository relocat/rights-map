// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Browser-only store for the Rights Map "fact set" (the user's answers).
//
// The facts live in localStorage (or in memory when storage is unavailable)
// and are never sent anywhere: this module has no network code and, by
// design, no logging output, so a fact value can never reach a log.
// Error messages name fact ids at most, never values.
//
// The module has no imports. The browser loader hands in `storage` and
// `rules`, which keeps a single import point for the page.

/** localStorage key holding the persisted fact set. */
export const STORAGE_KEY = 'relocat.factset.v1';

const PROBE_KEY = `${STORAGE_KEY}.probe`;
const PROBE_VALUE = '1';
// Duplicated on purpose: sibling modules cannot import each other without losing the ?v= cache
// buster, so this value is kept in sync with ui-fact-controls.js and pinned by tests/js/rights_map/shared-constants.test.mjs.
/** Fact type of a value chosen from a fixed option list. */
export const TYPE_ENUM = 'enum';
/** Fact type of a yes/no value. */
export const TYPE_BOOL = 'bool';
const TYPE_MONTH = 'month';
/** Fact type of a four-digit year. */
export const TYPE_YEAR = 'year';
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR_PATTERN = /^\d{4}$/;

const MSG_NOT_JSON = 'The file is not valid JSON.';
const MSG_BAD_SHAPE = 'The file is not a Relocat fact set export.';
const MSG_NEWER_SCHEMA = 'The file was written by a newer version of the map.';
const MSG_INVALID_FACTS = 'The file contains invalid answers. ';
const MSG_BAD_VALUE = 'Invalid value for fact: ';
// Own key produced by JSON.parse; assigning it would swap the prototype.
const PROTO_KEY = '__proto__';
const FACT_ID_SEPARATOR = ', ';
const EXPORT_INDENT = 2;

/** Thrown by parseExport; the message is safe to show and never holds values. */
export class FactSetImportError extends Error {
  /** @param {string} message User-presentable text without fact values. */
  constructor(message) {
    super(message);
    this.name = 'FactSetImportError';
  }
}

/** @returns {boolean} True when `value` is a non-null, non-array object. */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Private lookup so the module needs no engine import. */
function findFact(rules, factId) {
  return rules.facts.find((fact) => fact.id === factId) || null;
}

/** @returns {boolean} True when `value` is one of the fact's option codes. */
function isOptionCode(fact, value) {
  return Array.isArray(fact.options) && fact.options.some(([code]) => code === value);
}

/** @returns {boolean} True when `value` is acceptable for the fact's type. */
function isValidValue(fact, value) {
  if (typeof value !== 'string') return false;
  switch (fact.type) {
    case TYPE_ENUM:
    case TYPE_BOOL:
      return isOptionCode(fact, value);
    case TYPE_MONTH:
      return MONTH_PATTERN.test(value);
    case TYPE_YEAR:
      return YEAR_PATTERN.test(value);
    default:
      return false;
  }
}

/**
 * Checks every fact against the rules.
 * @param {object} facts Map of fact id to value.
 * @param {object} rules Parsed rules file.
 * @returns {string[]} Problems naming fact ids only, never values.
 */
export function validateFacts(facts, rules) {
  const problems = [];
  for (const [factId, value] of Object.entries(facts)) {
    const fact = findFact(rules, factId);
    if (fact === null) problems.push(`${MSG_BAD_VALUE}${factId} (unknown)`);
    else if (!isValidValue(fact, value)) problems.push(`${MSG_BAD_VALUE}${factId}`);
  }
  return problems;
}

/** Applies one migration step's renames and value maps to a copy. */
function applyMigrationStep(facts, step) {
  const renames = step.rename || {};
  const maps = step.map || {};
  const result = {};
  for (const [oldId, value] of Object.entries(facts)) {
    const factId = Object.hasOwn(renames, oldId) ? renames[oldId] : oldId;
    if (oldId === PROTO_KEY || factId === PROTO_KEY) continue;
    if (!Object.hasOwn(maps, factId)) {
      result[factId] = value;
    } else if (Object.hasOwn(maps[factId], value)) {
      // An unmapped value is dropped: guessing would corrupt an answer.
      result[factId] = maps[factId][value];
    }
  }
  return result;
}

/** Keeps only facts the rules define (skips the prototype key). */
function dropUnknown(facts, rules) {
  const kept = {};
  for (const [factId, value] of Object.entries(facts)) {
    if (factId !== PROTO_KEY && findFact(rules, factId) !== null) kept[factId] = value;
  }
  return kept;
}

/** Keeps only known facts holding valid values. */
function dropInvalid(facts, rules) {
  const kept = dropUnknown(facts, rules);
  for (const [factId, value] of Object.entries(kept)) {
    if (!isValidValue(findFact(rules, factId), value)) delete kept[factId];
  }
  return kept;
}

/** @returns {boolean} True when the stored shape can be migrated at all. */
function isMigratable(stored, rules) {
  return isPlainObject(stored) && isPlainObject(stored.facts)
    && Number.isInteger(stored.fact_schema) && stored.fact_schema <= rules.fact_schema;
}

/** Runs the ordered migration steps from the stored schema; keeps invalid values. */
function applyMigrations(stored, rules) {
  let facts = stored.facts;
  let version = stored.fact_schema;
  for (const step of rules.migrations) {
    if (step.from !== version) continue;
    facts = applyMigrationStep(facts, step);
    version = step.to;
  }
  return facts;
}

/**
 * Brings a stored fact set up to `rules.fact_schema`.
 * @param {{fact_schema: number, facts: object}} stored Persisted or imported shape.
 * @param {object} rules Parsed rules file.
 * @returns {object} Valid facts at the current schema; empty if stored is newer or malformed.
 */
export function migrateFactSet(stored, rules) {
  if (!isMigratable(stored, rules)) return {};
  return dropInvalid(applyMigrations(stored, rules), rules);
}

/**
 * Serialises facts for the user's explicit download.
 * @param {object} facts Map of fact id to value.
 * @param {object} rules Parsed rules file.
 * @returns {string} JSON text.
 */
export function serializeExport(facts, rules) {
  return JSON.stringify({ fact_schema: rules.fact_schema, facts }, null, EXPORT_INDENT);
}

/** Parses JSON, converting the syntax error into a value-free import error. */
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) throw new FactSetImportError(MSG_NOT_JSON);
    throw error;
  }
}

/**
 * Parses and validates an uploaded export; all-or-nothing.
 * @param {string} text File contents.
 * @param {object} rules Parsed rules file.
 * @returns {object} Migrated, validated facts.
 * @throws {FactSetImportError} On any malformed or invalid input.
 */
export function parseExport(text, rules) {
  const stored = parseJson(text);
  if (!isPlainObject(stored) || !Number.isInteger(stored.fact_schema) || !isPlainObject(stored.facts)) {
    throw new FactSetImportError(MSG_BAD_SHAPE);
  }
  if (stored.fact_schema > rules.fact_schema) throw new FactSetImportError(MSG_NEWER_SCHEMA);
  // Import rule: unknown ids are dropped, but a bad value of a KNOWN fact
  // rejects the whole file: an import is never partially applied.
  const facts = dropUnknown(applyMigrations(stored, rules), rules);
  const problems = validateFacts(facts, rules);
  if (problems.length > 0) throw new FactSetImportError(MSG_INVALID_FACTS + problems.join(FACT_ID_SEPARATOR));
  return facts;
}

/**
 * Reads and migrates the persisted facts. Corrupt STORED data (blocked
 * storage, bad JSON, wrong shape) never throws and yields no facts; a
 * malformed `rules` object does throw, as that is a programming error.
 */
function loadFacts(storage, rules) {
  if (storage === null) return {};
  let text;
  try {
    text = storage.getItem(STORAGE_KEY);
  } catch {
    // Browsers throw varied errors (SecurityError, quota) when storage is blocked.
    return {};
  }
  try {
    return migrateFactSet(JSON.parse(text), rules);
  } catch (error) {
    if (error instanceof SyntaxError) return {};
    throw error;
  }
}

/** @returns {boolean} True when storage accepts a write and a delete. */
function probeStorage(storage) {
  if (storage === null) return false;
  try {
    storage.setItem(PROBE_KEY, PROBE_VALUE);
    storage.removeItem(PROBE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Runs a storage write; on failure keeps memory state and marks the store non-persistent. */
function writeThrough(store, write) {
  if (!store.isPersistent) return;
  try {
    write();
  } catch {
    store.isPersistent = false;
  }
}

/** @returns {string} The persisted JSON shape for `facts`. */
function serializeStored(facts, rules) {
  return JSON.stringify({ fact_schema: rules.fact_schema, facts });
}

/**
 * Creates the fact store.
 * @param {{getItem: Function, setItem: Function, removeItem: Function}|null} storage Web Storage or null.
 * @param {object} rules Parsed rules file.
 * @returns {object} Store with facts/set/unset/replaceAll/clear/subscribe and isPersistent.
 */
export function createFactStore(storage, rules) {
  let current = loadFacts(storage, rules);
  const listeners = new Set();
  const store = { isPersistent: probeStorage(storage) };

  const persist = (write) => writeThrough(store, write);
  const notify = () => listeners.forEach((listener) => listener());
  const commit = (next) => {
    current = next;
    persist(() => storage.setItem(STORAGE_KEY, serializeStored(current, rules)));
    notify();
  };

  store.facts = () => ({ ...current });
  store.set = (factId, value) => {
    const fact = findFact(rules, factId);
    if (fact === null || !isValidValue(fact, value)) throw new TypeError(`${MSG_BAD_VALUE}${factId}`);
    commit({ ...current, [factId]: value });
  };
  store.unset = (factId) => {
    const rest = { ...current };
    delete rest[factId];
    commit(rest);
  };
  store.replaceAll = (facts) => {
    const problems = validateFacts(facts, rules);
    if (problems.length > 0) throw new TypeError(problems.join(FACT_ID_SEPARATOR));
    commit({ ...facts });
  };
  store.clear = () => {
    current = {};
    persist(() => storage.removeItem(STORAGE_KEY));
    notify();
  };
  store.subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return store;
}
