// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Wizard card. Step 1 lists the topics and the profile; step 2 shows the
// chosen topic's situation. The profile block, the situation body and the
// answer actions are separate views, mounted into fixed slots so each keeps
// its own focus and scroll handling.

const STRINGS = Object.freeze({
  step1Label: 'STEP 1 OF 2 · TOPIC',
  step2Label: 'STEP 2 OF 2 · YOUR SITUATION',
  step1Heading: 'What do you want to check?',
  step1Intro: 'Pick a topic. Next, you set your situation and see which countries open up.',
  back: 'All topics',
  soon: 'Soon',
  badges: Object.freeze({ verified: 'Verified', draft: 'Draft data', pilot: 'Germany pilot' }),
  plannedTopics: Object.freeze([
    { title: 'Student visa', summary: 'Study permits and work rights while studying' },
    { title: 'Family reunification', summary: 'Bringing a spouse or children' },
    { title: 'Job-seeker permits', summary: 'Opportunity Card and similar routes' },
  ]),
});
const HEADING_ID = 'rm-wizard-title';
const ICON_VIEW_BOX = '0 0 24 24';
const BACK_ARROW_PATH = 'M19 12H5M11 6l-6 6 6 6';

function topicBadge(deps, text, modifier) {
  return deps.common.h('span', { cls: `rm-badge-small rm-mono rm-badge-${modifier}`, text });
}

function buildTopicButton(deps, topic, callbacks) {
  const { h, focusKey } = deps.common;
  const badgeKey = topic.data_badge;
  return h('button', {
    cls: 'rm-topic',
    attrs: { type: 'button', ...focusKey(`topic:${topic.id}`) },
    on: { click: () => callbacks.onPickTopic(topic.id) },
  }, [
    h('span', { cls: 'rm-topic-text' }, [
      h('span', { cls: 'rm-topic-title', text: topic.title }),
      h('span', { cls: 'rm-note', text: topic.summary }),
    ]),
    STRINGS.badges[badgeKey] ? topicBadge(deps, STRINGS.badges[badgeKey], badgeKey) : null,
  ]);
}

function buildPlannedTopic(deps, planned) {
  const { h } = deps.common;
  return h('button', { cls: 'rm-topic rm-topic-planned', attrs: { type: 'button', disabled: true } }, [
    h('span', { cls: 'rm-topic-text' }, [
      h('span', { cls: 'rm-topic-title', text: planned.title }),
      h('span', { cls: 'rm-note', text: planned.summary }),
    ]),
    topicBadge(deps, STRINGS.soon, 'soon'),
  ]);
}

function buildStep1(deps, state, callbacks) {
  const { h } = deps.common;
  const topics = deps.engine.supportedTopics(state.rules);
  return [
    h('h2', { cls: 'rm-wizard-title', text: STRINGS.step1Heading, attrs: { id: HEADING_ID, tabindex: '-1' } }),
    h('p', { cls: 'rm-intro', text: STRINGS.step1Intro }),
    h('div', { cls: 'rm-topics' }, [
      ...topics.map((topic) => buildTopicButton(deps, topic, callbacks)),
      ...STRINGS.plannedTopics.map((planned) => buildPlannedTopic(deps, planned)),
    ]),
  ];
}

/** Decorative left arrow; the button's accessible name stays the text beside it. */
function backArrow(deps) {
  const { s } = deps.common;
  return s('svg', {
    cls: 'rm-icon-stroke rm-back-icon',
    attrs: { viewBox: ICON_VIEW_BOX, 'aria-hidden': 'true', focusable: 'false' },
  }, [s('path', { attrs: { d: BACK_ARROW_PATH } })]);
}

function buildStep2Header(deps, state, callbacks) {
  const { h, focusKey } = deps.common;
  const topic = deps.engine.findTopic(state.rules, state.topicId);
  return [
    h('button', {
      cls: 'rm-link-button rm-back',
      attrs: { type: 'button', ...focusKey('wizard-back') }, on: { click: callbacks.onBack },
    }, [backArrow(deps), h('span', { text: STRINGS.back })]),
    h('h2', { cls: 'rm-wizard-title', text: topic.title, attrs: { id: HEADING_ID, tabindex: '-1' } }),
    h('p', { cls: 'rm-intro', text: topic.summary }),
  ];
}

/**
 * Creates the wizard card.
 * @param {HTMLElement} rootElement the <section> to fill
 * @param {object} callbacks onPickTopic, onBack, onSetFact, onUnsetFact, onToggleProfile and the
 *   answer-action callbacks (see ui-wizard-answers.js)
 * @param {{common: object, engine: object, parts: object}} deps `parts` holds the create… functions
 *   of the profile, situation, requirements and answer-action views plus the shared factControls
 * @returns {{render: function(object): void}}
 */
export function createWizard(rootElement, callbacks, deps) {
  const { h, rebuild } = deps.common;
  rootElement.setAttribute('aria-labelledby', HEADING_ID);
  const stepLabel = h('p', { cls: 'rm-step-label rm-mono' });
  const head = h('div', { cls: 'rm-wizard-head' });
  const situation = h('div', { cls: 'rm-situation' });
  const profile = h('div', { cls: 'rm-profile' });
  const requirements = h('div', { cls: 'rm-requirements-slot' });
  const answers = h('div', { cls: 'rm-answers' });
  rootElement.append(stepLabel, head, situation, requirements, profile, answers);
  let renderedStep = null;
  const views = [
    deps.parts.createSituation(situation, callbacks, deps),
    deps.parts.createRequirements(requirements, callbacks, deps),
    deps.parts.createProfile(profile, callbacks, deps),
    deps.parts.createAnswerActions(answers, callbacks, deps),
  ];

  return {
    /** @param {object} state app state */
    render(state) {
      const isTopicStep = state.step === deps.common.STEP_TOPIC;
      stepLabel.textContent = isTopicStep ? STRINGS.step1Label : STRINGS.step2Label;
      rebuild(head, () => (isTopicStep ? buildStep1(deps, state, callbacks) : buildStep2Header(deps, state, callbacks)));
      for (const view of views) view.render(state);
      profile.hidden = !isTopicStep;
      // The control the user just pressed is gone after a step change; move focus to the new heading.
      if (renderedStep !== null && renderedStep !== state.step) deps.common.focusHeadingFromTop(rootElement, head.querySelector('h2'));
      renderedStep = state.step;
    },
  };
}
