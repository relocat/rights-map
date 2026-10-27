// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Unit tests for the browser proof-of-work solver. The cross-check vector was
// computed once with an independent SHA-256 implementation and is the spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODULE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'web', 'static', 'public', 'rights_map',
);
const { countLeadingZeroBits, solveProofOfWork, MAX_ACCEPTED_BITS, BATCH_SIZE } = await import(
  pathToFileURL(join(MODULE_DIR, 'pow.js')).href
);

const TOKEN = 'test-token.signature';
const EASY_BITS = 8;
const CROSS_CHECK_TOKEN = 'fixedtoken.sig';
const CROSS_CHECK_BITS = 12;
const CROSS_CHECK_COUNTER = 4377;
const UNREACHABLE_BITS = 256;

/** Independent leading-zero check via a BigInt, unlike the module's byte loop. */
function hasLeadingZeroBits(token, counter, bits) {
  const digest = createHash('sha256').update(`${token}:${counter}`).digest();
  return BigInt(`0x${digest.toString('hex')}`) >> BigInt(digest.length * 8 - bits) === 0n;
}

test('countLeadingZeroBits matches the server vectors', () => {
  assert.equal(countLeadingZeroBits(Uint8Array.of(0x00, 0x01)), 15);
  assert.equal(countLeadingZeroBits(Uint8Array.of(0xff)), 0);
  assert.equal(countLeadingZeroBits(Uint8Array.of(0, 0, 0)), 24);
  assert.equal(countLeadingZeroBits(Uint8Array.of(0x10)), 3);
});

test('solver finds a counter that passes an independent check', async () => {
  const counter = await solveProofOfWork({ token: TOKEN, bits: EASY_BITS });
  assert.ok(hasLeadingZeroBits(TOKEN, counter, EASY_BITS));
});

test('solver returns the smallest counter (independent cross-check vector)', async () => {
  const counter = await solveProofOfWork({ token: CROSS_CHECK_TOKEN, bits: CROSS_CHECK_BITS });
  assert.equal(counter, CROSS_CHECK_COUNTER);
});

test('solver yields at least once per batch', async () => {
  let yields = 0;
  let digestCalls = 0;
  const neverSolved = async () => {
    digestCalls += 1;
    return digestCalls > BATCH_SIZE * 2 ? new Uint8Array(32) : Uint8Array.of(0xff);
  };
  await solveProofOfWork({
    token: TOKEN, bits: EASY_BITS, digest: neverSolved, yieldFn: async () => { yields += 1; },
  });
  assert.ok(yields >= 2);
});

test('solver reports progress at batch ends', async () => {
  const progress = [];
  let digestCalls = 0;
  const digest = async () => {
    digestCalls += 1;
    return digestCalls > BATCH_SIZE ? new Uint8Array(32) : Uint8Array.of(0xff);
  };
  await solveProofOfWork({
    token: TOKEN, bits: EASY_BITS, digest, yieldFn: async () => {}, onProgress: (n) => progress.push(n),
  });
  assert.deepEqual(progress, [BATCH_SIZE]);
});

test('solver rejects difficulty outside 1..MAX_ACCEPTED_BITS', async () => {
  for (const bits of [0, MAX_ACCEPTED_BITS + 1, -1, 1.5, UNREACHABLE_BITS, NaN]) {
    await assert.rejects(solveProofOfWork({ token: TOKEN, bits }), RangeError);
  }
});

test('pow.js touches no storage, cookie or network API', () => {
  const source = readFileSync(join(MODULE_DIR, 'pow.js'), 'utf8');
  for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'fetch(']) {
    assert.ok(!source.includes(forbidden), `pow.js must not use ${forbidden}`);
  }
});

/** Reference solver: one digest at a time, exactly as the server's algorithm reads. */
function sequentialSolve(token, bits) {
  for (let counter = 0; ; counter += 1) {
    if (hasLeadingZeroBits(token, counter, bits)) return counter;
  }
}

test('the batched solver returns exactly what a sequential loop returns', async () => {
  for (const token of ['alpha.sig', 'beta.sig', 'gamma.sig', 'delta.sig', 'epsilon.sig']) {
    for (const bits of [1, 4, 8, 11]) {
      assert.equal(await solveProofOfWork({ token, bits }), sequentialSolve(token, bits), `${token} @ ${bits}`);
    }
  }
});

test('the smallest qualifying counter inside a batch wins, not the first one to finish', async () => {
  const qualifying = new Set([3, 7]);
  const digest = async (bytes) => {
    const counter = Number(new TextDecoder().decode(bytes).split(':')[1]);
    // Later counters resolve sooner, so completion order is the reverse of counter order.
    await new Promise((resolve) => setTimeout(resolve, BATCH_SIZE - counter));
    return qualifying.has(counter) ? new Uint8Array(32) : Uint8Array.of(0xff);
  };
  assert.equal(await solveProofOfWork({ token: TOKEN, bits: EASY_BITS, digest, yieldFn: async () => {} }), 3);
});

test('the attempt count is unchanged: progress is reported once per full batch, at the same totals', async () => {
  const sequentialAttempts = 2 * BATCH_SIZE + 5;
  const progress = [];
  const digest = async (bytes) => {
    const counter = Number(new TextDecoder().decode(bytes).split(':')[1]);
    return counter === sequentialAttempts ? new Uint8Array(32) : Uint8Array.of(0xff);
  };
  const counter = await solveProofOfWork({
    token: TOKEN, bits: EASY_BITS, digest, yieldFn: async () => {}, onProgress: (n) => progress.push(n),
  });
  assert.equal(counter, sequentialAttempts);
  assert.deepEqual(progress, [BATCH_SIZE, 2 * BATCH_SIZE]);
});

test('an aborted signal stops the solver before the next batch', async () => {
  const controller = new AbortController();
  let batches = 0;
  const digest = async () => Uint8Array.of(0xff);
  const yieldFn = async () => { batches += 1; if (batches === 2) controller.abort(); };
  await assert.rejects(
    solveProofOfWork({ token: TOKEN, bits: EASY_BITS, digest, yieldFn, signal: controller.signal }),
    { name: 'AbortError' },
  );
  assert.equal(batches, 2);
});
