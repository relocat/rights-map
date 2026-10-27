// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Cross-checks of the Rights Map authorities file (authorities.de.v1.json): covered districts,
// evidence entries, dates and community figures. Each problem starts with a category tag such
// as [covers], [evidence], [date] or [community].
import { findDuplicates, TAG_DUPLICATE, TAG_RANGE } from './rules-checks.mjs';

export const TAG_COVERS = '[covers]';
export const TAG_EVIDENCE = '[evidence]';
export const TAG_DATE = '[date]';
export const TAG_COMMUNITY = '[community]';

const SRC_OFFICIAL = 'official';
const SRC_COMMUNITY = 'community';
const SRC_NONE = 'none';
const KIND_OFFICIAL = 'official';
const KIND_PRESS = 'press';
const HTTPS_PREFIX = 'https://';
/** A community value counts on the map only from this many experience reports. */
export const COMMUNITY_MIN_REPORTS = 5;
/** A community range is the 25th-75th percentile: with few reports a min or max is one person's value. */
export const RANGE_IQR = 'iqr';
/** Published community figures are whole multiples of this many months, so none is one person's exact value. */
export const COMMUNITY_FIGURE_STEP_MONTHS = 3;
/** Fields of an authority's `community` summary that hold figures from reports. */
const COMMUNITY_SUMMARY_FIGURE_FIELDS = ['wait_months', 'proc_months'];
/** Interval bounds of a time figure. */
const RANGE_BOUNDS = ['lo', 'hi'];

/** Dates are a full day, or a month for figures collected from experience reports. */
const DAY_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_DATE_PATTERN = /^\d{4}-\d{2}$/;
const AGS_PATTERN = /^\d{5}$/;
/** A calendar date has no year 0; JavaScript's `Date` maps years 0-99 to the 1900s. */
const MIN_YEAR = 1;
const FIRST_DAY_SUFFIX = '-01';

/** Whether `value` is a real calendar day (`YYYY-MM-DD`) or month (`YYYY-MM`, read as its first day). */
export function isRealAuthorityDate(value) {
  if (typeof value !== 'string') return false;
  const text = MONTH_DATE_PATTERN.test(value) ? `${value}${FIRST_DAY_SUFFIX}` : value;
  const match = DAY_DATE_PATTERN.exec(text);
  if (match === null) return false;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < MIN_YEAR) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** The mode and every time figure of an authority as `[label, value]`. */
function datedValues(authority) {
  const prefix = `authority ${authority.id}`;
  return [[`${prefix} mode`, authority.mode], ...Object.entries(authority.times).map(([metric, value]) => [`${prefix} ${metric}`, value])];
}

/** Authority ids are unique. */
function checkUniqueAuthorityIds(data) {
  return findDuplicates(data.authorities.map((authority) => authority.id)).map(
    (authorityId) => `${TAG_DUPLICATE} duplicate authority id ${authorityId}`,
  );
}

/** Every `covers` entry is a five-digit AGS of the geo layer, claimed by one authority only. */
function checkCovers(data, knownAgs) {
  const problems = [];
  const claimed = [];
  for (const authority of data.authorities) {
    for (const ags of authority.covers) {
      if (!AGS_PATTERN.test(ags)) {
        problems.push(`${TAG_COVERS} authority ${authority.id}: covers entry ${JSON.stringify(ags)} is not a 5-digit AGS`);
      } else if (!knownAgs.has(ags)) {
        problems.push(`${TAG_COVERS} authority ${authority.id}: AGS ${ags} is not in the geo layer`);
      }
      claimed.push(ags);
    }
  }
  for (const ags of findDuplicates(claimed)) {
    problems.push(`${TAG_COVERS} AGS ${ags} is covered by more than one authority`);
  }
  return problems;
}

/** Problems with one evidence entry: link scheme, official link, press intermediary. */
function evidenceProblems(authorityId, evidence) {
  const label = `authority ${authorityId} evidence ${evidence.id}`;
  const problems = [];
  if (evidence.url !== undefined && !evidence.url.startsWith(HTTPS_PREFIX)) {
    problems.push(`${TAG_EVIDENCE} ${label}: url must start with ${HTTPS_PREFIX}`);
  }
  if (evidence.kind === KIND_OFFICIAL && !evidence.url) {
    problems.push(`${TAG_EVIDENCE} ${label}: official evidence needs a url`);
  }
  if (evidence.kind === KIND_PRESS && !evidence.via) {
    problems.push(`${TAG_EVIDENCE} ${label}: press evidence needs via`);
  }
  return problems;
}

/** Evidence ids are unique per authority and every entry meets the rules of its kind. */
function checkEvidence(data) {
  const problems = [];
  for (const authority of data.authorities) {
    for (const each of findDuplicates(authority.evidence.map((evidence) => evidence.id))) {
      problems.push(`${TAG_DUPLICATE} authority ${authority.id}: duplicate evidence id ${each}`);
    }
    for (const evidence of authority.evidence) problems.push(...evidenceProblems(authority.id, evidence));
  }
  return problems;
}

