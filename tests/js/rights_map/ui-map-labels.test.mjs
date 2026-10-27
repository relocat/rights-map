// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Unit tests for the city label collision helper (pure: screen rectangles in, visible ids out).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODULE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'web', 'static', 'public', 'rights_map', 'ui-map-labels.js',
);
const { placeLabels, LABEL_PADDING_PX, MAJOR_CITY_POPULATION } = await import(pathToFileURL(MODULE_PATH).href);

const LABEL_WIDTH = 60;
const LABEL_HEIGHT = 12;
const FAR_APART = 500;
const SMALL_CITY = 100000;
const BIG_CITY = 600000;
const MILLION_CITY = MAJOR_CITY_POPULATION;
const HALF_LABEL_WIDTH = LABEL_WIDTH / 2;

const rectangleAt = (left, top) => ({ left, top, right: left + LABEL_WIDTH, bottom: top + LABEL_HEIGHT });
/** measure() backed by a lookup of id -> rectangle; unknown ids have no box. */
const measureFrom = (rectangles) => (candidate) => rectangles[candidate.id] ?? null;

test('two overlapping labels: the larger city keeps its label', () => {
  const candidates = [{ id: 'small', population: SMALL_CITY }, { id: 'big', population: BIG_CITY }];
  const measure = measureFrom({ small: rectangleAt(0, 0), big: rectangleAt(HALF_LABEL_WIDTH, 0) });
  assert.deepEqual([...placeLabels(candidates, measure)], ['big']);
});

test('non-overlapping labels are all kept', () => {
  const candidates = [{ id: 'a', population: SMALL_CITY }, { id: 'b', population: BIG_CITY }];
  const measure = measureFrom({ a: rectangleAt(0, 0), b: rectangleAt(FAR_APART, 0) });
  assert.deepEqual([...placeLabels(candidates, measure)].sort(), ['a', 'b']);
});

test('a capital beats a larger city', () => {
  const candidates = [{ id: 'city', population: BIG_CITY }, { id: 'capital', isCapital: true, population: SMALL_CITY }];
  const measure = measureFrom({ city: rectangleAt(0, 0), capital: rectangleAt(HALF_LABEL_WIDTH, 0) });
  assert.deepEqual([...placeLabels(candidates, measure)], ['capital']);
});

test('a pinned label beats a capital', () => {
  const candidates = [{ id: 'capital', isCapital: true, population: BIG_CITY }, { id: 'pinned', isPinned: true }];
  const measure = measureFrom({ capital: rectangleAt(0, 0), pinned: rectangleAt(HALF_LABEL_WIDTH, 0) });
  assert.deepEqual([...placeLabels(candidates, measure)], ['pinned']);
});

test('labels closer than the padding collide even without touching', () => {
  const candidates = [{ id: 'first', population: BIG_CITY }, { id: 'second', population: SMALL_CITY }];
  const measure = measureFrom({ first: rectangleAt(0, 0), second: rectangleAt(LABEL_WIDTH + LABEL_PADDING_PX - 1, 0) });
  assert.deepEqual([...placeLabels(candidates, measure)], ['first']);
  const apart = measureFrom({ first: rectangleAt(0, 0), second: rectangleAt(LABEL_WIDTH + LABEL_PADDING_PX, 0) });
  assert.equal(placeLabels(candidates, apart).size, 2);
});

test('a label without a box is skipped and blocks nothing', () => {
  const candidates = [{ id: 'hidden', isCapital: true }, { id: 'shown', population: SMALL_CITY }];
  assert.deepEqual([...placeLabels(candidates, measureFrom({ shown: rectangleAt(0, 0) }))], ['shown']);
});

test('a skipped label does not block a lower-priority one', () => {
  const candidates = [
    { id: 'first', population: BIG_CITY }, { id: 'skipped', population: SMALL_CITY }, { id: 'third', population: 1 },
  ];
  const measure = measureFrom({
    first: rectangleAt(0, 0), skipped: rectangleAt(HALF_LABEL_WIDTH, 0), third: rectangleAt(LABEL_WIDTH * 2, 0),
  });
  assert.deepEqual([...placeLabels(candidates, measure)].sort(), ['first', 'third']);
});

test('a city of a million or more beats a smaller capital and a smaller city', () => {
  const smallCapital = { id: 'small-capital', isCapital: true, population: SMALL_CITY };
  const million = { id: 'million-city', population: MILLION_CITY };
  const crowded = measureFrom({ 'small-capital': rectangleAt(0, 0), 'million-city': rectangleAt(HALF_LABEL_WIDTH, 0) });
  assert.deepEqual([...placeLabels([smallCapital, million], crowded)], ['million-city']);
  const withSmall = [{ id: 'small', population: BIG_CITY }, million];
  const crowdedSmall = measureFrom({ small: rectangleAt(0, 0), 'million-city': rectangleAt(HALF_LABEL_WIDTH, 0) });
  assert.deepEqual([...placeLabels(withSmall, crowdedSmall)], ['million-city']);
});

test('inside the major group the larger city wins, capital or not', () => {
  const candidates = [
    { id: 'million-city', population: MILLION_CITY }, { id: 'big-capital', isCapital: true, population: MILLION_CITY * 3 },
  ];
  const measure = measureFrom({ 'million-city': rectangleAt(0, 0), 'big-capital': rectangleAt(HALF_LABEL_WIDTH, 0) });
  assert.deepEqual([...placeLabels(candidates, measure)], ['big-capital']);
});
