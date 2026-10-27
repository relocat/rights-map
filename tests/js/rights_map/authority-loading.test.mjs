// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Lazy loading of the district layer: what is requested, when, and how failures surface.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  districtLayerPath, loadDistrictData, loadDistrictLayer, shouldCloseOnEscape,
} from '../../../web/static/public/rights_map/map-app.js';
import { authorityIndex } from '../../../web/static/public/rights_map/engine.js';
import { districtLabels } from '../../../web/static/public/rights_map/authority-metrics.js';
import { GEO_STATUS, METRIC_LABELS, BUCKET_LABELS } from '../../../web/static/public/rights_map/ui-common.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PUBLIC_DIR = join(ROOT, 'web', 'static', 'public', 'rights_map');
const RULES = JSON.parse(readFileSync(join(PUBLIC_DIR, 'data', 'rules.v1.json'), 'utf8'));
const AUTHORITIES = JSON.parse(readFileSync(join(PUBLIC_DIR, 'data', 'authorities.de.v1.json'), 'utf8'));
const TOPIC = RULES.topics.find((topic) => topic.granularity === 'authority');
const STATIC_BASE = '/static/public/rights_map/';
const GEO_BASE = '/static/geo/v1/';
const VERSION = 'abc123';
const AUTHORITIES_URL = `${STATIC_BASE}data/${TOPIC.authorities_file}?v=${VERSION}`;
const LAYER_URL = `${GEO_BASE}l2/DE.json?v=${VERSION}`;
const COLLECTION = { type: 'FeatureCollection', features: [] };
const SETTINGS = { staticBase: STATIC_BASE, version: VERSION, indexAuthorities: authorityIndex };
const ESCAPE = { key: 'Escape', defaultPrevented: false, target: {} };
const URL_WITH_VERSION_ONLY = /^[^?]+\?v=[a-z0-9]+$/;

/** Records every requested URL; `failures` makes the first N requests of a URL reject. */
function createStubs(failures = {}) {
  const requests = [];
  const remaining = { ...failures };
  const respond = (url, body) => {
    requests.push(url);
    if (remaining[url] > 0) {
      remaining[url] -= 1;
      return Promise.reject(new TypeError('network'));
    }
    return Promise.resolve(body);
  };
  return {
    requests,
    loadGeo: (path) => respond(`${GEO_BASE}${path}?v=${VERSION}`, COLLECTION),
    fetchJson: (url) => respond(url, AUTHORITIES),
  };
}

function createApp(stubs) {
  const app = {
    state: {
      districts: { status: GEO_STATUS.LOADING, collection: null, authorities: null, byAgs: {}, labels: new Map() },
    },
    common: { GEO_STATUS },
    settings: SETTINGS,
    loadGeo: stubs.loadGeo,
    fetchJson: stubs.fetchJson,
    modules: { 'authority-metrics': { districtLabels } },
    isLoadingDistricts: false,
    update: () => {},
  };
  return app;
}

test('the district layer path follows the country code', () => {
  assert.equal(districtLayerPath('DE'), 'l2/DE.json');
});

test('loadDistrictData requests the layer and the authorities file with only the version', async () => {
  const stubs = createStubs();
  const loaded = await loadDistrictData(stubs.loadGeo, stubs.fetchJson, TOPIC, SETTINGS);
  assert.deepEqual([...stubs.requests].sort(), [LAYER_URL, AUTHORITIES_URL].sort());
  for (const url of stubs.requests) assert.match(url, URL_WITH_VERSION_ONLY);
  assert.equal(loaded.collection, COLLECTION);
  assert.ok(Object.keys(loaded.byAgs).length > 0);
});

test('nothing is requested before a load starts, and a loaded layer is not refetched', async () => {
  const stubs = createStubs();
  const app = createApp(stubs);
  assert.equal(stubs.requests.length, 0);
  await loadDistrictLayer(app, TOPIC);
  await loadDistrictLayer(app, TOPIC);
  assert.equal(stubs.requests.length, 2);
  assert.equal(app.state.districts.status, GEO_STATUS.READY);
  assert.equal(app.state.districts.collection, COLLECTION);
});

test('a failed fetch gives ERROR and the next call retries', async () => {
  const stubs = createStubs({ [AUTHORITIES_URL]: 1 });
  const app = createApp(stubs);
  await loadDistrictLayer(app, TOPIC);
  assert.equal(app.state.districts.status, GEO_STATUS.ERROR);
  await loadDistrictLayer(app, TOPIC);
  assert.equal(app.state.districts.status, GEO_STATUS.READY);
});

test('a load already running is not started twice', async () => {
  const stubs = createStubs();
  const app = createApp(stubs);
  await Promise.all([loadDistrictLayer(app, TOPIC), loadDistrictLayer(app, TOPIC)]);
  assert.equal(stubs.requests.length, 2);
});

test('a duplicate AGS surfaces as ERROR, not an uncaught exception', async () => {
  const [first, second] = AUTHORITIES.authorities;
  const duplicated = { authorities: [first, { ...second, covers: [...second.covers, first.covers[0]] }] };
  const app = createApp({ ...createStubs(), fetchJson: () => Promise.resolve(duplicated) });
  await loadDistrictLayer(app, TOPIC);
  assert.equal(app.state.districts.status, GEO_STATUS.ERROR);
  assert.equal(app.isLoadingDistricts, false);
});

test('an unexpected error is not swallowed', async () => {
  const app = createApp({ ...createStubs(), fetchJson: () => Promise.reject(new ReferenceError('bug')) });
  await assert.rejects(loadDistrictLayer(app, TOPIC), ReferenceError);
});

test('Escape clears a district selection like a country selection', () => {
  assert.equal(shouldCloseOnEscape(ESCAPE, { selectedIso2: null, selectedAgs: '11000' }), true);
  assert.equal(shouldCloseOnEscape(ESCAPE, { selectedIso2: 'PL', selectedAgs: null }), true);
  assert.equal(shouldCloseOnEscape(ESCAPE, { selectedIso2: null, selectedAgs: null }), false);
});

test('the legend has one label per bucket and one metric label per option', () => {
  assert.equal(BUCKET_LABELS.length, TOPIC.colour.buckets_months.length + 1);
  assert.deepEqual(Object.keys(METRIC_LABELS).sort(), [...TOPIC.colour.metric_options].sort());
});
