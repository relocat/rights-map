// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Geo pack v1 contract tests: Crimea and Kosovo point of view, covered set, hashes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { L2_DE_FILE, L2_DE_MAX_BYTES, L2_DE_EXPECTED_COUNT_RANGE } from '../../../geo/constants.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PACK_DIR = join(ROOT, 'web', 'static', 'geo', 'v1');
const RULES_PATH = join(ROOT, 'web', 'static', 'public', 'rights_map', 'data', 'rules.v1.json');
const SIMFEROPOL = [34.10, 44.95];
const BERLIN = [13.40, 52.52];
const PRISTINA = [21.17, 42.66];
const BELGRADE = [20.46, 44.79];
const KOSOVO_ISO2 = 'XK';
const SERBIA_ISO2 = 'RS';
const EXPECTED_COVERED_COUNT = 39;

const readRulesCovered = () => JSON.parse(readFileSync(RULES_PATH, 'utf8')).groups.COVERED;
const MANIFEST_FILE = 'manifest.json';
// Size budgets keep the first map load small; raise one only on purpose.
const COUNTRIES_MAX_BYTES = 600_000;
const LAND_MAX_BYTES = 400_000;
const ADMIN1_FILE_MAX_BYTES = 250_000;
const PACK_MAX_BYTES = 2_000_000;
const ADMIN1_DIRECTORY = 'admin1';
const COUNTRIES_FILE = 'countries.json';
const LAND_FILE = 'land.json';
const SYDNEY = [151.21, -33.87];
const SAO_PAULO = [-46.63, -23.55];
const MID_PACIFIC = [-150, 0];

/** Sorted relative paths of every file under a directory. */
const listFiles = (directory) =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .sort();

const readJson = (relativePath) => JSON.parse(readFileSync(join(PACK_DIR, relativePath), 'utf8'));

/** Ray-casting point-in-ring test for one linear ring of [lon, lat] pairs. */
function isInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** True when the point lies in the polygon (outer ring minus holes) of a Polygon/MultiPolygon. */
function isInGeometry(point, geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(([outer, ...holes]) => isInRing(point, outer) && !holes.some((hole) => isInRing(point, hole)));
}

const featuresContaining = (collection, point) =>
  collection.features.filter((feature) => isInGeometry(point, feature.geometry));

test('Crimea is part of Ukraine in L0', () => {
  const hits = featuresContaining(readJson('countries.json'), SIMFEROPOL).map((f) => f.properties.iso2);
  assert.deepEqual(hits, ['UA']);
});

test('Crimea is part of Ukraine in L1 and absent from any Russian file', () => {
  const hits = featuresContaining(readJson('admin1/UA.json'), SIMFEROPOL);
  assert.equal(hits.length, 1);
  assert.ok(!readdirSync(join(PACK_DIR, 'admin1')).includes('RU.json'), 'RU is not covered and must have no L1 file');
});

test('Pristina lies in exactly one L0 feature: Kosovo, grey and not covered', () => {
  const hits = featuresContaining(readJson('countries.json'), PRISTINA);
  assert.deepEqual(hits.map((f) => f.properties.iso2), [KOSOVO_ISO2]);
  assert.equal(hits[0].properties.covered, false);
});

test('Belgrade lies in exactly one L0 feature: Serbia, covered', () => {
  const hits = featuresContaining(readJson('countries.json'), BELGRADE);
  assert.deepEqual(hits.map((f) => f.properties.iso2), [SERBIA_ISO2]);
  assert.equal(hits[0].properties.covered, true);
});

test('no Serbian admin-1 feature contains Pristina, and Kosovo has no L1 file', () => {
  assert.equal(featuresContaining(readJson(`admin1/${SERBIA_ISO2}.json`), PRISTINA).length, 0);
  assert.ok(!readdirSync(join(PACK_DIR, ADMIN1_DIRECTORY)).includes(`${KOSOVO_ISO2}.json`));
});

test('no city tagged Serbia lies inside Kosovo', () => {
  const kosovo = readJson('countries.json').features.find((f) => f.properties.iso2 === KOSOVO_ISO2);
  const serbianCities = [readJson('cities-t1.json'), ...['cities-t2', 'cities-t3'].map((d) => readJson(`${d}/${SERBIA_ISO2}.json`))]
    .flatMap((c) => c.features).filter((f) => f.properties.iso2 === SERBIA_ISO2);
  assert.ok(serbianCities.length > 0);
  assert.deepEqual(serbianCities.filter((f) => isInGeometry(f.geometry.coordinates, kosovo.geometry)), []);
});

