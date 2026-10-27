// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Static server for the Rights Map browser test. It serves the page shell (the
// file named by RM_SHELL_FILE, rendered by the site) and the static tree
// with the production CSP header, so any inline script or style the page needs shows up as a CSP
// violation. With RM_STATIC_SHELL=1 the shell is the static demo page instead: its relative links
// (../web/static/..., demo.css) resolve under /map/, so the server also serves the repository's
// web/static tree at /web/static/ and the demo directory's own files next to the shell.
// Usage: RM_PORT=<port> RM_SHELL_FILE=<path> [RM_STATIC_SHELL=1] node server.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATIC_ROOT = path.join(HERE, '..', '..', '..', 'web', 'static');
const PORT = Number(process.env.RM_PORT);
const HOST = '127.0.0.1';
const NOT_FOUND = 404;
const OK = 200;
const CONTENT_TYPES = Object.freeze({
  '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.html': 'text/html',
});
const FALLBACK_TYPE = 'application/octet-stream';
const SHELL_PATHS = Object.freeze(['/', '/map/']);
const SHELL_FILE = process.env.RM_SHELL_FILE;
const STATIC_PREFIX = '/static/';
const IS_STATIC_SHELL = process.env.RM_STATIC_SHELL === '1';
const DEMO_STATIC_PREFIX = '/web/static/';
const DEMO_ASSET_PREFIXES = Object.freeze(['/map/', '/demo/']);
// Stands in for the site's defaults endpoint: serves the fixture file the driver writes (RM_DEFAULTS_FIXTURE),
// an empty object (no overrides) while it does not exist, and a 500 while it holds FAILURE_MARKER.
const DEFAULTS_PATH = '/map/defaults.json';
const DEFAULTS_FIXTURE = process.env.RM_DEFAULTS_FIXTURE;
const FAILURE_MARKER = 'FAIL';
const SERVER_ERROR = 500;
const NO_OVERRIDES = '{}';
// Same policy the production site sends (the same headers the site's web server and application send).
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

// Stand-ins for the report endpoints. The driver sets the submit mode and reads what arrived through
// the two test-only paths below; the stub never checks the proof, the driver does.
const CHALLENGE_PATH = '/map/report/challenge/';
const SUBMIT_PATH = '/map/report/';
const REPORT_MODE_PATH = '/__test/report-mode';
const REPORT_LOG_PATH = '/__test/reports';
const MODE_ACCEPT = 'accept';
const MODE_PROOF_REJECTED_ONCE = 'proof-rejected-once';
const MODE_PROOF_REJECTED_ALWAYS = 'proof-rejected-always';
const STUB_CHALLENGE_BITS = 4;
const CREATED = 201;
const BAD_REQUEST = 400;
const ACCEPTED_BODY = JSON.stringify({ ok: true });
const EMPTY_BODY = JSON.stringify({});
const PROOF_REJECTED_BODY = JSON.stringify({ error: { code: 'E-RM02', message: 'stub' } });
const reportState = { mode: MODE_ACCEPT, challenges: 0, submissions: [] };

// The experience endpoints get the same kind of stand-in, with their own state and log path.
const EXPERIENCE_CHALLENGE_PATH = '/map/experience/challenge/';
const EXPERIENCE_SUBMIT_PATH = '/map/experience/';
const EXPERIENCE_MODE_PATH = '/__test/experience-mode';
const EXPERIENCE_LOG_PATH = '/__test/experiences';
const experienceState = { mode: MODE_ACCEPT, challenges: 0, submissions: [] };

// Stand-in for the disputed-status endpoint. Default: nothing disputed. The driver switches the
// mode with STATUS_MODE_PATH: Hungary disputed for the Ukrainian temporary protection topic, or a 500.
// The real endpoint lists a pair only from two open reports , so one
// report never reaches the browser; this stand-in just plays the already-thresholded answer.
const STATUS_PATH = '/map/status.json';
const STATUS_MODE_PATH = '/__test/status-mode';
const STATUS_MODE_EMPTY = 'empty';
const STATUS_MODE_DISPUTED = 'disputed';
const STATUS_MODE_FAILING = 'failing';
const STATUS_BODIES = Object.freeze({
  [STATUS_MODE_EMPTY]: JSON.stringify({ disputed: {} }),
  [STATUS_MODE_DISPUTED]: JSON.stringify({ disputed: { 'ua-tp': ['HU'] } }),
});
const statusState = { mode: STATUS_MODE_EMPTY };

