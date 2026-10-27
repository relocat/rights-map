// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Filters GeoNames cities15000 into the committed geo/inputs/cities-europe.tsv and records the
// snapshot (date + sha256 of the zip) in sources.lock.json. GeoNames changes daily, so the zip is
// not pinned; the committed TSV is the build input.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  CAPITAL_FEATURE_CODE, CITIES_TSV_PATH, COVERED_ISO2, TIER3_MIN_POPULATION, TSV_COLUMNS,
  download, readLock, readZipMember, sha256Hex, writeLock,
} from './shared.mjs';

const ZIP_FILE_NAME = 'cities15000.zip';
const ZIP_MEMBER = 'cities15000.txt';
const FIELD_SEPARATOR = '\t';
// Column positions in the GeoNames dump (https://download.geonames.org/export/dump/readme.txt).
const SOURCE_COLUMN = { geonameid: 0, name: 1, latitude: 4, longitude: 5, featureCode: 7, countryCode: 8, population: 14 };
const ISO_DATE_LENGTH = 10;

/** Parses one GeoNames line into the TSV row object, or null when the line is not a data row. */
function parseLine(line) {
  const fields = line.split(FIELD_SEPARATOR);
  if (fields.length <= SOURCE_COLUMN.population) return null;
  return {
    geonameid: fields[SOURCE_COLUMN.geonameid],
    name: fields[SOURCE_COLUMN.name],
    latitude: fields[SOURCE_COLUMN.latitude],
    longitude: fields[SOURCE_COLUMN.longitude],
    country_code: fields[SOURCE_COLUMN.countryCode],
    population: fields[SOURCE_COLUMN.population],
    feature_code: fields[SOURCE_COLUMN.featureCode],
  };
}

/** True for rows the build needs: covered country and (large city or national capital). */
function isWanted(row) {
  if (!COVERED_ISO2.includes(row.country_code)) return false;
  return Number(row.population) >= TIER3_MIN_POPULATION || row.feature_code === CAPITAL_FEATURE_CODE;
}

/** Orders rows by country then numeric geonameid so reruns on the same dump are byte-identical. */
function compareRows(a, b) {
  return a.country_code.localeCompare(b.country_code) || Number(a.geonameid) - Number(b.geonameid);
}

const lock = readLock();
const zipPath = await download(lock.cities.url, ZIP_FILE_NAME);
const zipSha256 = sha256Hex(readFileSync(zipPath));
const rows = readZipMember(zipPath, ZIP_MEMBER)
  .split('\n')
  .filter((line) => line.length > 0)
  .map(parseLine)
  .filter((row) => row !== null && isWanted(row))
  .sort(compareRows);

const lines = [TSV_COLUMNS.join(FIELD_SEPARATOR), ...rows.map((row) => TSV_COLUMNS.map((c) => row[c]).join(FIELD_SEPARATOR))];
mkdirSync(dirname(CITIES_TSV_PATH), { recursive: true });
writeFileSync(CITIES_TSV_PATH, lines.join('\n') + '\n');

lock.cities.snapshot = { fetched: new Date().toISOString().slice(0, ISO_DATE_LENGTH), sha256: zipSha256 };
writeLock(lock);
console.log(`cities-europe.tsv: ${rows.length} rows, zip sha256 ${zipSha256}`);
