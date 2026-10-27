// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Country detail card (desktop: floating right card, phone: bottom sheet;
// the layout switch is pure CSS). Shows the evaluated status for the selected
// country with reason, caveat, legal basis, sources and the report button.

const STRINGS = Object.freeze({
  closeLabel: 'Close country detail',
  noTopicEyebrow: 'Country detail',
  noTopicLabel: 'No topic chosen',
  noTopicReason: 'Pick a topic to colour the map.',
  needAnswersReason: (count) => `Answer ${count} ${count === 1 ? 'question' : 'questions'} to colour the map.`,
  noDetailReason: 'No verified data for this country yet.',
  warningLead: 'Warning.',
  caveatLead: 'Caveat.',
  draftNote: 'Draft data · to verify',
  basisHeading: 'Legal basis',
  sourcesHeading: 'Sources',
  effectiveLabel: 'In force since',
  verifiedLabel: 'Last verified',
  reportLabel: 'Report outdated info',
  staleWarning: (days) => `Last verified ${days} days ago — may be out of date`,
  disputedNote: 'Open reports about this rule are waiting for moderator review.',
  disclaimer: 'General information, not legal advice.',
  emptyValue: '—',
});
const WARNING_SYMBOL = '!';
const DRAFT_VERIFIED_MARKER = 'draft';
const VERIFIED_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Length of one day, for turning a clock difference into whole days. */
export const MILLISECONDS_PER_DAY = 86400000;
const PLACEHOLDER_PATTERN = /\{([a-z0-9_]+)\}/g;
const EXTERNAL_LINK_REL = 'noopener noreferrer';
const EXTERNAL_LINK_TARGET = '_blank';
const TITLE_ID = 'rm-detail-title';
const REPORT_FOCUS_KEY = 'detail-report';

/**
 * Replaces `{factId}` with the month-formatted answer; the value stays in this DOM text only.
 * @param {{common: {formatMonthYear: function(string): string}}} deps
 * @param {string} text check text with {factId} placeholders
 * @param {Object<string, string>} facts the fact set
 * @returns {string} text with known placeholders filled and unknown ones left as written
 */
export function fillCheckText(deps, text, facts) {
  return text.replace(PLACEHOLDER_PATTERN, (match, factId) =>
    (facts[factId] === undefined ? match : deps.common.formatMonthYear(facts[factId])));
}

/**
 * Whole days since `lastVerified` when that is more than `thresholdDays`, else null. A draft, a
 * malformed or impossible date and a future date all give null: the card then says nothing rather
 * than guessing.
 * @param {string} lastVerified 'YYYY-MM-DD' or 'draft'
 * @param {number} todayMs current time in milliseconds since the epoch
 * @param {number} thresholdDays age that is still fine; only older rules are stale
 * @returns {?number}
 */
export function staleDays(lastVerified, todayMs, thresholdDays) {
  const parts = VERIFIED_DATE_PATTERN.exec(lastVerified ?? '');
  if (!parts) return null;
  const [year, month, day] = parts.slice(1).map(Number);
  const verified = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC rolls 2026-02-30 over to March; the round trip rejects such impossible dates.
  if (verified.getUTCMonth() !== month - 1 || verified.getUTCDate() !== day) return null;
  const ageDays = Math.floor((todayMs - verified.getTime()) / MILLISECONDS_PER_DAY);
  return ageDays > thresholdDays ? ageDays : null;
}

function buildStaleWarning(deps, detail) {
  const { h } = deps.common;
  const days = staleDays(detail.last_verified, deps.today, deps.staleAfterDays);
  if (days === null) return null;
  return h('p', { cls: 'rm-warning', attrs: { role: 'status' } }, [
    h('span', { cls: 'rm-warning-icon', text: WARNING_SYMBOL, attrs: { 'aria-hidden': 'true' } }),
    h('span', { text: STRINGS.staleWarning(days) }),
  ]);
}

function buildDisputedNote(deps, state) {
  const { h } = deps.common;
  if (!deps.isDisputed(state.disputed, state.topicId, state.selectedIso2)) return null;
  return h('p', { cls: 'rm-disputed-note', attrs: { role: 'status' } }, [h('span', { text: STRINGS.disputedNote })]);
}

function buildWarnings(deps, state) {
  const { h } = deps.common;
  return state.result.checks.map((check) => h('p', { cls: 'rm-warning', attrs: { role: 'status' } }, [
    h('span', { cls: 'rm-warning-icon', text: WARNING_SYMBOL, attrs: { 'aria-hidden': 'true' } }),
    h('span', {}, [
      h('strong', { text: `${STRINGS.warningLead} ` }),
      h('span', { text: fillCheckText(deps, check.text, state.facts) }),
    ]),
  ]));
}

function buildList(deps, heading, items) {
  const { h } = deps.common;
  if (items.length === 0) return null;
  return h('section', {}, [
    h('h3', { cls: 'rm-section-heading', text: heading }),
    h('ul', { cls: 'rm-detail-list' }, items),
  ]);
}

function buildSourceLinks(deps, rules, sourceIds) {
  const { h, isSafeLink } = deps.common;
  return sourceIds
    .map((sourceId) => rules.sources[sourceId])
    .filter((source) => source && isSafeLink(source.url))
    .map((source) => h('li', {}, [h('a', {
      text: source.label,
      attrs: { href: source.url, target: EXTERNAL_LINK_TARGET, rel: EXTERNAL_LINK_REL },
    })]));
}

