// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Finds the validator (tools/) and the JSON schemas (web/static/public/rights_map/data/schema).
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root: this file sits at tests/js/rights_map/validator-parity/. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
export const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const VALIDATOR_CANDIDATES = [
  ['tools', 'validate.mjs'],
];
const SCHEMA_DIR_CANDIDATES = [
  ['web', 'static', 'public', 'rights_map', 'data', 'schema'],
];
const RULES_SCHEMA_FILE = 'rules.schema.json';

const firstExisting = (candidates, probe) => {
  const found = candidates.map((parts) => join(REPO_ROOT, ...parts)).find((path) => existsSync(probe(path)));
  if (found === undefined) throw new Error(`none of ${candidates.map((parts) => parts.join('/')).join(', ')} exists`);
  return found;
};

/** Absolute path of the validator module in this checkout. */
export const validatorPath = () => firstExisting(VALIDATOR_CANDIDATES, (path) => path);

/** Absolute path of the directory holding the two JSON schemas in this checkout. */
export const schemaDirPath = () => firstExisting(SCHEMA_DIR_CANDIDATES, (path) => join(path, RULES_SCHEMA_FILE));
