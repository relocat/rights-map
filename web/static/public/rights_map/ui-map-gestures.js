// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Pointer input for the map: wheel zoom anchored at the pointer, drag-pan
// and two-pointer pinch. It only translates input into a new viewBox; the
// caller owns the view and applies clamping.

const WHEEL_SENSITIVITY = 0.0015;
const WHEEL_LINE_HEIGHT_PX = 16;
const WHEEL_DELTA_LINE_MODE = 1;
/** Pointer travel (px) before a press becomes a drag, so a slightly shaky click still selects. */
const DRAG_START_DISTANCE_PX = 6;
const PINCH_POINTER_COUNT = 2;
const MIN_PINCH_DISTANCE_PX = 1;

function worldPoint(input, clientX, clientY) {
  const rect = input.svg.getBoundingClientRect();
  const view = input.hooks.getView();
  return [
    view.x + ((clientX - rect.left) / rect.width) * view.width,
    view.y + ((clientY - rect.top) / rect.height) * view.height,
  ];
}

function zoomAt(input, factor, clientX, clientY) {
  const { getView, applyView, geo } = input.hooks;
  applyView(geo.zoomViewBox(getView(), factor, worldPoint(input, clientX, clientY)));
}

function pinchDistance(input) {
  const [first, second] = [...input.pointers.values()];
  return Math.max(MIN_PINCH_DISTANCE_PX, Math.hypot(first.x - second.x, first.y - second.y));
}

function onWheel(input, event) {
  event.preventDefault();
  const pixels = event.deltaMode === WHEEL_DELTA_LINE_MODE ? event.deltaY * WHEEL_LINE_HEIGHT_PX : event.deltaY;
  zoomAt(input, Math.exp(pixels * WHEEL_SENSITIVITY), event.clientX, event.clientY);
}

function onPointerDown(input, event) {
  input.pointers.set(event.pointerId, {
    x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
  });
  input.didDrag = false;
}

function handlePinch(input, event) {
  const before = pinchDistance(input);
  input.pointers.set(event.pointerId, { ...input.pointers.get(event.pointerId), x: event.clientX, y: event.clientY });
  const [first, second] = [...input.pointers.values()];
  zoomAt(input, before / pinchDistance(input), (first.x + second.x) * input.hooks.common.HALF, (first.y + second.y) * input.hooks.common.HALF);
  input.isDragging = true;
}

function handleDrag(input, event, pointer) {
  const travelled = Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY);
  if (!input.isDragging && travelled < DRAG_START_DISTANCE_PX) return;
  // Capture only once it is a drag: capturing on press would retarget the click away from the country.
  if (!input.isDragging) input.svg.setPointerCapture(event.pointerId);
  input.isDragging = true;
  const { getView, applyView, geo } = input.hooks;
  const scale = getView().width / input.svg.getBoundingClientRect().width;
  applyView(geo.panViewBox(getView(), (pointer.x - event.clientX) * scale, (pointer.y - event.clientY) * scale));
  input.pointers.set(event.pointerId, { ...pointer, x: event.clientX, y: event.clientY });
}

function onPointerMove(input, event) {
  const pointer = input.pointers.get(event.pointerId);
  if (!pointer) return;
  if (input.pointers.size === PINCH_POINTER_COUNT) handlePinch(input, event);
  else if (input.pointers.size === 1) handleDrag(input, event, pointer);
}

function onPointerEnd(input, event) {
  input.pointers.delete(event.pointerId);
  if (input.pointers.size > 0) return;
  input.didDrag = input.isDragging;
  input.isDragging = false;
  // A drag that ends over a country must not also select it: clear the flag after this click.
  setTimeout(() => { input.didDrag = false; }, 0);
}

/**
 * Attaches wheel, drag and pinch handling to the map SVG.
 * @param {SVGSVGElement} svg element receiving the pointer events
 * @param {{getView: function(): object, applyView: function(object): void, geo: object, common: object}} hooks
 *   `common` supplies the shared HALF constant
 *   `geo` supplies zoomViewBox / panViewBox from geo-render.js
 * @returns {{zoomBy: function(number): void, wasDragged: function(): boolean}}
 */
export function attachGestures(svg, hooks) {
  const input = { svg, hooks, pointers: new Map(), isDragging: false, didDrag: false };
  svg.addEventListener('wheel', (event) => onWheel(input, event), { passive: false });
  svg.addEventListener('pointerdown', (event) => onPointerDown(input, event));
  svg.addEventListener('pointermove', (event) => onPointerMove(input, event));
  svg.addEventListener('pointerup', (event) => onPointerEnd(input, event));
  svg.addEventListener('pointercancel', (event) => onPointerEnd(input, event));
  return {
    /** Zooms about the centre of the visible map; factor below 1 zooms in. */
    zoomBy(factor) {
      const view = hooks.getView();
      hooks.applyView(hooks.geo.zoomViewBox(view, factor, [view.x + view.width * hooks.common.HALF, view.y + view.height * hooks.common.HALF]));
    },
    /** True while the click that follows a drag must be ignored. */
    wasDragged: () => input.didDrag,
  };
}
