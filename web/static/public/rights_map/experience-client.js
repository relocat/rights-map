// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Wire payload of "Share my experience". The builder names its fields one by
// one, so a caller cannot smuggle in the fact set or any answer: an experience
// says which office and how long, never who is asking. Challenge and submit
// transport are the report client's; only the payload differs.

/** The five form fields, in the order the dialog shows them. */
export const EXPERIENCE_FIELD_KEYS = Object.freeze([
  'topicId', 'authorityId', 'certificateMonth', 'waitMonths', 'processingMonths',
]);

/** The exact wire keys of a submission, including the proof of work; equals the server's allowed set. */
export const EXPERIENCE_PAYLOAD_KEYS = Object.freeze([
  'topic_id', 'authority_id', 'certificate_month', 'wait_months', 'processing_months', 'token', 'counter',
]);

/**
 * Builds the exact seven-key wire payload; unknown properties are never read.
 * @param {{topicId: string, authorityId: string, certificateMonth: string,
 *   waitMonths: ?number, processingMonths: ?number}} fields validated form values
 * @param {{token: string, counter: number}} proof the solved challenge
 * @returns {object} payload with the server's snake_case keys
 */
export function buildExperiencePayload(
  { topicId, authorityId, certificateMonth, waitMonths, processingMonths },
  { token, counter },
) {
  return {
    topic_id: topicId,
    authority_id: authorityId,
    certificate_month: certificateMonth,
    wait_months: waitMonths,
    processing_months: processingMonths,
    token,
    counter,
  };
}
