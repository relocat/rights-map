// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Wizard step 2 body: the facts the chosen topic declares in `uses`, grouped
// by role (About you / Your documents / What you can change), lever badges
// from the what-if deltas, and the tips below. Facts a topic does not
// declare are never shown here.

const STRINGS = Object.freeze({
  groups: Object.freeze({
    about: { heading: 'About you', note: '' },
    documents: {
      heading: 'Your documents',
      note: 'Many people cannot renew a passport or get papers certified at home. Tell us so the advice fits.',
    },
    lever: { heading: 'What you can change', note: 'Badges show how many more countries open if you get there.' },
  }),
  needAnswers: (labels) =>
    `Answer ${labels.length} ${labels.length === 1 ? 'question' : 'questions'} to colour the map: ${labels.join(', ')}`,
  needAnswersForEstimate: (count) => `Answer ${count} ${count === 1 ? 'question' : 'questions'} to see your estimate`,
  toVerify: 'to verify',
});
const GROUP_ROLES = Object.freeze(['about', 'documents', 'lever']);
const TO_VERIFY_TIP_STATUSES = Object.freeze(['draft', 'todo']);

function buildGroup(deps, role, fields) {
  const { h } = deps.common;
  const { heading, note } = STRINGS.groups[role];
  return h('section', { cls: 'rm-group' }, [
    h('h3', { cls: 'rm-section-heading', text: heading }),
    note ? h('p', { cls: 'rm-note', text: note }) : null,
    ...fields,
  ]);
}

function buildTips(deps, tips) {
  const { h } = deps.common;
  if (tips.length === 0) return null;
  return h('ul', { cls: 'rm-tips' }, tips.map((tip) => h('li', { cls: 'rm-tip' }, [
    h('span', { cls: 'rm-tag rm-tag-tip rm-mono', text: tip.tag }),
    TO_VERIFY_TIP_STATUSES.includes(tip.status)
      ? h('span', { cls: 'rm-tag rm-tag-soft rm-mono', text: STRINGS.toVerify })
      : null,
    h('span', { text: tip.text }),
  ])));
}

function buildFields(deps, state, topic, role, callbacks) {
  const fieldContext = {
    rules: state.rules,
    facts: state.facts,
    gains: state.result.levers,
    showProfileTag: true,
    onSet: callbacks.onSetFact,
    onUnset: callbacks.onUnsetFact,
  };
  return topic.uses
    .filter((use) => use.role === role)
    .map((use) => deps.engine.factDefinition(state.rules, use.fact))
    .map((fact) => deps.factControls.buildField(fact, fieldContext))
    .filter(Boolean);
}

/**
 * Creates the situation (step 2) body.
 * @param {HTMLElement} rootElement container to fill
 * @param {{onSetFact: function, onUnsetFact: function}} callbacks
 * @param {{common: object, engine: object, factControls: object}} deps
 * @returns {{render: function(object): void}}
 */
export function createSituation(rootElement, callbacks, deps) {
  const { h, rebuild } = deps.common;
  return {
    /** @param {object} state app state; no-op output when no topic is chosen */
    render(state) {
      rootElement.hidden = state.topicId === null;
      if (rootElement.hidden) return;
      const topic = deps.engine.findTopic(state.rules, state.topicId);
      // Named by label: a required question under "What you can change" is otherwise easy to miss.
      const missingLabels = state.result.missing.map((factId) => deps.engine.factDefinition(state.rules, factId).label);
      // An authority topic colours districts by time, not by facts, so the prompt promises the estimate.
      const promptText = deps.engine.isAuthorityTopic(topic)
        ? STRINGS.needAnswersForEstimate(missingLabels.length)
        : STRINGS.needAnswers(missingLabels);
      rebuild(rootElement, () => [
        missingLabels.length > 0
          ? h('p', { cls: 'rm-prompt', text: promptText, attrs: { role: 'status' } })
          : null,
        ...GROUP_ROLES
          .map((role) => [role, buildFields(deps, state, topic, role, callbacks)])
          .filter(([, fields]) => fields.length > 0)
          .map(([role, fields]) => buildGroup(deps, role, fields)),
        buildTips(deps, state.result.tips),
      ]);
    },
  };
}
