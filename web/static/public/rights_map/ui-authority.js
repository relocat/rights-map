// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Authority card (desktop: floating right card, phone: bottom sheet, like the country card). Shows
// the naturalisation authority behind the selected district: how to apply, three time figures with
// their sources, the evidence, legal notes and the check warnings for the visitor's facts. Every
// time figure is drawn by `buildTimeRow`, so the later correction flow has one place to hook into.
//
// Text only: authority data is rendered through text nodes and https links, never as markup.

const STRINGS = Object.freeze({
  closeLabel: 'Close authority detail',
  eyebrow: 'Naturalisation authority',
  warningLead: 'Warning.',
  noData: 'No data',
  openEnded: 'or later',
  unconfirmed: 'unconfirmed',
  staleOfficial: (months) => `Official figure ${months} ${months === 1 ? 'month' : 'months'} old`,
  staleUndated: 'Official figure is undated',
  noAuthority: 'No authority data for this district yet.',
  evidenceHeading: 'Evidence',
  notesHeading: 'Legal notes',
  coversLabel: 'Covers',
  disclaimer: 'General information, not legal advice.',
  communityBadge: (count) => `Community · ${count}`,
  detailsLabel: 'Details',
  reportLabel: 'Report outdated info',
  experienceLabel: 'Share my experience',
  experienceGap: 'No waiting time known for this office yet. Went through naturalisation here? Your experience fills the map.',
  reportPrefill: (name, id) => `Authority: ${name} (${id})\n\n`,
});
const SOURCE_LABELS = Object.freeze({
  official: 'Official', community: 'Community', estimate: 'Estimate', press: 'Press', none: STRINGS.noData,
});
const SRC_COMMUNITY = 'community';
const SRC_NONE = 'none';
/** Time figures the card reads: the total is the main block, the other two sit in its details. */
const TIME_KEYS = Object.freeze(['wait', 'proc', 'total']);
const TOTAL_KEY = 'total';
/** Figures shown inside the Details section, in card order: waiting for the application slot, then processing. */
const DETAIL_KEYS = Object.freeze(['wait', 'proc']);
const DETAILS_PANEL_ID = 'rm-authority-time-details';
const DETAILS_FOCUS_KEY = 'authority-time-details';
const BAR_KEYS = Object.freeze(['wait', 'proc']);
/** Months the full width of the time bar stands for. */
const TIME_BAR_SCALE_MONTHS = 48;
/** Width of a zero-month segment: visible, but clearly "none". */
const MIN_SEGMENT_FRACTION = 0.02;
/** Width of the dashed placeholder for a figure nobody has. */
const UNKNOWN_SEGMENT_FRACTION = 0.18;
const FULL_FRACTION = 1;
const HALF = 0.5;
const PERCENT = 100;
const SEGMENT_STATE = Object.freeze({ KNOWN: 'known', UNCONFIRMED: 'unconfirmed', UNKNOWN: 'unknown' });
const PLACEHOLDER_PATTERN = /\{([a-z0-9_]+)\}/g;
const WARNING_SYMBOL = '!';
const EXTERNAL_LINK_REL = 'noopener noreferrer';
const EXTERNAL_LINK_TARGET = '_blank';
const TITLE_ID = 'rm-authority-title';
const CLOSE_FOCUS_KEY = 'authority-close';
const CLOSE_SYMBOL = '×';
const REPORT_FOCUS_KEY = 'authority-report';
const EXPERIENCE_FOCUS_KEY = 'authority-experience';
/** Stable test hook: the invitation line is found by this attribute, never by its wording. */
const GAP_TEST_ATTRIBUTES = Object.freeze({ 'data-testid': 'experience-gap' });
/** Country the report dialog files naturalisation authority reports under (the pilot covers Germany only). */
const AUTHORITY_REPORT_COUNTRY = 'DE';

/**
 * Badge text for the source of a figure.
 * @param {{src?: string, n?: number}|undefined} value a `times.*` or `mode` entry
 * @returns {string} 'Official', 'Community · 3', 'Estimate', 'Press' or 'No data'
 */
