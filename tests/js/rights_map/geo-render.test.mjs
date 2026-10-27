// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Unit tests for the Web Mercator SVG geo renderer primitives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODULE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'web', 'static', 'public', 'rights_map', 'geo-render.js',
);
const R = await import(pathToFileURL(MODULE_PATH).href);

const EPSILON = 1e-6;
const PROJECTION_TOLERANCE = 1e-9;
const HALF_WORLD = 512;
const FULL_WORLD = 1024;
const OVER_LIMIT_LATITUDE = 89.9;
const UNIT_SQUARE_RING = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
const LIMITS = { x: 0, y: 0, width: 1000, height: 600 };
const INITIAL = { x: 100, y: 100, width: 400, height: 250 };
const WIDE_ASPECT = 2;
const TALL_ASPECT = 0.5;
const ZOOM_IN = 0.5;
const ANCHOR = [200, 150];
const SAMPLE_VIEW = { x: 100, y: 100, width: 200, height: 100 };
const ANCHOR_FRACTION_TOLERANCE = 1e-9;

const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < EPSILON, `${message}: ${actual} != ${expected}`);
const countOf = (text, char) => text.split(char).length - 1;

test('projectMercator maps the origin to the world centre', () => {
  const [x, y] = R.projectMercator([0, 0]);
  near(x, HALF_WORLD, 'x');
  near(y, HALF_WORLD, 'y');
});

test('projectMercator maps lon 180 to the right edge', () => {
  near(R.projectMercator([180, 0])[0], FULL_WORLD, 'x');
  near(R.projectMercator([-180, 0])[0], 0, 'x');
});

test('projectMercator y grows downward (north is smaller y)', () => {
  assert.ok(R.projectMercator([0, 50])[1] < R.projectMercator([0, -50])[1]);
});

test('projectMercator clamps latitude above the Web Mercator limit', () => {
  const clamped = R.projectMercator([0, OVER_LIMIT_LATITUDE]);
  const atLimit = R.projectMercator([0, R.MAX_LATITUDE]);
  near(clamped[1], atLimit[1], 'y');
  assert.ok(Number.isFinite(clamped[1]));
  near(atLimit[1], 0, 'limit maps to the top edge');
  near(R.projectMercator([0, -OVER_LIMIT_LATITUDE])[1], FULL_WORLD, 'south limit');
});

test('geometryToPath: unit square polygon has one M, three Ls and Z', () => {
  const path = R.geometryToPath({ type: 'Polygon', coordinates: [UNIT_SQUARE_RING] });
  assert.equal(countOf(path, 'M'), 1);
  assert.equal(countOf(path, 'L'), 3);
  assert.equal(countOf(path, 'Z'), 1);
});

test('geometryToPath: MultiPolygon yields one M per ring', () => {
  const path = R.geometryToPath({
    type: 'MultiPolygon',
    coordinates: [[UNIT_SQUARE_RING], [UNIT_SQUARE_RING]],
  });
  assert.equal(countOf(path, 'M'), 2);
  assert.equal(countOf(path, 'Z'), 2);
});

test('geometryToPath: holes become additional subpaths', () => {
  const path = R.geometryToPath({
    type: 'Polygon',
    coordinates: [UNIT_SQUARE_RING, UNIT_SQUARE_RING],
  });
  assert.equal(countOf(path, 'M'), 2);
});

test('geometryToPath rounds fractional coordinates to two decimals exactly', () => {
  const ring = [[0.123456, 0.5], [1.987654, 0.5], [1.987654, 1.5], [0.123456, 0.5]];
  const path = R.geometryToPath({ type: 'Polygon', coordinates: [ring] });
  assert.equal(path, 'M512.35 510.58L517.65 510.58L517.65 507.73Z');
});

test('geometryToPath skips empty rings', () => {
  const path = R.geometryToPath({ type: 'Polygon', coordinates: [[], UNIT_SQUARE_RING] });
  assert.equal(countOf(path, 'M'), 1);
  assert.equal(R.geometryToPath({ type: 'Polygon', coordinates: [[]] }), '');
});

test('projectMercator matches the closed-form value at latitude 45', () => {
  const expectedY = HALF_WORLD
    - (HALF_WORLD * Math.log(Math.tan((67.5 * Math.PI) / 180))) / Math.PI;
  assert.ok(Math.abs(R.projectMercator([0, 45])[1] - expectedY) < PROJECTION_TOLERANCE);
});

test('geometryToPath rejects unsupported geometry types', () => {
  assert.throws(() => R.geometryToPath({ type: 'Point', coordinates: [0, 0] }), RangeError);
});

test('bboxToViewBox frames the bbox with positive size', () => {
  const view = R.bboxToViewBox(R.EUROPE_VIEW_BBOX);
  assert.ok(view.width > 0 && view.height > 0);
  const [westX, northY] = R.projectMercator([R.EUROPE_VIEW_BBOX[0], R.EUROPE_VIEW_BBOX[3]]);
  near(view.x, westX, 'x');
  near(view.y, northY, 'y');
});

test('fitViewBox preserves the centre and reaches the target aspect', () => {
  for (const aspect of [WIDE_ASPECT, TALL_ASPECT]) {
    const fitted = R.fitViewBox(SAMPLE_VIEW, aspect);
    near(fitted.x + fitted.width / 2, SAMPLE_VIEW.x + SAMPLE_VIEW.width / 2, 'cx');
    near(fitted.y + fitted.height / 2, SAMPLE_VIEW.y + SAMPLE_VIEW.height / 2, 'cy');
    near(fitted.width / fitted.height, aspect, 'aspect');
    assert.ok(fitted.width >= SAMPLE_VIEW.width && fitted.height >= SAMPLE_VIEW.height);
  }
});

