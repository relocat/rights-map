// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Unit tests for the pure helpers exported by the Rights Map UI modules. They run in
// node without a DOM: every function under test takes its dependencies as arguments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODULE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'web', 'static', 'public', 'rights_map',
);
const load = (name) => import(pathToFileURL(join(MODULE_DIR, name)).href);
const common = await load('ui-common.js');
const engine = await load('engine.js');
const geo = await load('geo-render.js');
const detail = await load('ui-detail.js');
const finder = await load('ui-finder.js');
const map = await load('ui-map.js');
const mapDetail = await load('ui-map-detail.js');
const profile = await load('ui-wizard-profile.js');
const app = await load('map-app.js');
const rules = JSON.parse(readFileSync(join(MODULE_DIR, 'data', 'rules.v1.json'), 'utf8'));

const TODAY = '2026-10';
const TP_TOPIC = 'ua-tp';
const TP_FACTS = { nat: 'UA', ua_military_obligation: 'yes', ua_holds_tp: 'no', ua_exit_proof: 'no' };
const deps = { common, engine, geo };

test('formatMonthYear formats YYYY-MM and leaves anything else untouched', () => {
  assert.equal(common.formatMonthYear('2027-06'), 'Jun 2027');
  assert.equal(common.formatMonthYear('2026-12'), 'Dec 2026');
  assert.equal(common.formatMonthYear('2027-13'), '2027-13');
  assert.equal(common.formatMonthYear('soon'), 'soon');
});

test('isSafeLink accepts only https URLs', () => {
  assert.equal(common.isSafeLink('https://eur-lex.europa.eu/x'), true);
  for (const bad of ['http://example.org', 'javascript:alert(1)', 'data:text/html,x', 'not a url', '']) {
    assert.equal(common.isSafeLink(bad), false, bad);
  }
});

test('sortByName sorts a copy alphabetically', () => {
  const input = [{ iso2: 'SE', name: 'Sweden' }, { iso2: 'AT', name: 'Austria' }];
  assert.deepEqual(common.sortByName(input).map((c) => c.iso2), ['AT', 'SE']);
  assert.equal(input[0].iso2, 'SE');
});

test('statusClass maps a status, and a missing status to the neutral class', () => {
  assert.equal(common.statusClass('ok'), 'rm-status-ok');
  assert.equal(common.statusClass(undefined), 'rm-status-neutral');
});

test('fillCheckText fills known fact placeholders as Mon YYYY and keeps unknown ones', () => {
  const text = 'Expires {passport_until}, then {other}.';
  assert.equal(
    detail.fillCheckText(deps, text, { passport_until: '2027-06' }),
    'Expires Jun 2027, then {other}.',
  );
});

test('describeSelection: no topic, missing answers, and a coloured country', () => {
  const noTopic = detail.describeSelection(deps, { rules, topicId: null, result: null, selectedIso2: 'HU' });
  assert.equal(noTopic.label, 'No topic chosen');
  const missingResult = engine.evaluate(rules, TP_TOPIC, {}, TODAY);
  const missing = detail.describeSelection(deps, { rules, topicId: TP_TOPIC, result: missingResult, selectedIso2: 'HU' });
  assert.match(missing.reason, /^Answer \d+ questions? to colour the map\.$/);
  const result = engine.evaluate(rules, TP_TOPIC, TP_FACTS, TODAY);
  const coloured = detail.describeSelection(deps, { rules, topicId: TP_TOPIC, result, selectedIso2: 'HU' });
  assert.equal(coloured.status, 'ok');
  assert.equal(coloured.label, 'Protection available');
});

test('countStatuses and legendItems keep ok visible and follow the legend order', () => {
  const result = engine.evaluate(rules, TP_TOPIC, TP_FACTS, TODAY);
  const counts = finder.countStatuses(result.statuses);
  assert.equal(counts.ok, 1);
  assert.equal(counts.origin, 1);
  const topic = engine.findTopic(rules, TP_TOPIC);
  const items = finder.legendItems(deps, topic, counts);
  assert.deepEqual(items.map((item) => item.status), ['ok', 'restricted', 'unknown', 'origin']);
  assert.equal(items[0].label, 'Protection available');
  const empty = finder.legendItems(deps, topic, {});
  assert.deepEqual(empty, [{ status: 'ok', label: 'Protection available', count: 0 }]);
  assert.equal(finder.announcement(deps, topic, counts), 'Map updated: 1 Protection available');
});

