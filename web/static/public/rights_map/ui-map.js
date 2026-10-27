// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// SVG map view: one <path> per country coloured by status, micro-state rings,
// capital dots, selection outline, zoom and pan, and on-demand detail layers.
// The SVG is built once and updated in place, so keyboard focus on a country
// survives every state change. Status colours and the hatch live in CSS; the
// code only sets classes and geometry attributes (strict CSP: no style="").

const STRINGS = Object.freeze({
  mapLabel: 'Map of the world',
  neutralStatus: 'no topic chosen',
  openReportSuffix: ', open report',
  loading: 'Loading borders…',
  loadFailed: 'Map could not be loaded',
  retry: 'Retry',
});
const MICRO_STATE_ISO2 = Object.freeze(['MT', 'LU', 'LI']);
const DETAIL_DEBOUNCE_MS = 150;
/** Pattern tile edge in screen pixels; converted to map units on every view change. */
const HATCH_TILE_PX = 6;
const [HATCH_ROTATION, HATCH_ID] = ['rotate(45)', 'rm-hatch'];
/** One striped pattern per colour bucket marks an unconfirmed figure (colour is never the only cue). */
const BUCKET_COUNT = 5;
const UNCONFIRMED_PATTERN_PREFIX = 'rm-unconfirmed-';
const UNCONFIRMED_BASE_CLASS_PREFIX = 'rm-unconfirmed-base-';
const UNCONFIRMED_STRIPE_CLASS = 'rm-unconfirmed-stripe';
const UNIT_PROPERTY = '--rm-unit';
const SELECT_KEYS = Object.freeze(['Enter', ' ']);
const LEVEL_CLASS_PREFIX = 'rm-level-';
// Same class the on-demand tier-2 labels use (siblings share no imports), so one CSS rule styles both.
const CITY_LABEL_CLASS = 'rm-city-label';
const DISTRICT_MODE_CLASS = 'rm-mode-districts';
/** Zoom-in stops at this fraction of the initial view width: still reaches detail level 2, never meaningless polygons. */
const MAX_ZOOM_IN_FRACTION = 0.1;
const FOCUS_VISIBLE_SELECTOR = ':focus-visible';
const LAYER_NAMES = Object.freeze(['land', 'context', 'covered', 'districts', 'admin1', 'cities', 'rings']);

/** Geographic bbox of a Polygon/MultiPolygon, as [west, south, east, north]. */
export function geometryBbox(geometry) {
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (node) => {
    if (typeof node[0] !== 'number') {
      node.forEach(visit);
      return;
    }
    bbox[0] = Math.min(bbox[0], node[0]);
    bbox[1] = Math.min(bbox[1], node[1]);
    bbox[2] = Math.max(bbox[2], node[0]);
    bbox[3] = Math.max(bbox[3], node[1]);
  };
  visit(geometry.coordinates);
  return bbox;
}

/** A rotated stripe pattern of a base rect and a half-width stripe rect, sized later by `paintHatch`. */
function createStripePattern(s, id, baseClass, stripeClass) {
  const base = s('rect', { cls: baseClass });
  const stripe = s('rect', { cls: stripeClass });
  const pattern = s('pattern', {
    attrs: { id, patternUnits: 'userSpaceOnUse', patternTransform: HATCH_ROTATION },
  }, [base, stripe]);
  return { pattern, base, stripe };
}