export function sourceBadgeText(value) {
  const src = value?.src ?? SRC_NONE;
  if (src === SRC_COMMUNITY && value.nBand) return SOURCE_LABELS[SRC_COMMUNITY];
  if (src === SRC_COMMUNITY && Number.isFinite(value.n)) return STRINGS.communityBadge(value.n);
  return SOURCE_LABELS[src] ?? SOURCE_LABELS[SRC_NONE];
}

function segmentFraction(months, scaleMonths) {
  if (months === 0) return MIN_SEGMENT_FRACTION;
  return Math.min(months / scaleMonths, FULL_FRACTION);
}

/** Bar months of a figure: the middle of a range, `lo` when open-ended; null when unusable. */
function barMonths(value) {
  if (!value || value.src === SRC_NONE || !Number.isFinite(value.lo)) return null;
  return Number.isFinite(value.hi) ? (value.lo + value.hi) * HALF : value.lo;
}

/**
 * Widths and states of the two bar segments. The bar shows the middle of a range, while map and
 * warnings use the upper bound: a bar is a picture of "roughly how long", the others must not
 * understate a risk.
 * @param {object} times the authority's `times`
 * @param {number} scaleMonths months the full bar width stands for
 * @param {function(object): boolean} isConfirmedValue whether a figure is solid (not striped)
 * @returns {{wait: {widthFraction: number, state: string}, proc: {widthFraction: number, state: string}}}
 *   `widthFraction` is 0…1; a figure over the scale is capped at 1
 */
export function timeBarSegments(times, scaleMonths, isConfirmedValue) {
  const segments = {};
  for (const key of BAR_KEYS) {
    const months = barMonths(times?.[key]);
    if (months === null) {
      segments[key] = { widthFraction: UNKNOWN_SEGMENT_FRACTION, state: SEGMENT_STATE.UNKNOWN };
    } else {
      segments[key] = {
        widthFraction: segmentFraction(months, scaleMonths),
        state: isConfirmedValue(times[key]) ? SEGMENT_STATE.KNOWN : SEGMENT_STATE.UNCONFIRMED,
      };
    }
  }
  return segments;
}

function buildSourceBadge(deps, value) {
  const { h } = deps.common;
  const src = value?.src ?? SRC_NONE;
  return h('span', { cls: `rm-source-badge rm-source-${src}`, text: sourceBadgeText(value) });
}

function buildStaleText(deps, value, todayMonth) {
  const { h } = deps.common;
  const metrics = deps.modules['authority-metrics'];
  if (!metrics.isStale(value, todayMonth)) return null;
  const age = metrics.ageInMonths(value, todayMonth);
  return h('span', { cls: 'rm-time-stale', text: age === null ? STRINGS.staleUndated : STRINGS.staleOfficial(age) });
}

/**
 * One time figure: label, value, source badge, date, staleness and note. The single place a time
 * value is rendered.
 * @param {{common: object, modules: object}} deps
 * @param {string} key 'wait' | 'proc' | 'total'
 * @param {object|undefined} value the `times.*` entry
 * @param {number} todayMonth current month number (year*12 + month-1)
 * @param {?{element: HTMLElement, headline: string, badge: string, summary: string}} [community] the community
 *   parts of this metric: shown under a sourced figure, or instead of "No data" when there is none
 * @returns {HTMLElement} the list item
 */
export function buildTimeRow(deps, key, value, todayMonth, community = null) {
  const { h } = deps.common;
  const metrics = deps.modules['authority-metrics'];
  const hasValue = hasFigure(value);
  const isUnconfirmed = hasValue && !metrics.isConfirmed(value, todayMonth);
  const isCommunityOnly = !hasValue && community !== null;
  return h('li', { cls: `rm-time-row rm-time-${key}` }, [
    h('span', { cls: 'rm-time-label', text: deps.common.METRIC_LABELS[key] }),
    h('p', { cls: 'rm-time-value' }, [
      h('span', { text: communityHeadline(hasValue, value, community) }),
      hasValue && value.partial ? h('span', { cls: 'rm-time-open', text: ` ${STRINGS.openEnded}` }) : null,
    ]),
    h('div', { cls: 'rm-time-meta' }, [
      isCommunityOnly ? buildCommunityBadge(deps, community) : buildSourceBadge(deps, value),
      hasValue ? h('span', { cls: 'rm-mono rm-time-date', text: value.date }) : null,
      hasValue ? buildStaleText(deps, value, todayMonth) : null,
      isUnconfirmed ? h('span', { cls: 'rm-time-unconfirmed', text: STRINGS.unconfirmed }) : null,
    ]),
    hasValue && value.note ? h('p', { cls: 'rm-time-note', text: value.note }) : null,
    isCommunityOnly ? h('p', { cls: 'rm-time-community', text: community.summary }) : null,
    hasValue && community ? community.element : null,
  ]);
}

