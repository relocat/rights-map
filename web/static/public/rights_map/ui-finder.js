// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// "Find a country" select (the keyboard and screen reader path to every
// country; on desktop it sits above the detail card), the legend with counts
// and the attribution line (bottom right), and a visually hidden live region
// announcing map updates. On an authority topic the same widgets switch to
// districts: "Find a district", the time-metric radiogroup, the bucket legend
// and the BKG attribution read from the geo manifest.

const STRINGS = Object.freeze({
  findLabel: 'Find a country',
  placeholder: 'Choose a country',
  legendLabel: 'Legend',
  attribution: 'General information, not legal advice · Borders: Natural Earth · Places: GeoNames (CC BY 4.0) · Grey stripes = not verified yet',
  mapUpdated: 'Map updated: ',
  openReportLabel: 'Open report',
  findDistrictLabel: 'Find a district',
  districtPlaceholder: 'Choose a district',
  metricGroupLabel: 'Time shown on the map',
  noData: 'No data',
  noDataAria: 'no data',
  unconfirmed: 'Not verified yet',
  unconfirmedAria: 'unconfirmed',
  districtsWithData: 'districts with data',
  districtsAttributionPrefix: 'Districts: ',
  providerName: 'BKG',
  // German on purpose: BKG's Quellenvermerk prescribes this wording verbatim.
  datasourcesLabel: ', Datenquellen: ',
});
const ATTRIBUTION_SEPARATOR = ' · ';
const HTTPS_PREFIX = 'https://';
const EXTERNAL_LINK_REL = 'noopener noreferrer';
const EXTERNAL_LINK_TARGET = '_blank';
const LEGEND_KEY_BUCKET_PREFIX = 'bucket-';
const LEGEND_KEY_NO_DATA = 'nodata';
const LEGEND_KEY_UNCONFIRMED = 'unconfirmed';
const SWATCH_CLASS_PREFIX = 'rm-swatch rm-swatch-';
const METRIC_OPTION_CLASS = 'rm-metric-option';
const FINDER_CLASS = 'rm-finder';
/** Marks the finder in district mode: its option texts are long, so the CSS sizes the card, not the select. */
const FINDER_DISTRICTS_CLASS = 'rm-finder-districts';
const TAB_STOP = '0';
const NO_TAB_STOP = '-1';
const ARROW_STEP = Object.freeze({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 });
const SORT_LOCALE = 'en';
/** Geo manifest key of the district layer; `manifest.layers` carries its licence block. */
export const DISTRICT_LAYER_KEY = 'l2/DE.json';

/** DOM id of the finder select; the label points at it. */
export const FINDER_SELECT_ID = 'rm-finder-select';

/**
 * @param {Object<string, {status: string}>} statuses per-country results
 * @returns {Object<string, number>} how many countries have each status
 */
export function countStatuses(statuses) {
  const counts = {};
  for (const { status } of Object.values(statuses)) counts[status] = (counts[status] ?? 0) + 1;
  return counts;
}

/** The legend only makes sense once the map is coloured. */
export function isColoured(state) {
  return state.result !== null && state.result.missing.length === 0;
}

function buildLegendItem(deps, { status, label, count }) {
  const { h, STATUS_SYMBOL, statusClass } = deps.common;
  return h('li', { cls: 'rm-legend-item' }, [
    h('span', { cls: `rm-swatch ${statusClass(status)}`, text: STATUS_SYMBOL[status], attrs: { 'aria-hidden': 'true' } }),
    h('span', { text: label }),
    h('strong', { cls: 'rm-mono', text: String(count) }),
  ]);
}

/**
 * @param {{isDisputed: function(?object, string, string): boolean}} deps
 * @param {object} state app state (disputed, topicId, countries)
 * @returns {number} how many covered countries have an open report for the chosen topic
 */
export function countDisputed(deps, state) {
  return state.countries.filter(({ iso2 }) => deps.isDisputed(state.disputed, state.topicId, iso2)).length;
}

/** The "Open report" row: a plain dotted swatch without a symbol, because the overlay never changes a status. */
function buildDisputedLegendItem(deps, count) {
  const { h } = deps.common;
  return h('li', { cls: 'rm-legend-item' }, [
    h('span', { cls: 'rm-swatch rm-swatch-disputed', attrs: { 'aria-hidden': 'true' } }),
    h('span', { text: STRINGS.openReportLabel }),
    h('strong', { cls: 'rm-mono', text: String(count) }),
  ]);
}

/**
 * Legend rows (data) for the statuses present, always including 'ok' so the goal state is visible.
 * @returns {Array<{status: string, label: string, count: number}>} in STATUS_ORDER
 */