test('zoomViewBox keeps the anchor at the same relative position', () => {
  const zoomed = R.zoomViewBox(INITIAL, ZOOM_IN, ANCHOR);
  near(zoomed.width, INITIAL.width * ZOOM_IN, 'width');
  near(zoomed.height, INITIAL.height * ZOOM_IN, 'height');
  const before = [(ANCHOR[0] - INITIAL.x) / INITIAL.width, (ANCHOR[1] - INITIAL.y) / INITIAL.height];
  const after = [(ANCHOR[0] - zoomed.x) / zoomed.width, (ANCHOR[1] - zoomed.y) / zoomed.height];
  assert.ok(Math.abs(before[0] - after[0]) < ANCHOR_FRACTION_TOLERANCE);
  assert.ok(Math.abs(before[1] - after[1]) < ANCHOR_FRACTION_TOLERANCE);
});

test('panViewBox shifts the origin only', () => {
  const panned = R.panViewBox(INITIAL, 10, -5);
  assert.deepEqual(panned, { ...INITIAL, x: INITIAL.x + 10, y: INITIAL.y - 5 });
});

test('clampViewBox enforces the minimum width', () => {
  const tiny = { x: 10, y: 10, width: 0.001, height: 0.0006 };
  const clamped = R.clampViewBox(tiny, LIMITS);
  near(clamped.width, LIMITS.width * R.MIN_VIEW_FRACTION, 'min width');
});

test('clampViewBox never exceeds the limits in size or position', () => {
  const cases = [
    { x: -500, y: -500, width: 300, height: 180 },
    { x: 900, y: 500, width: 300, height: 180 },
    { x: 0, y: 0, width: 5000, height: 3000 },
    { x: 200, y: 100, width: 300, height: 180 },
  ];
  for (const view of cases) {
    const c = R.clampViewBox(view, LIMITS);
    assert.ok(c.width >= LIMITS.width * R.MIN_VIEW_FRACTION - EPSILON);
    assert.ok(c.x >= LIMITS.x - EPSILON && c.y >= LIMITS.y - EPSILON);
    assert.ok(c.x + c.width <= LIMITS.x + LIMITS.width + EPSILON);
    assert.ok(c.y + c.height <= LIMITS.y + LIMITS.height + EPSILON);
  }
});

test('clampViewBox: the minimum-width floor wins over the limits cap', () => {
  const tall = { x: 10, y: 10, width: 10, height: 5000 };
  const clamped = R.clampViewBox(tall, LIMITS);
  near(clamped.width, LIMITS.width * R.MIN_VIEW_FRACTION, 'min width');
  assert.ok(clamped.height > LIMITS.height);
});

test('clampViewBox leaves an in-bounds view unchanged', () => {
  assert.deepEqual(R.clampViewBox(INITIAL, LIMITS), INITIAL);
});

test('detailLevel returns 0/1/2 at widths 1.0/0.3/0.1 of the initial', () => {
  const at = (ratio) => ({ ...INITIAL, width: INITIAL.width * ratio });
  assert.equal(R.detailLevel(at(1.0), INITIAL), 0);
  assert.equal(R.detailLevel(at(0.3), INITIAL), 1);
  assert.equal(R.detailLevel(at(0.1), INITIAL), 2);
});

test('detailLevel thresholds are strict at the exact boundaries', () => {
  const at = (ratio) => ({ ...INITIAL, width: INITIAL.width * ratio });
  assert.equal(R.detailLevel(at(R.DETAIL_ZOOM_RATIO), INITIAL), 0);
  assert.equal(R.detailLevel(at(R.FINE_ZOOM_RATIO), INITIAL), 1);
});

test('viewBoxContains is inclusive of edges and rejects outside points', () => {
  assert.ok(R.viewBoxContains(INITIAL, [INITIAL.x, INITIAL.y]));
  assert.ok(R.viewBoxContains(INITIAL, [INITIAL.x + INITIAL.width, INITIAL.y + INITIAL.height]));
  assert.ok(!R.viewBoxContains(INITIAL, [INITIAL.x - 1, INITIAL.y]));
  assert.ok(!R.viewBoxContains(INITIAL, [INITIAL.x, INITIAL.y + INITIAL.height + 1]));
});

const KREIS_VIEW_WIDTH = 1.5;
const KREIS_MIN_FRACTION = 0.005;
const GERMANY_SIZED_LIMITS = { x: 0, y: 0, width: 300, height: 200 };
const KREIS_VIEW = { x: 500, y: 300, width: KREIS_VIEW_WIDTH, height: KREIS_VIEW_WIDTH / 2 };

test('clampViewBox with a smaller minFraction lets a district-sized view through', () => {
  const clamped = R.clampViewBox(KREIS_VIEW, GERMANY_SIZED_LIMITS, KREIS_MIN_FRACTION);
  near(clamped.width, KREIS_VIEW_WIDTH, 'width');
});

test('clampViewBox with the default fraction still floors a district-sized view', () => {
  const clamped = R.clampViewBox(KREIS_VIEW, LIMITS);
  near(clamped.width, LIMITS.width * R.MIN_VIEW_FRACTION, 'width');
});

test('the district zoom floor is a fraction and the Germany frame is west-south-east-north', () => {
  assert.ok(R.DISTRICT_MIN_ZOOM_FRACTION < 1 && R.DISTRICT_MIN_ZOOM_FRACTION > 0);
  const [west, south, east, north] = R.GERMANY_VIEW_BBOX;
  assert.ok(west < east && south < north);
});
