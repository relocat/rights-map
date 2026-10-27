// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Unit tests for the finder in authority mode: metric radiogroup, district legend, district select,
// live region and the manifest-driven attribution. Elements are small fakes; no DOM is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PUBLIC_DIR = join(ROOT, 'web', 'static', 'public', 'rights_map');
const load = (name) => import(pathToFileURL(join(PUBLIC_DIR, name)).href);
const finder = await load('ui-finder.js');
const common = await load('ui-common.js');
const metrics = await load('authority-metrics.js');
const districts = await load('ui-map-districts.js');
const engine = await load('engine.js');
const RULES = JSON.parse(readFileSync(join(PUBLIC_DIR, 'data', 'rules.v1.json'), 'utf8'));
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'web', 'static', 'geo', 'v1', 'manifest.json'), 'utf8'));
const TOPIC = RULES.topics.find((topic) => topic.granularity === 'authority');

const BKG_DATASOURCES_URL = 'https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg_nuts.pdf';
// BKG's Quellenvermerk verbatim, then the change note (the exact footer text).
const BKG_CREDIT = `Districts: © BKG (2026) dl-de/by-2-0, Datenquellen: ${BKG_DATASOURCES_URL} · Data changed: geometry simplified and reprojected.`;
const BKG_LINKS = [
  ['BKG', 'https://www.bkg.bund.de'],
  ['dl-de/by-2-0', 'https://www.govdata.de/dl-de/by-2-0'],
  [BKG_DATASOURCES_URL, BKG_DATASOURCES_URL],
];
const EXTERNAL_LINK_REL = 'noopener noreferrer';
const SIMPLIFIED = 'simplified';
const NATURAL_EARTH = 'Natural Earth';
const GEONAMES = 'GeoNames (CC BY 4.0)';
const FIND_DISTRICT = 'Find a district';
const FIND_COUNTRY = 'Find a country';
const BUCKET_LEGEND_ROWS = 5;
const LEGEND_ROWS = BUCKET_LEGEND_ROWS + 2;
const TODAY = '2026-10';
const CONFIRMED_BUCKET_ONE = { src: 'official', lo: 7, hi: 12, date: '2026-09' };
const UNCONFIRMED_BUCKET_ZERO = { src: 'estimate', lo: 3 };
const NO_DATA_ENTRY = { src: 'none' };
const AUTHORITIES = {
  '01001': { times: { total: CONFIRMED_BUCKET_ONE, wait: UNCONFIRMED_BUCKET_ZERO, proc: NO_DATA_ENTRY } },
  '01002': { times: { total: UNCONFIRMED_BUCKET_ZERO, wait: NO_DATA_ENTRY, proc: NO_DATA_ENTRY } },
  '01003': { times: { total: NO_DATA_ENTRY, wait: NO_DATA_ENTRY, proc: NO_DATA_ENTRY } },
};
const LABELS = new Map([['01001', 'Flensburg'], ['01002', 'Kiel'], ['01003', 'Lübeck']]);
const METRICS = TOPIC.colour.metric_options;
const FIRST_METRIC = METRICS[0];
const LAST_METRIC = METRICS[METRICS.length - 1];

/** Minimal element: attributes, listeners, children, focus. */
function fakeElement(tag) {
  const attributes = {};
  const listeners = {};
  const element = {
    tag, attributes, listeners, children: [], textContent: '', hidden: false, value: '', scrollTop: 0,
    setAttribute(name, value) { attributes[name] = String(value); },
    getAttribute: (name) => attributes[name] ?? null,
    addEventListener(name, handler) { listeners[name] = handler; },
    append(...nodes) { element.children.push(...nodes); },
    replaceChildren(...nodes) { element.children = nodes; },
    contains: () => false,
    querySelectorAll: () => [],
    focus() { globalThis.document.activeElement = element; },
  };
  return element;
}

globalThis.document = {
  activeElement: null,
  createElementNS: (_namespace, tag) => fakeElement(tag),
  createTextNode: (value) => ({ textContent: value, attributes: {}, children: [] }),
};

const findAll = (root, predicate) => [root, ...root.children.flatMap((child) => findAll(child, predicate))].filter(predicate);
const textOf = (node) => node.textContent + node.children.map(textOf).join('');

function stateFor(overrides = {}) {
  return {
    rules: RULES, topicId: TOPIC.id, metric: FIRST_METRIC, today: TODAY, manifest: MANIFEST,
    countries: [], selectedIso2: null, selectedAgs: null, result: null, disputed: null,
    districts: { status: 'ready', collection: { features: [] }, authorities: [], byAgs: AUTHORITIES, labels: LABELS },
    ...overrides,
  };
}

