// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Wizard step 2, authority topics only: the requirements checklist and the
// "Your estimate" card. Both read the shared fact set through the engine, so a
// change in the situation questions updates them on the next render. Text states
// conditional facts, never instructions.

const STRINGS = Object.freeze({
  checklistHeading: 'Requirements',
  estimateHeading: 'Your estimate',
  stateWords: Object.freeze({ met: 'Met', unmet: 'Not met', unanswered: 'Answer to check' }),
  applyNow: 'You can apply now',
  earliestApply: (month) => `Earliest application: ${month}`,
  earliestUnknown: 'Earliest application date not known yet',
  decisionBetween: (from, to) => `Decision expected between ${from} and ${to}`,
  decisionOrLater: (from) => `Decision expected ${from} or later`,
  unconfirmed: ' (unconfirmed)',
  pickDistrict: 'Pick a district on the map to add the local waiting time.',
  noDistrictData: 'No waiting-time data for this district yet.',
});
/** Symbols per requirement state; colour is never the only signal. */
const REQUIREMENT_SYMBOL = Object.freeze({ met: '✓', unmet: '!', unanswered: '?', info: '•' });
const STATE_INFO = 'info';
const MONTH_TOKEN_PATTERN = /\d{4}-\d{2}/g;

/**
 * Symbol that stands for a requirement state.
 * @param {string} requirementState 'met' | 'unmet' | 'unanswered' | 'info'
 * @returns {string} one of ✓ ! ? •
 */
export function requirementSymbol(requirementState) {
  return REQUIREMENT_SYMBOL[requirementState] ?? REQUIREMENT_SYMBOL.unanswered;
}

/**
 * Headline and detail of the personal estimate.
 * @param {{earliestApply?: string, canApplyNow: boolean, window: ({from: string, to: string,
 *   isOpenEnded: boolean}|null), isConfirmed: boolean}} estimate from `evaluateAuthority`
 * @param {string|undefined} authorityName the selected district's name; undefined when none is selected
 * @param {function(string): string} [formatMonth] 'YYYY-MM' → display text (ui-common formatMonthYear)
 * @returns {{headline: string, detail: string}}
 */
export function estimateText(estimate, authorityName, formatMonth = (month) => month) {
  let headline = STRINGS.earliestUnknown;
  if (estimate.canApplyNow) headline = STRINGS.applyNow;
  else if (estimate.earliestApply !== undefined) headline = STRINGS.earliestApply(formatMonth(estimate.earliestApply));
  if (authorityName === undefined) return { headline, detail: STRINGS.pickDistrict };
  const { window } = estimate;
  if (window === null) return { headline, detail: STRINGS.noDistrictData };
  const sentence = window.isOpenEnded
    ? STRINGS.decisionOrLater(formatMonth(window.from))
    : STRINGS.decisionBetween(formatMonth(window.from), formatMonth(window.to));
  return { headline, detail: estimate.isConfirmed ? sentence : `${sentence}${STRINGS.unconfirmed}` };
}

/** The engine fills `{eligible_from}` as 'YYYY-MM'; show it as a month name. */
function readableNote(note, formatMonth) {
  return note.replace(MONTH_TOKEN_PATTERN, (month) => formatMonth(month));
}

function buildRequirement(deps, requirement) {
  const { h, formatMonthYear } = deps.common;
  const isInfo = requirement.state === STATE_INFO;
  const stateWord = STRINGS.stateWords[requirement.state];
  return h('li', { cls: `rm-requirement rm-requirement-${requirement.state}` }, [
    h('span', { cls: 'rm-requirement-symbol rm-mono', text: requirementSymbol(requirement.state), attrs: { 'aria-hidden': 'true' } }),
    h('span', { cls: 'rm-requirement-text' }, [
      h('span', { cls: 'rm-requirement-title', text: requirement.title }),
      !isInfo && stateWord ? h('span', { cls: 'rm-requirement-state', text: stateWord }) : null,
      requirement.note ? h('span', { cls: 'rm-note', text: readableNote(requirement.note, formatMonthYear) }) : null,
    ]),
  ]);
}

function buildChecklist(deps, requirements) {
  const { h } = deps.common;
  return h('section', { cls: 'rm-group rm-checklist' }, [
    h('h3', { cls: 'rm-section-heading', text: STRINGS.checklistHeading }),
    h('ul', { cls: 'rm-requirements' }, requirements.map((requirement) => buildRequirement(deps, requirement))),
  ]);
}

/** Estimate of the selected district; a district without a record still yields the earliest application. */
function estimateFor(deps, state, topic) {
  if (state.authorityResult) return state.authorityResult.estimate;
  return deps.engine.evaluateAuthority(state.rules, topic, undefined, { factSet: state.facts, today: state.today }).estimate;
}

function districtName(state) {
  if (state.selectedAgs === null) return undefined;
  return state.districts.byAgs[state.selectedAgs]?.name ?? state.districts.labels.get(state.selectedAgs) ?? state.selectedAgs;
}

function buildEstimate(deps, state, topic) {
  const { h, formatMonthYear } = deps.common;
  const name = districtName(state);
  const { headline, detail } = estimateText(estimateFor(deps, state, topic), name, formatMonthYear);
  return h('section', { cls: 'rm-group rm-estimate', attrs: { role: 'status' } }, [
    h('h3', { cls: 'rm-section-heading', text: STRINGS.estimateHeading }),
    h('p', { cls: 'rm-estimate-headline', text: headline }),
    name === undefined ? null : h('p', { cls: 'rm-estimate-where rm-note', text: name }),
    h('p', { cls: 'rm-estimate-detail', text: detail }),
  ]);
}

/**
 * Creates the requirements and estimate view.
 * @param {HTMLElement} rootElement container to fill; hidden for topics that are not authority topics
 * @param {object} callbacks unused; the view only displays
 * @param {{common: object, engine: object}} deps
 * @returns {{render: function(object): void}}
 */
export function createRequirements(rootElement, callbacks, deps) {
  const { rebuild } = deps.common;
  return {
    /** @param {object} state app state */
    render(state) {
      const topic = state.topicId === null ? null : deps.engine.findTopic(state.rules, state.topicId);
      rootElement.hidden = topic === null || !deps.engine.isAuthorityTopic(topic);
      if (rootElement.hidden) return;
      rebuild(rootElement, () => [buildEstimate(deps, state, topic), buildChecklist(deps, state.result.requirements ?? [])]);
    },
  };
}
