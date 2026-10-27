// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Which part of the full-bleed map the cards leave uncovered. The map is fitted
// into this area so Europe is never hidden behind the wizard, detail or finder card.

/** Gap between the fitted map and the cards around it, in screen pixels. */
const VIEW_PADDING_PX = 16;
const HIDDEN_VISIBILITY = 'hidden';
/** Selectors of the cards that float over the map, keyed by the role the fit gives them. */
export const CARD_SELECTORS = Object.freeze({
  topbar: '.rm-topbar', wizard: '.rm-wizard', detail: '.rm-detail', finder: '.rm-finder-cluster',
  finderCard: '.rm-finder', legend: '.rm-legend-block',
});

function isShown(element) {
  return Boolean(element) && element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== HIDDEN_VISIBILITY;
}

/** Shrinks `area` by each card that overlaps it, on the side the card sits at. */
function excludeCards(rootElement, area, mapRect, half) {
  const rects = Object.fromEntries(Object.entries(CARD_SELECTORS).map(([key, selector]) => {
    const element = rootElement.parentElement.querySelector(selector);
    return [key, isShown(element) ? element.getBoundingClientRect() : null];
  }));
  const { topbar, wizard, finderCard } = rects;
  // Only one of the two detail cards is shown at a time; the fit treats whichever is open as the detail card.
  const detail = rects.detail ?? rects.authorityCard;
  const middleX = mapRect.left + mapRect.width * half;
  if (topbar && topbar.bottom > mapRect.top) area.top = Math.max(area.top, topbar.bottom - mapRect.top);
  if (wizard && wizard.right > mapRect.left && wizard.left < middleX) area.left = Math.max(area.left, wizard.right - mapRect.left);
  const rightCards = [detail, finderCard].filter((card) => card && card.left > middleX);
  for (const card of rightCards) area.right = Math.min(area.right, card.left - mapRect.left);
  if (detail && detail.left <= middleX) area.bottom = Math.min(area.bottom, detail.top - mapRect.top);
  const middleY = mapRect.top + mapRect.height * half;
  const bottomCards = [rects.finder, rects.legend].filter((card) => card && card.top > middleY);
  for (const card of bottomCards) area.bottom = Math.min(area.bottom, card.top - mapRect.top);
  return area;
}

/** Custom property carrying the real height of the legend block, read by rights_map.css. */
export const DOCK_HEIGHT_PROPERTY = '--rm-dock-height';

/**
 * Publishes the measured height of the bottom-right legend block (metric switch, legend,
 * attribution) so the zoom buttons and the detail card clear it at every window size, instead
 * of relying on a fixed reserve that a wrapping legend or the metric switch row outgrows.
 * @param {HTMLElement} rootElement the map panel; the legend block is its sibling
 */
export function publishDockHeight(rootElement) {
  const root = rootElement.parentElement;
  const legend = root.querySelector(CARD_SELECTORS.legend);
  const height = isShown(legend) ? legend.getBoundingClientRect().height : 0;
  root.style.setProperty(DOCK_HEIGHT_PROPERTY, `${height}px`);
}

/**
 * The part of the full-bleed map not covered by cards, in pixels relative to the map, padded.
 * @param {HTMLElement} rootElement the map panel; the cards are its siblings
 * @param {SVGElement} svg the map svg
 * @param {number} half the factor 0.5, shared via ui-common
 * @returns {{left: number, top: number, right: number, bottom: number}}
 */
export function visibleMapArea(rootElement, svg, half) {
  const rect = svg.getBoundingClientRect();
  const area = excludeCards(rootElement, { left: 0, top: 0, right: rect.width, bottom: rect.height }, rect, half);
  const padded = {
    left: area.left + VIEW_PADDING_PX, top: area.top + VIEW_PADDING_PX,
    right: area.right - VIEW_PADDING_PX, bottom: area.bottom - VIEW_PADDING_PX,
  };
  const isUsable = padded.right - padded.left > VIEW_PADDING_PX && padded.bottom - padded.top > VIEW_PADDING_PX;
  return isUsable ? padded : { left: 0, top: 0, right: rect.width, bottom: rect.height };
}