function mount(callbackOverrides = {}) {
  const calls = { metric: [], district: [], country: [] };
  const callbacks = {
    onSetMetric: (metric) => calls.metric.push(metric),
    onFindDistrict: (ags) => calls.district.push(ags),
    onSelectCountry: (iso2) => calls.country.push(iso2),
    ...callbackOverrides,
  };
  const root = fakeElement('div');
  const deps = {
    common, engine, isDisputed: () => false,
    modules: { 'authority-metrics': metrics, 'ui-map-districts': districts },
  };
  const view = finder.createFinder(root, callbacks, deps);
  return { root, view, calls };
}

const radios = (root) => findAll(root, (node) => node.attributes.role === 'radio');
const select = (root) => findAll(root, (node) => node.tag === 'select')[0];
const legend = (root) => findAll(root, (node) => node.attributes['aria-label'] === 'Legend')[0];
const live = (root) => findAll(root, (node) => node.attributes.role === 'status')[0];
const attribution = (root) => findAll(root, (node) => node.attributes.class === 'rm-attribution')[0];

test('the metric radiogroup has one radio per option and aria-checked follows the state', () => {
  const { root, view } = mount();
  view.render(stateFor({ metric: LAST_METRIC }));
  const buttons = radios(root);
  assert.equal(buttons.length, METRICS.length);
  assert.equal(buttons.length, 3);
  assert.deepEqual(buttons.map((button) => button.attributes['aria-checked']), METRICS.map((metric) => String(metric === LAST_METRIC)));
  assert.deepEqual(buttons.map((button) => button.attributes.tabindex), METRICS.map((metric) => (metric === LAST_METRIC ? '0' : '-1')));
  assert.deepEqual(buttons.map((button) => button.textContent), METRICS.map((metric) => common.METRIC_LABELS[metric]));
});

test('arrow keys move the radio selection, wrap around and call onSetMetric', () => {
  const { root, view, calls } = mount();
  view.render(stateFor());
  const [first, , last] = radios(root);
  const press = (button, key) => {
    const event = { key, preventDefault() { event.prevented = true; } };
    button.listeners.keydown(event);
    return event;
  };
  assert.equal(press(first, 'ArrowRight').prevented, true);
  assert.equal(press(first, 'ArrowLeft').prevented, true);
  assert.equal(press(last, 'ArrowDown').prevented, true);
  assert.deepEqual(calls.metric, [METRICS[1], LAST_METRIC, FIRST_METRIC]);
  assert.equal(press(first, 'Tab').prevented, undefined);
  assert.equal(calls.metric.length, 3);
  first.listeners.click();
  assert.equal(calls.metric.at(-1), FIRST_METRIC);
});

test('nextMetric ignores keys that are not arrows', () => {
  assert.equal(finder.nextMetric(METRICS, FIRST_METRIC, 'Enter'), null);
  assert.equal(finder.nextMetric(METRICS, LAST_METRIC, 'ArrowRight'), FIRST_METRIC);
  assert.equal(finder.nextMetric(METRICS, FIRST_METRIC, 'ArrowUp'), LAST_METRIC);
});

test('the district legend lists five buckets, no data and unconfirmed with the shared labels', () => {
  const strings = { bucketLabels: common.BUCKET_LABELS, noData: 'No data', unconfirmed: 'Not verified yet' };
  const items = finder.districtLegendItems(strings, TOPIC.colour.buckets_months);
  assert.equal(items.length, LEGEND_ROWS);
  assert.deepEqual(items.map((item) => item.key), ['bucket-0', 'bucket-1', 'bucket-2', 'bucket-3', 'bucket-4', 'nodata', 'unconfirmed']);
  assert.deepEqual(items.slice(0, BUCKET_LEGEND_ROWS).map((item) => item.label), [...common.BUCKET_LABELS]);
  const { root, view } = mount();
  view.render(stateFor());
  assert.equal(legend(root).hidden, false);
  assert.equal(legend(root).children.length, LEGEND_ROWS);
});

test('the finder lists every district with its state and selecting one calls onFindDistrict', () => {
  const { root, view, calls } = mount();
  view.render(stateFor());
  const options = select(root).children;
  assert.equal(options.length, LABELS.size + 1);
  const texts = options.slice(1).map((option) => option.textContent);
  assert.deepEqual(texts, [
    `Flensburg: ${common.BUCKET_LABELS[1]}`,
    `Kiel: ${common.BUCKET_LABELS[0]}, unconfirmed`,
    'Lübeck: no data',
  ]);
  select(root).value = '01002';
  select(root).listeners.change();
  assert.deepEqual(calls.district, ['01002']);
  assert.deepEqual(calls.country, []);
});

