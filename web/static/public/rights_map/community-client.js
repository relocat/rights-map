// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Reads the public community figures (weekly snapshot of accepted experience reports). The request
// is a plain GET with no parameter: nothing about the visitor is sent. Every failure yields no data
// and no error text; the map simply shows no community figures.

const CREDENTIALS_MODE = 'omit';
const AUTHORITIES_KEY = 'authorities';
const BAND_KEY = 'n_band';
const METRIC_KEYS = Object.freeze(['wait', 'proc', 'total']);
const FIGURE_KEYS = Object.freeze(['median', 'q1', 'q3']);
/** Public report-count bands and the smallest count each stands for (never an exact count). */
const BAND_MINIMUM = Object.freeze({ '5-9': 5, '10-19': 10, '20+': 20 });
const EN_DASH = '–';
/** Largest months figure of one report; must match the server's limit (siblings cannot import it). */
const MONTHS_MAX = 120;
/** Total is wait plus processing, so its published figures can reach twice the single-figure maximum. */
const TOTAL_MONTHS_MAX = 2 * MONTHS_MAX;
/** Published figures are rounded to this step; must match the server's rounding step. */
const FIGURE_STEP_MONTHS = 3;
const TOTAL_KEY = 'total';
const FORBIDDEN_AUTHORITY_ID = '__proto__';
const BAND_SEPARATOR_PATTERN = /-/;
const STRINGS = Object.freeze({
  badge: 'Community',
  text: (band, median, lower, upper) => `· ${band} reports: about ${median} months (typically ${typicalRange(lower, upper)})`,
  headline: (median) => `About ${median} months`,
  summary: (band, lower, upper) => `${band} reports · typically ${typicalRange(lower, upper)}`,
});

function typicalRange(lower, upper) {
  return lower === upper ? `${lower}` : `${lower}${EN_DASH}${upper}`;
}

function isPublishedMonths(value, maximum) {
  return Number.isInteger(value) && value >= 0 && value <= maximum && value % FIGURE_STEP_MONTHS === 0;
}

function parseFigure(raw, maximum) {
  if (raw === null || typeof raw !== 'object') return null;
  if (!FIGURE_KEYS.every((key) => isPublishedMonths(raw[key], maximum))) return null;
  if (!(raw.q1 <= raw.median && raw.median <= raw.q3)) return null;
  return { median: raw.median, q1: raw.q1, q3: raw.q3 };
}

function parseAuthority(raw) {
  if (raw === null || typeof raw !== 'object' || !Object.hasOwn(BAND_MINIMUM, raw[BAND_KEY])) return null;
  const entry = { nBand: raw[BAND_KEY], nMin: BAND_MINIMUM[raw[BAND_KEY]] };
  for (const key of METRIC_KEYS) {
    const figure = parseFigure(raw[key], key === TOTAL_KEY ? TOTAL_MONTHS_MAX : MONTHS_MAX);
    if (figure) entry[key] = figure;
  }
  return METRIC_KEYS.some((key) => entry[key]) ? entry : null;
}

/**
 * Validates a response body; anything unexpected is dropped, so the map never trusts the shape.
 * @param {*} body parsed JSON
 * @returns {Object<string, object>} authority id to `{nBand, nMin, wait?, proc?, total?}`
 */
export function parseCommunityBody(body) {
  const raw = body?.[AUTHORITIES_KEY];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  // No prototype, and the one key that could still reach it is skipped, so a lookup never sees inherited data.
  const parsed = Object.create(null);
  for (const [authorityId, value] of Object.entries(raw)) {
    if (authorityId === FORBIDDEN_AUTHORITY_ID) continue;
    const entry = parseAuthority(value);
    if (entry) parsed[authorityId] = entry;
  }
  return parsed;
}

/**
 * Fetches the community figures once. Best effort: network, non-2xx status, bad JSON and an
 * unexpected shape all yield `{}`.
 * @param {string} url the endpoint published by the page shell
 * @param {function} [fetchFn] injectable for tests
 * @returns {Promise<Object<string, object>>} see {@link parseCommunityBody}; `{}` on any failure
 */
export async function fetchCommunityFigures(url, fetchFn = fetch) {
  try {
    const response = await fetchFn(url, { credentials: CREDENTIALS_MODE });
    if (!response.ok) return {};
    return parseCommunityBody(await response.json());
  } catch (error) {
    // fetch rejects with TypeError and json() with SyntaxError; anything else is a bug and must surface.
    if (error instanceof TypeError || error instanceof SyntaxError) return {};
    throw error;
  }
}

/**
 * Text of one community row, with the band and never an exact report count.
 * @param {{nBand: string}} entry an authority entry
 * @param {{median: number, q1: number, q3: number}} figure one metric of the entry
 * @returns {{badge: string, text: string, headline: string, summary: string}} badge label, the sentence after it
 *   (under a sourced figure), and the headline and count line that stand in for a missing sourced figure
 */
export function formatCommunityRow(entry, figure) {
  const band = entry.nBand.replace(BAND_SEPARATOR_PATTERN, EN_DASH);
  return {
    badge: STRINGS.badge,
    text: STRINGS.text(band, figure.median, figure.q1, figure.q3),
    headline: STRINGS.headline(figure.median),
    summary: STRINGS.summary(band, figure.q1, figure.q3),
  };
}