/** Creates the persistent SVG skeleton and every mutable piece of view state. */
function createContext(rootElement, callbacks, deps) {
  const { h, s } = deps.common;
  const svg = s('svg', { cls: 'rm-svg', attrs: { role: 'group', 'aria-label': STRINGS.mapLabel } });
  const stripePatterns = [createStripePattern(s, HATCH_ID, 'rm-hatch-base', 'rm-hatch-stripe')];
  for (let bucket = 0; bucket < BUCKET_COUNT; bucket += 1) {
    stripePatterns.push(createStripePattern(s, `${UNCONFIRMED_PATTERN_PREFIX}${bucket}`,
      `${UNCONFIRMED_BASE_CLASS_PREFIX}${bucket}`, UNCONFIRMED_STRIPE_CLASS));
  }
  const layers = Object.fromEntries(LAYER_NAMES.map((name) => [name, s('g', { cls: `rm-layer rm-layer-${name}` })]));
  // Two strokes make the dotted line readable on any fill: a white one underneath, the dark dots on top.
  const disputedUnder = s('path', { cls: 'rm-outline rm-outline-disputed-under' });
  const disputedDots = s('path', { cls: 'rm-outline rm-outline-disputed' });
  const selectionOutline = s('path', { cls: 'rm-outline rm-outline-selected' });
  const focusOutline = s('path', { cls: 'rm-outline rm-outline-focus' });
  svg.append(s('defs', {}, stripePatterns.map(({ pattern }) => pattern)), layers.land, layers.context, layers.covered, layers.districts, layers.admin1,
    disputedUnder, disputedDots, selectionOutline, focusOutline, layers.cities, layers.rings);
  return {
    rootElement, callbacks, deps, svg, stripePatterns, layers, selectionOutline, focusOutline, disputedOutlines: [disputedUnder, disputedDots],
    capitalLabel: h('div', { cls: 'rm-capital-label', attrs: { hidden: true } }),
    message: h('div', { cls: 'rm-map-message' }),
    countries: new Map(), capitals: new Map(),
    view: null, initialView: null, homeView: null, districtHost: null, districtLayer: null, builtDistricts: null,
    revealedAgs: null, hasUserView: false, wasDetailOpen: false, sizedForDetailOpen: false, viewSize: null,
    limits: null, detailLayers: null, labels: null, gestures: null, detailTimer: null, isBuilt: false,
  };
}

/** Sizes every stripe tile (no-data hatch and unconfirmed stripes) in map units so the stripes keep one screen size at every zoom. */
function paintHatch(ctx, tile) {
  const full = { width: tile, height: tile };
  const half = { width: tile * ctx.deps.common.HALF, height: tile };
  for (const { pattern, base, stripe } of ctx.stripePatterns) {
    for (const [element, box] of [[pattern, full], [base, full], [stripe, half]]) {
      element.setAttribute('width', box.width);
      element.setAttribute('height', box.height);
    }
  }
}

/** Positions the HTML capital label over the selected country's capital. */
function paintOverlays(ctx) {
  if (!ctx.view) return;
  const { geo } = ctx.deps;
  const label = ctx.capitalLabel;
  const capital = ctx.capitals.get(label.dataset.iso2);
  label.hidden = !capital || !geo.viewBoxContains(ctx.view, capital.point);
  if (label.hidden) return;
  const rect = ctx.svg.getBoundingClientRect();
  label.style.left = `${((capital.point[0] - ctx.view.x) / ctx.view.width) * rect.width}px`;
  label.style.top = `${((capital.point[1] - ctx.view.y) / ctx.view.height) * rect.height}px`;
}

function paintView(ctx) {
  const { view } = ctx;
  const unitsPerPixel = view.width / ctx.svg.getBoundingClientRect().width;
  const box = [view.x, view.y, view.width, view.height];
  ctx.svg.setAttribute('viewBox', box.map((value) => value.toFixed(ctx.deps.common.COORDINATE_DECIMALS)).join(' '));
  ctx.svg.style.setProperty(UNIT_PROPERTY, `${unitsPerPixel}px`);
  paintHatch(ctx, HATCH_TILE_PX * unitsPerPixel);
  const level = ctx.deps.geo.detailLevel(view, ctx.initialView);
  const modeClass = ctx.districtHost ? ` ${DISTRICT_MODE_CLASS}` : '';
  ctx.svg.setAttribute('class', `rm-svg${modeClass} ${LEVEL_CLASS_PREFIX}${level}`);
  paintOverlays(ctx);
  clearTimeout(ctx.detailTimer);
  ctx.detailTimer = setTimeout(() => {
    ctx.detailLayers.update(view, level);
    ctx.labels.run();
  }, DETAIL_DEBOUNCE_MS);
}

/**
 * Narrowest view width in map units. District mode measures against the Germany view so a single
 * Kreis can fill the screen; otherwise against Europe.
 */
function zoomInFloor(ctx) {
  if (ctx.districtHost) return ctx.homeView.width * ctx.deps.geo.DISTRICT_MIN_ZOOM_FRACTION;
  return ctx.initialView.width * MAX_ZOOM_IN_FRACTION;
}

/** The `minFraction` clampViewBox needs to agree with `zoomInFloor`; undefined keeps the default floor. */
function clampFloorFraction(ctx) {
  return ctx.districtHost ? zoomInFloor(ctx) / ctx.limits.width : undefined;
}

