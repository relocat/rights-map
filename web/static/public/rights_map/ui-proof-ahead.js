// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Solves the anonymous-submission proof of work while the visitor is still typing, so Send usually
// finds the proof ready. The solve starts at the first input in the dialog, never on open, so opening
// and cancelling consumes no challenge. One instance belongs to one open dialog: it fetches at most one
// challenge at a time, hands the proof out once, and after the dialog is closed it never starts again. The challenge
// request carries nothing but the endpoint URL; no answer or form value is ever seen here.

const ABORT_ERROR_NAME = 'AbortError';
const NETWORK_FAILURE_CODE = 'network';
const FIRST_INPUT_EVENTS = Object.freeze(['focusin', 'input']);
const FIELD_SELECTOR = 'input, textarea, select';

/**
 * Fetches a challenge and solves it.
 * @param {{client: object, pow: object, urls: {challenge: string, submit: string}}} source report client,
 *   proof-of-work module and endpoint URLs
 * @param {AbortSignal} [signal] stops the solver at the next batch
 * @returns {Promise<{ok: true, token: string, counter: number} | {ok: false, code: string}>}
 */
export async function solveFreshProof({ client, pow, urls }, signal) {
  const challenge = await client.fetchChallenge(urls);
  if (!challenge.ok) return challenge;
  try {
    const counter = await pow.solveProofOfWork({ token: challenge.token, bits: challenge.bits, signal });
    return { ok: true, token: challenge.token, counter };
  } catch (error) {
    // A difficulty outside the accepted range means the server answer cannot be trusted; an abort
    // means the dialog was closed and nobody waits for the proof. Anything else is a real defect.
    if (!(error instanceof RangeError) && error?.name !== ABORT_ERROR_NAME) throw error;
    return { ok: false, code: NETWORK_FAILURE_CODE };
  }
}

/**
 * Creates the solve-ahead handle of one dialog.
 * @param {{client: object, pow: object, urls: {challenge: string, submit: string}}} source as for `solveFreshProof`
 * @returns {{start: function(): void, take: function(): Promise<object>, abandon: function(): void}}
 *   `start` begins solving in the background (a no-op while one is running or ready); `take` returns the
 *   running or finished proof, or starts a fresh one, and gives each proof out once; `abandon` stops the
 *   solver for good: afterwards `start` does nothing and `take` answers a network failure
 */
export function createProofAhead(source) {
  let controller = null;
  let pending = null;
  let isAbandoned = false;

  function start() {
    if (isAbandoned || pending !== null) return;
    const ownController = new AbortController();
    controller = ownController;
    const attempt = solveFreshProof(source, ownController.signal).then((result) => {
      // A failed background attempt is dropped, so the next Send tries again instead of replaying it.
      if (!result.ok && pending === attempt) pending = null;
      return result;
    });
    pending = attempt;
    // Marks a rejection as observed while nobody has called take() yet; take() hands the same
    // promise to the submit flow, which still receives the rejection.
    attempt.catch(() => {});
  }

  function take() {
    // A closed dialog must never start a solve or a send, so no new solver is created here.
    if (isAbandoned) return Promise.resolve({ ok: false, code: NETWORK_FAILURE_CODE });
    start();
    const proof = pending;
    pending = null;
    return proof;
  }

  function abandon() {
    isAbandoned = true;
    if (controller !== null) controller.abort();
    controller = null;
    pending = null;
  }

  return { start, take, abandon };
}

/**
 * Starts the solve-ahead on the first focus or keystroke inside a form field of `container`.
 * @param {HTMLElement} container the dialog element
 * @param {{start: function(): void}} proofAhead the dialog's handle from `createProofAhead`
 * @returns {void}
 */
export function startOnFirstInput(container, proofAhead) {
  const onFirstInput = (event) => {
    if (!event.target.matches?.(FIELD_SELECTOR)) return;
    for (const name of FIRST_INPUT_EVENTS) container.removeEventListener(name, onFirstInput);
    proofAhead.start();
  };
  for (const name of FIRST_INPUT_EVENTS) container.addEventListener(name, onFirstInput);
}
