// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Guards against the mockup's GADM-derived district geometry shipping: only BKG VG250 may.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const STATIC_DIR = join(ROOT, 'web', 'static');
const FORBIDDEN_FILE_NAME_PART = 'geo-de-kreise';
const FORBIDDEN_CONTENT_MARKER = 'GADM';
const TEXT_EXTENSIONS = new Set(['.json', '.js', '.mjs', '.css', '.html', '.txt', '.md', '.svg', '.geojson']);

const staticFiles = () =>
  readdirSync(STATIC_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));

const isTextFile = (path) => TEXT_EXTENSIONS.has(path.slice(path.lastIndexOf('.')).toLowerCase());

test('no served file is named after the mockup district geometry', () => {
  const offenders = staticFiles().filter((path) => path.includes(FORBIDDEN_FILE_NAME_PART));
  assert.deepEqual(offenders, []);
});

test('no served text or JSON file mentions GADM', () => {
  const offenders = staticFiles()
    .filter(isTextFile)
    .filter((path) => readFileSync(path, 'utf8').includes(FORBIDDEN_CONTENT_MARKER));
  assert.deepEqual(offenders, []);
});