/** Narrowest view the UI allows; below this the generalised borders turn into meaningless polygons. */
export function limitZoomIn(ctx, next) {
  const minWidth = zoomInFloor(ctx);
  if (next.width >= minWidth) return next;
  const { HALF } = ctx.deps.common;
  const centre = [next.x + next.width * HALF, next.y + next.height * HALF];
  return ctx.deps.geo.zoomViewBox(next, minWidth / next.width, centre);
}

/** Applies a user-driven view change (wheel, drag, pinch, buttons) after clamping. */
function setView(ctx, next) {
  ctx.hasUserView = true;
  ctx.view = ctx.deps.geo.clampViewBox(limitZoomIn(ctx, next), ctx.limits, clampFloorFraction(ctx));
  paintView(ctx);
}

/** The viewBox that places `bbox` (degrees) centred in `area` (px) of an svg of the given size, at the largest fit. */
export function viewBoxForArea(deps, bbox, area, size) {
  const { geo, common } = deps;
  const { HALF } = common;
  const box = geo.bboxToViewBox(bbox);
  const unitsPerPixel = Math.max(box.width / (area.right - area.left), box.height / (area.bottom - area.top));
  const centreX = box.x + box.width * HALF;
  const centreY = box.y + box.height * HALF;
  return {
    x: centreX - ((area.left + area.right) * HALF) * unitsPerPixel,
    y: centreY - ((area.top + area.bottom) * HALF) * unitsPerPixel,
    width: size.width * unitsPerPixel,
    height: size.height * unitsPerPixel,
  };
}

/** The visible map area, svg size and map-unit box a district reveal needs, for a geographic bbox. */
function revealFrame(ctx, bbox) {
  return {
    area: ctx.deps.visibleMapArea(ctx.rootElement, ctx.svg, ctx.deps.common.HALF),
    size: ctx.svg.getBoundingClientRect(),
    box: ctx.deps.geo.bboxToViewBox(bbox),
  };
}

/** The smallest box containing both. */
export function unionBox(first, second) {
  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  return {
    x, y,
    width: Math.max(first.x + first.width, second.x + second.width) - x,
    height: Math.max(first.y + first.height, second.y + second.height) - y,
  };
}

/**
 * Fits Europe (Germany in district mode) into the uncovered map area and recomputes the pan limits. A view the user has
 * moved is kept (only clamped); an untouched view follows the new fit, so cards opening or
 * closing and window resizes re-centre Europe.
 */
function layout(ctx) {
  const { geo } = ctx.deps;
  ctx.deps.publishDockHeight(ctx.rootElement);
  const rect = ctx.svg.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const aspect = rect.width / rect.height;
  const area = ctx.deps.visibleMapArea(ctx.rootElement, ctx.svg, ctx.deps.common.HALF);
  ctx.initialView = viewBoxForArea(ctx.deps, geo.EUROPE_VIEW_BBOX, area, rect);
  ctx.homeView = ctx.districtHost ? viewBoxForArea(ctx.deps, geo.GERMANY_VIEW_BBOX, area, rect) : ctx.initialView;
  // Zoom-out reaches the whole world; the home views may exceed it on a narrow area, so the limits include them.
  ctx.limits = unionBox(unionBox(geo.fitViewBox(geo.bboxToViewBox(geo.WORLD_VIEW_BBOX), aspect), ctx.initialView), ctx.homeView);
  ctx.view = ctx.hasUserView ? geo.clampViewBox(ctx.view, ctx.limits, clampFloorFraction(ctx)) : ctx.homeView;
  ctx.viewSize = { width: rect.width, height: rect.height };
  paintView(ctx);
}

/**
 * Rescales the view to a resized svg at the same map units per pixel about the same centre, so a
 * card that shrinks the map (the phone sheet) crops it instead of zooming it.
 */
function adaptViewToSize(ctx, rect) {
  if (!ctx.view || !ctx.viewSize) return;
  const { HALF } = ctx.deps.common;
  const unitsPerPixel = ctx.view.width / ctx.viewSize.width;
  const width = rect.width * unitsPerPixel;
  const height = rect.height * unitsPerPixel;
  ctx.view = {
    x: ctx.view.x + (ctx.view.width - width) * HALF, y: ctx.view.y + (ctx.view.height - height) * HALF, width, height,
  };
}