/** Every date in the file is a real day or month. */
function checkDates(data) {
  const problems = [];
  if (!isRealAuthorityDate(data.generated)) problems.push(`${TAG_DATE} generated: bad date ${JSON.stringify(data.generated)}`);
  for (const authority of data.authorities) {
    for (const evidence of authority.evidence) {
      if (!isRealAuthorityDate(evidence.date)) {
        problems.push(`${TAG_DATE} authority ${authority.id} evidence ${evidence.id}: bad date ${JSON.stringify(evidence.date)}`);
      }
    }
    for (const [label, value] of datedValues(authority)) {
      if ('date' in value && !isRealAuthorityDate(value.date)) {
        problems.push(`${TAG_DATE} ${label}: bad date ${JSON.stringify(value.date)}`);
      }
    }
  }
  return problems;
}

/** A problem when any published community figure is finer than `COMMUNITY_FIGURE_STEP_MONTHS`. */
function stepProblems(label, figures) {
  const offStep = figures.filter((figure) => figure % COMMUNITY_FIGURE_STEP_MONTHS !== 0);
  if (offStep.length === 0) return [];
  return [`${TAG_COMMUNITY} ${label}: community figures [${offStep.join(', ')}] must be multiples of ${COMMUNITY_FIGURE_STEP_MONTHS} months`];
}

/** Problems with the community-specific rules of one time figure. */
function communityValueProblems(label, value) {
  const problems = [];
  if (!('n' in value)) {
    problems.push(`${TAG_COMMUNITY} ${label}: community value needs n`);
  } else if (value.n < COMMUNITY_MIN_REPORTS) {
    // The file is public: a handful of reports can single out one person.
    problems.push(`${TAG_COMMUNITY} ${label}: community value with fewer than ${COMMUNITY_MIN_REPORTS} reports`);
  }
  if (value.range !== RANGE_IQR) {
    problems.push(`${TAG_COMMUNITY} ${label}: community value must declare range '${RANGE_IQR}' (25th-75th percentile, never min-max)`);
  }
  const figures = RANGE_BOUNDS.filter((bound) => bound in value).map((bound) => value[bound]);
  return [...problems, ...stepProblems(label, figures)];
}

/** Problems with one time figure: range, sample size and evidence links. */
function valueProblems(label, value, evidenceIds) {
  const problems = [];
  if ('hi' in value && value.hi < value.lo) {
    problems.push(`${TAG_RANGE} ${label}: lo ${value.lo} is greater than hi ${value.hi}`);
  }
  if (value.src === SRC_COMMUNITY) problems.push(...communityValueProblems(label, value));
  const cited = value.evidence ?? [];
  for (const each of cited) {
    if (!evidenceIds.has(each)) problems.push(`${TAG_EVIDENCE} ${label}: unknown evidence id ${each}`);
  }
  if (value.src === SRC_OFFICIAL && cited.length === 0) {
    problems.push(`${TAG_EVIDENCE} ${label}: official value needs an evidence id`);
  }
  return problems;
}

/** Every sourced time figure has a sane range, a sample size if community, and real evidence. */
function checkTimeValues(data) {
  const problems = [];
  for (const authority of data.authorities) {
    const evidenceIds = new Set(authority.evidence.map((evidence) => evidence.id));
    for (const [metric, value] of Object.entries(authority.times)) {
      if (value.src !== SRC_NONE) problems.push(...valueProblems(`authority ${authority.id} ${metric}`, value, evidenceIds));
    }
  }
  return problems;
}

/** A community summary carries figures only from `COMMUNITY_MIN_REPORTS` reports, as interquartile ranges. */
function checkCommunityBlocks(data) {
  const problems = [];
  for (const authority of data.authorities) {
    const summary = authority.community;
    if (summary === undefined) continue;
    for (const field of COMMUNITY_SUMMARY_FIGURE_FIELDS) {
      if (!(field in summary)) continue;
      const label = `authority ${authority.id} community ${field}`;
      if (summary.n < COMMUNITY_MIN_REPORTS) {
        problems.push(`${TAG_COMMUNITY} ${label}: community value with fewer than ${COMMUNITY_MIN_REPORTS} reports`);
      }
      if (summary.range !== RANGE_IQR) {
        problems.push(`${TAG_COMMUNITY} ${label}: community summary must declare range '${RANGE_IQR}' (never min-max)`);
      }
      problems.push(...stepProblems(label, summary[field]));
    }
  }
  return problems;
}

/** Run every cross-check on an authorities file that already passed the schema. */
export function authoritiesCrossChecks(data, knownAgs) {
  return [
    ...checkUniqueAuthorityIds(data),
    ...checkCovers(data, knownAgs),
    ...checkEvidence(data),
    ...checkDates(data),
    ...checkTimeValues(data),
    ...checkCommunityBlocks(data),
  ];
}
