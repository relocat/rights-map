// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// On-demand detail layers: admin-1 outlines and city dots/labels. Files are
// fetched only when the view is zoomed in far enough AND the country's box
// intersects the view, one file per country and tier, each fetched at most
// once (map-app's loader caches by path).

const TIER_ADMIN1 = 'admin1';
const TIER_CITIES_T2 = 'cities-t2';
const TIER_CITIES_T3 = 'cities-t3';
const FILE_EXTENSION = '.json';
const CITY_CLASS = 'rm-city';
const LABEL_CLASS = 'rm-city-label';
const SMALL_TIER_CLASS = ' rm-city-t3';
const POLYGON_TYPES = Object.freeze(['Polygon', 'MultiPolygon']);

/** True when two {x, y, width, height} boxes overlap (edges inclusive).
 * @returns {boolean} */
export function boxesIntersect(view, bounds) {
  return bounds.x <= view.x + view.width && bounds.x + bounds.width >= view.x
    && bounds.y <= view.y + view.height && bounds.y + bounds.height >= view.y;
}

function drawAdmin1(context, iso2, collection) {
  const { s } = context.deps.common;
  const group = s('g', { cls: 'rm-admin1-group', attrs: { 'data-iso2': iso2 } });
  for (const feature of collection.features) {
    if (!feature.geometry || !POLYGON_TYPES.includes(feature.geometry.type)) continue;
    group.append(s('path', { cls: 'rm-admin1', attrs: { d: context.deps.geo.geometryToPath(feature.geometry) } }));
  }
  context.layers.admin1Layer.append(group);
}

function drawCity(context, tier, feature) {
  const { s } = context.deps.common;
  const [x, y] = context.deps.geo.projectMercator(feature.geometry.coordinates);
  const attrs = { cx: x.toFixed(context.deps.common.COORDINATE_DECIMALS), cy: y.toFixed(context.deps.common.COORDINATE_DECIMALS) };
  const tierClass = tier === TIER_CITIES_T3 ? SMALL_TIER_CLASS : '';
  const dot = s('circle', { cls: `${CITY_CLASS}${tierClass}`, attrs });
  if (tier !== TIER_CITIES_T2) return [dot];
  const label = s('text', { cls: LABEL_CLASS, text: feature.properties.name, attrs: { x: attrs.cx, y: attrs.cy } });
  const { capital, population } = feature.properties;
  context.deps.labels.register(label, { isCapital: capital === true, population });
  return [dot, label];
}

function drawCities(context, iso2, tier, collection) {
  const { s } = context.deps.common;
  const group = s('g', { attrs: { 'data-iso2': iso2, 'data-tier': tier } });
  for (const feature of collection.features) group.append(...drawCity(context, tier, feature));
  context.layers.cityLayer.append(group);
  context.deps.labels.run();
}

function ensureLoaded(context, iso2, tier) {
  const path = `${tier}/${iso2}${FILE_EXTENSION}`;
  if (context.requested.has(path)) return;
  context.requested.add(path);
  const draw = (collection) => {
    if (tier === TIER_ADMIN1) drawAdmin1(context, iso2, collection);
    else drawCities(context, iso2, tier, collection);
  };
  // Only a failed fetch is tolerated (it costs detail, and the next zoom or pan retries);
  // a bug while drawing must stay visible, so draw errors are not caught here.
  const allowRetry = () => { context.requested.delete(path); };
  context.deps.loadGeo(path).then(draw, allowRetry);
}

/**
 * Creates the detail layer manager.
 * @param {{admin1Layer: SVGElement, cityLayer: SVGElement}} layers groups to draw into
 * @param {{common: object, geo: object, loadGeo: function(string): Promise<object>, labels: object,
 *   countries: Array<{iso2: string, bounds: object}>}} deps covered countries with projected bounds;
 *   `labels` is the label placer (register/run) that hides colliding city labels
 * @returns {{update: function(object, number): void}}
 */
export function createDetailLayers(layers, deps) {
  const context = { layers, deps, requested: new Set() };
  return {
    /**
     * Requests the layers the current zoom needs for countries in view.
     * @param {object} view current viewBox
     * @param {number} level detailLevel() result
     */
    update(view, level) {
      if (level < deps.geo.DETAIL_ADMIN1_AND_TIER2) return;
      for (const { iso2, bounds } of deps.countries) {
        if (!boxesIntersect(view, bounds)) continue;
        ensureLoaded(context, iso2, TIER_ADMIN1);
        ensureLoaded(context, iso2, TIER_CITIES_T2);
        if (level >= deps.geo.DETAIL_ALL_CITIES) ensureLoaded(context, iso2, TIER_CITIES_T3);
      }
    },
  };
}
