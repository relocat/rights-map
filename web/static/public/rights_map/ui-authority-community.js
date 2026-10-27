// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// The community parts of the authority card: for every metric the weekly community snapshot states,
// a line to show under a sourced figure, or a headline, badge and count line that stand in for a
// missing one. Text nodes only; the band is shown, never an exact count.

const METRIC_KEYS = Object.freeze(['total', 'wait', 'proc']);

/**
 * Builds the community parts of every metric the authority has.
 * @param {{common: object, modules: object}} deps `modules` holds community-client
 * @param {?object} entry the authority's community entry, if any
 * @returns {Object<string, {element: HTMLElement, headline: string, badge: string, summary: string}>} metric key
 *   to `element` (the line under a sourced figure), `headline` and `badge` (replace "No data") and `summary`
 *   (the count and typical range); a metric without a figure is absent
 */
export function buildCommunityRows(deps, entry) {
  const { h } = deps.common;
  const { formatCommunityRow } = deps.modules['community-client'];
  const rows = {};
  for (const key of METRIC_KEYS) {
    if (!entry?.[key]) continue;
    const { badge, text, headline, summary } = formatCommunityRow(entry, entry[key]);
    const element = h('p', { cls: 'rm-time-community' }, [
      h('span', { cls: 'rm-source-badge rm-source-community', text: badge }),
      h('span', { text: ` ${text}` }),
    ]);
    rows[key] = { element, headline, badge, summary };
  }
  return rows;
}