// Stand-in for the community-figures endpoint. Barnim has no sourced figure (a gap the community
// median fills); Frankfurt (Oder) has an official total, so its community figure must never win.
// Bands only, like the real snapshot. The driver switches the mode, and reads how often it was fetched.
const COMMUNITY_PATH = '/map/community.json';
const COMMUNITY_MODE_PATH = '/__test/community-mode';
const COMMUNITY_HITS_PATH = '/__test/community-hits';
const COMMUNITY_MODE_EMPTY = 'empty';
const COMMUNITY_MODE_OK = 'ok';
const COMMUNITY_MODE_FAILING = 'failing';
const COMMUNITY_BODY = JSON.stringify({
  topic: 'de-naturalisation',
  authorities: {
    'de-bb-barnim': {
      n_band: '5-9',
      wait: { median: 6, q1: 3, q3: 9 },
      proc: { median: 6, q1: 3, q3: 6 },
      total: { median: 12, q1: 9, q3: 15 },
    },
    'de-bb-frankfurt-oder': { n_band: '10-19', total: { median: 60, q1: 54, q3: 63 } },
  },
});
const COMMUNITY_EMPTY_BODY = JSON.stringify({ topic: 'de-naturalisation', authorities: {} });
// Default: nothing published, so the pages of unrelated checks see the map as the data files draw it.
const communityState = { mode: COMMUNITY_MODE_EMPTY, hits: 0 };

if (!Number.isInteger(PORT) || PORT <= 0) throw new Error('RM_PORT must be a positive integer');
if (!SHELL_FILE || !fs.existsSync(SHELL_FILE)) throw new Error('RM_SHELL_FILE must name the rendered page shell');

/** Joins a request path onto a root directory; null when the result would leave that root. */
function resolveInside(root, relativePath) {
  const file = path.join(root, relativePath);
  return file.startsWith(root + path.sep) ? file : null;
}

/** Static-shell mode only: the demo's own files (demo.css) and the web/static tree under the demo's relative links. */
function resolveDemoFile(pathname) {
  if (pathname.startsWith(DEMO_STATIC_PREFIX)) return resolveInside(STATIC_ROOT, pathname.slice(DEMO_STATIC_PREFIX.length));
  const prefix = DEMO_ASSET_PREFIXES.find((candidate) => pathname.startsWith(candidate));
  return prefix ? resolveInside(path.dirname(SHELL_FILE), pathname.slice(prefix.length)) : null;
}

/** Maps a request path to the rendered shell or a file in the static tree, else null. */
function resolveFile(pathname) {
  if (SHELL_PATHS.includes(pathname)) return SHELL_FILE;
  const demoFile = IS_STATIC_SHELL ? resolveDemoFile(pathname) : null;
  if (demoFile) return demoFile;
  if (!pathname.startsWith(STATIC_PREFIX)) return null;
  return resolveInside(STATIC_ROOT, pathname.slice(STATIC_PREFIX.length));
}

/** Answers the defaults endpoint from the fixture file, read per request so the driver can change it. */
function serveDefaults(response) {
  const body = DEFAULTS_FIXTURE && fs.existsSync(DEFAULTS_FIXTURE) ? fs.readFileSync(DEFAULTS_FIXTURE, 'utf8') : NO_OVERRIDES;
  const isFailure = body.trim() === FAILURE_MARKER;
  response.writeHead(isFailure ? SERVER_ERROR : OK, {
    'Content-Type': CONTENT_TYPES['.json'], 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': CSP,
  });
  response.end(isFailure ? '' : body);
}

/** Replies with a JSON body and the production CSP. */
function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': CONTENT_TYPES['.json'], 'Content-Security-Policy': CSP });
  response.end(body);
}