/** Recomputes limits and clearance without moving the view, whether or not the visitor has moved it. */
function relayoutKeepingView(ctx) {
  const rect = ctx.svg.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  adaptViewToSize(ctx, rect);
  const wasUserView = ctx.hasUserView;
  ctx.hasUserView = true;
  layout(ctx);
  ctx.hasUserView = wasUserView;
}

/** A resize caused by a card opening or closing keeps the view; any other resize refits an untouched view. */
function onMapResize(ctx) {
  const isCardToggle = ctx.wasDetailOpen !== ctx.sizedForDetailOpen;
  ctx.sizedForDetailOpen = ctx.wasDetailOpen;
  if (isCardToggle) relayoutKeepingView(ctx);
  else layout(ctx);
}

function resetView(ctx) {
  ctx.hasUserView = false;
  layout(ctx);
}

function makeSelectable(ctx, element, iso2) {
  element.addEventListener('click', () => {
    if (!ctx.gestures.wasDragged()) ctx.callbacks.onSelectCountry(iso2);
  });
  element.addEventListener('keydown', (event) => {
    if (!SELECT_KEYS.includes(event.key)) return;
    event.preventDefault();
    ctx.callbacks.onSelectCountry(iso2);
  });
  element.addEventListener('focus', () => {
    // Pointer clicks also focus; only keyboard focus gets the ring.
    if (element.matches(FOCUS_VISIBLE_SELECTOR)) ctx.focusOutline.setAttribute('d', ctx.countries.get(iso2).d);
  });
  element.addEventListener('blur', () => ctx.focusOutline.removeAttribute('d'));
}

/** Adds one country path; micro-states get their focus target from the ring instead. */
function addCountry(ctx, feature) {
  const { s } = ctx.deps.common;
  const { iso2, name, covered } = feature.properties;
  const attrs = { d: ctx.deps.geo.geometryToPath(feature.geometry) };
  if (covered) attrs.role = 'button';
  if (covered && !MICRO_STATE_ISO2.includes(iso2)) attrs.tabindex = '0';
  const path = s('path', { cls: 'rm-country', attrs }, [s('title', { text: name })]);
  if (covered) makeSelectable(ctx, path, iso2);
  (covered ? ctx.layers.covered : ctx.layers.context).append(path);
  const bounds = ctx.deps.geo.bboxToViewBox(geometryBbox(feature.geometry));
  ctx.countries.set(iso2, { path, d: attrs.d, name, covered, bounds, ring: null });
}

/**
 * A micro-state gets a visible ring plus a larger transparent hit circle: the hit circle is the
 * focus and click target, so it meets the 44 px touch size while the ring stays small.
 */
function addRing(ctx, iso2, attrs) {
  const { s } = ctx.deps.common;
  const country = ctx.countries.get(iso2);
  const mark = s('circle', { cls: 'rm-ring', attrs: { ...attrs, 'aria-hidden': 'true' } });
  const hit = s('circle', { cls: 'rm-ring-hit', attrs: { ...attrs, role: 'button', tabindex: '0' } });
  makeSelectable(ctx, hit, iso2);
  ctx.layers.rings.append(mark, hit);
  country.ring = hit;
  country.ringMark = mark;
}

/**
 * Tier-1 cities (capitals and million-plus cities) come with the base geo pack, so their labels are drawn here;
 * the placer ranks them above the smaller tier-2 labels that load later, so they are never hidden by them.
 */
function registerCityLabel(ctx, feature, attrs) {
  const { name, capital, population } = feature.properties;
  const label = ctx.deps.common.s('text', { cls: CITY_LABEL_CLASS, text: name, attrs: { x: attrs.cx, y: attrs.cy } });
  ctx.layers.cities.append(label);
  ctx.labels.register(label, { isCapital: capital === true, population });
}

function addCity(ctx, feature) {
  const { iso2, capital, name } = feature.properties;
  const point = ctx.deps.geo.projectMercator(feature.geometry.coordinates);
  const attrs = { cx: point[0].toFixed(ctx.deps.common.COORDINATE_DECIMALS), cy: point[1].toFixed(ctx.deps.common.COORDINATE_DECIMALS) };
  const dot = ctx.deps.common.s('circle', { cls: 'rm-capital-dot', attrs });
  ctx.layers.cities.append(dot);
  registerCityLabel(ctx, feature, attrs);
  if (!capital) return;
  ctx.capitals.set(iso2, { dot, point, name });
  if (MICRO_STATE_ISO2.includes(iso2)) addRing(ctx, iso2, attrs);
}