test('the district finder follows the selection and the metric', () => {
  const { root, view } = mount();
  view.render(stateFor({ selectedAgs: '01003' }));
  assert.equal(select(root).value, '01003');
  view.render(stateFor({ metric: LAST_METRIC }));
  assert.equal(select(root).children[1].textContent, 'Flensburg: no data');
  assert.equal(select(root).value, '');
});

test('the label says "Find a district" only in authority mode', () => {
  const { root, view } = mount();
  const label = () => textOf(findAll(root, (node) => node.attributes.for === 'rm-finder-select')[0].children[0]);
  view.render(stateFor());
  assert.equal(label(), FIND_DISTRICT);
  view.render(stateFor({ topicId: null, districts: { collection: null, byAgs: {}, labels: new Map() } }));
  assert.equal(label(), FIND_COUNTRY);
  assert.equal(radios(root).every((button) => button.attributes['aria-checked'] !== undefined), true);
  assert.equal(findAll(root, (node) => node.attributes.role === 'radiogroup')[0].hidden, true);
});

test('the live region announces the number of districts with data and only when it changes', () => {
  const { root, view } = mount();
  view.render(stateFor());
  assert.equal(live(root).textContent, '2 districts with data');
  view.render(stateFor({ metric: METRICS[2] }));
  assert.equal(live(root).textContent, '0 districts with data');
});

test('attributionText credits BKG from the manifest only while the district layer is shown', () => {
  const shown = finder.attributionText(MANIFEST, true);
  assert.ok(shown.includes(BKG_CREDIT), shown);
  assert.ok(shown.includes(NATURAL_EARTH) && shown.includes(GEONAMES));
  const hidden = finder.attributionText(MANIFEST, false);
  assert.ok(!hidden.includes('BKG') && !hidden.includes(SIMPLIFIED));
  assert.ok(hidden.includes(NATURAL_EARTH) && hidden.includes(GEONAMES));
  assert.equal(finder.attributionText(null, true), hidden);
  assert.equal(finder.attributionText({ layers: {} }, true), hidden);
});

test('the attribution is drawn from the manifest, not from literals in the module', () => {
  const custom = { layers: { [finder.DISTRICT_LAYER_KEY]: { attribution: 'Test credit', licence: 'test-licence', modified: 'Test note.' } } };
  assert.ok(finder.attributionText(custom, true).includes('Districts: Test credit · Test note.'));
  assert.ok(!readFileSync(join(PUBLIC_DIR, 'ui-finder.js'), 'utf8').includes('GeoBasis'));
  const { root, view } = mount();
  view.render(stateFor());
  assert.ok(textOf(attribution(root)).includes(BKG_CREDIT));
  view.render(stateFor({ topicId: null, districts: { collection: null, byAgs: {}, labels: new Map() } }));
  assert.ok(!textOf(attribution(root)).includes('BKG'));
});

test('the district credit links BKG, the licence and the Datenquellen PDF, and nothing else', () => {
  const { root, view } = mount();
  view.render(stateFor());
  const links = findAll(attribution(root), (node) => node.tag === 'a');
  assert.deepEqual(links.map((link) => [link.textContent, link.attributes.href]), BKG_LINKS);
  assert.ok(links.every((link) => link.attributes.rel === EXTERNAL_LINK_REL));
  view.render(stateFor({ topicId: null, districts: { collection: null, byAgs: {}, labels: new Map() } }));
  assert.equal(findAll(attribution(root), (node) => node.tag === 'a').length, 0);
});

test('a credit link whose URL is not https stays plain text', () => {
  const layer = { attribution: '© BKG (2026) lic', licence: 'lic', provider_url: 'javascript:alert(1)', licence_url: 'http://insecure.example', modified: 'n' };
  const parts = finder.attributionParts({ layers: { [finder.DISTRICT_LAYER_KEY]: layer } }, true);
  assert.ok(parts.every((part) => part.href === undefined));
});

// Regression: stored answers make the result complete before the district layer has loaded.
test('an authority topic with a complete result renders without a country legend while districts load', () => {
  const { root, view } = mount();
  const completeResult = { statuses: {}, missing: [] };
  const loadingDistricts = { status: 'loading', collection: null, authorities: [], byAgs: {}, labels: new Map() };
  assert.doesNotThrow(() => view.render(stateFor({ result: completeResult, districts: loadingDistricts })));
  assert.equal(legend(root).hidden, true);
  assert.equal(legend(root).children.length, 0);
});
