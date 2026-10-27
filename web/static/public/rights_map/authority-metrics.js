// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Authority time metrics: which colour bucket a district gets and whether the figure behind it is
// confirmed. Pure functions, no imports (browser modules cannot import each other without losing
// the ?v= cache buster). Month numbers are year*12 + month-1, the same scale as engine.js.

/** The three figures the map can show for an authority. */
export const METRIC = Object.freeze({TOTAL: 'total', WAIT: 'wait', PROC: 'proc'});
/** Months in a year; duplicated from engine.js on purpose, pinned by shared-constants.test.mjs. */
export const MONTHS_PER_YEAR = 12;
/** An official figure older than this many months is stale and renders as unconfirmed. */
export const STALE_OFFICIAL_MONTHS = 12;
/** Community figures count as confirmed from this many experience reports. */
export const COMMUNITY_MIN_REPORTS = 5;

const SRC_OFFICIAL = 'official';
const SRC_COMMUNITY = 'community';
const SRC_NONE = 'none';
const DATE_MONTH_PATTERN = /^(\d{4})-(\d{2})/;
const TYPE_CITY = 'city';
const TYPE_DISTRICT = 'district';
const STRINGS = Object.freeze({
  month: 'month',
  months: 'months',
  year: 'year',
  years: 'years',
  [TYPE_CITY]: 'city',
  [TYPE_DISTRICT]: 'district',
});
const METRIC_VALUES = new Set(Object.values(METRIC));
const NO_PAINT = Object.freeze({bucket: null, isConfirmed: false});
const NO_VALUE = Object.freeze({src: SRC_NONE});

/**
 * Privacy gate: a community figure from fewer than COMMUNITY_MIN_REPORTS reports (or with no
 * report count) can single out one person, so every consumer sees "no data" instead. The data
 * file is already checked server-side; this is the second line of defence.
 * @param {object|undefined} value a `times.*` entry
 * @returns {object|undefined} `value`, or a "no data" entry when it is an under-reported community figure
 */
export function publishableValue(value) {
  const isUnderReported = value?.src === SRC_COMMUNITY && !(value.n >= COMMUNITY_MIN_REPORTS);
  return isUnderReported ? NO_VALUE : value;
}

/**
 * Months a time figure represents on the map: the upper bound, because an open-ended or ranged
 * figure must not understate the wait (the same number drives the card and the passport warning).
 * @param {object|undefined} rawValue a `times.*` entry
 * @returns {number|null} `hi ?? lo`, or null when there is no usable number
 */
export function metricMonths(rawValue) {
  const value = publishableValue(rawValue);
  if (!value || value.src === SRC_NONE || !Number.isFinite(value.lo)) return null;
  return Number.isFinite(value.hi) ? value.hi : value.lo;
}

/**
 * Colour bucket of a month count: the number of thresholds strictly below it.
 * @param {number} months months to place
 * @param {number[]} bucketsMonths ascending upper thresholds, e.g. [6, 12, 24, 36]
 * @returns {number} 0 … bucketsMonths.length
 */
export function bucketIndex(months, bucketsMonths) {
  return bucketsMonths.filter((threshold) => threshold < months).length;
}

/**
 * Month number of a 'YYYY-MM' or 'YYYY-MM-DD' date string.
 * @param {string|undefined} date the date text
 * @returns {number|null} year*12 + month-1, or null when the text is not a date
 */
function dateMonth(date) {
  const match = DATE_MONTH_PATTERN.exec(String(date ?? ''));
  return match ? Number(match[1]) * MONTHS_PER_YEAR + Number(match[2]) - 1 : null;
}

/**
 * How old a figure is.
 * @param {object} value a `times.*` entry
 * @param {number} todayMonth current month number
 * @returns {number|null} whole months since `value.date`, or null without a valid date
 */
export function ageInMonths(value, todayMonth) {
  const dated = dateMonth(value?.date);
  return dated === null ? null : todayMonth - dated;
}

