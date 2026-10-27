// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// "Report outdated info" dialog. The visitor says which rule looks wrong and
// where it can be verified; the browser solves a small proof of work and posts
// the report anonymously. This module only ever sees the six form fields: it
// is never handed the fact set, so an answer cannot reach a request.
//
// Nothing is stored on the device: form text and the proof-of-work state live
// in this closure and are dropped when the dialog closes.

const STRINGS = Object.freeze({
  heading: 'Report outdated info',
  headingFor: (subjectName) => `Report outdated info: ${subjectName}`,
  privacyNote: 'No answers or personal data are sent. Do not write names or case details.',
  disputedExplanation: 'A report marks this topic as "disputed" for this country until we have checked it.',
  kindLegend: 'What is wrong?',
  kindLabels: Object.freeze({
    rule_changed: 'The rule has changed',
    wrong_colour: 'The colour is wrong for my case',
    source_broken: 'The source link is broken',
    experienced_differently: 'I experienced it differently',
  }),
  urlLabel: 'Link to the new rule or source',
  urlOptionalSuffix: ' (optional)',
  descriptionLabel: 'What should we check?',
  descriptionCounter: (used, limit) => `${used} / ${limit}`,
  sinceLabel: 'In force since (optional)',
  submitLabel: 'Send report',
  cancelLabel: 'Cancel',
  closeLabel: 'Close',
  solving: 'Sending…',
  sending: 'Sending…',
  doneHeading: 'Thank you',
  doneBody: 'We will check the report. Until then this topic shows as disputed for this country.',
  urlRequired: 'Add a link to the new rule so we can verify it.',
  urlInvalid: 'Enter a full web address, like https://example.org/law.',
  referencePrefix: 'Reference: ',
  noticeBeforeLink: 'We use this report only to check and correct the map. Please don\'t include names, case numbers, '
    + 'health details or anything else about you or another person — just what is wrong and where we can verify it. '
    + 'Your answers on the map are not sent. We keep the report until we have checked it and delete it 90 days after '
    + 'our decision. To limit abuse, we briefly keep a scrambled form of your IP address (deleted within a day). Details: ',
  privacyLinkLabel: 'privacy notice for reports',
  noticeAfterLink: '.',
  errors: Object.freeze({
    'E-RM01': 'The report could not be accepted. Please check the fields and try again.',
    'E-RM02': 'The browser check failed twice. Please try again in a moment.',
    'E-RM03': 'Too many reports from this connection. Please try again later.',
    'E-RM04': 'The report service is temporarily unavailable. Please try again later.',
    network: 'The report could not be sent. Check your connection and try again.',
  }),
});

/** Target of the "privacy notice for reports" link; repoint it to the privacy-policy section once that covers reports. */
export const PRIVACY_POLICY_URL = '/map/report-privacy/';
/** Description limit; must match the server's limit and the textarea's maxlength. */
export const DESCRIPTION_MAX_LENGTH = 1000;
/** Fresh-challenge retries after the server rejects a proof (`E-RM02`): exactly one. */
export const MAX_PROOF_RETRIES = 1;
/** Phases of one submission, in order; `idle` before and `done`/`error` after. */
export const PHASE = Object.freeze({
  IDLE: 'idle', SOLVING: 'solving', SENDING: 'sending', DONE: 'done', ERROR: 'error',
});
/** Report kinds in dialog order; values must match the report kinds the server accepts. */
export const KIND_ORDER = Object.freeze([
  'rule_changed', 'wrong_colour', 'source_broken', 'experienced_differently',
]);
/** The kind whose source link the server requires. */
export const KIND_REQUIRING_URL = 'rule_changed';

const PROOF_EXPIRED_CODE = 'E-RM02';
const NETWORK_CODE = 'network';
const ESCAPE_KEY = 'Escape';
const TAB_KEY = 'Tab';
const HOST_SELECTOR = '.rm-root';
const FOCUSABLE_SELECTOR = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href]';
const FOCUS_KEY_ATTRIBUTE = 'data-focus-key';
const HEADING_ID = 'rm-report-title';
const URL_INPUT_TYPE = 'url';
const MONTH_INPUT_TYPE = 'month';
const KIND_FIELD_NAME = 'rm-report-kind';
const ARIA_DISABLED = 'aria-disabled';
const URL_ID = 'rm-report-url';
const DESCRIPTION_ID = 'rm-report-description';
const SINCE_ID = 'rm-report-since';
const DESCRIPTION_ROWS = 4;

