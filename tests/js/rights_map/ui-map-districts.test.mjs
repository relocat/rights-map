// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Unit tests for the district layer: path construction, paint classes, accessible names,
// selection and the inert-country mode. Elements are small fakes; no DOM is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RIGHTS_MAP_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'web', 'static', 'public', 'rights_map',
);
const load = (name) => import(pathToFileURL(join(RIGHTS_MAP_DIRECTORY, name)).href);
const D = await load('ui-map-districts.js');
const metrics = await load('authority-metrics.js');
const { BUCKET_LABELS } = await load('ui-common.js');

const STRINGS = { bucketLabels: BUCKET_LABELS, noData: 'no data', unconfirmed: 'unconfirmed' };
const BUCKETS_MONTHS = [6, 12, 24, 36];
const TODAY = '2026-10';
const MONTHS_PER_YEAR = 12;
const TODAY_MONTH_NUMBER = 2026 * MONTHS_PER_YEAR + 9;
const DISTRICT_AGS = ['01001', '01002', '01003'];
const CONFIRMED_BUCKET_ONE = { src: 'official', lo: 7, hi: 12, date: '2026-09' };
const UNCONFIRMED_BUCKET_ZERO = { src: 'estimate', lo: 3 };
const SQUARE = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 3], [0, 3], [0, 0]]] };
const SQUARE_BBOX = [0, 0, 2, 3];

/** Minimal element: attributes, class list, listeners and children. */
function fakeElement(tag, options = {}) {
  const attributes = { ...(options.attrs ?? {}) };
  const classes = new Set(options.cls ? options.cls.split(' ') : []);
  const listeners = {};
  return {
    tag, attributes, listeners, classes, children: [],
    classList: {
      toggle: (name, force) => { if (force) classes.add(name); else classes.delete(name); },
    },
    setAttribute(name, value) {
      attributes[name] = String(value);
      if (name === 'class') {
        classes.clear();
        String(value).split(' ').forEach((name_) => classes.add(name_));
      }
    },
    removeAttribute(name) { delete attributes[name]; },
    getAttribute: (name) => attributes[name] ?? null,
    addEventListener(type, handler) { listeners[type] = handler; },
    replaceChildren(...nodes) { this.children = nodes; },
  };
}
const fakeCommon = {
  s: (tag, options = {}, children = []) => Object.assign(fakeElement(tag, options), { children }),
  BUCKET_LABELS,
};

const collection = {
  features: DISTRICT_AGS.map((ags) => ({ properties: { ags, name: `District ${ags}` }, geometry: SQUARE })),
};
const labels = new Map(DISTRICT_AGS.map((ags) => [ags, `Label ${ags}`]));
const topic = { id: 'naturalisation', country: 'DE', colour: { buckets_months: BUCKETS_MONTHS } };

function makeLayer({ isSelectable = () => true, onSelect = () => {}, experiencesEnabled = false } = {}) {
  const group = fakeElement('g');
  const layer = D.createDistrictLayer(group, {
    common: fakeCommon,
    geo: { geometryToPath: () => 'M0 0Z' },
    engine: { findTopic: () => topic, monthIndex: () => TODAY_MONTH_NUMBER },
    metrics,
    geometryBbox: () => SQUARE_BBOX,
    onSelect,
    isSelectable,
    experiencesEnabled,
  });
  layer.build(collection, labels);
  return { group, layer };
}

const stateWith = (byAgs, extra = {}) => ({
  rules: {}, topicId: topic.id, today: TODAY, metric: 'total', selectedAgs: null, districts: { byAgs }, ...extra,
});
const authorityWith = (value) => ({ times: { total: value } });

test('districtAriaLabel covers bucket confirmed, bucket unconfirmed and no data', () => {
  assert.equal(D.districtAriaLabel('Leipzig', { bucket: 1, isConfirmed: true }, STRINGS), `Leipzig: ${BUCKET_LABELS[1]}`);
  assert.equal(D.districtAriaLabel('Leipzig', { bucket: 1, isConfirmed: false }, STRINGS),
    `Leipzig: ${BUCKET_LABELS[1]}, unconfirmed`);
  assert.equal(D.districtAriaLabel('Leipzig', { bucket: null, isConfirmed: false }, STRINGS), 'Leipzig: no data');
});

test('build makes one focusable button path per feature, in input order, with a title', () => {
  const { group } = makeLayer();
  assert.equal(group.children.length, DISTRICT_AGS.length);
  for (const path of group.children) {
    assert.equal(path.getAttribute('role'), 'button');
    assert.equal(path.getAttribute('tabindex'), '0');
    assert.equal(path.getAttribute('d'), 'M0 0Z');
    assert.equal(path.children[0].tag, 'title');
  }
});

