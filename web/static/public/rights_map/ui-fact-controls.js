// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Builds the input control for one fact: segmented buttons for enum and bool
// facts, a year text field for year facts, and a month text field (MM/YYYY) with a Save button, in the same row, for
// the companion month fact (shown only while its parent condition holds). Used by both
// the profile editor and the situation step, so the two can never drift apart.

const STRINGS = Object.freeze({
  profileTag: 'PROFILE',
  profileTagTitle: 'Shared across topics',
  usedByPrefix: 'Used by: ',
  usedBySeparator: ', ',
  gainPrefix: '+',
  monthPlaceholder: 'until MM/YYYY',
  saveDate: 'Save date',
  monthInvalid: 'Enter a month and year like 03/2028.',
  monthOutOfRange: 'Month must be 01–12.',
  monthSavedPrefix: 'Saved: ',
  monthSavedSuffix: '.',
  yearPlaceholder: 'YYYY',
  saveYear: 'Save year',
  yearInvalid: 'Enter a four-digit year like 2022.',
});
const MONTH_NAMES = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
const MESSAGE_ERROR = 'error';
const MESSAGE_SUCCESS = 'success';
const MESSAGE_CLASS = Object.freeze({ [MESSAGE_ERROR]: 'rm-month-message-error', [MESSAGE_SUCCESS]: 'rm-month-message-ok' });
const ENTER_KEY = 'Enter';
// Three accepted spellings; the capture groups differ in order, so each carries its own mapping.
const MONTH_YEAR_PATTERN = /^(\d{1,2})\/(\d{4})$/;
const YEAR_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const FIRST_MONTH = 1;
const LAST_MONTH = 12;
const MONTH_DIGITS = 2;
const MAX_INPUT_DIGITS = 6; // MMYYYY
const NON_DIGITS = /\D/g;
const DELETE_INPUT_PREFIX = 'delete';
const DISPLAY_SEPARATOR = '/';
const STORED_SEPARATOR = '-';
const ICON_VIEW_BOX = '0 0 24 24';
const ENTER_ICON_PATH = 'M20 6v6a3 3 0 0 1-3 3H5M9 11l-4 4 4 4';
// Duplicated on purpose: sibling modules cannot import each other without losing the ?v= cache
// buster, so this value is kept in sync with factset-store.js and pinned by tests/js/rights_map/shared-constants.test.mjs.
/** Fact type of a value chosen from a fixed option list. */
export const TYPE_ENUM = 'enum';
/** Fact type of a yes/no value. */
export const TYPE_BOOL = 'bool';
const SEGMENTED_TYPES = Object.freeze([TYPE_ENUM, TYPE_BOOL]);
/** Fact type of a four-digit year, typed into a text field. */
export const TYPE_YEAR = 'year';
const YEAR_PATTERN = /^\d{4}$/;
const MAX_YEAR_DIGITS = 4;

function isMonthNumber(month) {
  return month >= FIRST_MONTH && month <= LAST_MONTH;
}

/**
 * Reads a typed month. Accepts MM/YYYY, M/YYYY and YYYY-MM.
 * @param {string} text what the visitor typed
 * @returns {string|null} the fact value `YYYY-MM`, or null when the text is not a real month
 */
export function parseMonthInput(text) {
  const trimmed = String(text).trim();
  const monthFirst = MONTH_YEAR_PATTERN.exec(trimmed);
  const yearFirst = YEAR_MONTH_PATTERN.exec(trimmed);
  const [year, month] = monthFirst ? [monthFirst[2], monthFirst[1]] : yearFirst ? [yearFirst[1], yearFirst[2]] : [null, null];
  if (year === null || !isMonthNumber(Number(month))) return null;
  return `${year}${STORED_SEPARATOR}${month.padStart(MONTH_DIGITS, '0')}`;
}

/**
 * Formats a stored month for the field.
 * @param {string|undefined} stored fact value `YYYY-MM`
 * @returns {string} `MM/YYYY`, or '' when nothing valid is stored
 */
