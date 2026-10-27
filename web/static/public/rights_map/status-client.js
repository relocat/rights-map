// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Reads the public list of (topic, country) pairs with several open reports. The request
// is a plain GET with no parameter: nothing about the visitor is sent.

const CREDENTIALS_MODE = 'omit';
const DISPUTED_KEY = 'disputed';

/** True when `value` is an object whose every entry is a list of strings. */
function isDisputedMap(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every((list) => Array.isArray(list) && list.every((code) => typeof code === 'string'));
}

/**
 * Fetches the disputed pairs. Best effort: the overlay is an extra, so every failure
 * (network, non-2xx status, bad JSON, unexpected shape) yields an empty map and no error
 * text anywhere.
 * @param {string} url the status endpoint published by the page shell
 * @param {function} [fetchFn] injectable for tests
 * @returns {Promise<Object<string, string[]>>} topic id to ISO2 codes, `{}` on any failure
 */
export async function fetchDisputedStatus(url, fetchFn = fetch) {
  try {
    const response = await fetchFn(url, { credentials: CREDENTIALS_MODE });
    if (!response.ok) return {};
    const body = await response.json();
    return isDisputedMap(body?.[DISPUTED_KEY]) ? body[DISPUTED_KEY] : {};
  } catch (error) {
    // fetch rejects with TypeError and json() with SyntaxError; anything else is a bug and must surface.
    if (error instanceof TypeError || error instanceof SyntaxError) return {};
    throw error;
  }
}

/**
 * Whether an open report exists for the pair.
 * @param {?Object<string, string[]>} status result of {@link fetchDisputedStatus}
 * @param {string} topicId
 * @param {string} iso2
 * @returns {boolean}
 */
export function isDisputed(status, topicId, iso2) {
  if (!status || !Object.hasOwn(status, topicId)) return false;
  return status[topicId].includes(iso2);
}