test('covered set equals the rules COVERED group, in both countries.json and the manifest', () => {
  const rulesCovered = readRulesCovered();
  const manifest = readJson('manifest.json');
  const coveredInL0 = readJson('countries.json').features.filter((f) => f.properties.covered).map((f) => f.properties.iso2);
  assert.equal(rulesCovered.length, EXPECTED_COVERED_COUNT);
  assert.deepEqual([...manifest.covered].sort(), [...rulesCovered].sort());
  assert.deepEqual([...new Set(coveredInL0)].sort(), [...rulesCovered].sort());
});

test('every covered country has an L1 file whose features all carry that iso2', () => {
  for (const iso2 of readJson('manifest.json').covered) {
    const features = readJson(`admin1/${iso2}.json`).features;
    assert.ok(features.length > 0, `${iso2} has no admin-1 features`);
    assert.ok(features.every((f) => f.properties.iso2 === iso2), `${iso2} file has a foreign feature`);
  }
});

test('Berlin lies in exactly one L0 feature, Germany', () => {
  assert.deepEqual(featuresContaining(readJson('countries.json'), BERLIN).map((f) => f.properties.iso2), ['DE']);
});

test('tier 1 has a capital for every covered country', () => {
  const capitals = readJson('cities-t1.json').features.filter((f) => f.properties.capital).map((f) => f.properties.iso2);
  assert.deepEqual([...new Set(capitals)].sort(), [...readRulesCovered()].sort());
});

test('manifest hashes match every file and list every file', () => {
  const manifest = readJson('manifest.json');
  for (const [relativePath, expectedHash] of Object.entries(manifest.files)) {
    const actual = createHash('sha256').update(readFileSync(join(PACK_DIR, relativePath))).digest('hex');
    assert.equal(actual, expectedHash, relativePath);
  }
  const onDisk = listFiles(PACK_DIR).filter((path) => path !== MANIFEST_FILE);
  assert.deepEqual(Object.keys(manifest.files).sort(), onDisk, 'manifest must list exactly the files on disk');
  assert.ok(manifest.sources.every((s) => s.licence && s.attribution !== undefined && s.url));
});

test('land layer covers the whole world, unclipped, and carries no properties', () => {
  const land = readJson(LAND_FILE);
  assert.ok(land.features.length > 0);
  assert.ok(land.features.every((f) => Object.keys(f.properties).length === 0));
  for (const point of [SYDNEY, SAO_PAULO, BERLIN, SIMFEROPOL]) {
    assert.ok(land.features.some((f) => isInGeometry(point, f.geometry)), `land misses ${point}`);
  }
  assert.ok(!land.features.some((f) => isInGeometry(MID_PACIFIC, f.geometry)), 'open sea must not be land');
});

test('land.json is listed in the manifest and Natural Earth Land is a pinned source', () => {
  const manifest = readJson('manifest.json');
  assert.ok(LAND_FILE in manifest.files);
  assert.ok(manifest.sources.some((s) => s.id === 'ne_50m_land'));
});

const sizeOf = (relativePath) => statSync(join(PACK_DIR, relativePath)).size;

test('geo pack stays within its size budget', () => {
  assert.ok(sizeOf(COUNTRIES_FILE) <= COUNTRIES_MAX_BYTES, `${COUNTRIES_FILE} is ${sizeOf(COUNTRIES_FILE)} bytes`);
  assert.ok(sizeOf(LAND_FILE) <= LAND_MAX_BYTES, `${LAND_FILE} is ${sizeOf(LAND_FILE)} bytes`);
  const admin1Files = listFiles(join(PACK_DIR, ADMIN1_DIRECTORY));
  assert.ok(admin1Files.length > 0, 'admin1 directory must not be empty');
  for (const file of admin1Files) {
    const path = join(ADMIN1_DIRECTORY, file);
    assert.ok(sizeOf(path) <= ADMIN1_FILE_MAX_BYTES, `${path} is ${sizeOf(path)} bytes`);
  }
  const totalBytes = listFiles(PACK_DIR).reduce((sum, path) => sum + sizeOf(path), 0);
  assert.ok(totalBytes <= PACK_MAX_BYTES, `pack is ${totalBytes} bytes`);
});

