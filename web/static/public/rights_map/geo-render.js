// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Rights Map geo renderer primitives. Pure functions only (no DOM, no
// imports): Web Mercator projection, GeoJSON -> SVG path data, and viewBox
// zoom / pan / clamp / detail-level helpers. A viewBox is
// {x, y, width, height} in projected units; y grows downward.

/** Projected units spanning 360 degrees of longitude. */
export const WORLD_SIZE = 1024;

/** Web Mercator latitude limit in degrees; beyond it y diverges to infinity. */
export const MAX_LATITUDE = 85.05112878;

/** Initial frame (Europe) as [west, south, east, north] in degrees. */
export const EUROPE_VIEW_BBOX = [-25, 34, 45, 71];

/** Whole world as [west, south, east, north]; the zoom-out limit. */
export const WORLD_VIEW_BBOX = [-180, -MAX_LATITUDE, 180, MAX_LATITUDE];

/** Germany as [west, south, east, north]; the home frame of the district (authority) mode. */
export const GERMANY_VIEW_BBOX = [5.5, 47.0, 15.5, 55.2];

/**
 * District mode zoom-in floor as a fraction of the home (Germany) view width: about 5 % still
 * resolves a single Kreis, while the Europe-wide 10 % would stop at regional level.
 */
export const DISTRICT_MIN_ZOOM_FRACTION = 0.05;

/** Show admin-1 and tier-2 cities below this fraction of the initial width. */
export const DETAIL_ZOOM_RATIO = 0.4;

/** Show tier-3 cities below this fraction of the initial width. */
export const FINE_ZOOM_RATIO = 0.15;

/**
 * Minimum view width as a fraction of the limits width. 0.02 of a 1024-unit
 * world is about 20 units, enough to resolve a city at district level while
 * stopping the user from zooming into empty, meaningless space.
 */
export const MIN_VIEW_FRACTION = 0.02;

/** Detail levels returned by detailLevel(). */
export const DETAIL_COUNTRIES = 0;
export const DETAIL_ADMIN1_AND_TIER2 = 1;
export const DETAIL_ALL_CITIES = 2;

const FULL_CIRCLE_DEGREES = 360;
const HALF_CIRCLE_DEGREES = 180;
const PATH_DECIMALS = 2;
const HALF = 0.5;
const WORLD_CENTRE = WORLD_SIZE * HALF;
// Mercator formula angles: pi/4 offsets latitude to the tangent form; 2*pi is
// the full turn that normalises y into WORLD_SIZE units.
const HALF_TURN_RADIANS = Math.PI;
const QUARTER_TURN_OFFSET_RADIANS = HALF_TURN_RADIANS * HALF * HALF;
const FULL_TURN_RADIANS = HALF_TURN_RADIANS / HALF;
const SUPPORTED_GEOMETRIES = 'Polygon, MultiPolygon';

/**
 * Projects [lon, lat] (WGS84 degrees) to Web Mercator in WORLD_SIZE units.
 * Latitude is clamped to +-MAX_LATITUDE so poles stay finite.
 * @param {number[]} lonLat
 * @returns {number[]} [x, y], y growing downward
 */
export function projectMercator([lon, lat]) {
  const clampedLat = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
  const radians = (clampedLat * HALF_TURN_RADIANS) / HALF_CIRCLE_DEGREES;
  const mercatorY = Math.log(Math.tan(QUARTER_TURN_OFFSET_RADIANS + radians * HALF));
  const x = ((lon + HALF_CIRCLE_DEGREES) / FULL_CIRCLE_DEGREES) * WORLD_SIZE;
  const y = WORLD_CENTRE - (mercatorY / FULL_TURN_RADIANS) * WORLD_SIZE;
  return [x, y];
}

/** Formats a projected point as "x y" with fixed decimals. */
function formatPoint(lonLat) {
  const [x, y] = projectMercator(lonLat);
  return `${x.toFixed(PATH_DECIMALS)} ${y.toFixed(PATH_DECIMALS)}`;
}

/**
 * Appends one ring as a closed subpath. GeoJSON repeats the first point at
 * the end; 'Z' closes the ring, so the duplicate is skipped. Empty rings
 * are skipped: there is no first point to move to.
 */
function appendRing(ring, parts) {
  if (ring.length === 0) return;
  const last = ring.length - 1;
  const first = ring[0];
  const isExplicitlyClosed = last > 0 && ring[last][0] === first[0] && ring[last][1] === first[1];
  const end = isExplicitlyClosed ? last : ring.length;
  parts.push(`M${formatPoint(first)}`);
  for (let index = 1; index < end; index += 1) {
    parts.push(`L${formatPoint(ring[index])}`);
  }
  parts.push('Z');
}