test('build is repeatable: a second build replaces the paths instead of adding to them', () => {
  const { group, layer } = makeLayer();
  layer.build(collection, labels);
  assert.equal(group.children.length, DISTRICT_AGS.length);
});

test('paint sets exactly one of bucket or no-data class, plus unconfirmed where needed', () => {
  const { group, layer } = makeLayer();
  layer.paint(stateWith({
    '01001': authorityWith(CONFIRMED_BUCKET_ONE),
    '01002': authorityWith(UNCONFIRMED_BUCKET_ZERO),
  }));
  const [confirmed, unconfirmed, missing] = group.children;
  assert.ok(confirmed.classes.has('rm-bucket-1') && !confirmed.classes.has('rm-unconfirmed'));
  assert.ok(unconfirmed.classes.has('rm-bucket-0') && unconfirmed.classes.has('rm-unconfirmed'));
  assert.ok(missing.classes.has('rm-nodata') && !missing.classes.has('rm-unconfirmed'));
  for (const path of group.children) {
    const kinds = [...path.classes].filter((name) => name.startsWith('rm-bucket-') || name === 'rm-nodata');
    assert.equal(kinds.length, 1);
  }
  assert.equal(missing.getAttribute('aria-label'), 'Label 01003: no data');
  assert.equal(unconfirmed.getAttribute('aria-label'), `Label 01002: ${BUCKET_LABELS[0]}, unconfirmed`);
});

test('paint marks only the selected district and repainting replaces old classes', () => {
  const { group, layer } = makeLayer();
  layer.paint(stateWith({ '01001': authorityWith(CONFIRMED_BUCKET_ONE) }, { selectedAgs: '01002' }));
  assert.ok(group.children[1].classes.has('rm-selected'));
  layer.paint(stateWith({}, { selectedAgs: null }));
  assert.ok(group.children.every((path) => !path.classes.has('rm-selected') && !path.classes.has('rm-bucket-1')));
});

test('setActive(false) removes tab stops and hides the group; true restores them', () => {
  const { group, layer } = makeLayer();
  layer.setActive(false);
  assert.ok(group.classes.has('rm-districts-inactive'));
  assert.ok(group.children.every((path) => path.getAttribute('tabindex') === null));
  layer.setActive(true);
  assert.ok(!group.classes.has('rm-districts-inactive'));
  assert.ok(group.children.every((path) => path.getAttribute('tabindex') === '0'));
});

test('click selects unless the pointer was dragging; Enter and Space select, other keys do not', () => {
  const selected = [];
  let isDragging = false;
  const { group } = makeLayer({ isSelectable: () => !isDragging, onSelect: (ags) => selected.push(ags) });
  const [path] = group.children;
  path.listeners.click();
  isDragging = true;
  path.listeners.click();
  assert.deepEqual(selected, ['01001']);
  let preventedCount = 0;
  const press = (key) => path.listeners.keydown({ key, preventDefault: () => { preventedCount += 1; } });
  press('Enter');
  press(' ');
  press('a');
  assert.deepEqual(selected, ['01001', '01001', '01001']);
  assert.equal(preventedCount, 2);
});

test('boundsOf and element answer for known AGS and null for unknown', () => {
  const { group, layer } = makeLayer();
  assert.deepEqual(layer.boundsOf('01002'), SQUARE_BBOX);
  assert.equal(layer.element('01002'), group.children[1]);
  assert.equal(layer.boundsOf('99999'), null);
  assert.equal(layer.element('99999'), null);
});

const VIEW = Object.freeze({ x: 0, y: 0, width: 100, height: 50 });
const AREA = Object.freeze({ left: 0, top: 0, right: 200, bottom: 100 });
const SIZE = Object.freeze({ width: 200, height: 100 });
const FAR_BOX = Object.freeze({ x: 500, y: 10, width: 10, height: 5 });

test('panToReveal leaves a district that overlaps the visible area alone', () => {
  assert.equal(D.panToReveal(VIEW, AREA, SIZE, { x: 90, y: 10, width: 30, height: 5 }), null);
});

test('panToReveal moves only the translation for a district outside the view', () => {
  const next = D.panToReveal(VIEW, AREA, SIZE, { x: 150, y: 10, width: 10, height: 5 });
  assert.equal(next.width, VIEW.width);
  assert.equal(next.height, VIEW.height);
  assert.equal(next.x, 60);
  assert.equal(next.y, VIEW.y);
  assert.equal(D.panToReveal(VIEW, AREA, SIZE, { x: -40, y: -30, width: 10, height: 5 }).x, -40);
});

test('panToReveal respects the area the cards leave free', () => {
  const narrow = { left: 0, top: 0, right: 100, bottom: 100 };
  assert.equal(D.panToReveal(VIEW, narrow, SIZE, { x: 60, y: 10, width: 10, height: 5 }).x, 20);
});