test('isColoured needs a result with no missing answers', () => {
  assert.equal(finder.isColoured({ result: null }), false);
  assert.equal(finder.isColoured({ result: { missing: ['nat'] } }), false);
  assert.equal(finder.isColoured({ result: { missing: [] } }), true);
});

test('geometryBbox covers Polygon and MultiPolygon coordinates', () => {
  assert.deepEqual(map.geometryBbox({ coordinates: [[[0, 1], [4, 1], [4, 6], [0, 1]]] }), [0, 1, 4, 6]);
  const multi = { coordinates: [[[[-3, 2], [1, 2], [1, 5]]], [[[10, -4], [12, -4], [12, 0]]]] };
  assert.deepEqual(map.geometryBbox(multi), [-3, -4, 12, 5]);
});

test('unionBox contains both boxes', () => {
  const union = map.unionBox({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: -5, width: 20, height: 8 });
  assert.deepEqual(union, { x: 0, y: -5, width: 25, height: 15 });
});

test('viewBoxForArea centres the bbox in the area and fits it entirely', () => {
  const area = { left: 100, top: 50, right: 500, bottom: 350 };
  const size = { width: 800, height: 600 };
  const view = map.viewBoxForArea(deps, geo.EUROPE_VIEW_BBOX, area, size);
  const unitsPerPixel = view.width / size.width;
  const box = geo.bboxToViewBox(geo.EUROPE_VIEW_BBOX);
  const toPixel = (x, y) => [(x - view.x) / unitsPerPixel, (y - view.y) / unitsPerPixel];
  const [left, top] = toPixel(box.x, box.y);
  const [right, bottom] = toPixel(box.x + box.width, box.y + box.height);
  const tolerance = 1e-6;
  assert.ok(left >= area.left - tolerance && right <= area.right + tolerance);
  assert.ok(top >= area.top - tolerance && bottom <= area.bottom + tolerance);
  assert.ok(Math.abs((left + right) / 2 - (area.left + area.right) / 2) < tolerance);
  assert.ok(Math.abs((top + bottom) / 2 - (area.top + area.bottom) / 2) < tolerance);
  assert.ok(Math.abs(view.height / view.width - size.height / size.width) < tolerance);
});

test('limitZoomIn in district mode allows Kreis-level zoom that Europe mode refuses', () => {
  const homeView = { x: 0, y: 0, width: 1000, height: 500 };
  const kreisView = { x: 100, y: 100, width: 60, height: 30 };
  const europeCtx = { initialView: homeView, deps };
  const districtCtx = { initialView: homeView, homeView, districtHost: 'DE', deps };
  assert.ok(map.limitZoomIn(europeCtx, kreisView).width > kreisView.width);
  assert.equal(map.limitZoomIn(districtCtx, kreisView), kreisView);
  const tooNarrow = map.limitZoomIn(districtCtx, { x: 100, y: 100, width: 10, height: 5 });
  assert.ok(Math.abs(tooNarrow.width / homeView.width - geo.DISTRICT_MIN_ZOOM_FRACTION) < 1e-9);
});

test('limitZoomIn widens a view that is narrower than the zoom-in cap and keeps its centre', () => {
  const ctx = { initialView: { x: 0, y: 0, width: 1000, height: 500 }, deps };
  const wide = { x: 0, y: 0, width: 400, height: 200 };
  assert.equal(map.limitZoomIn(ctx, wide), wide);
  const narrow = map.limitZoomIn(ctx, { x: 100, y: 100, width: 10, height: 5 });
  assert.ok(narrow.width > 10 && narrow.width <= 1000);
  assert.ok(Math.abs(narrow.x + narrow.width / 2 - 105) < 1e-9);
  assert.ok(narrow.width / 1000 >= 0.05 && narrow.width / 1000 < geo.FINE_ZOOM_RATIO);
});

test('boxesIntersect is true for overlap and touching edges, false for a gap', () => {
  const view = { x: 0, y: 0, width: 10, height: 10 };
  assert.equal(mapDetail.boxesIntersect(view, { x: 5, y: 5, width: 2, height: 2 }), true);
  assert.equal(mapDetail.boxesIntersect(view, { x: 10, y: 0, width: 5, height: 5 }), true);
  assert.equal(mapDetail.boxesIntersect(view, { x: 10.1, y: 0, width: 5, height: 5 }), false);
});

