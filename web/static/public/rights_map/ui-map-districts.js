// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// District layer of the SVG map: one <path> per Kreis, coloured by the chosen authority metric.
// Built once per layer (geometry and bounding boxes are computed once, never on repaint) and
// repainted by class only, so keyboard focus survives every state change. Colours and the
// unconfirmed stripe live in CSS (strict CSP: no style="").

const STRINGS = Object.freeze({
  noData: 'no data',
  unconfirmed: 'unconfirmed',
  shareExperience: ' · Share your experience',
});
const BUCKET_CLASS_PREFIX = 'rm-bucket-';
const NO_DATA_CLASS = 'rm-nodata';
const UNCONFIRMED_CLASS = 'rm-unconfirmed';
const SELECTED_CLASS = 'rm-selected';
const DISTRICT_CLASS = 'rm-district';
const INACTIVE_CLASS = 'rm-districts-inactive';
const CONTEXT_CLASS = 'rm-country-context';
const HOST_CLASS = 'rm-country-host';
const SELECT_KEYS = Object.freeze(['Enter', ' ']);
const BUTTON_ROLE = 'button';
const TAB_STOP = '0';
const NO_COUNTRY_TAB_STOP_ISO2 = Object.freeze(['MT', 'LU', 'LI']);
const INTERACTIVE_ATTRIBUTES = Object.freeze(['role', 'tabindex', 'aria-label']);
/**
 * Accessible name of a district: its label plus the time bucket, flagged when the figure behind
 * it is not confirmed. A district without a usable figure reads "no data".
 * @param {string} label display name of the district
 * @param {{bucket: ?number, isConfirmed: boolean}} paint result of `districtPaint`
 * @param {{bucketLabels: string[], noData: string, unconfirmed: string}} strings
 * @returns {string} e.g. 'Leipzig (city): 7–12 months, unconfirmed'
 */
export function districtAriaLabel(label, paint, strings) {
  if (paint.bucket === null) return `${label}: ${strings.noData}`;
  const suffix = paint.isConfirmed ? '' : `, ${strings.unconfirmed}`;
  return `${label}: ${strings.bucketLabels[paint.bucket]}${suffix}`;
}

/** The class list of a district path for a paint result. */
function paintClasses(paint, isSelected) {
  const parts = [DISTRICT_CLASS];
  if (paint.bucket === null) {
    parts.push(NO_DATA_CLASS);
  } else {
    parts.push(`${BUCKET_CLASS_PREFIX}${paint.bucket}`);
    if (!paint.isConfirmed) parts.push(UNCONFIRMED_CLASS);
  }
  if (isSelected) parts.push(SELECTED_CLASS);
  return parts.join(' ');
}

/** Wires pointer and keyboard selection of one district path. */
function makeSelectable(path, ags, deps) {
  path.addEventListener('click', () => {
    if (deps.isSelectable()) deps.onSelect(ags);
  });
  path.addEventListener('keydown', (event) => {
    if (!SELECT_KEYS.includes(event.key)) return;
    event.preventDefault();
    deps.onSelect(ags);
  });
}

/**
 * Makes the country layer inert while districts are shown: other countries become plain
 * context (no role, tab stop or accessible name) and the host country is hidden by CSS because
 * the districts replace it. Turning the mode off restores the focus targets; accessible names
 * come back with the next status paint.
 * @param {Map<string, {path: Element, ring: ?Element, ringMark: ?Element, covered: boolean}>} countries
 * @param {?string} hostIso2 country whose districts are shown, or null when the mode is off
 */
export function setCountryContext(countries, hostIso2) {
  const isActive = hostIso2 !== null;
  for (const [iso2, country] of countries) {
    if (!country.covered) continue;
    for (const element of [country.path, country.ring, country.ringMark]) {
      element?.classList.toggle(CONTEXT_CLASS, isActive);
    }
    country.path.classList.toggle(HOST_CLASS, iso2 === hostIso2);
    for (const element of [country.path, country.ring]) {
      if (!element) continue;
      if (isActive) INTERACTIVE_ATTRIBUTES.forEach((name) => element.removeAttribute(name));
      else restoreFocusTarget(element, iso2, element === country.ring);
    }
  }
}

