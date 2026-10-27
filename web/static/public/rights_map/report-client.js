// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Network client for anonymous rule reports. The payload builder names its
// fields one by one, so a caller cannot smuggle in the fact set: a report says
// which rule looks wrong, never who is asking. Endpoint URLs come from the
// page (`data-*` attributes) via `reportUrls`, never from this file.

/** The six form fields, in the order the dialog shows them. */
export const REPORT_FIELD_KEYS = Object.freeze([
  'topicId', 'country', 'kind', 'sourceUrl', 'description', 'sinceMonth',
]);

/** Code returned when the request never got a usable server answer. */
export const NETWORK_ERROR_CODE = 'network';

const JSON_CONTENT_TYPE = 'application/json';
const CONTENT_TYPE_HEADER = 'Content-Type';
const CREDENTIALS_MODE = 'omit';
const METHOD_GET = 'GET';
const METHOD_POST = 'POST';
const HTTP_CREATED = 201;

/**
 * Builds the exact eight-key wire payload; unknown properties are never read.
 * @param {{topicId: string, country: string, kind: string, sourceUrl: string,
 *   description: string, sinceMonth: string}} fields
 * @param {{token: string, counter: number}} proof the solved challenge
 * @returns {object} payload with the server's snake_case keys
 */
export function buildReportPayload(
  { topicId, country, kind, sourceUrl, description, sinceMonth },
  { token, counter },
) {
  return {
    topic_id: topicId,
    country,
    kind,
    source_url: sourceUrl,
    description,
    since_month: sinceMonth,
    token,
    counter,
  };
}

/**
 * Reads the server's static error code from a failed response, if present.
 * @param {Response} response
 * @returns {Promise<string>} the code, or NETWORK_ERROR_CODE when the body is unusable
 */
async function readErrorCode(response) {
  try {
    const body = await response.json();
    const code = body && body.error && body.error.code;
    return typeof code === 'string' ? code : NETWORK_ERROR_CODE;
  } catch {
    return NETWORK_ERROR_CODE;
  }
}

/**
 * Requests a proof-of-work challenge.
 * @param {{challenge: string}} reportUrls endpoint URLs from the page
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<{ok: true, token: string, bits: number} | {ok: false, code: string}>}
 */
export async function fetchChallenge(reportUrls, fetchFn = fetch) {
  try {
    const response = await fetchFn(reportUrls.challenge, {
      method: METHOD_GET, credentials: CREDENTIALS_MODE,
    });
    if (!response.ok) return { ok: false, code: await readErrorCode(response) };
    const { token, bits } = await response.json();
    if (typeof token !== 'string' || !Number.isInteger(bits)) {
      return { ok: false, code: NETWORK_ERROR_CODE };
    }
    return { ok: true, token, bits };
  } catch {
    return { ok: false, code: NETWORK_ERROR_CODE };
  }
}

/**
 * Posts a report. Cookies are never sent or stored.
 * @param {object} payload from buildReportPayload
 * @param {{submit: string}} reportUrls endpoint URLs from the page
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<{ok: true} | {ok: false, code: string}>}
 */
export async function submitReport(payload, reportUrls, fetchFn = fetch) {
  try {
    const response = await fetchFn(reportUrls.submit, {
      method: METHOD_POST,
      credentials: CREDENTIALS_MODE,
      headers: { [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE },
      body: JSON.stringify(payload),
    });
    if (response.status === HTTP_CREATED) return { ok: true };
    return { ok: false, code: await readErrorCode(response) };
  } catch {
    return { ok: false, code: NETWORK_ERROR_CODE };
  }
}