/**
 * Checks the fields the browser can judge without the server.
 * @param {{kind: string, sourceUrl: string}} fields trimmed form values
 * @returns {?string} a message for the visitor, or null when the fields may be sent
 */
export function validateReportFields({ kind, sourceUrl }) {
  if (sourceUrl === '') return kind === KIND_REQUIRING_URL ? STRINGS.urlRequired : null;
  try {
    new URL(sourceUrl);
    return null;
  } catch (error) {
    if (error instanceof TypeError) return STRINGS.urlInvalid;
    throw error;
  }
}

/**
 * Text shown while a submission is in flight.
 * @param {string} phase `PHASE.SOLVING` or `PHASE.SENDING`
 * @returns {string} the static progress message
 */
export function describePhase(phase) {
  return phase === PHASE.SOLVING ? STRINGS.solving : STRINGS.sending;
}

/**
 * Maps a failure code to the static text shown to the visitor.
 * @param {string} code a server error code or `network`
 * @returns {string} message, followed by the reference code for server errors
 */
export function describeFailure(code) {
  const known = Object.hasOwn(STRINGS.errors, code);
  const message = STRINGS.errors[known ? code : NETWORK_CODE];
  return known && code !== NETWORK_CODE ? `${message} ${STRINGS.referencePrefix}${code}` : message;
}

async function attemptReport({ client, proofAhead, reportUrls, fields, onPhase }) {
  onPhase(PHASE.SOLVING);
  const proof = await proofAhead.take();
  if (!proof.ok) return proof;
  onPhase(PHASE.SENDING);
  const payload = client.buildReportPayload(fields, { token: proof.token, counter: proof.counter });
  return client.submitReport(payload, reportUrls);
}

/**
 * Runs one submission: challenge, proof of work, post. An expired or rejected
 * proof (`E-RM02`) is retried with a fresh challenge `MAX_PROOF_RETRIES` times,
 * then reported as an error, so a misbehaving server cannot cause a loop.
 * @param {{client: object, proofAhead: {take: function(): Promise<object>},
 *   reportUrls: {challenge: string, submit: string}, fields: object, onPhase: function(string): void}} options
 *   `proofAhead` is the dialog's solve-ahead handle (ui-proof-ahead); each retry takes a fresh proof from it
 * @returns {Promise<{ok: true} | {ok: false, code: string}>}
 */
export async function runReportFlow(options) {
  for (let retries = 0; ; retries += 1) {
    const result = await attemptReport(options);
    if (result.ok || result.code !== PROOF_EXPIRED_CODE || retries >= MAX_PROOF_RETRIES) return result;
  }
}

function buildKindRadios(common) {
  const { h } = common;
  const radios = KIND_ORDER.map((kind, index) => h('label', { cls: 'rm-report-choice' }, [
    h('input', {
      attrs: { type: 'radio', name: KIND_FIELD_NAME, value: kind, checked: index === 0 },
    }),
    h('span', { text: STRINGS.kindLabels[kind] }),
  ]));
  return h('fieldset', { cls: 'rm-report-field' }, [
    h('legend', { cls: 'rm-section-heading', text: STRINGS.kindLegend }), ...radios,
  ]);
}

function buildTextFields(common, descriptionPrefill) {
  const { h } = common;
  const urlInput = h('input', {
    cls: 'rm-report-input',
    attrs: { type: URL_INPUT_TYPE, id: URL_ID, autocomplete: 'off', required: true },
  });
  const urlLabel = h('label', { cls: 'rm-section-heading', attrs: { for: URL_ID } });
  const description = h('textarea', {
    cls: 'rm-report-input rm-report-textarea',
    attrs: { id: DESCRIPTION_ID, maxlength: String(DESCRIPTION_MAX_LENGTH), rows: String(DESCRIPTION_ROWS) },
  });
  // The maxlength attribute only limits typing, so a programmatic value is cut to the limit here.
  description.value = descriptionPrefill.slice(0, DESCRIPTION_MAX_LENGTH);
  const counter = h('p', {
    cls: 'rm-report-counter', text: STRINGS.descriptionCounter(description.value.length, DESCRIPTION_MAX_LENGTH),
    attrs: { 'aria-hidden': 'true' },
  });
  description.addEventListener('input', () => {
    counter.textContent = STRINGS.descriptionCounter(description.value.length, DESCRIPTION_MAX_LENGTH);
  });
  const since = h('input', { cls: 'rm-report-input', attrs: { type: MONTH_INPUT_TYPE, id: SINCE_ID } });
  return { urlInput, urlLabel, description, counter, since };
}

