// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Builds web/static/geo/v1: the unprojected WGS84 geo pack (countries, admin-1, cities, l2 districts).
// Inputs: Natural Earth zips and the BKG VG250 archive (sha256-pinned in sources.lock.json) and inputs/cities-europe.tsv.
// The default admin-0 file contributes only the Kosovo polygon (see KOSOVO_NAME).
// Deterministic: two runs on the same inputs produce byte-identical output.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  CAPITAL_FEATURE_CODE, CITIES_TSV_PATH, COVERED_ISO2, GEO_DIR, TIER3_MIN_POPULATION, WORK_DIR,
  prepareSource, readLock, runMapshaper, sha256Hex, stableJson,
} from './shared.mjs';
import { L2_DE_FILE, L2_DE_SOURCE_ID, buildL2Germany } from './build-l2.mjs';

const FRAME_BBOX = [-32, 27, 50, 72];
const SIMPLIFY_COUNTRIES = '5%';
const SIMPLIFY_ADMIN1 = '8%';
// World land is drawn as one borderless grey layer, so coarse detail and 2-decimal precision
// keep it under the 400 KB budget enforced by tests/js/geo/geo-pack.test.mjs.
const SIMPLIFY_LAND = '25%';
const LAND_COORD_PRECISION = 0.01;
const COORD_PRECISION = 0.001;
const COORD_DECIMALS = Math.round(-Math.log10(COORD_PRECISION));
const TIER1_MIN_POPULATION = 1_000_000;
const TIER2_MIN_POPULATION = 300_000;
// Natural Earth admin-1 has no point-of-view variant and files these two under Russia.
const CRIMEA_ADMIN1_CODES = ['UA-43', 'UA-40'];
const CRIMEA_COUNTRY_ISO2 = 'UA';
// Natural Earth stores ISO_A2 = -99 for these; keyed by NAME (verified against the 5.1.1 data).
const NE_ISO_FIXES = { France: 'FR', Norway: 'NO' };
// The Ukraine point-of-view file has no Kosovo feature (its area is inside Serbia), so the Kosovo
// polygon comes from the default admin-0 file and is cut out of Serbia. Kosovo is a grey,
// non-covered context region: its ISO code is the widely used user-assigned XK.
const KOSOVO_NAME = 'Kosovo';
const KOSOVO_ISO2 = 'XK';
const SERBIA_NAME = 'Serbia';

const PACK_VERSION = 1;
const PACK_NAME = 'relocat-geo';
const PROJECTION_NOTE = 'none (WGS84 lon/lat)';
const ATTRIBUTION = ['Natural Earth', 'GeoNames (CC BY 4.0)'];
const GEONAMES_SOURCE = {
  id: 'geonames_cities15000',
  title: 'GeoNames cities15000 (filtered to covered countries)',
  licence: 'CC BY 4.0',
  attribution: 'GeoNames (CC BY 4.0)',
};
const ISO2_PATTERN = /^[A-Z]{2}$/;
const OUTPUT_DIR = join(GEO_DIR, '..', 'web', 'static', 'geo', `v${PACK_VERSION}`);
const NE_COUNTRIES_ID = 'ne_10m_admin_0_countries_ukr';
const NE_KOSOVO_SOURCE_ID = 'ne_10m_admin_0_countries';
const NE_LAND_ID = 'ne_50m_land';
const LAND_FILE = 'land.json';
const NE_ADMIN1_ID = 'ne_10m_admin_1_states_provinces';
const TIER_DIRS = { 2: 'cities-t2', 3: 'cities-t3' };
const TIER1_FILE = 'cities-t1.json';
const MANIFEST_FILE = 'manifest.json';
const TSV_SEPARATOR = '\t';

const bboxArgument = `bbox=${FRAME_BBOX.join(',')}`;
const outputOptions = `format=geojson precision=${COORD_PRECISION}`;

/**
 * Mapshaper command that loads the Ukraine-POV countries plus the default file's Kosovo, erases
 * Kosovo from Serbia only (so a border sliver can never nick another neighbour), and merges the
 * three into one `countries` layer. All layers share one dataset, so simplification keeps the
 * Serbia/Kosovo border and every other border topologically consistent.
 */
function kosovoCarveOutCommands(countriesShapefile, kosovoShapefile) {
  const countries = 'ne_10m_admin_0_countries_ukr';
  const defaults = NE_KOSOVO_SOURCE_ID;
  return `-i "${countriesShapefile}" "${kosovoShapefile}" combine-files` +
    ` -target ${countries} -filter-fields ISO_A2,NAME` +
    ` -target ${defaults} -filter 'NAME == "${KOSOVO_NAME}"' + name=kosovo` +
    ` -target kosovo -filter-fields NAME -each 'ISO_A2 = "${KOSOVO_ISO2}"'` +
    ` -target ${countries} -filter 'NAME == "${SERBIA_NAME}"' + name=serbia` +
    ` -target ${countries} -filter 'NAME != "${SERBIA_NAME}"'` +
    ` -target serbia -erase source=kosovo` +
    ` -merge-layers target=${countries},serbia,kosovo name=countries`;
}

