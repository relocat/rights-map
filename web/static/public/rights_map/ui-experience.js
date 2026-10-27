// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// "Share my experience" dialog of the authority card. The visitor says when they received their
// naturalisation certificate and, optionally, how long waiting and processing took; the browser
// solves a small proof of work and posts the figures anonymously. This module only ever sees the
// three form fields and the office: it is never handed the fact set, so an answer cannot reach a
// request. Nothing is stored on the device.

const STRINGS = Object.freeze({
  heading: (authorityName) => `Your experience: ${authorityName}`,
  monthPlaceholder: 'MM/YYYY',
  monthLabel: 'I received my naturalisation certificate in',
  waitLabel: 'Waiting to apply took (months)',
  processingLabel: 'Processing took (months)',
  processingHint: 'from application to decision',
  privacyBeforeLink: 'We use your answer only for the waiting times shown on the map, and only once at least 5 people have answered for this authority. Please don\'t add anything that identifies you. Details: ',
  privacyLinkLabel: 'privacy notice for experiences',
  privacyAfterLink: '.',
  closeLabel: 'Close',
  doneHeading: 'Your experience',
  done: (minimum) => `Thank you. Your experience counts once at least ${minimum} people have shared theirs for this office.`,
  monthRequired: 'Choose the month you received your certificate.',
  monthInvalid: 'Enter a month and year like 03/2026.',
  monthFuture: 'The month cannot be in the future.',
  monthTooOld: (year) => `The month cannot be before ${year}.`,
  monthsInvalid: (maximum) => `Enter a whole number of months from 0 to ${maximum}.`,
});

/** Topic the experience form collects for; must match the topic the server accepts. */
export const EXPERIENCE_TOPIC_ID = 'de-naturalisation';
/** Largest months figure; must match the server's limit. */
export const MONTHS_MAX = 120;
/** Earliest certificate year; must match the server's limit. */
export const CERTIFICATE_MONTH_MIN_YEAR = 2015;
/** People needed before a community figure shows; must match the server's publication threshold. */
export const COMMUNITY_MIN_REPORTS = 5;
/** Target of the privacy link; the shell also publishes it as `data-experience-privacy-url`. */
export const DEFAULT_PRIVACY_URL = '/map/experience-privacy/';

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const WHOLE_NUMBER_PATTERN = /^\d+$/;
const DECIMAL_RADIX = 10;
const ESCAPE_KEY = 'Escape';
const TAB_KEY = 'Tab';
const HOST_SELECTOR = '.rm-root';
const HEADING_ID = 'rm-experience-title';
const MONTH_ID = 'rm-experience-month';
const WAIT_ID = 'rm-experience-wait';
const PROCESSING_ID = 'rm-experience-processing';
const ARIA_DISABLED = 'aria-disabled';
const FIELD_NAMES = Object.freeze(['certificateMonth', 'waitMonths', 'processingMonths']);

/**
 * Parses an optional months field.
 * @param {string} text trimmed input text
 * @returns {{value: ?number, isValid: boolean}} `null` for an empty field; never auto-corrected
 */
function parseMonths(text) {
  if (text === '') return { value: null, isValid: true };
  if (!WHOLE_NUMBER_PATTERN.test(text)) return { value: null, isValid: false };
  const value = Number.parseInt(text, DECIMAL_RADIX);
  return { value, isValid: value <= MONTHS_MAX };
}

/**
 * Judges the typed certificate month.
 * @param {{text: string, stored: ?string}} month the typed text and its `YYYY-MM` reading (null when unreadable)
 * @param {Date} today the current date
 * @returns {?string} the message to show, or null when the month may be sent
 */
function checkMonth({ text, stored }, today) {
  if (text === '') return STRINGS.monthRequired;
  const match = stored === null ? null : MONTH_PATTERN.exec(stored);
  if (!match) return STRINGS.monthInvalid;
  const [year, month] = [Number.parseInt(match[1], DECIMAL_RADIX), Number.parseInt(match[2], DECIMAL_RADIX)];
  if (year < CERTIFICATE_MONTH_MIN_YEAR) return STRINGS.monthTooOld(CERTIFICATE_MONTH_MIN_YEAR);
  const isFuture = year > today.getFullYear() || (year === today.getFullYear() && month > today.getMonth() + 1);
  return isFuture ? STRINGS.monthFuture : null;
}

