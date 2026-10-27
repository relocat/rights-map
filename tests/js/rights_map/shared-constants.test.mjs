// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Browser modules cannot import each other (that would lose the ?v= cache buster), so a few
// constants are duplicated on purpose. This test pins every copy to the same value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODULE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'web', 'static', 'public', 'rights_map',
);
const load = (name) => import(pathToFileURL(join(MODULE_DIR, name)).href);
const engine = await load('engine.js');
const store = await load('factset-store.js');
const common = await load('ui-common.js');
const factControls = await load('ui-fact-controls.js');
const app = await load('map-app.js');
const metrics = await load('authority-metrics.js');

test('covered-countries group name is the same in the engine and the entry point', () => {
  assert.equal(app.COVERED_GROUP, engine.COVERED_GROUP);
});

test('enum and bool fact type names agree across store, controls and engine', () => {
  assert.equal(factControls.TYPE_ENUM, store.TYPE_ENUM);
  assert.equal(factControls.TYPE_BOOL, store.TYPE_BOOL);
  assert.equal(factControls.TYPE_YEAR, store.TYPE_YEAR);
  assert.equal(engine.ENUM_FACT_TYPE, store.TYPE_ENUM);
});

test('the legend status order lists exactly the engine statuses', () => {
  assert.deepEqual([...common.STATUS_ORDER].sort(), Object.values(engine.STATUS).sort());
});

test('the authority metrics month scale matches the engine', () => {
  const today = engine.monthIndex('2026-10');
  assert.equal(metrics.ageInMonths({ date: '2026-01' }, today), 9);
  assert.equal(engine.monthIndex('2026-02') - engine.monthIndex('2025-02'), metrics.MONTHS_PER_YEAR);
  assert.equal(metrics.ageInMonths({ date: '2025-02' }, engine.monthIndex('2026-02')), metrics.MONTHS_PER_YEAR);
});

test('the community minimum-reports threshold is the same in the engine and the metrics module', () => {
  assert.equal(engine.COMMUNITY_MIN_REPORTS, metrics.COMMUNITY_MIN_REPORTS);
});

test('the metric labels and bucket legend match the metrics module and the rules', async () => {
  const { readFile } = await import('node:fs/promises');
  const rules = JSON.parse(await readFile(join(MODULE_DIR, 'data', 'rules.v1.json'), 'utf8'));
  const { colour } = rules.topics.find((topic) => topic.colour);
  assert.deepEqual(Object.keys(common.METRIC_LABELS).sort(), Object.values(metrics.METRIC).sort());
  assert.deepEqual(colour.metric_options.slice().sort(), Object.values(metrics.METRIC).sort());
  assert.equal(common.BUCKET_LABELS.length, colour.buckets_months.length + 1);
});