/** Gives a country path (or micro-state ring) back its button role and tab stop. */
function restoreFocusTarget(element, iso2, isRing) {
  element.setAttribute('role', BUTTON_ROLE);
  if (isRing || !NO_COUNTRY_TAB_STOP_ISO2.includes(iso2)) element.setAttribute('tabindex', TAB_STOP);
}

/**
 * Creates the district layer inside an SVG group.
 * @param {SVGGElement} group the layer group
 * @param {{common: object, geo: object, engine: object, metrics: object, geometryBbox: function(object): number[],
 *   experiencesEnabled: boolean, onSelect: function(string): void, isSelectable: function(): boolean}} deps
 * @returns {{build: function(object, Map<string, string>): void, paint: function(object): void,
 *   boundsOf: function(string): ?number[], setActive: function(boolean): void, element: function(string): ?Element}}
 */
export function createDistrictLayer(group, deps) {
  const entries = new Map();
  return {
    /** Builds one path per feature in input order. @param {object} collection @param {Map<string, string>} labels */
    build(collection, labels) {
      const { s } = deps.common;
      const paths = collection.features.map(({ properties, geometry }) => {
        const label = labels.get(properties.ags) ?? properties.name;
        const path = s('path', {
          cls: DISTRICT_CLASS,
          attrs: { d: deps.geo.geometryToPath(geometry), role: BUTTON_ROLE, tabindex: TAB_STOP },
        }, [s('title', { text: label })]);
        makeSelectable(path, properties.ags, deps);
        entries.set(properties.ags, { path, label, tooltip: path.children[0], bbox: deps.geometryBbox(geometry) });
        return path;
      });
      group.replaceChildren(...paths);
    },
    /** Sets bucket, unconfirmed and selection classes and the accessible name of every district. */
    paint(state) {
      const topic = deps.engine.findTopic(state.rules, state.topicId);
      const context = {
        todayMonth: deps.engine.monthIndex(state.today), bucketsMonths: topic.colour.buckets_months,
        community: state.community,
      };
      const strings = { ...STRINGS, bucketLabels: deps.common.BUCKET_LABELS };
      for (const [ags, entry] of entries) {
        const paint = deps.metrics.districtPaint(state.districts.byAgs[ags], state.metric, context);
        entry.path.setAttribute('class', paintClasses(paint, ags === state.selectedAgs));
        entry.path.setAttribute('aria-label', districtAriaLabel(entry.label, paint, strings));
        // Only the hover tooltip invites; the accessible name above stays a plain statement of the data.
        entry.tooltip.textContent = paint.bucket === null && deps.experiencesEnabled
          ? `${entry.label}${STRINGS.shareExperience}` : entry.label;
      }
    },
    /** Geographic bbox [west, south, east, north] of a district, or null for an unknown AGS. */
    boundsOf: (ags) => entries.get(ags)?.bbox ?? null,
    /** Shows or hides the layer; hidden districts are not tab stops. */
    setActive(isActive) {
      group.classList.toggle(INACTIVE_CLASS, !isActive);
      for (const { path } of entries.values()) {
        if (isActive) path.setAttribute('tabindex', TAB_STOP);
        else path.removeAttribute('tabindex');
      }
    },
    /** The path element of a district, or null. */
    element: (ags) => entries.get(ags)?.path ?? null,
  };
}

/**
 * Switches district mode on or off when the chosen topic changes: the country layer turns into
 * context, the district layer shows, and the untouched view refits to the new home frame.
 * @param {object} ctx map context (`districtHost`, `countries`, `districtLayer`, `hasUserView`, `deps`)
 * @param {object} state app state
 * @param {function(object): void} relayout refits the view for the new mode
 */