/** Answers one submit according to the current mode and records the posted body. */
function serveSubmit(request, response, reportState) {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    reportState.submissions.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    const attempt = reportState.submissions.length;
    const isRejected = reportState.mode === MODE_PROOF_REJECTED_ALWAYS
      || (reportState.mode === MODE_PROOF_REJECTED_ONCE && attempt === 1);
    sendJson(response, isRejected ? BAD_REQUEST : CREATED, isRejected ? PROOF_REJECTED_BODY : ACCEPTED_BODY);
  });
}

/** Handles one report-style stub (challenge, submit, mode switch, log); returns true when the request was one of them. */
function serveReportStub(request, response, url, paths, state) {
  if (url.pathname === paths.challenge && request.method === 'GET') {
    state.challenges += 1;
    sendJson(response, OK, JSON.stringify({ token: `stub-token-${state.challenges}`, bits: STUB_CHALLENGE_BITS }));
  } else if (url.pathname === paths.submit && request.method === 'POST') {
    serveSubmit(request, response, state);
  } else if (url.pathname === paths.mode) {
    Object.assign(state, { mode: url.searchParams.get('mode'), challenges: 0, submissions: [] });
    sendJson(response, OK, EMPTY_BODY);
  } else if (url.pathname === paths.log) {
    sendJson(response, OK, JSON.stringify(state));
  } else return false;
  return true;
}

const REPORT_PATHS = { challenge: CHALLENGE_PATH, submit: SUBMIT_PATH, mode: REPORT_MODE_PATH, log: REPORT_LOG_PATH };
const EXPERIENCE_PATHS = {
  challenge: EXPERIENCE_CHALLENGE_PATH, submit: EXPERIENCE_SUBMIT_PATH, mode: EXPERIENCE_MODE_PATH, log: EXPERIENCE_LOG_PATH,
};

/** Handles the status stub and its mode switch; returns true when the request was one of them. */
function serveStatusStub(response, url) {
  if (url.pathname === STATUS_MODE_PATH) {
    statusState.mode = url.searchParams.get('mode');
    sendJson(response, OK, EMPTY_BODY);
  } else if (url.pathname === STATUS_PATH) {
    if (statusState.mode === STATUS_MODE_FAILING) sendJson(response, SERVER_ERROR, EMPTY_BODY);
    else sendJson(response, OK, STATUS_BODIES[statusState.mode]);
  } else return false;
  return true;
}

/** Handles the community stub, its mode switch and its hit counter; returns true when the request was one of them. */
function serveCommunityStub(response, url) {
  if (url.pathname === COMMUNITY_MODE_PATH) {
    communityState.mode = url.searchParams.get('mode');
    sendJson(response, OK, EMPTY_BODY);
  } else if (url.pathname === COMMUNITY_HITS_PATH) {
    sendJson(response, OK, JSON.stringify({ hits: communityState.hits }));
  } else if (url.pathname === COMMUNITY_PATH) {
    communityState.hits += 1;
    if (communityState.mode === COMMUNITY_MODE_FAILING) sendJson(response, SERVER_ERROR, EMPTY_BODY);
    else sendJson(response, OK, communityState.mode === COMMUNITY_MODE_OK ? COMMUNITY_BODY : COMMUNITY_EMPTY_BODY);
  } else return false;
  return true;
}

http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${HOST}`);
  if (serveReportStub(request, response, requestUrl, REPORT_PATHS, reportState)) return;
  if (serveReportStub(request, response, requestUrl, EXPERIENCE_PATHS, experienceState)) return;
  if (serveStatusStub(response, new URL(request.url, `http://${HOST}`))) return;
  if (serveCommunityStub(response, new URL(request.url, `http://${HOST}`))) return;
  if (new URL(request.url, `http://${HOST}`).pathname === DEFAULTS_PATH) { serveDefaults(response); return; }
  const file =resolveFile(new URL(request.url, `http://${HOST}`).pathname);
  fs.readFile(file ?? '', (error, data) => {
    if (!file || error) {
      response.writeHead(NOT_FOUND);
      response.end();
      return;
    }
    response.writeHead(OK, {
      'Content-Type': CONTENT_TYPES[path.extname(file)] ?? FALLBACK_TYPE,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': CSP,
    });
    response.end(data);
  });
}).listen(PORT, HOST);
