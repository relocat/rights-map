// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Builds the Germany district layer (l2/DE.json) from the BKG VG250 Kreise shapefile.
// Called by build-geo-pack.mjs; kept separate so that file stays cohesive.
import { join } from 'node:path';
import { WORK_DIR, runMapshaper } from './shared.mjs';
import { L2_DE_EXPECTED_COUNT_RANGE, L2_DE_FILE, L2_DE_MAX_BYTES, L2_DE_SOURCE_ID } from './constants.mjs';

export { L2_DE_EXPECTED_COUNT_RANGE, L2_DE_FILE, L2_DE_MAX_BYTES, L2_DE_SOURCE_ID };

/** Output coordinate reference system of every geo pack layer. */
const TARGET_CRS = 'wgs84';


// Mapshaper simplification, the lowest percentage of retained vertices that passes the budget.
const SIMPLIFY_L2 = '7%';
const COORD_PRECISION = 0.001;
// VG250 GF = 4 marks land area (the other values are water bodies and sea).
const LAND_GEOMETRY_FLAG = 4;
const AGS_FIELD = 'AGS';
const NAME_FIELD = 'GEN';
const TYPE_FIELD = 'BEZ';
const AGS_STATE_PREFIX_LENGTH = 2;

const TYPE_CITY = 'city';
const TYPE_DISTRICT = 'district';
// VG250 BEZ (administrative designation) values. An unknown value throws so that a new edition
// with a new designation is classified deliberately instead of silently mislabelled.
const BEZ_TYPE_BY_NAME = Object.freeze({
  'Kreisfreie Stadt': TYPE_CITY,
  Stadtkreis: TYPE_CITY,
  Kreis: TYPE_DISTRICT,
  Landkreis: TYPE_DISTRICT,
  Regionalverband: TYPE_DISTRICT,
  Region: TYPE_DISTRICT,
  Städteregion: TYPE_DISTRICT,
});

// Land (state) names by the first two digits of the AGS (Amtlicher Gemeindeschlüssel).
const STATE_BY_AGS_PREFIX = Object.freeze({
  '01': 'Schleswig-Holstein',
  '02': 'Hamburg',
  '03': 'Niedersachsen',
  '04': 'Bremen',
  '05': 'Nordrhein-Westfalen',
  '06': 'Hessen',
  '07': 'Rheinland-Pfalz',
  '08': 'Baden-Württemberg',
  '09': 'Bayern',
  '10': 'Saarland',
  '11': 'Berlin',
  '12': 'Brandenburg',
  '13': 'Mecklenburg-Vorpommern',
  '14': 'Sachsen',
  '15': 'Sachsen-Anhalt',
  '16': 'Thüringen',
});

/** Maps a VG250 BEZ value to `city` or `district`; throws on a value outside the allow-list. */
function typeFromDesignation(designation, ags) {
  const type = BEZ_TYPE_BY_NAME[designation];
  if (type === undefined) throw new Error(`unknown VG250 BEZ "${designation}" for AGS ${ags}`);
  return type;
}

/** Returns the state name for an AGS; throws when the prefix is not one of the 16 Länder. */
function stateFromAgs(ags) {
  const state = STATE_BY_AGS_PREFIX[ags.slice(0, AGS_STATE_PREFIX_LENGTH)];
  if (state === undefined) throw new Error(`AGS ${ags} has no known state prefix`);
  return state;
}

/** Converts one dissolved mapshaper feature to the layer's {ags, name, type, state} feature. */
function toDistrictFeature(feature) {
  const ags = String(feature.properties[AGS_FIELD]);
  return {
    type: 'Feature',
    properties: {
      ags,
      name: feature.properties[NAME_FIELD],
      type: typeFromDesignation(feature.properties[TYPE_FIELD], ags),
      state: stateFromAgs(ags),
    },
    geometry: feature.geometry,
  };
}

/** Throws when the feature count is outside the expected range or the output is over budget. */
function assertWithinBudget(collection, serialised) {
  const [minimum, maximum] = L2_DE_EXPECTED_COUNT_RANGE;
  const count = collection.features.length;
  if (count < minimum || count > maximum) {
    throw new Error(`l2/DE.json has ${count} features, expected ${minimum} to ${maximum}`);
  }
  const bytes = Buffer.byteLength(serialised);
  if (bytes > L2_DE_MAX_BYTES) {
    throw new Error(`l2/DE.json is ${bytes} bytes, over the ${L2_DE_MAX_BYTES} byte budget`);
  }
}

/**
 * Builds the Kreise FeatureCollection with {ags, name, type, state} properties, sorted by AGS.
 * Expects the UTM32 (ETRS89, EPSG:25832) VG250 archive; the shapefile path comes from prepareSource.
 */
export async function buildL2Germany(shapefilePath) {
  const outputPath = join(WORK_DIR, 'l2-de.raw.json');
  const raw = await runMapshaper(
    `-i "${shapefilePath}" encoding=utf8 -filter 'GF == ${LAND_GEOMETRY_FLAG}'` +
      ` -filter-fields ${AGS_FIELD},${NAME_FIELD},${TYPE_FIELD}` +
      ` -dissolve ${AGS_FIELD} copy-fields=${NAME_FIELD},${TYPE_FIELD}` +
      ` -simplify ${SIMPLIFY_L2} keep-shapes` +
      // BKG publishes the 2026 edition only in UTM32 (EPSG:25832); reproject so the pack stays WGS84.
      ` -proj ${TARGET_CRS}` +
      ` -o "${outputPath}" force format=geojson precision=${COORD_PRECISION}`,
    outputPath,
  );
  const features = raw.features.map(toDistrictFeature);
  features.sort((a, b) => a.properties.ags.localeCompare(b.properties.ags));
  const collection = { type: 'FeatureCollection', features };
  assertWithinBudget(collection, JSON.stringify(collection));
  return collection;
}