export function legendItems(deps, topic, counts) {
  const okStatus = deps.engine.STATUS.OK;
  return deps.common.STATUS_ORDER
    .filter((status) => (counts[status] ?? 0) > 0 || status === okStatus)
    .map((status) => ({ status, label: topic.labels[status], count: counts[status] ?? 0 }));
}

/** @returns {string} the screen-reader sentence for the current number of 'ok' countries */
export function announcement(deps, topic, counts) {
  const okStatus = deps.engine.STATUS.OK;
  return `${STRINGS.mapUpdated}${counts[okStatus] ?? 0} ${topic.labels[okStatus]}`;
}

/**
 * Legend rows of the district map: one per time bucket, then "no data" and "unconfirmed".
 * @param {{bucketLabels: string[], noData: string, unconfirmed: string}} strings display texts
 * @param {number[]} bucketsMonths ascending bucket thresholds; there is one bucket more than thresholds
 * @returns {Array<{key: string, label: string}>} keys `bucket-0` …, `nodata`, `unconfirmed`
 */
export function districtLegendItems(strings, bucketsMonths) {
  const bucketCount = bucketsMonths.length + 1;
  return [
    ...Array.from({ length: bucketCount }, (_, index) => ({
      key: `${LEGEND_KEY_BUCKET_PREFIX}${index}`, label: strings.bucketLabels[index],
    })),
    { key: LEGEND_KEY_NO_DATA, label: strings.noData },
    { key: LEGEND_KEY_UNCONFIRMED, label: strings.unconfirmed },
  ];
}

/**
 * Splits `text` into plain and linked parts: each term is linked to its URL, searched in order.
 * A term that is missing, or whose URL is not https, stays plain text.
 * @param {string} text the credit text
 * @param {{term: string, href: ?string}[]} links terms to link, in the order they appear in `text`
 * @returns {{text: string, href?: string}[]} consecutive parts that join back to `text`
 */