/** Builds the L0 country collection with {iso2, name, covered} properties. */
async function buildCountries(countriesShapefile, kosovoShapefile) {
  const outputPath = join(WORK_DIR, 'countries.raw.json');
  const raw = await runMapshaper(
    `${kosovoCarveOutCommands(countriesShapefile, kosovoShapefile)}` +
      ` -target countries -clip ${bboxArgument} -simplify ${SIMPLIFY_COUNTRIES} keep-shapes` +
      ` -o "${outputPath}" force ${outputOptions}`,
    outputPath,
  );
  const features = raw.features
    .map((feature) => ({
      type: 'Feature',
      properties: {
        iso2: NE_ISO_FIXES[feature.properties.NAME] ?? feature.properties.ISO_A2,
        name: feature.properties.NAME,
      },
      geometry: feature.geometry,
    }))
    .filter((feature) => ISO2_PATTERN.test(feature.properties.iso2))
    .map((feature) => ({ ...feature, properties: { ...feature.properties, covered: COVERED_ISO2.includes(feature.properties.iso2) } }));
  features.sort((a, b) => a.properties.iso2.localeCompare(b.properties.iso2) || a.properties.name.localeCompare(b.properties.name));
  return { type: 'FeatureCollection', features };
}

/** Builds the unclipped world land layer: one MultiPolygon feature with no properties. */
async function buildLand(shapefilePath) {
  const outputPath = join(WORK_DIR, 'land.raw.json');
  const raw = await runMapshaper(
    `-i "${shapefilePath}" -filter-fields -dissolve -simplify ${SIMPLIFY_LAND} keep-shapes` +
      ` -o "${outputPath}" force format=geojson precision=${LAND_COORD_PRECISION}`,
    outputPath,
  );
  return {
    type: 'FeatureCollection',
    features: raw.geometries.map((geometry) => ({ type: 'Feature', properties: {}, geometry })),
  };
}

/** Builds the L1 admin-1 collections keyed by covered iso2, with Crimea forced into Ukraine. */
async function buildAdmin1(shapefilePath) {
  const outputPath = join(WORK_DIR, 'admin1.raw.json');
  const crimeaCodes = JSON.stringify(CRIMEA_ADMIN1_CODES);
  const coveredCodes = JSON.stringify(COVERED_ISO2);
  const raw = await runMapshaper(
    `-i "${shapefilePath}" -filter-fields iso_a2,iso_3166_2,name` +
      ` -each 'if (${crimeaCodes}.indexOf(iso_3166_2) >= 0) iso_a2 = "${CRIMEA_COUNTRY_ISO2}"'` +
      ` -filter '${coveredCodes}.indexOf(iso_a2) >= 0' -clip ${bboxArgument}` +
      ` -simplify ${SIMPLIFY_ADMIN1} keep-shapes -o "${outputPath}" force ${outputOptions}`,
    outputPath,
  );
  const byCountry = Object.fromEntries(COVERED_ISO2.map((iso2) => [iso2, []]));
  for (const feature of raw.features) {
    const { iso_a2: iso2, iso_3166_2: code, name } = feature.properties;
    byCountry[iso2].push({ type: 'Feature', properties: { iso2, code, name }, geometry: feature.geometry });
  }
  for (const features of Object.values(byCountry)) {
    features.sort((a, b) => a.properties.code.localeCompare(b.properties.code));
  }
  return Object.fromEntries(Object.entries(byCountry).map(([iso2, features]) => [iso2, { type: 'FeatureCollection', features }]));
}

/** Rounds a coordinate to the pack precision. */
const roundCoordinate = (value) => Number(value.toFixed(COORD_DECIMALS));

/** Parses the committed GeoNames TSV into city point features. */
function readCities() {
  const [header, ...lines] = readFileSync(CITIES_TSV_PATH, 'utf8').split('\n').filter((line) => line.length > 0);
  const columns = header.split(TSV_SEPARATOR);
  return lines.map((line) => {
    const row = Object.fromEntries(line.split(TSV_SEPARATOR).map((value, index) => [columns[index], value]));
    return {
      type: 'Feature',
      properties: {
        name: row.name,
        iso2: row.country_code,
        population: Number(row.population),
        capital: row.feature_code === CAPITAL_FEATURE_CODE,
      },
      geometry: { type: 'Point', coordinates: [roundCoordinate(Number(row.longitude)), roundCoordinate(Number(row.latitude))] },
    };
  });
}