export function formatMonthForInput(stored) {
  const parsed = stored === undefined ? null : parseMonthInput(stored);
  if (parsed === null) return '';
  const [year, month] = parsed.split(STORED_SEPARATOR);
  return `${month}${DISPLAY_SEPARATOR}${year}`;
}

/**
 * Live-formats what the visitor has typed into the month field: keeps digits only, inserts the
 * `/` after the second digit and allows six digits at most (`MM/YYYY`). It never corrects the
 * digits themselves (no zero prefix, no month clamping): checking is left to Save, so the visitor
 * sees exactly what they typed. A complete pasted month (`2028-03`, `3/2028`) is recognised
 * first, so its digits are not re-split as a month.
 * @param {string} rawText the field's current text
 * @returns {string} the text to show
 */
export function formatMonthYearInput(rawText) {
  const text = String(rawText);
  const pasted = parseMonthInput(text);
  if (pasted !== null) return formatMonthForInput(pasted);
  const digits = text.replace(NON_DIGITS, '').slice(0, MAX_INPUT_DIGITS);
  if (digits.length < MONTH_DIGITS) return digits;
  return `${digits.slice(0, MONTH_DIGITS)}${DISPLAY_SEPARATOR}${digits.slice(MONTH_DIGITS)}`;
}

/**
 * Keeps the month field formatted while the visitor types. A deletion that only removed the
 * auto-inserted `/` also removes the digit before it, otherwise the formatter would put the
 * slash straight back and the visitor would be stuck. The caret stays at the end. Typing also
 * clears the previous Save message (`onTyped`).
 * @param {HTMLInputElement} input the month text field
 * @param {function(): void} onTyped runs on every input event
 * @returns {void}
 */
export function attachMonthFormatting(input, onTyped) {
  let previous = input.value;
  input.addEventListener('input', (event) => {
    onTyped();
    const isSlashOnlyDeletion = event.inputType?.startsWith(DELETE_INPUT_PREFIX)
      && previous.endsWith(DISPLAY_SEPARATOR) && input.value === previous.slice(0, -1);
    const raw = isSlashOnlyDeletion ? input.value.slice(0, -1) : input.value;
    const formatted = formatMonthYearInput(raw);
    if (input.value !== formatted) input.value = formatted;
    input.setSelectionRange(formatted.length, formatted.length);
    previous = formatted;
  });
}

function buildOption(deps, fact, [code, label], context) {
  const { h, focusKey } = deps.common;
  const gain = context.gains?.[fact.id]?.[code];
  const isSelected = context.facts[fact.id] === code;
  return h('button', {
    cls: 'rm-option',
    attrs: { type: 'button', 'aria-pressed': String(isSelected), ...focusKey(`fact:${fact.id}:${code}`) },
    on: { click: () => context.onSet(fact.id, code) },
  }, [
    h('span', { text: label }),
    gain > 0 ? h('span', { cls: 'rm-gain rm-mono', text: `${STRINGS.gainPrefix}${gain}` }) : null,
  ]);
}

/** Decorative "enter" arrow; the save button's name comes from its aria-label. */
function saveIcon(deps) {
  const { s } = deps.common;
  return s('svg', {
    cls: 'rm-icon-stroke rm-save-icon',
    attrs: { viewBox: ICON_VIEW_BOX, 'aria-hidden': 'true', focusable: 'false' },
  }, [s('path', { attrs: { d: ENTER_ICON_PATH } })]);
}

/**
 * Judges the typed month text. Nothing is judged while typing; Save is the only checkpoint.
 * @returns {{month: string|null, error: string|null}} the value to store, or why there is none
 */
function judgeMonthText(text) {
  const month = parseMonthInput(text);
  if (month !== null) return { month, error: null };
  const match = MONTH_YEAR_PATTERN.exec(text.trim());
  const isMonthOutOfRange = match !== null && !isMonthNumber(Number(match[1]));
  return { month: null, error: isMonthOutOfRange ? STRINGS.monthOutOfRange : STRINGS.monthInvalid };
}