/** The headline of a time row: the sourced text, else the community headline, else "No data". */
function communityHeadline(hasValue, value, community) {
  if (hasValue) return value.text;
  return community === null ? STRINGS.noData : community.headline;
}

function buildCommunityBadge(deps, community) {
  return deps.common.h('span', { cls: `rm-source-badge rm-source-${SRC_COMMUNITY}`, text: community.badge });
}

/** True when a figure carries a value from a source (not the "No data" placeholder). */
function hasFigure(value) {
  return Boolean(value) && value.src !== SRC_NONE;
}

/**
 * Whether Details starts open: only when the total is missing but wait or processing is known (sourced
 * or community), so the card never shows a "No data" headline that hides the figures it does have.
 * @param {object} times publishable figures by key
 * @param {object} [communityParts] the community parts by metric key
 * @returns {boolean}
 */
export function shouldOpenDetailsByDefault(times, communityParts = {}) {
  const isKnown = (key) => hasFigure(times[key]) || Boolean(communityParts[key]);
  return !isKnown(TOTAL_KEY) && DETAIL_KEYS.some(isKnown);
}

/**
 * The main time block: the total figure with a "Details" button that expands wait and processing.
 * `isOpen` is the card's remembered state, so a re-render keeps what the visitor chose.
 * @param {{common: object, modules: object}} deps
 * @param {object} times publishable figures by key
 * @param {{todayMonth: number, isOpen: boolean, onToggle: function(boolean): void,
 *   communityRows?: Object<string, object>}} options `communityRows` holds the optional community parts per metric
 * @returns {HTMLElement} the list item of the total, holding the button and the details section
 */
export function buildTotalBlock(deps, times, { todayMonth, isOpen, onToggle, communityRows = {} }) {
  const { h, focusKey } = deps.common;
  const panel = h('ul', { cls: 'rm-time-details', attrs: { id: DETAILS_PANEL_ID, hidden: !isOpen } },
    DETAIL_KEYS.map((key) => buildTimeRow(deps, key, times[key], todayMonth, communityRows[key] ?? null)));
  const button = h('button', {
    cls: 'rm-link-button rm-time-details-toggle', text: STRINGS.detailsLabel,
    attrs: { type: 'button', 'aria-expanded': String(isOpen), 'aria-controls': DETAILS_PANEL_ID, ...focusKey(DETAILS_FOCUS_KEY) },
  });
  button.addEventListener('click', () => {
    const willOpen = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(willOpen));
    panel.hidden = !willOpen;
    onToggle(willOpen);
  });
  const block = buildTimeRow(deps, TOTAL_KEY, times[TOTAL_KEY], todayMonth, communityRows[TOTAL_KEY] ?? null);
  block.append(button, panel);
  return block;
}

function buildTimeBar(deps, times, todayMonth) {
  const { h } = deps.common;
  const metrics = deps.modules['authority-metrics'];
  const segments = timeBarSegments(times, TIME_BAR_SCALE_MONTHS, (value) => metrics.isConfirmed(value, todayMonth));
  const bar = h('div', { cls: 'rm-time-bar', attrs: { 'aria-hidden': 'true' } });
  for (const key of BAR_KEYS) {
    const segment = h('span', { cls: `rm-time-segment rm-time-segment-${key} rm-time-segment-${segments[key].state}` });
    segment.style.width = `${segments[key].widthFraction * PERCENT}%`;
    bar.append(segment);
  }
  return bar;
}