function buildNotice(common) {
  const { h } = common;
  return h('p', { cls: 'rm-report-notice' }, [
    common.text(STRINGS.noticeBeforeLink),
    h('a', { text: STRINGS.privacyLinkLabel, attrs: { href: PRIVACY_POLICY_URL } }),
    common.text(STRINGS.noticeAfterLink),
  ]);
}

/** Keeps the URL label and required flag in step with the chosen kind. */
function syncUrlRequirement(form, fields) {
  const isRequired = form.querySelector(`input[name="${KIND_FIELD_NAME}"]:checked`).value === KIND_REQUIRING_URL;
  fields.urlInput.required = isRequired;
  fields.urlLabel.textContent = isRequired ? STRINGS.urlLabel : `${STRINGS.urlLabel}${STRINGS.urlOptionalSuffix}`;
}

function readFields(form, fields, context) {
  return {
    topicId: context.topicId,
    country: context.country,
    kind: form.querySelector(`input[name="${KIND_FIELD_NAME}"]:checked`).value,
    sourceUrl: fields.urlInput.value.trim(),
    description: fields.description.value,
    sinceMonth: fields.since.value,
  };
}

/**
 * Moves Tab focus around inside a dialog instead of out to the page behind it.
 * @param {KeyboardEvent} event the Tab keydown
 * @param {HTMLElement} dialog the dialog element
 * @returns {void}
 */
export function trapTab(event, dialog) {
  const focusable = [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)];
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Returns focus to what opened a dialog; the detail card may have re-rendered it away.
 * @param {?Element} opener the element that was focused when the dialog opened
 * @returns {void}
 */
export function restoreFocus(opener) {
  if (opener?.isConnected) {
    opener.focus();
    return;
  }
  const key = opener?.getAttribute?.(FOCUS_KEY_ATTRIBUTE);
  if (key) document.querySelector(`[${FOCUS_KEY_ATTRIBUTE}="${key}"]`)?.focus();
}

/**
 * Builds the Send / Cancel row shared by the report dialogs.
 * @param {object} common the ui-common module
 * @param {function(): void} onCancel runs when Cancel is pressed
 * @returns {{submit: HTMLElement, cancel: HTMLElement, row: HTMLElement}}
 */
export function buildActions(common, onCancel) {
  const { h } = common;
  const submit = h('button', {
    cls: 'rm-button rm-button-ink', text: STRINGS.submitLabel, attrs: { type: 'submit' },
  });
  const cancel = h('button', {
    cls: 'rm-button rm-button-outline', text: STRINGS.cancelLabel, attrs: { type: 'button' }, on: { click: onCancel },
  });
  return { submit, cancel, row: h('div', { cls: 'rm-report-actions' }, [submit, cancel]) };
}

function showDone(common, dialog, onClose) {
  const { h } = common;
  const close = h('button', {
    cls: 'rm-button rm-button-ink', text: STRINGS.closeLabel, attrs: { type: 'button' }, on: { click: onClose },
  });
  dialog.replaceChildren(
    h('h2', { cls: 'rm-detail-title', text: STRINGS.doneHeading, attrs: { id: HEADING_ID, tabindex: '-1' } }),
    h('p', { cls: 'rm-reason', text: STRINGS.doneBody }),
    close,
  );
  dialog.querySelector('h2').focus();
}

function buildDialogShell(common, context) {
  const { h } = common;
  const headingText = context.subjectName ? STRINGS.headingFor(context.subjectName) : STRINGS.heading;
  const form = h('form', { cls: 'rm-report-form', attrs: { novalidate: true } });
  const dialog = h('div', {
    cls: 'rm-report-dialog',
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': HEADING_ID },
  });
  dialog.append(
    h('h2', { cls: 'rm-detail-title', text: headingText, attrs: { id: HEADING_ID, tabindex: '-1' } }),
    h('p', { cls: 'rm-eyebrow', text: `${context.topicTitle} · ${context.countryName}` }),
    h('p', { cls: 'rm-reason', text: STRINGS.privacyNote }),
    h('p', { cls: 'rm-reason', text: STRINGS.disputedExplanation }),
    form,
  );
  return { form, dialog, backdrop: h('div', { cls: 'rm-report-backdrop' }, [dialog]) };
}