/** Orders features by population descending, then name, for deterministic output. */
function byPopulationThenName(a, b) {
  return b.properties.population - a.properties.population || a.properties.name.localeCompare(b.properties.name);
}

/** Wraps features in a sorted FeatureCollection. */
const collection = (features) => ({ type: 'FeatureCollection', features: [...features].sort(byPopulationThenName) });

/** Splits cities into the tier-1 file and per-country tier-2 / tier-3 collections. */
function buildCityTiers(cities) {
  const tier1 = cities.filter((c) => c.properties.capital || c.properties.population >= TIER1_MIN_POPULATION);
  const nonCapitals = cities.filter((c) => !c.properties.capital);
  const inRange = (minimum, maximum) => nonCapitals.filter((c) => c.properties.population >= minimum && c.properties.population < maximum);
  const byCountry = (features) => Object.fromEntries(COVERED_ISO2.map((iso2) => [iso2, collection(features.filter((f) => f.properties.iso2 === iso2))]));
  return {
    tier1: collection(tier1),
    tier2: byCountry(inRange(TIER2_MIN_POPULATION, TIER1_MIN_POPULATION)),
    tier3: byCountry(inRange(TIER3_MIN_POPULATION, TIER2_MIN_POPULATION)),
  };
}

/** Recursively lists files under a directory as sorted relative paths. */
function listFiles(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .sort();
}

/** Writes compact stable JSON under the pack directory. */
function writePackFile(relativePath, value) {
  const path = join(OUTPUT_DIR, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, stableJson(value));
}

/** Per-layer licence block for layers whose terms differ from the global attribution list. */
function buildLayerEntries(lock) {
  const source = lock.sources[L2_DE_SOURCE_ID];
  return {
    [L2_DE_FILE]: {
      attribution: source.attribution,
      licence: source.licence,
      licence_url: source.licence_url,
      provider_url: source.provider_url,
      datasources_url: source.datasources_url,
      dataset_url: source.dataset_url,
      source_url: source.url,
      modified: source.modified,
    },
  };
}

/** Builds the manifest last, hashing every other file in the pack. */
function buildManifest(lock) {
  const files = Object.fromEntries(listFiles(OUTPUT_DIR).map((path) => [path, sha256Hex(readFileSync(join(OUTPUT_DIR, path)))]));
  const naturalEarth = Object.entries(lock.sources).map(([id, entry]) => ({
    id, title: entry.title, url: entry.url, licence: entry.licence, attribution: entry.attribution,
  }));
  return {
    pack: PACK_NAME,
    version: PACK_VERSION,
    projection: PROJECTION_NOTE,
    frame: FRAME_BBOX,
    covered: COVERED_ISO2,
    files,
    sources: [...naturalEarth, { ...GEONAMES_SOURCE, url: lock.cities.url }],
    attribution: ATTRIBUTION,
    layers: buildLayerEntries(lock),
  };
}

const lock = readLock();
rmSync(WORK_DIR, { recursive: true, force: true });
mkdirSync(WORK_DIR, { recursive: true });
const countriesShapefile = await prepareSource(lock, NE_COUNTRIES_ID);
const kosovoShapefile = await prepareSource(lock, NE_KOSOVO_SOURCE_ID);
const admin1Shapefile = await prepareSource(lock, NE_ADMIN1_ID);
const landShapefile = await prepareSource(lock, NE_LAND_ID);
const districtShapefile = await prepareSource(lock, L2_DE_SOURCE_ID);

rmSync(OUTPUT_DIR, { recursive: true, force: true });
writePackFile('countries.json', await buildCountries(countriesShapefile, kosovoShapefile));
writePackFile(LAND_FILE, await buildLand(landShapefile));
for (const [iso2, features] of Object.entries(await buildAdmin1(admin1Shapefile))) {
  writePackFile(`admin1/${iso2}.json`, features);
}
const tiers = buildCityTiers(readCities());
writePackFile(TIER1_FILE, tiers.tier1);
for (const iso2 of COVERED_ISO2) {
  writePackFile(`${TIER_DIRS[2]}/${iso2}.json`, tiers.tier2[iso2]);
  writePackFile(`${TIER_DIRS[3]}/${iso2}.json`, tiers.tier3[iso2]);
}
writePackFile(L2_DE_FILE, await buildL2Germany(districtShapefile));
writePackFile(MANIFEST_FILE, buildManifest(lock));
console.log(`geo pack written to ${OUTPUT_DIR}`);