test('editableProfileFacts lists profile facts of supported topics only', () => {
  const ids = profile.editableProfileFacts(deps, rules).map(({ fact }) => fact.id);
  assert.deepEqual(ids.sort(), ['apostille', 'de_residence_since', 'degree', 'german', 'nat', 'passport']);
  const nat = profile.editableProfileFacts(deps, rules).find(({ fact }) => fact.id === 'nat');
  assert.deepEqual(nat.topics.map((topic) => topic.id), [TP_TOPIC]);
});

test('chipText shows answered facts with the passport month, and null when unanswered', () => {
  const passport = rules.facts.find((fact) => fact.id === 'passport');
  const state = { facts: { passport: 'valid', passport_until: '2027-06' } };
  assert.equal(profile.chipText(deps, passport, state), 'Passport: Valid until Jun 2027');
  assert.equal(profile.chipText(deps, passport, { facts: {} }), null);
});

test('formatMonth pads the month', () => {
  assert.equal(app.formatMonth(new Date(2026, 0, 15)), '2026-01');
  assert.equal(app.formatMonth(new Date(2026, 9, 1)), '2026-10');
});

test('buildCountryNames prefers geo names and falls back to region names', () => {
  const fallback = app.buildCountryNames(rules, null);
  assert.equal(fallback.HU, 'Hungary');
  assert.equal(Object.keys(fallback).length, rules.groups.COVERED.length);
  const geoData = { countries: { features: [{ properties: { iso2: 'HU', name: 'Magyar', covered: true } }] } };
  assert.equal(app.buildCountryNames(rules, geoData).HU, 'Magyar');
});

test('shouldCloseOnEscape ignores handled keys and form controls', () => {
  const state = { selectedIso2: 'HU' };
  const press = (overrides) => ({ key: 'Escape', defaultPrevented: false, target: { tagName: 'BODY' }, ...overrides });
  assert.equal(app.shouldCloseOnEscape(press({}), state), true);
  assert.equal(app.shouldCloseOnEscape(press({ defaultPrevented: true }), state), false);
  assert.equal(app.shouldCloseOnEscape(press({ target: { tagName: 'SELECT' } }), state), false);
  assert.equal(app.shouldCloseOnEscape(press({ target: { tagName: 'INPUT' } }), state), false);
  assert.equal(app.shouldCloseOnEscape(press({ key: 'Enter' }), state), false);
  assert.equal(app.shouldCloseOnEscape(press({}), { selectedIso2: null }), false);
});

const factControls = await load('ui-fact-controls.js');

test('parseMonthInput accepts MM/YYYY, M/YYYY and YYYY-MM and stores YYYY-MM', () => {
  assert.equal(factControls.parseMonthInput('03/2028'), '2028-03');
  assert.equal(factControls.parseMonthInput('3/2028'), '2028-03');
  assert.equal(factControls.parseMonthInput('2028-03'), '2028-03');
  assert.equal(factControls.parseMonthInput('  12/2027 '), '2027-12');
});

test('parseMonthInput rejects month 13, month 0 and garbage', () => {
  const rejected = ['13/2028', '00/2028', '2028-13', '2028-00', '2028-3', '03-2028', '03/28', 'march 2028', '', '03/2028x', '1/2/2028'];
  for (const text of rejected) assert.equal(factControls.parseMonthInput(text), null, text);
});

test('formatMonthYearInput only inserts the slash and caps the length; it never corrects digits', () => {
  const cases = { '0': '0', '03': '03/', '3': '3', '9': '9', '1': '1', '1/': '1', '12': '12/', '55': '55/', '552025': '55/2025', '032': '03/2', '032028': '03/2028', '0320289': '03/2028', ab03: '03/', '': '', '03/2028': '03/2028', '00': '00/', '99/9999': '99/9999' };
  for (const [typed, shown] of Object.entries(cases)) assert.equal(factControls.formatMonthYearInput(typed), shown, JSON.stringify(typed));
});

test('formatMonthYearInput keeps pasted complete months parseable', () => {
  assert.equal(factControls.formatMonthYearInput('2028-03'), '03/2028');
  assert.equal(factControls.formatMonthYearInput('3/2028'), '03/2028');
});

test('formatMonthForInput shows a stored month as MM/YYYY and round-trips', () => {
  assert.equal(factControls.formatMonthForInput('2028-03'), '03/2028');
  assert.equal(factControls.formatMonthForInput(undefined), '');
  assert.equal(factControls.formatMonthForInput('garbage'), '');
  for (const stored of ['2027-01', '2027-12', '2030-06']) {
    assert.equal(factControls.parseMonthInput(factControls.formatMonthForInput(stored)), stored);
  }
});
