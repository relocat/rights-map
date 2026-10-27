// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Shared helpers for the Rights Map UI modules: DOM construction, focus-safe
// re-rendering, status presentation and month formatting. Sibling modules have
// no imports (every import must carry the cache-busting version), so
// map-app.js hands this module to each of them as `deps.common`.
//
// All DOM is built with createElement / textContent. No innerHTML anywhere:
// rule text is trusted data, but one construction path means one XSS review.

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const FOCUS_KEY_ATTRIBUTE = 'data-focus-key';
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MONTH_NAMES = Object.freeze([
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]);
const MONTH_YEAR_SEPARATOR = ' ';
const URL_PROTOCOL_ALLOWED = 'https:';
const SORT_LOCALE = 'en';

/** Shared constants: defined once here, handed to every view as deps.common. */
export const GEO_STATUS = Object.freeze({ LOADING: 'loading', READY: 'ready', ERROR: 'error' });
export const STEP_TOPIC = 1;
export const STEP_SITUATION = 2;
/** Decimals kept when projected coordinates become SVG attributes. */
export const COORDINATE_DECIMALS = 2;
export const PROFILE_SCOPE = 'profile';
export const HALF = 0.5;

// Duplicated on purpose: sibling modules cannot import each other without losing the ?v= cache
// buster, so this value is kept in sync with engine.js (STATUS) and pinned by tests/js/rights_map/shared-constants.test.mjs.
/** Status keys in legend order; the values are the engine's STATUS strings. */
export const STATUS_ORDER = Object.freeze(['ok', 'restricted', 'blocked', 'unknown', 'na', 'origin']);

/** Symbol shown next to every status so colour is never the only signal. */
export const STATUS_SYMBOL = Object.freeze({
  ok: '✓', restricted: '!', blocked: '×', unknown: '?', na: '–', origin: '◆',
});

// Keys duplicate authority-metrics.js METRIC for the same reason as STATUS_ORDER; pinned by tests.
/** Metric switch labels for the authority map, keyed by the metric value. */
export const METRIC_LABELS = Object.freeze({ total: 'Total', wait: 'Wait to apply', proc: 'Processing' });

/**
 * Legend labels of the authority time buckets, shortest first. The length must equal
 * `colour.buckets_months.length + 1` in the rules; a test asserts it.
 */
export const BUCKET_LABELS = Object.freeze(['≤ 6 months', '7–12 months', '1–2 years', '2–3 years', '> 3 years']);

/** Kinds of inline notice under the answer actions; also the CSS modifier suffix. */
export const NOTICE_KIND = Object.freeze({ ERROR: 'error', OK: 'ok' });

/** CSS class for a status; `undefined` status means the map is neutral. */
export function statusClass(status) {
  return status ? `rm-status-${status}` : 'rm-status-neutral';
}

function applyOptions(element, { cls, text, attrs, on }) {
  if (cls) element.setAttribute('class', cls);
  if (text !== undefined) element.textContent = text;
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value !== undefined && value !== null && value !== false) element.setAttribute(name, value === true ? '' : value);
  }
  for (const [eventName, handler] of Object.entries(on ?? {})) element.addEventListener(eventName, handler);
}

function appendChildren(element, children) {
  for (const child of children) {
    if (child) element.append(child);
  }
  return element;
}

/** Creates a text node. */
export function text(value) {
  return document.createTextNode(value);
}

/**
 * Creates an HTML element.
 * @param {string} tag
 * @param {{cls?: string, text?: string, attrs?: object, on?: object}} [options]
 *   `attrs` entries that are false/null/undefined are skipped; `true` sets a boolean attribute.
 * @param {Array<Node|null|false>} [children] falsy children are skipped
 * @returns {HTMLElement}
 */
export function h(tag, options = {}, children = []) {
  const element = document.createElementNS(HTML_NAMESPACE, tag);
  applyOptions(element, options);
  return appendChildren(element, children);
}

/** Creates an SVG element; same options as `h`. */
export function s(tag, options = {}, children = []) {
  const element = document.createElementNS(SVG_NAMESPACE, tag);
  applyOptions(element, options);
  return appendChildren(element, children);
}

/**
 * Moves keyboard focus to a card's heading and shows the card from its top edge. The heading is
 * focused without the browser's own scroll-into-view, which on a fixed-height phone card would
 * scroll the eyebrow and the back button out of sight; the card is then reset to its top padding.
 * @param {HTMLElement} card the scrolling card element
 * @param {HTMLElement} heading the card's focusable h2
 */
export function focusHeadingFromTop(card, heading) {
  heading.focus({ preventScroll: true });
  card.scrollTop = 0;
}

/**
 * Replaces a container's children while keeping keyboard focus and scroll
 * position, so pressing a button inside a re-rendered panel does not lose it.
 * Focusable elements opt in with a `data-focus-key` attribute.
 * @param {HTMLElement} container
 * @param {function(): Array<Node|null|false>} build returns the new children
 */
export function rebuild(container, build) {
  const active = document.activeElement;
  const focusKey = container.contains(active) ? active.getAttribute(FOCUS_KEY_ATTRIBUTE) : null;
  const scrollTop = container.scrollTop;
  container.replaceChildren(...build().filter(Boolean));
  container.scrollTop = scrollTop;
  if (focusKey === null) return;
  for (const candidate of container.querySelectorAll(`[${FOCUS_KEY_ATTRIBUTE}]`)) {
    if (candidate.getAttribute(FOCUS_KEY_ATTRIBUTE) === focusKey) {
      candidate.focus();
      return;
    }
  }
}

/** Builds the attribute pair that marks an element for focus restoration. */
export function focusKey(key) {
  return { [FOCUS_KEY_ATTRIBUTE]: key };
}

/**
 * Formats 'YYYY-MM' as 'Mon YYYY'.
 * @param {string} value
 * @returns {string} the formatted month, or the input unchanged when it is not a month
 */
export function formatMonthYear(value) {
  const match = MONTH_PATTERN.exec(value);
  if (!match) return value;
  const monthIndex = Number(match[2]) - 1;
  return `${MONTH_NAMES[monthIndex]}${MONTH_YEAR_SEPARATOR}${match[1]}`;
}

/** True only for https URLs, so a bad rules entry can never become a script link. */
export function isSafeLink(url) {
  try {
    return new URL(url).protocol === URL_PROTOCOL_ALLOWED;
  } catch {
    return false;
  }
}

/**
 * Sorts countries by display name for the finder.
 * @param {Array<{iso2: string, name: string}>} countries
 * @returns {Array<{iso2: string, name: string}>} a new sorted array
 */
export function sortByName(countries) {
  return [...countries].sort((left, right) => left.name.localeCompare(right.name, SORT_LOCALE));
}
