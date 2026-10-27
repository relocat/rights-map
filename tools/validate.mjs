#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Data validator of the Rights Map: checks rules.v1.json and authorities.de.v1.json against their
// JSON schemas, then runs the cross-reference checks (rules-checks.mjs and
// authorities-checks.mjs). Usage:
//   node tools/validate.mjs [--root <repo root>] [--schema-dir <dir>]
// Exit 0 and one `OK ...` line when the data is clean; exit 1 with one problem per line otherwise.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { rulesCrossChecks } from './rules-checks.mjs';
import { authoritiesCrossChecks } from './authorities-checks.mjs';

export const TAG_SCHEMA = '[schema]';

const DATA_DIR_RELATIVE = ['web', 'static', 'public', 'rights_map', 'data'];
const DEFAULT_SCHEMA_DIR_RELATIVE = [...DATA_DIR_RELATIVE, 'schema'];
const GEO_BASE_DIR_RELATIVE = ['web', 'static', 'geo', 'v1'];
const RULES_FILE = 'rules.v1.json';
const AUTHORITIES_FILE = 'authorities.de.v1.json';
const RULES_SCHEMA_FILE = 'rules.schema.json';
const AUTHORITIES_SCHEMA_FILE = 'authorities.schema.json';
const AUTHORITIES_COUNTRY = 'DE';
const GEO_L2_DIR = 'l2';
/** Member of a geo feature that holds its district key. */
const GEO_AGS_PROPERTY = 'ags';
const ROOT_FLAG = '--root';
const SCHEMA_DIR_FLAG = '--schema-dir';
const USAGE_EXIT_CODE = 2;
const PROBLEMS_EXIT_CODE = 1;
const ROOT_LABEL = '<root>';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf-8'));

/**
 * Compile `schemaPath` with ajv (draft 2020-12) and return the validate function. Strict mode stays
 * on so a misspelt keyword fails loudly, except for the two checks that reject valid idioms the
 * schemas use on purpose (`required` inside an `if/then` branch names properties declared outside
 * it, and `minItems`-style keywords appear without a sibling `type`).
 */
function compileSchema(schemaPath) {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, strictTypes: false });
  addFormats(ajv);
  return ajv.compile(readJson(schemaPath));
}

/** One `[schema] <path> <message>` line per schema violation of `document`. */
function schemaProblems(validate, document) {
  if (validate(document)) return [];
  return validate.errors.map((error) => `${TAG_SCHEMA} ${error.instancePath || ROOT_LABEL} ${error.message}`);
}

/**
 * Validate a parsed rules file and return problems (empty when valid). Cross-checks run only after
 * the schema passes, as they index into the structure the schema guarantees. `dataDir` is the
 * directory the authorities file must sit in; without it that check reports a problem (fail closed).
 */
export function validateRules(rules, { dataDir, schemaDir } = {}) {
  const problems = schemaProblems(compileSchema(join(schemaDir, RULES_SCHEMA_FILE)), rules);
  return problems.length > 0 ? problems : rulesCrossChecks(rules, dataDir);
}

/** Validate a parsed authorities file against the known district keys and return problems. */
export function validateAuthorities(data, knownAgs, { schemaDir } = {}) {
  const problems = schemaProblems(compileSchema(join(schemaDir, AUTHORITIES_SCHEMA_FILE)), data);
  return problems.length > 0 ? problems : authoritiesCrossChecks(data, knownAgs);
}

/** AGS keys of the shipped district layer `<geoBaseDir>/l2/<country>.json`. */
export function loadKnownAgs(geoBaseDir, country) {
  const collection = readJson(join(geoBaseDir, GEO_L2_DIR, `${country}.json`));
  return new Set(collection.features.map((feature) => feature.properties[GEO_AGS_PROPERTY]));
}

/** Read the value following `flag` in `args`, or `fallback` when the flag is absent. */
function flagValue(args, flag, fallback) {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (value === undefined) throw new Error(`${flag} needs a value`);
  return value;
}

/** Validate both shipped files under `root`; returns `{ rulesProblems, authoritiesProblems }`. */
export function validateRepository(root, schemaDir) {
  const dataDir = join(root, ...DATA_DIR_RELATIVE);
  const knownAgs = loadKnownAgs(join(root, ...GEO_BASE_DIR_RELATIVE), AUTHORITIES_COUNTRY);
  return {
    rulesProblems: validateRules(readJson(join(dataDir, RULES_FILE)), { dataDir, schemaDir }),
    authoritiesProblems: validateAuthorities(readJson(join(dataDir, AUTHORITIES_FILE)), knownAgs, { schemaDir }),
  };
}

/** CLI entry point; returns the process exit code. */
function main(args) {
  let root;
  let schemaDir;
  try {
    root = resolve(flagValue(args, ROOT_FLAG, join(dirname(fileURLToPath(import.meta.url)), '..')));
    schemaDir = resolve(flagValue(args, SCHEMA_DIR_FLAG, join(root, ...DEFAULT_SCHEMA_DIR_RELATIVE)));
  } catch (error) {
    console.error(`usage: node tools/validate.mjs [${ROOT_FLAG} <dir>] [${SCHEMA_DIR_FLAG} <dir>]: ${error.message}`);
    return USAGE_EXIT_CODE;
  }
  const { rulesProblems, authoritiesProblems } = validateRepository(root, schemaDir);
  const problems = [...rulesProblems.map((p) => `rules: ${p}`), ...authoritiesProblems.map((p) => `authorities: ${p}`)];
  if (problems.length === 0) {
    console.log('OK rules: 0 problems; authorities: 0 problems');
    return 0;
  }
  console.error(problems.join('\n'));
  return PROBLEMS_EXIT_CODE;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