function linkTerms(text, links) {
  const parts = [];
  let cursor = 0;
  for (const { term, href } of links) {
    const at = text.indexOf(term, cursor);
    if (at < 0 || !String(href).startsWith(HTTPS_PREFIX)) continue;
    if (at > cursor) parts.push({ text: text.slice(cursor, at) });
    parts.push({ text: term, href });
    cursor = at + term.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}

/** The district layer's credit as BKG's Quellenvermerk requires: credit, licence, Datenquellen link. */
function districtCreditParts(layer) {
  const parts = linkTerms(layer.attribution, [
    { term: STRINGS.providerName, href: layer.provider_url },
    { term: layer.licence, href: layer.licence_url },
  ]);
  if (layer.datasources_url) {
    parts.push({ text: STRINGS.datasourcesLabel }, { text: layer.datasources_url, href: layer.datasources_url });
  }
  return parts;
}

/**
 * The attribution line as parts. The district layer's credit, licence, links and change note come
 * from the manifest, so a licence change in the pack needs no code change.
 * @param {?{layers?: object}} manifest the geo manifest (null before it has loaded)
 * @param {boolean} isDistrictLayerShown whether the map is currently drawing districts
 * @returns {{text: string, href?: string}[]} parts to render; a part with `href` is a link
 */
export function attributionParts(manifest, isDistrictLayerShown) {
  const layer = manifest?.layers?.[DISTRICT_LAYER_KEY];
  if (!isDistrictLayerShown || !layer) return [{ text: STRINGS.attribution }];
  return [
    { text: `${STRINGS.attribution}${ATTRIBUTION_SEPARATOR}${STRINGS.districtsAttributionPrefix}` },
    ...districtCreditParts(layer),
    { text: `${ATTRIBUTION_SEPARATOR}${layer.modified}` },
  ];
}

/**
 * The attribution line as plain text.
 * @param {?{layers?: object}} manifest the geo manifest (null before it has loaded)
 * @param {boolean} isDistrictLayerShown whether the map is currently drawing districts
 * @returns {string} the footer text
 */
export function attributionText(manifest, isDistrictLayerShown) {
  return attributionParts(manifest, isDistrictLayerShown).map((part) => part.text).join('');
}

/** Replaces the footer's content with text nodes and links (never markup). */
function renderAttribution(deps, element, parts) {
  const { h, text } = deps.common;
  element.replaceChildren(...parts.map((part) => (part.href
    ? h('a', { text: part.text, attrs: { href: part.href, target: EXTERNAL_LINK_TARGET, rel: EXTERNAL_LINK_REL } })
    : text(part.text))));
}

/**
 * Next metric for an arrow key in the metric radiogroup (wraps around).
 * @param {string[]} options metric values in display order
 * @param {string} current the checked metric
 * @param {string} key the `KeyboardEvent.key`
 * @returns {?string} the metric to select, or null when the key is not an arrow
 */
export function nextMetric(options, current, key) {
  const step = ARROW_STEP[key];
  if (step === undefined) return null;
  const index = options.indexOf(current);
  return options[(index + step + options.length) % options.length];
}

/**
 * Paint of every district under the current metric.
 * @returns {Array<{ags: string, label: string, paint: {bucket: ?number, isConfirmed: boolean}}>} sorted by label
 */
function districtEntries(deps, state, topic) {
  const context = {
    todayMonth: deps.engine.monthIndex(state.today), bucketsMonths: topic.colour.buckets_months, community: state.community,
  };
  const { districtPaint } = deps.modules['authority-metrics'];
  return [...state.districts.labels]
    .map(([ags, label]) => ({ ags, label, paint: districtPaint(state.districts.byAgs[ags], state.metric, context) }))
    .sort((left, right) => left.label.localeCompare(right.label, SORT_LOCALE));
}

function buildDistrictLegendItem(deps, { key, label }) {
  const { h } = deps.common;
  return h('li', { cls: 'rm-legend-item' }, [
    h('span', { cls: `${SWATCH_CLASS_PREFIX}${key}`, attrs: { 'aria-hidden': 'true' } }),
    h('span', { text: label }),
  ]);
}

/**
 * The time-metric radiogroup, with a roving tabindex: only the checked option is a tab stop.
 * Buttons are built once per option list, so focus survives every re-render.
 * @returns {{element: HTMLElement, render: function(string[], string): void}}
 */
function createMetricSwitch(deps, callbacks) {
  const { h, METRIC_LABELS } = deps.common;
  const element = h('div', {
    cls: 'rm-metric-switch', attrs: { role: 'radiogroup', 'aria-label': STRINGS.metricGroupLabel, hidden: true },
  });
  const buttons = new Map();
  let builtKey = '';
  const onKeydown = (options, metric, event) => {
    const target = nextMetric(options, metric, event.key);
    if (target === null) return;
    event.preventDefault();
    callbacks.onSetMetric(target);
    buttons.get(target).focus();
  };
  const build = (options) => {
    buttons.clear();
    for (const metric of options) {
      buttons.set(metric, h('button', {
        cls: METRIC_OPTION_CLASS, text: METRIC_LABELS[metric], attrs: { type: 'button', role: 'radio' },
        on: { click: () => callbacks.onSetMetric(metric), keydown: (event) => onKeydown(options, metric, event) },
      }));
    }
    element.replaceChildren(...buttons.values());
  };
  return {
    element,
    render(options, current) {
      if (builtKey !== options.join()) { builtKey = options.join(); build(options); }
      for (const [metric, button] of buttons) {
        const isChecked = metric === current;
        button.setAttribute('aria-checked', String(isChecked));
        button.setAttribute('tabindex', isChecked ? TAB_STOP : NO_TAB_STOP);
      }
    },
  };
}

/** Option texts of the district finder: label, bucket and a flag for unconfirmed figures. */
function districtOptionTexts(deps, entries) {
  const strings = { bucketLabels: deps.common.BUCKET_LABELS, noData: STRINGS.noDataAria, unconfirmed: STRINGS.unconfirmedAria };
  const { districtAriaLabel } = deps.modules['ui-map-districts'];
  return entries.map(({ label, paint }) => districtAriaLabel(label, paint, strings));
}

function fillDistrictSelect(select, deps, entries) {
  const { h } = deps.common;
  const texts = districtOptionTexts(deps, entries);
  select.replaceChildren(
    h('option', { text: STRINGS.districtPlaceholder, attrs: { value: '' } }),
    ...entries.map(({ ags }, index) => h('option', { text: texts[index], attrs: { value: ags } })),
  );
  return texts.join('\n');
}

function fillSelect(select, deps, countries) {
  const { h } = deps.common;
  select.replaceChildren(
    h('option', { text: STRINGS.placeholder, attrs: { value: '' } }),
    ...countries.map(({ iso2, name }) => h('option', { text: name, attrs: { value: iso2 } })),
  );
}

/**
 * @returns {boolean} whether the chosen topic is an authority topic with its districts loaded
 */
function isDistrictMode(deps, state) {
  if (!state.topicId || !state.districts?.collection) return false;
  return deps.engine.isAuthorityTopic(deps.engine.findTopic(state.rules, state.topicId));
}

/** Legend, live-region sentence and finder entries of the district map. */
function renderDistricts(parts, deps, state) {
  const topic = deps.engine.findTopic(state.rules, state.topicId);
  const entries = districtEntries(deps, state, topic);
  const legendStrings = { bucketLabels: deps.common.BUCKET_LABELS, noData: STRINGS.noData, unconfirmed: STRINGS.unconfirmed };
  parts.metricSwitch.element.hidden = false;
  parts.metricSwitch.render(topic.colour.metric_options, state.metric);
  parts.legend.hidden = false;
  deps.common.rebuild(parts.legend, () => districtLegendItems(legendStrings, topic.colour.buckets_months)
    .map((item) => buildDistrictLegendItem(deps, item)));
  const optionsKey = districtOptionTexts(deps, entries).join('\n');
  if (parts.listed.key !== optionsKey) parts.listed.key = fillDistrictSelect(parts.select, deps, entries);
  parts.select.value = state.selectedAgs ?? '';
  const withData = entries.filter(({ paint }) => paint.bucket !== null).length;
  return `${withData} ${STRINGS.districtsWithData}`;
}

/** Legend, live-region sentence and finder entries of the country map; null while it is not coloured. */
function renderCountries(parts, deps, state) {
  const { sortByName, rebuild } = deps.common;
  parts.metricSwitch.element.hidden = true;
  if (parts.listed.key !== state.countries) {
    parts.listed.key = state.countries;
    fillSelect(parts.select, deps, sortByName(state.countries));
  }
  parts.select.value = state.selectedIso2 ?? '';
  const topic = state.topicId ? deps.engine.findTopic(state.rules, state.topicId) : null;
  // An authority topic renders here only while its district layer is still loading:
  // it has no country status labels, so there is no country legend to build yet.
  const coloured = isColoured(state) && topic !== null && !deps.engine.isAuthorityTopic(topic);
  parts.legend.hidden = !coloured;
  if (!coloured) return null;
  const counts = countStatuses(state.result.statuses);
  const disputedCount = countDisputed(deps, state);
  rebuild(parts.legend, () => [
    ...legendItems(deps, topic, counts).map((item) => buildLegendItem(deps, item)),
    ...(disputedCount > 0 ? [buildDisputedLegendItem(deps, disputedCount)] : []),
  ]);
  return announcement(deps, topic, counts);
}

/**
 * Creates the finder, metric switch, legend, attribution and live region.
 * @param {HTMLElement} rootElement container to fill
 * @param {{onSelectCountry: function(string): void, onFindDistrict: function(string): void,
 *   onSetMetric: function(string): void}} callbacks
 * @param {{common: object, engine: object, modules: object}} deps injected helpers; `modules` holds
 *   authority-metrics and ui-map-districts, which sibling modules cannot import
 * @returns {{render: function(object): void, legendBlock: HTMLElement}} `legendBlock` holds the metric
 *   switch, legend and attribution; on a phone ui-sources shows it as a panel
 */
export function createFinder(rootElement, callbacks, deps) {
  const { h } = deps.common;
  const select = h('select', { attrs: { id: FINDER_SELECT_ID } });
  const findLabel = h('span');
  const finderCard = h('label', { cls: FINDER_CLASS, attrs: { for: FINDER_SELECT_ID } }, [findLabel, select]);
  const legend = h('ul', { cls: 'rm-legend', attrs: { 'aria-label': STRINGS.legendLabel } });
  const attribution = h('p', { cls: 'rm-attribution' });
  const live = h('p', { cls: 'rm-visually-hidden', attrs: { role: 'status', 'aria-live': 'polite' } });
  const metricSwitch = createMetricSwitch(deps, callbacks);
  let isDistrictSelect = false;
  select.addEventListener('change', () => {
    if (!select.value) return;
    if (isDistrictSelect) callbacks.onFindDistrict(select.value);
    else callbacks.onSelectCountry(select.value);
  });
  const legendBlock = h('div', { cls: 'rm-legend-block' }, [metricSwitch.element, legend, attribution]);
  rootElement.append(finderCard, legendBlock, live);
  const parts = { select, legend, metricSwitch, listed: { key: null } };
  let lastAnnouncement = null;

  return {
    legendBlock,
    /** @param {object} state app state */
    render(state) {
      const isDistricts = isDistrictMode(deps, state);
      isDistrictSelect = isDistricts;
      findLabel.textContent = isDistricts ? STRINGS.findDistrictLabel : STRINGS.findLabel;
      finderCard.setAttribute('class', isDistricts ? `${FINDER_CLASS} ${FINDER_DISTRICTS_CLASS}` : FINDER_CLASS);
      renderAttribution(deps, attribution, attributionParts(state.manifest, isDistricts));
      const sentence = isDistricts ? renderDistricts(parts, deps, state) : renderCountries(parts, deps, state);
      if (sentence === null || sentence === lastAnnouncement) return;
      live.textContent = sentence;
      lastAnnouncement = sentence;
    },
  };
}
