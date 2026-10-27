// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Unit tests for the solve-ahead handle: one challenge per dialog, one solve at a time, a proof
// handed out once, and a solver that stops when the dialog is abandoned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODULE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'web', 'static', 'public', 'rights_map',
);
const { createProofAhead, startOnFirstInput } = await import(pathToFileURL(join(MODULE_DIR, 'ui-proof-ahead.js')).href);
const { solveProofOfWork, BATCH_SIZE } = await import(pathToFileURL(join(MODULE_DIR, 'pow.js')).href);

const URLS = { challenge: '/c/', submit: '/s/' };
const BITS = 4;
const SOLVED_COUNTER = 9;

/** Client stub that counts challenges; `gate` (a promise) holds the challenge back until resolved. */
function stubClient({ gate = Promise.resolve(), failures = 0 } = {}) {
  const calls = { challenges: 0 };
  return {
    calls,
    client: {
      fetchChallenge: async () => {
        calls.challenges += 1;
        await gate;
        if (calls.challenges <= failures) return { ok: false, code: 'network' };
        return { ok: true, token: `token-${calls.challenges}`, bits: BITS };
      },
    },
  };
}
const instantPow = { solveProofOfWork: async ({ token }) => token.length + SOLVED_COUNTER };

test('start fetches one challenge; a second start while it runs does not fetch another', async () => {
  const { client, calls } = stubClient();
  const ahead = createProofAhead({ client, pow: instantPow, urls: URLS });
  ahead.start();
  ahead.start();
  const proof = await ahead.take();
  assert.equal(calls.challenges, 1);
  assert.deepEqual(proof, { ok: true, token: 'token-1', counter: 'token-1'.length + SOLVED_COUNTER });
});

test('take while the solve is still running waits for it and never starts a second one', async () => {
  let release;
  const { client, calls } = stubClient({ gate: new Promise((resolve) => { release = resolve; }) });
  const ahead = createProofAhead({ client, pow: instantPow, urls: URLS });
  ahead.start();
  const waiting = ahead.take();
  release();
  assert.equal((await waiting).ok, true);
  assert.equal(calls.challenges, 1);
});

test('a proof is handed out once; the next take solves a fresh challenge', async () => {
  const { client, calls } = stubClient();
  const ahead = createProofAhead({ client, pow: instantPow, urls: URLS });
  ahead.start();
  const first = await ahead.take();
  const second = await ahead.take();
  assert.equal(calls.challenges, 2);
  assert.notEqual(first.token, second.token);
});

test('a failed background attempt is not replayed: the next take tries again', async () => {
  const { client, calls } = stubClient({ failures: 1 });
  const ahead = createProofAhead({ client, pow: instantPow, urls: URLS });
  ahead.start();
  await new Promise((resolve) => setImmediate(resolve));
  const proof = await ahead.take();
  assert.equal(calls.challenges, 2);
  assert.equal(proof.ok, true);
});

test('abandon stops the real solver within one batch', async () => {
  let digestCalls = 0;
  const neverSolved = async () => { digestCalls += 1; return Uint8Array.of(0xff); };
  const pow = { solveProofOfWork: (options) => solveProofOfWork({ ...options, digest: neverSolved }) };
  const { client } = stubClient();
  const ahead = createProofAhead({ client, pow, urls: URLS });
  ahead.start();
  while (digestCalls === 0) await new Promise((resolve) => setImmediate(resolve));
  ahead.abandon();
  const callsAtAbandon = digestCalls;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(digestCalls - callsAtAbandon <= BATCH_SIZE * 2, `${digestCalls - callsAtAbandon} digests after abandon`);
  const settled = digestCalls;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(digestCalls, settled);
});

test('a difficulty outside the accepted range is reported as a network failure', async () => {
  const { client } = stubClient();
  const outOfRange = { solveProofOfWork: async () => { throw new RangeError('bits'); } };
  const ahead = createProofAhead({ client, pow: outOfRange, urls: URLS });
  assert.deepEqual(await ahead.take(), { ok: false, code: 'network' });
});

/** Minimal event target: records listeners and lets a test fire an event at a fake form field. */
function fakeContainer() {
  const listeners = new Map();
  return {
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name) => listeners.delete(name),
    fire: (name, matchesField) => listeners.get(name)?.({ target: { matches: () => matchesField } }),
    listenerCount: () => listeners.size,
  };
}

test('no challenge on open; exactly one after the first field input', async () => {
  const { client, calls } = stubClient();
  const ahead = createProofAhead({ client, pow: instantPow, urls: URLS });
  const container = fakeContainer();
  startOnFirstInput(container, ahead);
  assert.equal(calls.challenges, 0);
  container.fire('focusin', false);
  assert.equal(calls.challenges, 0);
  container.fire('focusin', true);
  container.fire('input', true);
  await ahead.take();
  assert.equal(calls.challenges, 1);
  assert.equal(container.listenerCount(), 0);
});

test('after abandon, take answers a network failure and starts nothing', async () => {
  const { client, calls } = stubClient();
  const ahead = createProofAhead({ client, pow: instantPow, urls: URLS });
  ahead.abandon();
  ahead.start();
  assert.deepEqual(await ahead.take(), { ok: false, code: 'network' });
  assert.equal(calls.challenges, 0);
});