const LEIPZIG_POINT = [12.3747, 51.3397];
const LEIPZIG_CITY_AGS = '14713';
const LEIPZIG_NEIGHBOUR_AGS = '14729';
const BERLIN_AGS = '11000';
const BERLIN_AGS_PREFIX = '110';
const AGS_PATTERN = /^\d{5}$/;
const L2_DISTRICT_TYPES = ['city', 'district'];
const L2_PROPERTY_KEYS = ['ags', 'name', 'state', 'type'];
const L2_ATTRIBUTION = '© BKG (2026) dl-de/by-2-0';
const L2_LICENCE = 'dl-de/by-2-0';
const L2_LINKS = {
  licence_url: 'https://www.govdata.de/dl-de/by-2-0',
  provider_url: 'https://www.bkg.bund.de',
  datasources_url: 'https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg_nuts.pdf',
  dataset_url: 'https://gdz.bkg.bund.de',
};
const L2_MODIFIED = 'Data changed: geometry simplified and reprojected.';
// Generous bounding box of Germany (lon/lat), wider than the border so simplification cannot trip it.
const GERMANY_BBOX = { minLon: 5.5, maxLon: 15.5, minLat: 47, maxLat: 55.5 };

/** Every [lon, lat] position of a Polygon/MultiPolygon, flattened. */
const positionsOf = (geometry) => {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flatMap((rings) => rings.flat());
};

const districtByAgs = (ags) => readJson(L2_DE_FILE).features.find((f) => f.properties.ags === ags);

test('l2/DE.json has a plausible number of districts', () => {
  const [minimum, maximum] = L2_DE_EXPECTED_COUNT_RANGE;
  const count = readJson(L2_DE_FILE).features.length;
  assert.ok(count >= minimum && count <= maximum, `${count} districts`);
});

test('every l2/DE.json feature has exactly ags, name, type, state, with unique 5-digit AGS', () => {
  const features = readJson(L2_DE_FILE).features;
  for (const { properties } of features) {
    assert.deepEqual(Object.keys(properties).sort(), L2_PROPERTY_KEYS);
    assert.match(properties.ags, AGS_PATTERN);
    assert.ok(L2_DISTRICT_TYPES.includes(properties.type), `${properties.ags} type ${properties.type}`);
    assert.ok(properties.name && properties.state, `${properties.ags} has an empty name or state`);
  }
  assert.equal(new Set(features.map((f) => f.properties.ags)).size, features.length);
});

test('Berlin is one district (11000) and no other AGS has the Berlin prefix', () => {
  const berlinLike = readJson(L2_DE_FILE).features.map((f) => f.properties.ags).filter((ags) => ags.startsWith(BERLIN_AGS_PREFIX));
  assert.deepEqual(berlinLike, [BERLIN_AGS]);
});

test('Leipzig city (14713) contains the Leipzig point and its neighbour district does not', () => {
  assert.ok(isInGeometry(LEIPZIG_POINT, districtByAgs(LEIPZIG_CITY_AGS).geometry));
  assert.ok(!isInGeometry(LEIPZIG_POINT, districtByAgs(LEIPZIG_NEIGHBOUR_AGS).geometry));
});

test('every l2/DE.json geometry is a non-empty polygon with finite coordinates inside Germany', () => {
  const { minLon, maxLon, minLat, maxLat } = GERMANY_BBOX;
  for (const { properties, geometry } of readJson(L2_DE_FILE).features) {
    assert.ok(['Polygon', 'MultiPolygon'].includes(geometry.type), `${properties.ags} geometry ${geometry.type}`);
    const positions = positionsOf(geometry);
    assert.ok(positions.length > 0, `${properties.ags} is empty`);
    for (const [lon, lat] of positions) {
      assert.ok(Number.isFinite(lon) && Number.isFinite(lat), `${properties.ags} has a non-finite coordinate`);
      assert.ok(lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat, `${properties.ags} outside Germany`);
    }
  }
});

test('l2/DE.json stays within its size budget', () => {
  assert.ok(sizeOf(L2_DE_FILE) <= L2_DE_MAX_BYTES, `${L2_DE_FILE} is ${sizeOf(L2_DE_FILE)} bytes`);
});

test('manifest lists l2/DE.json with its real hash and the BKG licence and attribution', () => {
  const manifest = readJson(MANIFEST_FILE);
  const actual = createHash('sha256').update(readFileSync(join(PACK_DIR, L2_DE_FILE))).digest('hex');
  assert.equal(manifest.files[L2_DE_FILE], actual);
  const layer = manifest.layers[L2_DE_FILE];
  assert.equal(layer.attribution, L2_ATTRIBUTION);
  assert.deepEqual(Object.fromEntries(Object.keys(L2_LINKS).map((key) => [key, layer[key]])), L2_LINKS);
  assert.equal(layer.modified, L2_MODIFIED);
  assert.equal(layer.licence, L2_LICENCE);
});