/** One-time construction once the geo pack is available. */
function build(ctx, state) {
  ctx.isBuilt = true;
  ctx.rootElement.removeAttribute('aria-hidden');
  // One borderless path: the land is a backdrop, never interactive.
  const landPath = state.geo.land.features.map((feature) => ctx.deps.geo.geometryToPath(feature.geometry)).join('');
  ctx.layers.land.append(ctx.deps.common.s('path', { cls: 'rm-land', attrs: { d: landPath } }));
  state.geo.countries.features.forEach((feature) => addCountry(ctx, feature));
  ctx.labels = ctx.deps.createLabelPlacer({ capitalLabel: ctx.capitalLabel });
  state.geo.cities.features.forEach((feature) => addCity(ctx, feature));
  const covered = [...ctx.countries.entries()]
    .filter(([, country]) => country.covered)
    .map(([iso2, country]) => ({ iso2, bounds: country.bounds }));
  const { deps } = ctx;
  ctx.detailLayers = deps.createDetailLayers(
    { admin1Layer: ctx.layers.admin1, cityLayer: ctx.layers.cities },
    { common: deps.common, geo: deps.geo, loadGeo: deps.loadGeo, labels: ctx.labels, countries: covered });
  ctx.districtLayer = deps.districts.createDistrictLayer(ctx.layers.districts, {
    common: deps.common, geo: deps.geo, engine: deps.engine, metrics: deps.metrics, geometryBbox,
    experiencesEnabled: deps.experiencesEnabled,
    onSelect: (ags) => ctx.callbacks.onSelectDistrict(ags), isSelectable: () => !ctx.gestures.wasDragged(),
  });
  ctx.gestures = deps.attachGestures(ctx.svg, {
    getView: () => ctx.view, applyView: (next) => setView(ctx, next), geo: deps.geo, common: deps.common,
  });
  ctx.rootElement.append(ctx.svg, ctx.capitalLabel, deps.createZoomControls(deps.common, {
    zoomBy: (factor) => ctx.gestures.zoomBy(factor), reset: () => resetView(ctx),
  }), ...(deps.sourcesButton ? [deps.sourcesButton] : []));
  layout(ctx);
  // The cards size the visible area, so a size change in any of them refits an untouched view.
  const observer = new ResizeObserver(() => onMapResize(ctx));
  const cards = Object.keys(ctx.deps.cardSelectors)
    .map((key) => ctx.rootElement.parentElement.querySelector(ctx.deps.cardSelectors[key]));
  [ctx.rootElement, ...cards].filter(Boolean).forEach((element) => observer.observe(element));
}

function paintStatuses(ctx, state) {
  const { statusClass } = ctx.deps.common;
  const topic = state.topicId ? ctx.deps.engine.findTopic(state.rules, state.topicId) : null;
  const disputedShapes = [];
  for (const [iso2, country] of ctx.countries) {
    if (!country.covered) continue;
    const status = state.result?.statuses[iso2]?.status;
    // The overlay is independent of the status: it adds an outline and a class, never a fill or symbol.
    const isDisputed = state.topicId !== null && ctx.deps.isDisputed(state.disputed, state.topicId, iso2);
    if (isDisputed) disputedShapes.push(country.d);
    const label = `${country.name}: ${status ? topic.labels[status] : STRINGS.neutralStatus}${isDisputed ? STRINGS.openReportSuffix : ''}`;
    const cls = `${statusClass(status)}${iso2 === state.selectedIso2 ? ' rm-selected' : ''}${isDisputed ? ' rm-disputed' : ''}`;
    for (const [element, base] of [[country.path, 'rm-country'], [country.ring, 'rm-ring-hit'], [country.ringMark, 'rm-ring']]) {
      element?.setAttribute('class', `${base} ${cls}`);
    }
    if (!ctx.districtHost) {
      country.path.setAttribute('aria-label', label);
      country.ring?.setAttribute('aria-label', label);
    }
    ctx.capitals.get(iso2)?.dot.setAttribute('class', `rm-capital-dot ${statusClass(status)}`);
  }
  paintDisputedOutlines(ctx, disputedShapes);
}

