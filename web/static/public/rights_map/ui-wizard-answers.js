// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// The three answer-management actions: download my answers (a file the user
// keeps), load answers from such a file, and forget everything. Nothing here
// uploads: the download is a Blob object URL and the upload is read locally.

const STRINGS = Object.freeze({
  exportAnswers: 'Export my answers',
  load: 'Load answers',
  forget: 'Forget my answers',
  forgetQuestion: 'Delete all your answers from this browser?',
  forgetConfirm: 'Yes, forget them',
  forgetCancel: 'Cancel',
  fileTooLarge: 'That file is too large to be an answers file.',
  fileUnreadable: 'The file could not be read.',
});
const BYTES_PER_KIBIBYTE = 1024;
const MAX_IMPORT_BYTES = BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE;
const IMPORT_ACCEPT = 'application/json,.json';
/** Button variants; each maps to a `rm-button-<variant>` class. */
const BUTTON_VARIANT = Object.freeze({ OUTLINE: 'outline', INK: 'ink', DANGER: 'danger' });
const exportButton = Object.freeze({ text: STRINGS.exportAnswers, key: 'answers-export', variant: BUTTON_VARIANT.INK });

function actionButton(deps, spec, onClick) {
  const { h, focusKey } = deps.common;
  return h('button', {
    cls: `rm-button rm-button-${spec.variant}`,
    text: spec.text,
    attrs: { type: 'button', ...focusKey(spec.key) },
    on: { click: onClick },
  });
}

/** Reads a chosen file locally and hands its text on; oversized files are refused before reading. */
async function readChosenFile(fileInput, callbacks) {
  const [file] = fileInput.files;
  fileInput.value = '';
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) {
    callbacks.onFileProblem(STRINGS.fileTooLarge);
    return;
  }
  try {
    callbacks.onLoadText(await file.text());
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    callbacks.onFileProblem(STRINGS.fileUnreadable);
  }
}

function buildConfirm(deps, callbacks) {
  const { h } = deps.common;
  const outline = (text, key) => ({ text, key, variant: BUTTON_VARIANT.OUTLINE });
  return h('div', { cls: 'rm-confirm', attrs: { role: 'alertdialog', 'aria-label': STRINGS.forgetQuestion } }, [
    h('p', { text: STRINGS.forgetQuestion }),
    actionButton(deps, outline(STRINGS.forgetConfirm, 'answers-forget-confirm'), callbacks.onForgetConfirm),
    actionButton(deps, outline(STRINGS.forgetCancel, 'answers-forget-cancel'), callbacks.onForgetCancel),
  ]);
}

/** The second row: Load beside Forget, or the forget confirmation in their place. */
function buildSecondaryRow(deps, callbacks, state, fileInput) {
  const { h } = deps.common;
  if (state.forgetPending) return h('div', { cls: 'rm-actions-row' }, [buildConfirm(deps, callbacks)]);
  const load = { text: STRINGS.load, key: 'answers-load', variant: BUTTON_VARIANT.OUTLINE };
  const forget = { text: STRINGS.forget, key: 'answers-forget', variant: BUTTON_VARIANT.DANGER };
  return h('div', { cls: 'rm-actions-row' }, [
    actionButton(deps, load, () => fileInput.click()),
    actionButton(deps, forget, callbacks.onForgetAsk),
  ]);
}

function buildNotice(deps, notice) {
  if (!notice) return null;
  const isError = notice.kind === deps.common.NOTICE_KIND.ERROR;
  return deps.common.h('p', {
    cls: `rm-notice rm-notice-${notice.kind}`, text: notice.text, attrs: { role: isError ? 'alert' : 'status' },
  });
}

/**
 * Creates the answer actions block.
 * @param {HTMLElement} rootElement container to fill
 * @param {{onDownload: function, onLoadText: function(string): void, onFileProblem: function(string): void,
 *   onForgetAsk: function, onForgetConfirm: function, onForgetCancel: function}} callbacks
 * @param {{common: object}} deps
 * @returns {{render: function(object): void}}
 */
export function createAnswerActions(rootElement, callbacks, deps) {
  const { h, rebuild } = deps.common;
  // One persistent input: re-rendering must not drop a file chosen in the OS dialog.
  const fileInput = h('input', { attrs: { type: 'file', accept: IMPORT_ACCEPT, hidden: true, tabindex: '-1' } });
  fileInput.addEventListener('change', () => readChosenFile(fileInput, callbacks));
  return {
    /** @param {{forgetPending: boolean, answersNotice: ?{kind: string, text: string}}} state */
    render(state) {
      rebuild(rootElement, () => [
        h('div', { cls: 'rm-actions' }, [
          actionButton(deps, exportButton, callbacks.onDownload),
          buildSecondaryRow(deps, callbacks, state, fileInput),
          fileInput,
        ]),
        buildNotice(deps, state.answersNotice),
      ]);
    },
  };
}
