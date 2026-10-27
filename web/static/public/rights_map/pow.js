// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Browser side of the anonymous-report proof of work. The server hashes
// `token + ':' + counter` with SHA-256 and demands a number of leading zero
// bits; this module finds the smallest such counter. All state lives in local
// variables: nothing is written to storage, a cookie or the network.

/** Highest difficulty the browser will attempt; a larger value is treated as a hostile server. */
export const MAX_ACCEPTED_BITS = 20;
/** Hashes computed between two yields to the event loop, so the page stays responsive. */
export const BATCH_SIZE = 500;

const MIN_ACCEPTED_BITS = 1;
const BITS_PER_BYTE = 8;
const UINT32_BITS = 32;
const COUNTER_SEPARATOR = ':';
const HASH_ALGORITHM = 'SHA-256';
const YIELD_DELAY_MS = 0;
const STRINGS = Object.freeze({
  bitsOutOfRange: 'Proof-of-work difficulty is outside the accepted range',
});

const textEncoder = new TextEncoder();

/**
 * Counts the zero bits at the start of a byte array.
 * @param {Uint8Array} bytes
 * @returns {number} leading zero bits (8 per byte for all-zero input)
 */
export function countLeadingZeroBits(bytes) {
  let zeroBits = 0;
  for (const byte of bytes) {
    if (byte !== 0) return zeroBits + Math.clz32(byte) - (UINT32_BITS - BITS_PER_BYTE);
    zeroBits += BITS_PER_BYTE;
  }
  return zeroBits;
}

/**
 * Default SHA-256 using the platform's SubtleCrypto.
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
async function defaultDigest(bytes) {
  return new Uint8Array(await globalThis.crypto.subtle.digest(HASH_ALGORITHM, bytes));
}

/**
 * Default yield: hands control back to the event loop for one tick.
 * @returns {Promise<void>}
 */
function defaultYield() {
  return new Promise((resolve) => setTimeout(resolve, YIELD_DELAY_MS));
}

/**
 * Hashes one batch of consecutive counters at once.
 * @param {{token: string, firstCounter: number, digest: function(Uint8Array): Promise<Uint8Array>}} batch
 * @returns {Promise<Uint8Array[]>} the digests, in counter order
 */
function digestBatch({ token, firstCounter, digest }) {
  const pending = Array.from({ length: BATCH_SIZE }, (_, offset) => (
    digest(textEncoder.encode(`${token}${COUNTER_SEPARATOR}${firstCounter + offset}`))
  ));
  return Promise.all(pending);
}

/**
 * Finds the smallest counter whose hash meets the difficulty.
 * Each batch starts all its digests together and is then scanned in counter order, so the answer is
 * the same as hashing one counter at a time; only the per-await overhead is gone.
 * @param {{token: string, bits: number, digest?: function(Uint8Array): Promise<Uint8Array>,
 *   yieldFn?: function(): Promise<void>, onProgress?: function(number): void, signal?: AbortSignal}} options
 *   `digest` and `yieldFn` are injectable for tests; `onProgress` receives the attempts made at each batch end;
 *   `signal` is checked before every batch, so an abandoned solve stops within one batch.
 * @returns {Promise<number>} the counter
 * @throws {RangeError} when `bits` is not an integer in [1, MAX_ACCEPTED_BITS]
 * @throws {DOMException} `AbortError` when `signal` is aborted
 */
export async function solveProofOfWork({
  token, bits, digest = defaultDigest, yieldFn = defaultYield, onProgress, signal,
}) {
  if (!Number.isInteger(bits) || bits < MIN_ACCEPTED_BITS || bits > MAX_ACCEPTED_BITS) {
    throw new RangeError(STRINGS.bitsOutOfRange);
  }
  for (let firstCounter = 0; ; firstCounter += BATCH_SIZE) {
    if (signal) signal.throwIfAborted();
    const hashes = await digestBatch({ token, firstCounter, digest });
    const hit = hashes.findIndex((hash) => countLeadingZeroBits(hash) >= bits);
    if (hit !== -1) return firstCounter + hit;
    if (onProgress) onProgress(firstCounter + BATCH_SIZE);
    await yieldFn();
  }
}