/** "March 2028" for a stored `YYYY-MM`. */
function monthLabel(stored) {
  const [year, month] = stored.split(STORED_SEPARATOR);
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

/** Shows (or, with null, clears) the message line and remembers it across the re-render a commit causes. */
function showMessage(deps, monthFact, element, message) {
  element.textContent = message?.text ?? '';
  element.classList.remove(...Object.values(MESSAGE_CLASS));
  if (message) element.classList.add(MESSAGE_CLASS[message.kind]);
  if (message) deps.messages.set(monthFact.id, message);
  else deps.messages.delete(monthFact.id);
}

/**
 * Commits the month field, or explains in red what is wrong with it. Nothing is committed while the
 * visitor types: a commit re-renders the card, which would swallow a click on a neighbouring button.
 * An invalid text stays in the field so it can be corrected, and is never stored.
 */
function saveMonth(deps, input, monthFact, context, element) {
  const { month, error } = judgeMonthText(input.value);
  if (error !== null) {
    showMessage(deps, monthFact, element, { kind: MESSAGE_ERROR, text: error });
    return;
  }
  showMessage(deps, monthFact, element, {
    kind: MESSAGE_SUCCESS, text: `${STRINGS.monthSavedPrefix}${monthLabel(month)}${STRINGS.monthSavedSuffix}`,
  });
  context.onSet(monthFact.id, month);
}

/** The month field and its Save button, sharing the row of the option buttons. */
function buildMonthEntry(deps, monthFact, context, element) {
  const { h, focusKey } = deps.common;
  const input = h('input', {
    cls: 'rm-month-input',
    attrs: {
      type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: STRINGS.monthPlaceholder,
      'aria-label': monthFact.label, value: formatMonthForInput(context.facts[monthFact.id]), ...focusKey(`fact:${monthFact.id}`),
    },
  });
  attachMonthFormatting(input, () => showMessage(deps, monthFact, element, null));
  const save = () => saveMonth(deps, input, monthFact, context, element);
  input.addEventListener('keydown', (event) => {
    if (event.key !== ENTER_KEY) return;
    event.preventDefault();
    save();
  });
  return h('div', { cls: 'rm-month-entry' }, [
    input,
    h('button', {
      cls: 'rm-month-save',
      attrs: { type: 'button', 'aria-label': STRINGS.saveDate, ...focusKey(`fact:${monthFact.id}:save`) },
      on: { click: save },
    }, [saveIcon(deps)]),
  ]);
}

/**
 * The year field and its Save button. Like the month field it commits only on Save or Enter, never
 * while typing, so a commit's re-render cannot swallow a click; invalid text is explained and not stored.
 */
function buildYearEntry(deps, fact, context, messageElement) {
  const { h, focusKey } = deps.common;
  const input = h('input', {
    cls: 'rm-month-input',
    attrs: {
      type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: String(MAX_YEAR_DIGITS), placeholder: STRINGS.yearPlaceholder,
      'aria-label': fact.label, value: context.facts[fact.id] ?? '', ...focusKey(`fact:${fact.id}`),
    },
  });
  input.addEventListener('input', () => {
    input.value = input.value.replace(NON_DIGITS, '');
    messageElement.textContent = '';
  });
  const save = () => {
    const text = input.value.trim();
    if (!YEAR_PATTERN.test(text)) {
      messageElement.textContent = STRINGS.yearInvalid;
      return;
    }
    context.onSet(fact.id, text);
  };
  input.addEventListener('keydown', (event) => {
    if (event.key !== ENTER_KEY) return;
    event.preventDefault();
    save();
  });
  return h('div', { cls: 'rm-month-entry' }, [
    input,
    h('button', {
      cls: 'rm-month-save', attrs: { type: 'button', 'aria-label': STRINGS.saveYear, ...focusKey(`fact:${fact.id}:save`) }, on: { click: save },
    }, [saveIcon(deps)]),
  ]);
}

function buildYearField(deps, fact, context) {
  const { h } = deps.common;
  const message = h('p', { cls: 'rm-month-message rm-month-message-error', attrs: { 'aria-live': 'polite' } });
  return h('fieldset', { cls: 'rm-fact' }, [
    buildLegend(deps, fact, context),
    context.usedBy ? h('p', { cls: 'rm-used-by', text: usedByText(context.usedBy) }) : null,
    h('div', { cls: 'rm-options' }, [buildYearEntry(deps, fact, context, message)]),
    message,
  ]);
}

/** The month fact attached to `fact`, only while its parent condition holds. */
function companionOf(deps, fact, context) {
  if (!fact.companion) return null;
  const monthFact = deps.engine.factDefinition(context.rules, fact.companion);
  const isParentMatched = monthFact?.parent && context.facts[monthFact.parent.fact] === monthFact.parent.equals;
  return isParentMatched ? monthFact : null;
}

function buildLegend(deps, fact, context) {
  const { h } = deps.common;
  const showTag = fact.scope === deps.common.PROFILE_SCOPE && context.showProfileTag;
  return h('legend', { cls: 'rm-fact-legend' }, [
    h('span', { text: fact.label }),
    showTag
      ? h('span', { cls: 'rm-tag rm-mono', text: STRINGS.profileTag, attrs: { title: STRINGS.profileTagTitle } })
      : null,
  ]);
}

function usedByText(topicTitles) {
  return `${STRINGS.usedByPrefix}${topicTitles.join(STRINGS.usedBySeparator)}`;
}

/**
 * The message line under a fact that has a companion month. It is always built, empty or not, so its
 * reserved height (see rights_map.css) never changes when a message appears, disappears, or the
 * month field itself is hidden.
 */
function buildMessageLine(deps, monthFact) {
  const { h } = deps.common;
  const element = h('p', { cls: 'rm-month-message', attrs: { 'aria-live': 'polite' } });
  const remembered = monthFact ? deps.messages.get(monthFact.id) : undefined;
  if (monthFact && remembered) showMessage(deps, monthFact, element, remembered);
  return element;
}

function buildField(deps, fact, context) {
  const { h } = deps.common;
  if (fact.type === TYPE_YEAR) return buildYearField(deps, fact, context);
  if (!SEGMENTED_TYPES.includes(fact.type)) return null;
  const monthFact = companionOf(deps, fact, context);
  if (fact.companion && !monthFact) deps.messages.delete(fact.companion);
  const message = fact.companion ? buildMessageLine(deps, monthFact) : null;
  return h('fieldset', { cls: 'rm-fact' }, [
    buildLegend(deps, fact, context),
    context.usedBy ? h('p', { cls: 'rm-used-by', text: usedByText(context.usedBy) }) : null,
    h('div', { cls: 'rm-options' }, [
      ...fact.options.map((option) => buildOption(deps, fact, option, context)),
      monthFact ? buildMonthEntry(deps, monthFact, context, message) : null,
    ]),
    message,
  ]);
}

/**
 * Creates the fact-control builder.
 * @param {object} common helpers from ui-common.js
 * @param {object} engine engine.js exports (for the companion month fact lookup)
 * @returns {{buildField: function(object, object): (HTMLElement|null)}}
 */
export function createFactControls(common, engine) {
  // Save messages by month fact id: a commit re-renders the card, which would otherwise erase them.
  const deps = { common, engine, messages: new Map() };
  return {
    /**
     * Builds one fact's fieldset.
     * @param {object} fact fact definition from rules.facts
     * @param {{rules: object, facts: object, gains?: object, usedBy?: string[], showProfileTag?: boolean,
     *   onSet: function(string, string): void}} context
     * @returns {HTMLElement|null} null for fact types this UI cannot edit
     */
    buildField: (fact, context) => buildField(deps, fact, context),
  };
}
