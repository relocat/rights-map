// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Dependency-free constants shared by the geo pack build and its tests. Kept apart
// from build-l2.mjs because that module imports mapshaper (build tooling), which a
// clean checkout or CI does not install; the JS tests must run without it.

/** Pack-relative path of the generated layer; the manifest and the browser use the same path. */
export const L2_DE_FILE = 'l2/DE.json';
/** Key of the VG250 Kreise entry in sources.lock.json. */
export const L2_DE_SOURCE_ID = 'vg250_krs';
/** Size budget in bytes, pinned by tests/js/geo/geo-pack.test.mjs. */
export const L2_DE_MAX_BYTES = 700_000;
/** Inclusive [min, max] count of Kreise; Germany has about 400 (397 to 400 in recent editions). */
export const L2_DE_EXPECTED_COUNT_RANGE = [390, 410];