/** Draws the dotted outlines of all disputed countries; no shapes removes the geometry. */
function paintDisputedOutlines(ctx, shapes) {
  for (const outline of ctx.disputedOutlines) {
    if (shapes.length > 0) outline.setAttribute('d', shapes.join(''));
    else outline.removeAttribute('d');
  }
}

function paintSelection(ctx, state) {
  const districtShape = state.selectedAgs === null ? null : ctx.districtLayer?.element(state.selectedAgs)?.getAttribute('d');
  const outline = ctx.countries.get(state.selectedIso2)?.d ?? districtShape;
  if (outline) ctx.selectionOutline.setAttribute('d', outline);
  else ctx.selectionOutline.removeAttribute('d');
  const capital = ctx.capitals.get(state.selectedIso2);
  ctx.capitalLabel.dataset.iso2 = capital ? state.selectedIso2 : '';
  ctx.capitalLabel.textContent = capital ? capital.name : '';
  paintOverlays(ctx);
  // The pinned capital label changed, so the city labels around it may need to give way.
  ctx.labels.run();
}

function paintMessage(ctx, state) {
  const { h } = ctx.deps.common;
  const { GEO_STATUS } = ctx.deps.common;
  // Once the pack is ready, the district layer is what the visitor waits for in district mode.
  const isDistrictView = state.geoStatus === GEO_STATUS.READY && ctx.districtHost !== null;
  const status = isDistrictView ? state.districts.status : state.geoStatus;
  const isFailed = status === GEO_STATUS.ERROR;
  ctx.message.hidden = status === GEO_STATUS.READY;
  ctx.message.replaceChildren(
    h('p', { text: isFailed ? STRINGS.loadFailed : STRINGS.loading }),
    isFailed ? h('button', {
      cls: 'rm-button rm-button-outline', text: STRINGS.retry, attrs: { type: 'button' },
      on: { click: isDistrictView ? ctx.callbacks.onRetryDistricts : ctx.callbacks.onRetryGeo },
    }) : null,
  );
}

/**
 * The detail card renders after the map, so on the next frame the pan limits and card clearance are
 * recomputed once its size is known. The view itself stays put: opening or closing a card must never
 * move the map the visitor is comparing districts on.
 */
function refitWhenDetailToggles(ctx, state) {
  const isDetailOpen = state.selectedIso2 !== null || state.selectedAgs !== null;
  if (isDetailOpen === ctx.wasDetailOpen) return;
  ctx.wasDetailOpen = isDetailOpen;
  requestAnimationFrame(() => relayoutKeepingView(ctx));
}

/**
 * Creates the map view.
 * @param {HTMLElement} rootElement the .rm-map container
 * @param {{onSelectCountry: function(string): void, onRetryGeo: function(): void}} callbacks
 * @param {object} deps common, engine, geo (geo-render.js), metrics (authority-metrics.js), districts (ui-map-districts.js), createZoomControls, attachGestures, visibleMapArea, publishDockHeight, cardSelectors, createDetailLayers, loadGeo
 * @returns {{render: function(object): void, focusCountry: function(string): void, focusDistrict: function(string): void}}
 */
export function createMap(rootElement, callbacks, deps) {
  const ctx = createContext(rootElement, callbacks, deps);
  rootElement.append(ctx.message);
  return {
    /** @param {object} state app state; builds the SVG on the first render with geometry */
    render(state) {
      const isGeoReady = state.geoStatus === deps.common.GEO_STATUS.READY;
      if (isGeoReady) {
        if (!ctx.isBuilt) build(ctx, state);
        ctx.deps.districts.syncDistrictMode(ctx, state, layout);
      }
      paintMessage(ctx, state);
      if (!isGeoReady) return;
      paintStatuses(ctx, state);
      ctx.deps.districts.paintDistricts(ctx, state);
      paintSelection(ctx, state);
      refitWhenDetailToggles(ctx, state);
      ctx.deps.districts.revealFoundDistrict(ctx, state, (next) => setView(ctx, next), (bbox) => revealFrame(ctx, bbox));
    },
    /** Moves keyboard focus to a country (used after the detail card closes). */
    focusCountry(iso2) {
      const country = ctx.countries.get(iso2);
      (country?.ring ?? country?.path)?.focus();
    },
    /** Moves keyboard focus to a district (used after the authority card closes). */
    focusDistrict(ags) {
      ctx.districtLayer?.element(ags)?.focus();
    },
  };
}