function fillForm(common, shell, fields, message, actionRow) {
  const { h } = common;
  shell.form.append(
    buildKindRadios(common), fields.urlLabel, fields.urlInput,
    h('label', { cls: 'rm-section-heading', text: STRINGS.descriptionLabel, attrs: { for: DESCRIPTION_ID } }),
    fields.description, fields.counter,
    h('label', { cls: 'rm-section-heading', text: STRINGS.sinceLabel, attrs: { for: SINCE_ID } }),
    fields.since, buildNotice(common), message, actionRow,
  );
}

/**
 * Creates the status line shown under a dialog form.
 * @param {object} common the ui-common module
 * @returns {{element: HTMLElement, show: function(string, boolean): void}} `show(text, isError)` updates it
 */
export function createMessageLine(common) {
  const element = common.h('p', { cls: 'rm-notice', attrs: { role: 'status', hidden: true } });
  return {
    element,
    show(text, isError) {
      element.hidden = text === '';
      element.textContent = text;
      element.className = `rm-notice ${isError ? 'rm-notice-error' : 'rm-notice-ok'}`;
    },
  };
}

/**
 * Builds the submit handler. A second call while a submission is in flight is ignored,
 * so a double click can never send two reports.
 */
function createSubmitHandler({ deps, context, shell, fields, line, submitButton, proofAhead, close }) {
  let isWorking = false;
  const onPhase = (phase) => line.show(describePhase(phase), false);
  return async () => {
    if (isWorking) return;
    const values = readFields(shell.form, fields, context);
    const problem = validateReportFields(values);
    if (problem) {
      line.show(problem, true);
      return;
    }
    isWorking = true;
    submitButton.setAttribute(ARIA_DISABLED, 'true');
    const result = await runReportFlow({
      client: deps.client, proofAhead, reportUrls: deps.reportUrls, fields: values, onPhase,
    });
    isWorking = false;
    submitButton.removeAttribute(ARIA_DISABLED);
    if (result.ok) showDone(deps.common, shell.dialog, close);
    else line.show(describeFailure(result.code), true);
  };
}

function wireEvents(shell, fields, submit, close) {
  shell.form.addEventListener('submit', (event) => { event.preventDefault(); submit(); });
  shell.form.addEventListener('change', () => syncUrlRequirement(shell.form, fields));
  shell.dialog.addEventListener('keydown', (event) => {
    if (event.key === ESCAPE_KEY) {
      // Handled here so the page-level Escape handler does not also close the detail card.
      event.preventDefault();
      close();
    } else if (event.key === TAB_KEY) trapTab(event, shell.dialog);
  });
}

/**
 * Opens the report dialog for one topic and country. Escape or Cancel closes it
 * and returns focus to the opener.
 * @param {{common: object, pow: object, client: object, proofAhead: object, reportUrls: {challenge: string, submit: string},
 *   onClose?: function(): void}} deps `proofAhead` is the ui-proof-ahead module; `onClose` runs after the dialog is removed
 * @param {{topicId: string, topicTitle: string, country: string, countryName: string,
 *   subjectName?: string, descriptionPrefill?: string}} context `subjectName` (an authority, say) is added to
 *   the heading; `descriptionPrefill` starts the description field, which the visitor may edit
 * @returns {void}
 */
export function openReportDialog(deps, context) {
  const opener = document.activeElement;
  const shell = buildDialogShell(deps.common, context);
  const fields = buildTextFields(deps.common, context.descriptionPrefill ?? '');
  const line = createMessageLine(deps.common);
  const proofAhead = deps.proofAhead.createProofAhead({ client: deps.client, pow: deps.pow, urls: deps.reportUrls });
  const close = () => {
    proofAhead.abandon();
    shell.backdrop.remove();
    restoreFocus(opener);
    if (deps.onClose) deps.onClose();
  };
  const actions = buildActions(deps.common, close);
  const submit = createSubmitHandler({
    deps, context, shell, fields, line, submitButton: actions.submit, proofAhead, close,
  });
  fillForm(deps.common, shell, fields, line.element, actions.row);
  wireEvents(shell, fields, submit, close);
  syncUrlRequirement(shell.form, fields);
  (document.querySelector(HOST_SELECTOR) ?? document.body).append(shell.backdrop);
  shell.dialog.querySelector('h2').focus();
  deps.proofAhead.startOnFirstInput(shell.dialog, proofAhead);
}