function buildWarnings(deps, state) {
  const { h, formatMonthYear } = deps.common;
  const values = { ...state.facts, ...state.authorityResult?.milestones };
  const fill = (text) => text.replace(PLACEHOLDER_PATTERN, (match, name) => (
    values[name] === undefined ? match : formatMonthYear(values[name])));
  return (state.authorityResult?.checks ?? []).map((check) => h('p', { cls: 'rm-warning', attrs: { role: 'status' } }, [
    h('span', { cls: 'rm-warning-icon', text: WARNING_SYMBOL, attrs: { 'aria-hidden': 'true' } }),
    h('span', {}, [h('strong', { text: `${STRINGS.warningLead} ` }), h('span', { text: fill(check.text) })]),
  ]));
}

function buildEvidenceTitle(deps, entry) {
  const { h, isSafeLink } = deps.common;
  if (!isSafeLink(entry.url)) return h('span', { cls: 'rm-evidence-title', text: entry.title });
  return h('a', {
    cls: 'rm-evidence-title', text: entry.title,
    attrs: { href: entry.url, target: EXTERNAL_LINK_TARGET, rel: EXTERNAL_LINK_REL },
  });
}

function buildEvidenceList(deps, authority) {
  const { h } = deps.common;
  const items = authority.evidence.map((entry) => h('li', { cls: 'rm-evidence-item' }, [
    h('span', { cls: `rm-source-badge rm-source-${entry.kind}`, text: sourceBadgeText({ src: entry.kind }) }),
    buildEvidenceTitle(deps, entry),
    h('span', { cls: 'rm-mono rm-time-date', text: entry.date }),
    h('p', { cls: 'rm-evidence-text', text: entry.text }),
  ]));
  if (items.length === 0) return null;
  return h('section', {}, [
    h('h3', { cls: 'rm-section-heading', text: STRINGS.evidenceHeading }), h('ul', { cls: 'rm-evidence-list' }, items),
  ]);
}

function buildLegalNotes(deps, topic) {
  const { h } = deps.common;
  const notes = topic.legal_notes ?? [];
  if (notes.length === 0) return null;
  return h('section', {}, [
    h('h3', { cls: 'rm-section-heading', text: STRINGS.notesHeading }),
    h('ul', { cls: 'rm-detail-list' }, notes.map((note) => h('li', { text: note }))),
  ]);
}

function buildHeader(deps, heading, authority, onClose) {
  const { h, focusKey } = deps.common;
  return h('div', { cls: 'rm-detail-header' }, [
    h('div', {}, [
      h('p', { cls: 'rm-eyebrow', text: STRINGS.eyebrow }),
      h('h2', { cls: 'rm-detail-title', text: heading, attrs: { id: TITLE_ID, tabindex: '-1' } }),
      authority ? h('p', { cls: 'rm-authority-unit', text: authority.unit }) : null,
      authority ? h('p', { cls: 'rm-authority-covers', text: `${STRINGS.coversLabel}: ${authority.covers_label}` }) : null,
    ]),
    h('button', {
      cls: 'rm-icon-button', text: CLOSE_SYMBOL,
      attrs: { type: 'button', 'aria-label': STRINGS.closeLabel, ...focusKey(CLOSE_FOCUS_KEY) }, on: { click: onClose },
    }),
  ]);
}

/**
 * "Report outdated info" for one authority. It opens the country dialog with the authority named in the
 * heading and on the first description line, so no field beyond the existing ones is needed.
 */
function buildReportButton(deps, state, authority) {
  const { h, focusKey } = deps.common;
  if (!deps.reportsEnabled) return null;
  const topic = deps.engine.findTopic(state.rules, state.topicId);
  const context = {
    topicId: state.topicId, topicTitle: topic.title, country: AUTHORITY_REPORT_COUNTRY,
    countryName: state.countryNames[AUTHORITY_REPORT_COUNTRY], subjectName: authority.name, descriptionPrefill: STRINGS.reportPrefill(authority.name, authority.id),
  };
  return h('button', {
    cls: 'rm-button rm-button-outline', text: STRINGS.reportLabel,
    attrs: { type: 'button', ...focusKey(REPORT_FOCUS_KEY) }, on: { click: () => deps.openReport(context) },
  });
}

/**
 * "Share my experience" under the title block, with an invitation line above it when the office has no
 * figure. The dialog gets the office only, so no visitor answer can reach the form or a request.
 * @returns {HTMLElement[]} the line (if any) and the button; empty when experiences are off
 */