test('revealFoundDistrict pans once per find and never without one', () => {
  const originalRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => callback();
  try {
    const pans = [];
    const ctx = { view: VIEW, revealedAgs: null, districtLayer: { boundsOf: () => [0, 0, 1, 1] } };
    const readFrame = () => ({ area: AREA, size: SIZE, box: FAR_BOX });
    const panTo = (next) => pans.push(next);
    D.revealFoundDistrict(ctx, { revealAgs: null }, panTo, readFrame);
    assert.equal(pans.length, 0);
    D.revealFoundDistrict(ctx, { revealAgs: '05315' }, panTo, readFrame);
    D.revealFoundDistrict(ctx, { revealAgs: '05315' }, panTo, readFrame);
    assert.equal(pans.length, 1);
    assert.equal(pans[0].width, VIEW.width);
  } finally {
    globalThis.requestAnimationFrame = originalRaf;
  }
});

function fakeCountries() {
  const make = (covered, isMicro) => ({
    covered,
    path: fakeElement('path', {
      attrs: covered ? { role: 'button', ...(isMicro ? {} : { tabindex: '0' }), 'aria-label': 'label' } : {},
    }),
    ring: isMicro ? fakeElement('circle', { attrs: { role: 'button', tabindex: '0', 'aria-label': 'label' } }) : null,
    ringMark: isMicro ? fakeElement('circle') : null,
  });
  return new Map([['DE', make(true, false)], ['FR', make(true, false)], ['MT', make(true, true)], ['XK', make(false, false)]]);
}

test('setCountryContext strips focus targets, hides the host and restores them afterwards', () => {
  const countries = fakeCountries();
  D.setCountryContext(countries, 'DE');
  const france = countries.get('FR').path;
  assert.ok(france.classes.has('rm-country-context') && !france.classes.has('rm-country-host'));
  assert.ok(countries.get('DE').path.classes.has('rm-country-host'));
  for (const name of ['role', 'tabindex', 'aria-label']) assert.equal(france.getAttribute(name), null);
  assert.equal(countries.get('MT').ring.getAttribute('tabindex'), null);
  assert.equal(countries.get('XK').path.classes.has('rm-country-context'), false);
  D.setCountryContext(countries, null);
  assert.equal(france.getAttribute('role'), 'button');
  assert.equal(france.getAttribute('tabindex'), '0');
  assert.ok(!france.classes.has('rm-country-context'));
  assert.ok(!countries.get('DE').path.classes.has('rm-country-host'));
  assert.equal(countries.get('MT').path.getAttribute('tabindex'), null);
  assert.equal(countries.get('MT').ring.getAttribute('tabindex'), '0');
  assert.equal(countries.get('XK').path.getAttribute('role'), null);
});

test('syncDistrictMode follows the topic, resets the user view and relayouts once per change', () => {
  const topics = { naturalisation: topic, other: { id: 'other', country: null } };
  const { layer } = makeLayer();
  const ctx = {
    districtHost: null, hasUserView: true, countries: fakeCountries(), districtLayer: layer,
    deps: {
      engine: {
        findTopic: (_rules, id) => topics[id],
        isAuthorityTopic: (candidate) => candidate.id === 'naturalisation',
      },
    },
  };
  let layoutCount = 0;
  const relayout = () => { layoutCount += 1; };
  D.syncDistrictMode(ctx, { rules: {}, topicId: 'naturalisation' }, relayout);
  assert.equal(ctx.districtHost, 'DE');
  assert.equal(ctx.hasUserView, false);
  D.syncDistrictMode(ctx, { rules: {}, topicId: 'naturalisation' }, relayout);
  assert.equal(layoutCount, 1);
  D.syncDistrictMode(ctx, { rules: {}, topicId: null }, relayout);
  assert.equal(ctx.districtHost, null);
  assert.equal(layoutCount, 2);
});

test('paint adds the share-your-experience invitation to the tooltip of no-data districts only, and only when experiences are on', () => {
  const byAgs = { '01001': authorityWith(CONFIRMED_BUCKET_ONE), '01002': authorityWith({ src: 'none' }), '01003': authorityWith(undefined) };
  const tooltips = (isEnabled) => {
    const { group, layer } = makeLayer({ experiencesEnabled: isEnabled });
    layer.paint(stateWith(byAgs));
    return group.children.map((path) => path.children[0].textContent);
  };
  assert.deepEqual(tooltips(true), ['Label 01001', 'Label 01002 · Share your experience', 'Label 01003 · Share your experience']);
  assert.deepEqual(tooltips(false), ['Label 01001', 'Label 01002', 'Label 01003']);
});
