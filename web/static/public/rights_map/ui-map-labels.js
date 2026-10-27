// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// City label collision avoidance. Labels keep one screen size at every zoom, so
// dense regions (the Ruhr) pile them on top of each other. Placement works on
// screen rectangles: the most important label claims its space first and any
// label that would touch an already placed one is hidden. Its dot stays.

/** Class that hides a label while keeping its layout box, so it can be measured again on the next run. */
export const HIDDEN_LABEL_CLASS = 'rm-city-label-hidden';
/** Gap in screen pixels kept free around every placed label. */
export const LABEL_PADDING_PX = 3;

/** Population from which a city always outranks smaller cities, like a capital (the tier-1 city file's cut-off). */
export const MAJOR_CITY_POPULATION = 1000000;

/** True when the two {left, top, right, bottom} rectangles are closer than `padding` pixels (or overlap). */
function isCrowded(first, second, padding) {
  return first.left < second.right + padding && first.right + padding > second.left
    && first.top < second.bottom + padding && first.bottom + padding > second.top;
}

/** True for a label that must not lose to a smaller city: a capital, or a city of a million or more. */
function isMajor(candidate) {
  return Boolean(candidate.isCapital) || (candidate.population ?? 0) >= MAJOR_CITY_POPULATION;
}

/**
 * Orders pinned first, then major cities (capitals and million-plus cities), then the rest; inside each
 * group the larger city comes first. Without the shared "major" group a small capital would hide Munich.
 */
function byPriority(first, second) {
  if (Boolean(first.isPinned) !== Boolean(second.isPinned)) return first.isPinned ? -1 : 1;
  if (isMajor(first) !== isMajor(second)) return isMajor(first) ? -1 : 1;
  return (second.population ?? 0) - (first.population ?? 0);
}

/**
 * Chooses which labels stay visible.
 * @param {Array<{id: *, isPinned?: boolean, isCapital?: boolean, population?: number}>} candidates
 *   pinned labels (the selected country's capital) always win, then capitals and cities of a million or
 *   more, then the rest; population descending inside each group
 * @param {function(object): ({left: number, top: number, right: number, bottom: number}|null)} measure
 *   screen rectangle of a candidate; null when it has no box (not shown at this zoom)
 * @returns {Set<*>} the `id` of every label that fits without touching a more important one
 */
export function placeLabels(candidates, measure) {
  const placed = [];
  const visibleIds = new Set();
  for (const candidate of [...candidates].sort(byPriority)) {
    const rectangle = measure(candidate);
    if (rectangle === null) continue;
    if (placed.some((other) => isCrowded(rectangle, other, LABEL_PADDING_PX))) continue;
    placed.push(rectangle);
    visibleIds.add(candidate.id);
  }
  return visibleIds;
}

/** Screen rectangle of an element, or null while it has no layout box (display: none). */
function measureElement(candidate) {
  const rectangle = candidate.id.getBoundingClientRect();
  return rectangle.width === 0 && rectangle.height === 0 ? null : rectangle;
}

/**
 * Creates the label placer for the city layer.
 * @param {{capitalLabel: HTMLElement}} elements the HTML label of the selected country's capital (pinned)
 * @returns {{register: function(Element, {isCapital: boolean, population: number}): void, run: function(): void}}
 */
export function createLabelPlacer({ capitalLabel }) {
  const registered = new Map();
  return {
    /** Adds a city label element with the data its priority is computed from. */
    register(element, { isCapital, population }) {
      registered.set(element, { id: element, isCapital, population });
    },
    /** Re-places every registered label for the current view. */
    run() {
      // Un-hide first: a hidden label of an earlier run may fit now, and it must be measurable.
      for (const element of registered.keys()) element.classList.remove(HIDDEN_LABEL_CLASS);
      const candidates = [...registered.values()];
      if (!capitalLabel.hidden) candidates.push({ id: capitalLabel, isPinned: true });
      const visibleIds = placeLabels(candidates, measureElement);
      for (const element of registered.keys()) element.classList.toggle(HIDDEN_LABEL_CLASS, !visibleIds.has(element));
    },
  };
}