export function syncDistrictMode(ctx, state, relayout) {
  const { engine } = ctx.deps;
  const topic = state.topicId ? engine.findTopic(state.rules, state.topicId) : null;
  const host = topic && engine.isAuthorityTopic(topic) ? topic.country : null;
  if (host === ctx.districtHost) return;
  ctx.districtHost = host;
  ctx.hasUserView = false;
  setCountryContext(ctx.countries, host);
  ctx.districtLayer.setActive(host !== null);
  relayout(ctx);
}

/**
 * Builds the district paths once their collection arrives, then repaints them in district mode.
 * @param {object} ctx map context
 * @param {object} state app state
 */
export function paintDistricts(ctx, state) {
  const { collection, labels } = state.districts;
  if (collection && ctx.builtDistricts !== collection) {
    ctx.builtDistricts = collection;
    ctx.districtLayer.build(collection, labels);
    ctx.districtLayer.setActive(ctx.districtHost !== null);
  }
  if (ctx.districtHost && ctx.builtDistricts) ctx.districtLayer.paint(state);
}

/**
 * The smallest shift along one axis that brings a box into a visible span; 0 when it already
 * overlaps the span. A box wider than the span lines up with the span's leading edge.
 * @param {number} boxStart box start on the axis
 * @param {number} boxEnd box end on the axis
 * @param {number} spanStart visible span start
 * @param {number} spanEnd visible span end
 * @returns {number} how far the view must move along the axis
 */
function shiftIntoSpan(boxStart, boxEnd, spanStart, spanEnd) {
  const isOutside = boxEnd < spanStart || boxStart > spanEnd;
  if (!isOutside) return 0;
  return boxStart < spanStart ? boxStart - spanStart : Math.min(boxEnd - spanEnd, boxStart - spanStart);
}

/**
 * The view moved (never scaled) just far enough to bring a district into the visible map area,
 * or null when the district already overlaps it.
 * @param {{x: number, y: number, width: number, height: number}} view current viewBox
 * @param {{left: number, top: number, right: number, bottom: number}} area visible area in px
 * @param {{width: number, height: number}} size svg size in px
 * @param {{x: number, y: number, width: number, height: number}} box district box in map units
 * @returns {?{x: number, y: number, width: number, height: number}}
 */
export function panToReveal(view, area, size, box) {
  const unitsPerPixel = view.width / size.width;
  const shiftX = shiftIntoSpan(box.x, box.x + box.width, view.x + area.left * unitsPerPixel, view.x + area.right * unitsPerPixel);
  const shiftY = shiftIntoSpan(box.y, box.y + box.height, view.y + area.top * unitsPerPixel, view.y + area.bottom * unitsPerPixel);
  if (shiftX === 0 && shiftY === 0) return null;
  return { ...view, x: view.x + shiftX, y: view.y + shiftY };
}

/**
 * Pans (never zooms) to a district picked from the "Find a district" list when it lies outside
 * the visible map area, one frame later once the authority card has taken its space. Map clicks
 * and keys never reach here: the visitor can already see what they chose.
 * @param {object} ctx map context (`districtLayer`, `view`, `revealedAgs`)
 * @param {object} state app state (`revealAgs` is set only by the finder)
 * @param {function(object): void} panTo applies a new view
 * @param {function(number[]): ?object} readFrame returns `{area, size, box}` for a district bbox
 */
export function revealFoundDistrict(ctx, state, panTo, readFrame) {
  const { revealAgs } = state;
  if (revealAgs === ctx.revealedAgs) return;
  ctx.revealedAgs = revealAgs;
  if (revealAgs === null) return;
  requestAnimationFrame(() => {
    const bbox = ctx.districtLayer.boundsOf(revealAgs);
    const frame = bbox && ctx.view ? readFrame(bbox) : null;
    const next = frame && panToReveal(ctx.view, frame.area, frame.size, frame.box);
    if (next) panTo(next);
  });
}