/**
 * Checks the fields the browser can judge without the server. Nothing is corrected, only reported.
 * @param {{certificateMonth: string, waitMonths: string, processingMonths: string}} values trimmed input text
 * @param {Date} today the current date
 * @param {function(string): ?string} parseMonthInput reads typed text (`MM/YYYY`) as `YYYY-MM`, or null; the
 *   passport field's parser, handed in so the two fields accept exactly the same spellings
 * @returns {{errors: object, cleaned: ?object}} a message per failing field name, or the cleaned values
 *   (`certificateMonth` as `YYYY-MM` and months as numbers or null) when every field may be sent
 */
export function validateExperienceFields(values, today, parseMonthInput) {
  const errors = {};
  const stored = parseMonthInput(values.certificateMonth);
  const monthProblem = checkMonth({ text: values.certificateMonth, stored }, today);
  if (monthProblem) errors.certificateMonth = monthProblem;
  const wait = parseMonths(values.waitMonths);
  const processing = parseMonths(values.processingMonths);
  if (!wait.isValid) errors.waitMonths = STRINGS.monthsInvalid(MONTHS_MAX);
  if (!processing.isValid) errors.processingMonths = STRINGS.monthsInvalid(MONTHS_MAX);
  if (Object.keys(errors).length > 0) return { errors, cleaned: null };
  return {
    errors,
    cleaned: { certificateMonth: stored, waitMonths: wait.value, processingMonths: processing.value },
  };
}

/** Default clock; tests and the page may pass their own through `deps.today`. */
function currentDate() {
  return new Date();
}

function buildField(common, { id, label, hint, inputAttrs }) {
  const { h } = common;
  const input = h('input', { cls: 'rm-report-input', attrs: { id, autocomplete: 'off', ...inputAttrs } });
  const error = h('p', { cls: 'rm-report-error', attrs: { role: 'alert', hidden: true } });
  const children = [h('label', { cls: 'rm-section-heading', text: label, attrs: { for: id } }), input];
  if (hint) children.push(h('p', { cls: 'rm-report-counter', text: hint }));
  children.push(error);
  return { input, error, nodes: children };
}

function buildFields(common) {
  return {
    certificateMonth: buildField(common, {
      id: MONTH_ID, label: STRINGS.monthLabel, inputAttrs: { type: 'text', inputmode: 'numeric', placeholder: STRINGS.monthPlaceholder },
    }),
    waitMonths: buildField(common, {
      id: WAIT_ID, label: STRINGS.waitLabel, inputAttrs: { type: 'number', inputmode: 'numeric' },
    }),
    processingMonths: buildField(common, {
      id: PROCESSING_ID, label: STRINGS.processingLabel, hint: STRINGS.processingHint,
      inputAttrs: { type: 'number', inputmode: 'numeric' },
    }),
  };
}

function showErrors(fields, errors) {
  for (const name of FIELD_NAMES) {
    const message = errors[name] ?? '';
    fields[name].error.textContent = message;
    fields[name].error.hidden = message === '';
  }
}

/** Hides one field's message; typing means the visitor is already fixing it. */
function clearError(field) {
  field.error.textContent = '';
  field.error.hidden = true;
}

function readValues(fields) {
  return Object.fromEntries(FIELD_NAMES.map((name) => [name, fields[name].input.value.trim()]));
}

function showDone(common, dialog, onClose) {
  const { h } = common;
  dialog.replaceChildren(
    h('h2', { cls: 'rm-detail-title', text: STRINGS.doneHeading, attrs: { id: HEADING_ID, tabindex: '-1' } }),
    h('p', { cls: 'rm-reason', text: STRINGS.done(COMMUNITY_MIN_REPORTS) }),
    h('button', { cls: 'rm-button rm-button-ink', text: STRINGS.closeLabel, attrs: { type: 'button' }, on: { click: onClose } }),
  );
  dialog.querySelector('h2').focus();
}