function buildExperienceBlock(deps, authority, hasAnyFigure) {
  const { h, focusKey } = deps.common;
  if (!deps.experiencesEnabled) return [];
  const context = { authorityId: authority.id, authorityName: authority.name };
  const button = h('button', {
    cls: 'rm-button rm-button-brand rm-experience-button', text: STRINGS.experienceLabel,
    attrs: { type: 'button', ...focusKey(EXPERIENCE_FOCUS_KEY) }, on: { click: () => deps.openExperience(context) },
  });
  if (hasAnyFigure) return [button];
  const gapLine = h('p', { cls: 'rm-experience-gap', text: STRINGS.experienceGap, attrs: GAP_TEST_ATTRIBUTES });
  return [gapLine, button];
}

/** True when any time figure of the office exists, sourced or community (`times`, `communityParts` as above). */
export function hasAnyTimeFigure(times, communityParts = {}) {
  return TIME_KEYS.some((key) => hasFigure(times[key]) || Boolean(communityParts[key]));
}

function buildAuthorityBody(deps, state, authority, details) {
  const { h } = deps.common;
  const todayMonth = deps.engine.monthIndex(state.today);
  const topic = deps.engine.findTopic(state.rules, state.topicId);
  const { publishableValue } = deps.modules['authority-metrics'];
  const times = Object.fromEntries(TIME_KEYS.map((key) => [key, publishableValue(authority.times[key])]));
  const communityRows = deps.modules['ui-authority-community'].buildCommunityRows(deps, state.community?.[authority.id]);
  return [
    ...buildExperienceBlock(deps, authority, hasAnyTimeFigure(times, communityRows)),
    ...buildWarnings(deps, state),
    h('p', { cls: 'rm-authority-mode' }, [
      h('span', { text: authority.mode.text }), buildSourceBadge(deps, authority.mode),
    ]),
    h('ul', { cls: 'rm-time-list' }, [buildTotalBlock(deps, times, {
      todayMonth, isOpen: details.choice ?? shouldOpenDetailsByDefault(times, communityRows), onToggle: details.remember,
      communityRows,
    })]),
    buildTimeBar(deps, times, todayMonth),
    buildEvidenceList(deps, authority),
    buildLegalNotes(deps, topic),
    buildReportButton(deps, state, authority),
  ];
}

function buildBody(deps, state, authority, details) {
  const { h } = deps.common;
  const content = authority
    ? buildAuthorityBody(deps, state, authority, details)
    : [h('p', { cls: 'rm-reason', text: STRINGS.noAuthority })];
  return [...content, h('p', { cls: 'rm-disclaimer', text: STRINGS.disclaimer })];
}

/**
 * Creates the authority card.
 * @param {HTMLElement} rootElement the <aside> to fill
 * @param {{onClose: function(): void}} callbacks
 * @param {{common: object, engine: object, modules: object}} deps `modules` holds authority-metrics
 * @returns {{render: function(object): void}}
 */
export function createAuthorityCard(rootElement, callbacks, deps) {
  rootElement.setAttribute('aria-labelledby', TITLE_ID);
  let shownAgs = null;
  // The visitor's own Details choice for the shown district; null means "use the default". Re-renders keep it.
  const details = { choice: null, remember: (isOpen) => { details.choice = isOpen; } };
  return {
    /** @param {object} state app state; the card hides when no district is selected */
    render(state) {
      rootElement.hidden = state.selectedAgs === null;
      if (rootElement.hidden) {
        shownAgs = null;
        return;
      }
      if (shownAgs !== state.selectedAgs) details.choice = null;
      const authority = state.districts.byAgs[state.selectedAgs];
      const heading = authority?.name ?? state.districts.labels.get(state.selectedAgs) ?? state.selectedAgs;
      deps.common.rebuild(rootElement, () => [
        buildHeader(deps, heading, authority, callbacks.onClose), ...buildBody(deps, state, authority, details),
      ]);
      // A newly selected district moves focus to its heading; re-renders for other reasons keep focus.
      if (shownAgs !== state.selectedAgs) deps.common.focusHeadingFromTop(rootElement, rootElement.querySelector('h2'));
      shownAgs = state.selectedAgs;
    },
  };
}