/**
 * Whether an official figure has outlived its welcome. A missing date counts as stale: an
 * undated official claim cannot be confirmed (fail closed).
 * @param {object} value a `times.*` entry
 * @param {number} todayMonth current month number
 * @returns {boolean} true for an official, non-exempt figure older than the threshold
 */
export function isStale(value, todayMonth) {
  if (value?.src !== SRC_OFFICIAL || value.stale_exempt) return false;
  const age = ageInMonths(value, todayMonth);
  return age === null || age > STALE_OFFICIAL_MONTHS;
}

/**
 * Whether a figure is solid enough to draw as a plain fill (not striped).
 * @param {object} value a `times.*` entry
 * @param {number} todayMonth current month number
 * @returns {boolean} true for fresh or exempt official figures and community figures with enough reports
 */
export function isConfirmed(value, todayMonth) {
  if (value?.src === SRC_OFFICIAL) return !isStale(value, todayMonth);
  if (value?.src === SRC_COMMUNITY) return value.n >= COMMUNITY_MIN_REPORTS;
  return false;
}

/**
 * The figure a district is painted from: the authority's own sourced figure (official, press,
 * estimate or data-file community) always wins; the weekly community median only fills a gap.
 * @param {object|undefined} authority the authority covering the district, if any
 * @param {string} metric one of `METRIC`
 * @param {Object<string, object>} [community] authority id to community entry (see community-client.js)
 * @returns {object|undefined} a `times.*`-shaped value; a filled one carries `n` = the band's lower bound, never the exact count
 */
export function paintedValue(authority, metric, community) {
  const own = authority?.times?.[metric];
  const ownSource = publishableValue(own)?.src ?? SRC_NONE;
  if (ownSource !== SRC_NONE) return own;
  const entry = community?.[authority?.id];
  const figure = entry?.[metric];
  if (!figure) return own;
  return {src: SRC_COMMUNITY, lo: figure.median, n: entry.nMin, nBand: entry.nBand};
}

/**
 * Paint instructions for one district.
 * @param {object|undefined} authority the authority covering the district, if any
 * @param {string} metric one of `METRIC`
 * @param {{todayMonth: number, bucketsMonths: number[], community?: object}} context current month, bucket
 *   thresholds and the optional community entries that fill districts without a sourced figure
 * @returns {{bucket: number|null, isConfirmed: boolean}} bucket null means "no data"
 */
export function districtPaint(authority, metric, context) {
  if (!METRIC_VALUES.has(metric)) return NO_PAINT;
  const value = paintedValue(authority, metric, context.community);
  const months = metricMonths(value);
  if (months === null) return NO_PAINT;
  return {
    bucket: bucketIndex(months, context.bucketsMonths),
    isConfirmed: isConfirmed(value, context.todayMonth),
  };
}

/**
 * Display labels for the districts of a layer. A name shared by a city and a district (Leipzig)
 * gets its type appended; unique names stay as they are.
 * @param {{features: object[]}} collection the `l2/DE.json` feature collection
 * @returns {Map<string, string>} AGS → label
 */
export function districtLabels(collection) {
  const nameCounts = new Map();
  for (const {properties} of collection.features) {
    nameCounts.set(properties.name, (nameCounts.get(properties.name) ?? 0) + 1);
  }
  const labels = new Map();
  for (const {properties} of collection.features) {
    const isDuplicate = nameCounts.get(properties.name) > 1;
    const typeText = STRINGS[properties.type];
    labels.set(
      properties.ags,
      isDuplicate && typeText ? `${properties.name} (${typeText})` : properties.name,
    );
  }
  return labels;
}

/**
 * Human text for a month count, used in aria-labels: whole years read as years.
 * @param {number} months a non-negative month count
 * @returns {string} e.g. '7 months', '1 month', '3 years'
 */
export function monthsText(months) {
  const isWholeYears = months >= MONTHS_PER_YEAR && months % MONTHS_PER_YEAR === 0;
  const count = isWholeYears ? months / MONTHS_PER_YEAR : months;
  const unit = isWholeYears ? (count === 1 ? STRINGS.year : STRINGS.years) : (count === 1 ? STRINGS.month : STRINGS.months);
  return `${count} ${unit}`;
}
