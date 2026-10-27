// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Helpers and constants shared by fetch-cities.mjs and build-geo-pack.mjs.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mapshaper from 'mapshaper';

export const GEO_DIR = dirname(fileURLToPath(import.meta.url));
export const CACHE_DIR = join(GEO_DIR, '.cache');
export const WORK_DIR = join(CACHE_DIR, 'work');
export const LOCK_PATH = join(GEO_DIR, 'sources.lock.json');
export const CITIES_TSV_PATH = join(GEO_DIR, 'inputs', 'cities-europe.tsv');

/** ISO 3166-1 alpha-2 codes of the 39 covered countries: rules.v1.json groups.COVERED, same order. */
export const COVERED_ISO2 = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
  'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'NO', 'CH',
  'LI', 'GB', 'UA', 'MD', 'RS', 'BA', 'ME', 'MK', 'AL',
];

/** GeoNames feature code of a national capital. */
export const CAPITAL_FEATURE_CODE = 'PPLC';
export const TSV_COLUMNS = ['geonameid', 'name', 'latitude', 'longitude', 'country_code', 'population', 'feature_code'];
export const JSON_INDENT = 2;
/** Smallest city kept in the TSV and in tier 3 of the pack. */
export const TIER3_MIN_POPULATION = 100_000;
const MAX_UNZIP_OUTPUT_BYTES = 1 << 30;

/** Hex sha256 of a Buffer or string. */
export function sha256Hex(content) {
  return createHash('sha256').update(content).digest('hex');
}

/** Returns a deep copy of a JSON value with every object's keys sorted, for byte-stable output. */
export function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeysDeep(value[key])]));
}

/** Serialises JSON with sorted keys and a trailing newline; indent 0 gives the compact form. */
export function stableJson(value, indent = 0) {
  return JSON.stringify(sortKeysDeep(value), null, indent) + '\n';
}

/** Reads sources.lock.json. */
export function readLock() {
  return JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
}

/** Writes sources.lock.json in the human-diffable indented form. */
export function writeLock(lock) {
  writeFileSync(LOCK_PATH, stableJson(lock, JSON_INDENT));
}

/** Downloads a URL into the cache directory and returns the file path (fails on any non-2xx). */
export async function download(url, fileName) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed: ${url} -> HTTP ${response.status}`);
  const path = join(CACHE_DIR, fileName);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  return path;
}

/** Returns the cached file path, downloading it only when absent. */
export async function ensureDownloaded(url, fileName) {
  const path = join(CACHE_DIR, fileName);
  return existsSync(path) ? path : download(url, fileName);
}

/** Streams one archive member to a string using the system unzip. */
export function readZipMember(zipPath, member) {
  return execFileSync('unzip', ['-p', zipPath, member], { encoding: 'utf8', maxBuffer: MAX_UNZIP_OUTPUT_BYTES });
}

/**
 * Verifies (or, on first run, records) the sha256 of a downloaded source archive and extracts it.
 * `entry.members` limits extraction to those unzip patterns; `entry.shapefile` is the shapefile's
 * path inside the archive and defaults to `${id}.shp`. Returns the extracted shapefile path.
 */
export async function prepareSource(lock, id) {
  const entry = lock.sources[id];
  const archivePath = await ensureDownloaded(entry.url, entry.archive);
  const actual = sha256Hex(readFileSync(archivePath));
  if (entry.sha256 === undefined) {
    entry.sha256 = actual;
    writeLock(lock);
    console.log(`recorded sha256 for ${id}: ${actual}`);
  } else if (entry.sha256 !== actual) {
    throw new Error(`sha256 mismatch for ${id}: lock ${entry.sha256}, downloaded ${actual}`);
  }
  const extractDir = join(WORK_DIR, id);
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  execFileSync('unzip', ['-q', '-o', archivePath, ...(entry.members ?? []), '-d', extractDir]);
  return join(extractDir, entry.shapefile ?? `${id}.shp`);
}

/** Runs one mapshaper command line through the pinned local Node API and returns the parsed GeoJSON. */
export async function runMapshaper(commandLine, outputPath) {
  await mapshaper.runCommands(commandLine);
  return JSON.parse(readFileSync(outputPath, 'utf8'));
}