function buildShell(deps, context, fields, line, actions) {
  const { h } = deps.common;
  const form = h('form', { cls: 'rm-report-form', attrs: { novalidate: true } });
  const privacy = h('p', { cls: 'rm-report-notice' }, [
    deps.common.text(STRINGS.privacyBeforeLink),
    h('a', { text: STRINGS.privacyLinkLabel, attrs: { href: deps.privacyUrl ?? DEFAULT_PRIVACY_URL } }),
    deps.common.text(STRINGS.privacyAfterLink),
  ]);
  form.append(...FIELD_NAMES.flatMap((name) => fields[name].nodes), privacy, line.element, actions.row);
  const dialog = h('div', {
    cls: 'rm-report-dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': HEADING_ID },
  }, [
    h('h2', { cls: 'rm-detail-title', text: STRINGS.heading(context.authorityName), attrs: { id: HEADING_ID, tabindex: '-1' } }),
    form,
  ]);
  return { form, dialog, backdrop: h('div', { cls: 'rm-report-backdrop' }, [dialog]) };
}

function createSubmitHandler({ deps, context, fields, line, submitButton, shell, close, proofAhead }) {
  const { report } = deps;
  let isWorking = false;
  const onPhase = (phase) => line.show(report.describePhase(phase), false);
  return async () => {
    if (isWorking) return;
    const { errors, cleaned } = validateExperienceFields(
      readValues(fields), (deps.today ?? currentDate)(), deps.monthField.parseMonthInput,
    );
    showErrors(fields, errors);
    if (cleaned === null) return;
    isWorking = true;
    submitButton.setAttribute(ARIA_DISABLED, 'true');
    const result = await report.runReportFlow({
      client: { ...deps.client, buildReportPayload: deps.buildPayload }, proofAhead, reportUrls: deps.urls,
      fields: { topicId: EXPERIENCE_TOPIC_ID, authorityId: context.authorityId, ...cleaned }, onPhase,
    });
    isWorking = false;
    submitButton.removeAttribute(ARIA_DISABLED);
    if (result.ok) showDone(deps.common, shell.dialog, close);
    else line.show(report.describeFailure(result.code), true);
  };
}

function wireEvents(shell, submit, close, report) {
  shell.form.addEventListener('submit', (event) => { event.preventDefault(); submit(); });
  shell.dialog.addEventListener('keydown', (event) => {
    if (event.key === ESCAPE_KEY) {
      // Handled here so the page-level Escape handler does not also close the authority card.
      event.preventDefault();
      close();
    } else if (event.key === TAB_KEY) report.trapTab(event, shell.dialog);
  });
}

/**
 * Opens the experience dialog for one authority. Escape or Cancel closes it and returns focus to the opener.
 * @param {{common: object, pow: object, client: object, report: object, buildPayload: function,
 *   urls: {challenge: string, submit: string}, privacyUrl?: string, today?: function(): Date,
 *   proofAhead: object, monthField: {attachMonthFormatting: function, parseMonthInput: function}}} deps `report` is the ui-report module (flow,
 *   focus trap, message line, progress text); `client` is the report client (challenge and submit transport);
 *   `proofAhead` is the ui-proof-ahead module; `monthField` is the ui-fact-controls module, so this field behaves like the passport month field
 * @param {{authorityId: string, authorityName: string}} context the office; no answer or fact is accepted here
 * @returns {void}
 */
export function openExperienceDialog(deps, context) {
  const opener = document.activeElement;
  const fields = buildFields(deps.common);
  const line = deps.report.createMessageLine(deps.common);
  const proofAhead = deps.proofAhead.createProofAhead({ client: deps.client, pow: deps.pow, urls: deps.urls });
  const close = () => {
    proofAhead.abandon();
    shell.backdrop.remove();
    deps.report.restoreFocus(opener);
  };
  const actions = deps.report.buildActions(deps.common, close);
  const shell = buildShell(deps, context, fields, line, actions);
  const submit = createSubmitHandler({ deps, context, fields, line, submitButton: actions.submit, shell, close, proofAhead });
  deps.monthField.attachMonthFormatting(fields.certificateMonth.input, () => clearError(fields.certificateMonth));
  wireEvents(shell, submit, close, deps.report);
  (document.querySelector(HOST_SELECTOR) ?? document.body).append(shell.backdrop);
  shell.dialog.querySelector('h2').focus();
  deps.proofAhead.startOnFirstInput(shell.dialog, proofAhead);
}
