// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// "Your profile" block on wizard step 1: summary chips of the answered
// profile facts plus an editor listing every profile fact a supported topic
// uses, with "Used by: …". Profile facts are set once and
// shared by every topic.

const STRINGS = Object.freeze({
  heading: 'Your profile',
  tag: 'PROFILE',
  note: 'Set once. Every topic uses the parts it needs.',
  edit: 'Edit',
  done: 'Done',
  empty: 'No answers yet.',
  chipSeparator: ': ',
  untilPrefix: ' until ',
});
const MONTH_TYPE = 'month';

/** Profile facts shown in the editor: top-level (no parent) and used by a supported topic. */
/**
 * @param {{engine: object, common: object}} deps
 * @param {object} rules parsed rules
 * @returns {Array<{fact: object, topics: object[]}>} editable profile facts with the topics using them
 */
export function editableProfileFacts(deps, rules) {
  const topics = deps.engine.supportedTopics(rules);
  const usedBy = (fact) => topics.filter((topic) => deps.engine.topicFactIds(rules, topic).has(fact.id));
  return rules.facts
    .filter((fact) => fact.scope === deps.common.PROFILE_SCOPE && fact.type !== MONTH_TYPE && !fact.parent)
    .map((fact) => ({ fact, topics: usedBy(fact) }))
    .filter(({ topics: users }) => users.length > 0);
}

/** @returns {?string} 'Label: Option[ until Mon YYYY]' for an answered profile fact, else null */
export function chipText(deps, fact, state) {
  const value = state.facts[fact.id];
  const option = fact.options?.find(([code]) => code === value);
  if (!option) return null;
  const monthValue = fact.companion ? state.facts[fact.companion] : undefined;
  const until = monthValue ? `${STRINGS.untilPrefix}${deps.common.formatMonthYear(monthValue)}` : '';
  return `${fact.label}${STRINGS.chipSeparator}${option[1]}${until}`;
}

function buildSummary(deps, entries, state) {
  const { h } = deps.common;
  const chips = entries.map(({ fact }) => chipText(deps, fact, state)).filter(Boolean);
  if (chips.length === 0) return h('p', { cls: 'rm-note', text: STRINGS.empty });
  return h('ul', { cls: 'rm-chips' }, chips.map((text) => h('li', { cls: 'rm-chip', text })));
}

function buildEditor(deps, entries, state, callbacks) {
  const { h } = deps.common;
  return h('div', { cls: 'rm-profile-editor' }, entries.map(({ fact, topics }) =>
    deps.factControls.buildField(fact, {
      rules: state.rules,
      facts: state.facts,
      usedBy: topics.map((topic) => topic.title),
      showProfileTag: false,
      onSet: callbacks.onSetFact,
      onUnset: callbacks.onUnsetFact,
    })));
}

/**
 * Creates the profile block.
 * @param {HTMLElement} rootElement container to fill
 * @param {{onSetFact: function, onUnsetFact: function, onToggleProfile: function}} callbacks
 * @param {{common: object, engine: object, factControls: object}} deps
 * @returns {{render: function(object): void}}
 */
export function createProfile(rootElement, callbacks, deps) {
  const { h, rebuild, focusKey } = deps.common;
  return {
    /** @param {object} state app state */
    render(state) {
      const entries = editableProfileFacts(deps, state.rules);
      rebuild(rootElement, () => [
        h('div', { cls: 'rm-profile-header' }, [
          h('h3', { cls: 'rm-profile-title' }, [
            h('span', { cls: 'rm-tag rm-mono', text: STRINGS.tag, attrs: { 'aria-hidden': 'true' } }),
            h('span', { text: STRINGS.heading }),
          ]),
          h('button', {
            cls: 'rm-link-button',
            text: state.profileOpen ? STRINGS.done : STRINGS.edit,
            attrs: { type: 'button', 'aria-expanded': String(state.profileOpen), ...focusKey('profile-toggle') },
            on: { click: callbacks.onToggleProfile },
          }),
        ]),
        h('p', { cls: 'rm-note', text: STRINGS.note }),
        state.profileOpen ? buildEditor(deps, entries, state, callbacks) : buildSummary(deps, entries, state),
      ]);
    },
  };
}