/**
 * Converts a Polygon or MultiPolygon geometry to SVG path data. Linear in
 * the number of vertices; built with an array join to avoid quadratic
 * string concatenation on large country outlines.
 * @param {{type: string, coordinates: Array}} geometry
 * @returns {string}
 * @throws {RangeError} for any other geometry type
 */
export function geometryToPath(geometry) {
  let polygons;
  if (geometry.type === 'Polygon') {
    polygons = [geometry.coordinates];
  } else if (geometry.type === 'MultiPolygon') {
    polygons = geometry.coordinates;
  } else {
    throw new RangeError(`Unsupported geometry type; expected ${SUPPORTED_GEOMETRIES}`);
  }
  const parts = [];
  for (const polygon of polygons) {
    for (const ring of polygon) {
      appendRing(ring, parts);
    }
  }
  return parts.join('');
}

/**
 * Converts a geographic bbox to a projected viewBox.
 * @param {number[]} bbox [west, south, east, north] in degrees
 * @returns {{x: number, y: number, width: number, height: number}}
 */
export function bboxToViewBox([west, south, east, north]) {
  const [left, top] = projectMercator([west, north]);
  const [right, bottom] = projectMercator([east, south]);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Expands a viewBox (never shrinks it) to the container aspect ratio, keeping
 * its centre, so the whole frame stays visible without distortion.
 * @param {{x: number, y: number, width: number, height: number}} viewBox
 * @param {number} aspectRatio container width / height
 */
export function fitViewBox(viewBox, aspectRatio) {
  const centreX = viewBox.x + viewBox.width * HALF;
  const centreY = viewBox.y + viewBox.height * HALF;
  const width = Math.max(viewBox.width, viewBox.height * aspectRatio);
  const height = width / aspectRatio;
  return { x: centreX - width * HALF, y: centreY - height * HALF, width, height };
}

/**
 * Scales a viewBox about an anchor point, which keeps its screen position.
 * @param {{x: number, y: number, width: number, height: number}} viewBox
 * @param {number} factor below 1 zooms in, above 1 zooms out
 * @param {number[]} anchor [anchorX, anchorY] in projected units
 */
export function zoomViewBox(viewBox, factor, [anchorX, anchorY]) {
  return {
    x: anchorX - (anchorX - viewBox.x) * factor,
    y: anchorY - (anchorY - viewBox.y) * factor,
    width: viewBox.width * factor,
    height: viewBox.height * factor,
  };
}

/** Translates a viewBox by (dx, dy) projected units. */
export function panViewBox(viewBox, dx, dy) {
  return { ...viewBox, x: viewBox.x + dx, y: viewBox.y + dy };
}

/** Restricts a value to [low, high]; when the range is inverted, low wins. */
function clampRange(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

/**
 * Keeps a viewBox inside limits: size is capped to the limits and floored at
 * limits.width * MIN_VIEW_FRACTION, with the aspect ratio preserved. The
 * minimum-width floor wins over the limits cap: for an extreme aspect ratio
 * the result may exceed limits.height, since a usable zoom matters more.
 * @param {{x: number, y: number, width: number, height: number}} viewBox
 * @param {{x: number, y: number, width: number, height: number}} limits
 * @param {number} [minFraction] floor as a fraction of limits.width; district mode passes a smaller one
 */
export function clampViewBox(viewBox, limits, minFraction = MIN_VIEW_FRACTION) {
  const maxScale = Math.min(limits.width / viewBox.width, limits.height / viewBox.height);
  const minScale = (limits.width * minFraction) / viewBox.width;
  const scale = clampRange(1, minScale, Math.max(minScale, maxScale));
  const width = viewBox.width * scale;
  const height = viewBox.height * scale;
  return {
    x: clampRange(viewBox.x, limits.x, limits.x + limits.width - width),
    y: clampRange(viewBox.y, limits.y, limits.y + limits.height - height),
    width,
    height,
  };
}

/**
 * Chooses how much geography to draw for the current zoom.
 * @returns {number} DETAIL_COUNTRIES, DETAIL_ADMIN1_AND_TIER2 or DETAIL_ALL_CITIES
 */
export function detailLevel(viewBox, initialViewBox) {
  const ratio = viewBox.width / initialViewBox.width;
  if (ratio < FINE_ZOOM_RATIO) return DETAIL_ALL_CITIES;
  if (ratio < DETAIL_ZOOM_RATIO) return DETAIL_ADMIN1_AND_TIER2;
  return DETAIL_COUNTRIES;
}

/** True when the projected point lies within the viewBox (edges inclusive). */
export function viewBoxContains(viewBox, [x, y]) {
  return x >= viewBox.x && x <= viewBox.x + viewBox.width
    && y >= viewBox.y && y <= viewBox.y + viewBox.height;
}
