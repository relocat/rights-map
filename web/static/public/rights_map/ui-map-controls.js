// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Zoom in, zoom out and reset buttons of the map. Pure construction: the map decides what each
// action does, so the buttons work the same in country and district mode.

const STRINGS = Object.freeze({
  zoomInLabel: 'Zoom in',
  zoomOutLabel: 'Zoom out',
  resetView: 'Reset view',
  zoomGroupLabel: 'Map zoom',
});
/** View scale per zoom-in press; below 1 shrinks the viewBox. */
export const ZOOM_IN_FACTOR = 0.6;
/** The inverse of one zoom-in press. */
export const ZOOM_OUT_FACTOR = 1 / ZOOM_IN_FACTOR;
const [ZOOM_IN_TEXT, ZOOM_OUT_TEXT] = ['+', '\u2212'];
const RESET_ICON_PATH = 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5';
const [RESET_ICON_SIZE, RESET_ICON_VIEWBOX] = ['20', '0 0 24 24'];

/** The circular-arrow icon of the reset button. */
function buildResetIcon(common) {
  return common.s('svg', {
    attrs: { viewBox: RESET_ICON_VIEWBOX, width: RESET_ICON_SIZE, height: RESET_ICON_SIZE, 'aria-hidden': 'true' },
  }, [common.s('path', { cls: 'rm-icon-stroke', attrs: { d: RESET_ICON_PATH } })]);
}

/**
 * Builds the zoom button group.
 * @param {object} common ui-common helpers (`h`, `s`, `text`)
 * @param {{zoomBy: function(number): void, reset: function(): void}} actions
 * @returns {HTMLElement}
 */
export function createZoomControls(common, actions) {
  const control = (content, label, onClick) => common.h('button', {
    cls: 'rm-map-button', attrs: { type: 'button', 'aria-label': label, title: label }, on: { click: onClick },
  }, content);
  return common.h('div', { cls: 'rm-zoom-controls', attrs: { role: 'group', 'aria-label': STRINGS.zoomGroupLabel } }, [
    control([common.text(ZOOM_IN_TEXT)], STRINGS.zoomInLabel, () => actions.zoomBy(ZOOM_IN_FACTOR)),
    control([common.text(ZOOM_OUT_TEXT)], STRINGS.zoomOutLabel, () => actions.zoomBy(ZOOM_OUT_FACTOR)),
    control([buildResetIcon(common)], STRINGS.resetView, actions.reset),
  ]);
}