function buildDates(deps, detail) {
  const { h } = deps.common;
  const verified = detail.last_verified === DRAFT_VERIFIED_MARKER ? undefined : detail.last_verified;
  const cell = (label, value) => h('div', {}, [
    h('dt', { text: label }),
    h('dd', { cls: 'rm-mono', text: value ?? STRINGS.emptyValue }),
  ]);
  return h('dl', { cls: 'rm-dates' }, [
    cell(STRINGS.effectiveLabel, detail.effective), cell(STRINGS.verifiedLabel, verified),
  ]);
}

function buildReportButton(deps, state, countryName) {
  const { h, focusKey } = deps.common;
  if (!deps.reportsEnabled) return null;
  const topic = deps.engine.findTopic(state.rules, state.topicId);
  const context = {
    topicId: state.topicId, topicTitle: topic.title, country: state.selectedIso2, countryName,
  };
  return h('button', {
    cls: 'rm-button rm-button-outline',
    text: STRINGS.reportLabel,
    attrs: { type: 'button', ...focusKey(REPORT_FOCUS_KEY) },
    on: { click: () => deps.openReport(context) },
  });
}

function buildStatusBadge(deps, status, label) {
  const { h, STATUS_SYMBOL, statusClass } = deps.common;
  const symbol = status ? STATUS_SYMBOL[status] : STATUS_SYMBOL.na;
  return h('span', { cls: `rm-badge ${statusClass(status)}` }, [
    h('span', { text: symbol, attrs: { 'aria-hidden': 'true' } }),
    h('span', { text: label }),
  ]);
}

/**
 * Resolves what the card says: neutral states have only a label and a reason.
 * @param {{engine: object}} deps
 * @param {object} state app state (rules, topicId, result, selectedIso2)
 * @returns {{status?: string, label: string, reason?: string, entry?: object, topic?: object}}
 */
export function describeSelection(deps, state) {
  const entry = state.result?.statuses[state.selectedIso2];
  if (state.topicId === null) return { label: STRINGS.noTopicLabel, reason: STRINGS.noTopicReason };
  const topic = deps.engine.findTopic(state.rules, state.topicId);
  if (!entry) {
    return { label: STRINGS.noTopicLabel, reason: STRINGS.needAnswersReason(state.result.missing.length), topic };
  }
  return { status: entry.status, label: topic.labels[entry.status], entry, topic };
}

function buildBody(deps, state, description) {
  const { h } = deps.common;
  const detail = description.entry?.detail ?? {};
  const name = state.countryNames[state.selectedIso2];
  return [
    buildStatusBadge(deps, description.status, description.label),
    description.topic ? buildWarnings(deps, state) : [],
    description.entry ? buildStaleWarning(deps, detail) : null,
    description.entry ? buildDisputedNote(deps, state) : null,
    h('p', { cls: 'rm-reason', text: detail.reason ?? description.reason ?? STRINGS.noDetailReason }),
    detail.caveat ? h('p', { cls: 'rm-caveat' }, [
      h('strong', { text: `${STRINGS.caveatLead} ` }), h('span', { text: detail.caveat })]) : null,
    description.entry?.draft ? h('p', { cls: 'rm-draft-note', text: STRINGS.draftNote }) : null,
    buildList(deps, STRINGS.basisHeading, (detail.basis ?? []).map((basis) => h('li', { text: basis }))),
    buildList(deps, STRINGS.sourcesHeading, buildSourceLinks(deps, state.rules, detail.sources ?? [])),
    description.entry ? buildDates(deps, detail) : null,
    description.entry ? buildReportButton(deps, state, name) : null,
    h('p', { cls: 'rm-disclaimer', text: STRINGS.disclaimer }),
  ].flat();
}

function buildHeader(deps, state, description, onClose) {
  const { h, focusKey } = deps.common;
  return h('div', { cls: 'rm-detail-header' }, [
    h('div', {}, [
      h('p', { cls: 'rm-eyebrow', text: description.topic?.title ?? STRINGS.noTopicEyebrow }),
      h('h2', { cls: 'rm-detail-title', text: state.countryNames[state.selectedIso2], attrs: { id: TITLE_ID, tabindex: '-1' } }),
    ]),
    h('button', {
      cls: 'rm-icon-button', text: '×', attrs: { type: 'button', 'aria-label': STRINGS.closeLabel, ...focusKey('detail-close') },
      on: { click: onClose },
    }),
  ]);
}

/**
 * Creates the detail card.
 * @param {HTMLElement} rootElement the <aside> to fill
 * @param {{onClose: function(): void}} callbacks
 * @param {{common: object, engine: object, reportsEnabled: boolean, openReport: function(object): void,
 *   today: number, staleAfterDays: number, isDisputed: function(?object, string, string): boolean}} deps
 *   `today` is the page-load time in epoch milliseconds, set once by map-app (the engine stays clock-free)
 * @returns {{render: function(object): void}}
 */
export function createDetail(rootElement, callbacks, deps) {
  rootElement.setAttribute('aria-labelledby', TITLE_ID);
  let shownIso2 = null;
  return {
    /** @param {object} state app state; the card hides when no country is selected */
    render(state) {
      rootElement.hidden = state.selectedIso2 === null;
      if (rootElement.hidden) {
        shownIso2 = null;
        return;
      }
      const description = describeSelection(deps, state);
      deps.common.rebuild(rootElement, () => [
        buildHeader(deps, state, description, callbacks.onClose),
        ...buildBody(deps, state, description),
      ]);
      // A newly selected country moves focus to its heading; re-renders for other reasons keep focus.
      if (shownIso2 !== state.selectedIso2) deps.common.focusHeadingFromTop(rootElement, rootElement.querySelector('h2'));
      shownIso2 = state.selectedIso2;
    },
  };
}
