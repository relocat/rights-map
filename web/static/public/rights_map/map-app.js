// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Rights Map entry point and the only holder of app state. The page loads
// only this module; it dynamic-imports every sibling with the versioned URL
// (siblings have no import statements) and hands each its dependencies.
//
// Privacy: answers live in the fact store (localStorage) and are used only
// by the in-browser engine. Requests are for static files only; no request
// URL, console message or error text ever contains an answer.

const ROOT_ID = 'rights-map';
const MODULE_NAMES = Object.freeze([
  'engine', 'factset-store', 'geo-render', 'pow', 'report-client', 'experience-client', 'status-client', 'community-client', 'ui-authority-community', 'ui-report', 'ui-proof-ahead', 'ui-experience', 'ui-common', 'ui-topbar', 'ui-map',
  'ui-map-gestures', 'ui-map-area', 'ui-map-detail', 'ui-map-labels', 'ui-wizard', 'ui-wizard-profile', 'ui-wizard-situation',
  'ui-wizard-answers', 'ui-fact-controls', 'ui-detail', 'ui-finder',
  'authority-metrics', 'ui-map-districts', 'ui-map-controls', 'ui-authority', 'ui-wizard-requirements', 'ui-sources',
]);
const RULES_PATH = 'data/rules.v1.json';
// Operator-edited default answers per topic. Served by the site (not as a static file), and fetched
// without any parameter but the cache buster: no answer is ever sent.
const DEFAULTS_URL = '/map/defaults.json';
const GEO_MANIFEST_PATH = 'manifest.json';
const GEO_COUNTRIES_PATH = 'countries.json';
const GEO_LAND_PATH = 'land.json';
const GEO_CITIES_PATH = 'cities-t1.json';
const GEO_DISTRICT_DIRECTORY = 'l2';
const AUTHORITIES_DATA_DIRECTORY = 'data';
// Mirrors authority-metrics.js METRIC.TOTAL (siblings cannot import each other); pinned by tests.
const DEFAULT_METRIC = 'total';
const DOWNLOAD_FILENAME = 'relocat-answers.json';
const DOWNLOAD_MIME_TYPE = 'application/json';
const ESCAPE_KEY = 'Escape';
const ESCAPE_IGNORED_TAGS = Object.freeze(['SELECT', 'INPUT', 'TEXTAREA']);
const MONTH_PAD_LENGTH = 2;
const DECIMAL_RADIX = 10;
const STRINGS = Object.freeze({
  rulesFailed: 'Rules could not be loaded.',
  retry: 'Retry',
  answersLoaded: 'Answers loaded.',
});
const RETRY_PARAMETER = 'retry';
// Value the shell's data-reports-enabled attribute carries while the reports feature is switched on.
const REPORTS_ENABLED_VALUE = 'true';
// Same convention for data-experiences-enabled (the experiences feature switch).
const EXPERIENCES_ENABLED_VALUE = 'true';
const COMMUNITY_ENABLED_VALUE = 'true';
// Same convention for data-de-pilot-enabled (the pilot switch).
const DE_PILOT_ENABLED_VALUE = 'true';
const REGION_DISPLAY_LOCALE = 'en';
// Duplicated on purpose: sibling modules cannot import each other without losing the ?v= cache
// buster, so this value is kept in sync with engine.js and pinned by tests/js/rights_map/shared-constants.test.mjs.
/** Name of the rules group listing the countries the map covers. */
export const COVERED_GROUP = 'COVERED';

/**
 * Path of a country's district layer inside the geo pack.
 * @param {string} country ISO 3166-1 alpha-2 code
 * @returns {string} e.g. 'l2/DE.json'
 */
export function districtLayerPath(country) {
  return `${GEO_DISTRICT_DIRECTORY}/${country}.json`;
}

/** Thrown when a static file answers with a non-2xx status. */
class LoadError extends Error {}

/**
 * Formats a date as 'YYYY-MM' (local time).
 * @param {Date} date
 * @returns {string}
 */
export function formatMonth(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(MONTH_PAD_LENGTH, '0')}`;
}

async function fetchJson(url) {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new LoadError(`Request failed with status ${response.status}`);
  return response.json();
}

/**
 * Replaces `topic.defaults` with the operator's values for every topic the overrides name. An
 * entry that is not an object of string answers is ignored, so a malformed response can never
 * break the map; the rules-file defaults then stay in force for that topic.
 * @param {{topics: Array<{id: string, defaults?: Object}>}} rules  Mutated in place.
 * @param {unknown} overrides  Parsed `/map/defaults.json`: `{topicId: {factId: code}}`.
 */
export function applyDefaultOverrides(rules, overrides) {
  if (overrides === null || typeof overrides !== 'object') return;
  for (const topic of rules.topics) {
    const entry = Object.hasOwn(overrides, topic.id) ? overrides[topic.id] : null;
    const isAnswerMap = entry !== null && typeof entry === 'object' && !Array.isArray(entry)
      && Object.values(entry).every((value) => typeof value === 'string');
    if (isAnswerMap) topic.defaults = entry;
  }
}

/**
 * Removes the authority topics while the pilot switch is off, so the pilot is
 * unreachable in the UI (the static data files stay public but nothing requests them).
 * @param {{topics: object[]}} rules  Mutated in place.
 * @param {boolean} isPilotEnabled the shell's `data-de-pilot-enabled` flag
 * @param {function(object): boolean} isAuthorityTopic the engine's predicate; this module cannot import it
 */
export function applyPilotSwitch(rules, isPilotEnabled, isAuthorityTopic) {
  if (isPilotEnabled) return;
  rules.topics = rules.topics.filter((topic) => !isAuthorityTopic(topic));
}

/** Fetches the operator defaults; any failure keeps the rules-file defaults, silently. */
async function loadDefaultOverrides(version) {
  try {
    return await fetchJson(`${DEFAULTS_URL}?v=${version}`);
  } catch (error) {
    if (!isLoadFailure(error)) throw error;
    return null;
  }
}

/** Web Storage can throw on access when the browser blocks it; the store then runs in memory. */
function browserStorage() {
  try {
    return window.localStorage;
  } catch (error) {
    if (error instanceof DOMException) return null;
    throw error;
  }
}

/** True for the failures a static fetch can produce: network, HTTP status, bad JSON. */
function isLoadFailure(error) {
  return error instanceof LoadError || error instanceof TypeError || error instanceof SyntaxError;
}

/** English country names without a network call, used until or unless the geo pack loads. */
function fallbackName(iso2) {
  try {
    return new Intl.DisplayNames([REGION_DISPLAY_LOCALE], { type: 'region' }).of(iso2) ?? iso2;
  } catch (error) {
    if (error instanceof RangeError) return iso2;
    throw error;
  }
}

/**
 * Display names for the covered countries: geo-pack names when loaded, else Intl names.
 * @param {object} rules parsed rules
 * @param {?{countries: {features: object[]}}} geoData
 * @returns {Object<string, string>} iso2 to name
 */
export function buildCountryNames(rules, geoData) {
  const names = {};
  for (const iso2 of rules.groups[COVERED_GROUP]) names[iso2] = fallbackName(iso2);
  for (const feature of geoData?.countries.features ?? []) {
    if (feature.properties.covered) names[feature.properties.iso2] = feature.properties.name;
  }
  return names;
}

function triggerDownload(text) {
  const url = URL.createObjectURL(new Blob([text], { type: DOWNLOAD_MIME_TYPE }));
  const link = document.createElement('a');
  link.href = url;
  link.download = DOWNLOAD_FILENAME;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Imports every sibling module. After a failed attempt the URL carries `&retry=N`: a browser
 * keeps a failed dynamic import in its module map, so retrying the identical URL would replay
 * the cached failure instead of asking the server again.
 */
async function importModules(staticBase, version, retryCount) {
  const suffix = retryCount > 0 ? `&${RETRY_PARAMETER}=${retryCount}` : '';
  // A dynamic import() resolves a relative specifier against this script, not the page, while fetch()
  // resolves against the page. Resolving against the page first keeps a relative data-static-base
  // (the static demo) pointing at the same files for both.
  const moduleBase = new URL(staticBase, document.baseURI).href;
  const loaded = await Promise.all(MODULE_NAMES.map((name) => import(`${moduleBase}${name}.js?v=${version}${suffix}`)));
  return Object.fromEntries(MODULE_NAMES.map((name, index) => [name, loaded[index]]));
}

/** Plain DOM here: this banner must work even when the helper modules failed to load. */
function bannerElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text) element.textContent = text;
  return element;
}

function showRulesBanner(root, onRetry) {
  const banner = bannerElement('div', 'rm-banner');
  banner.setAttribute('role', 'alert');
  const retry = bannerElement('button', 'rm-button rm-button-outline', STRINGS.retry);
  retry.type = 'button';
  retry.addEventListener('click', () => { banner.remove(); onRetry(); });
  banner.append(bannerElement('p', 'rm-banner-text', STRINGS.rulesFailed), retry);
  root.append(banner);
}

/** Creates the six panels around the template's .rm-map and returns them by name. */
function mountPanels(root, common) {
  const { h } = common;
  const mapElement = root.querySelector('.rm-map');
  const panels = {
    topbar: h('header', { cls: 'rm-topbar' }),
    wizard: h('section', { cls: 'rm-wizard' }),
    map: mapElement,
    finder: h('div', { cls: 'rm-finder-cluster' }),
    detail: h('aside', { cls: 'rm-detail', attrs: { hidden: true } }),
    authority: h('aside', { cls: 'rm-detail rm-authority-card', attrs: { hidden: true } }),
  };
  mapElement.before(panels.topbar, panels.wizard);
  mapElement.after(panels.finder, panels.detail, panels.authority);
  return panels;
}

function createViews(panels, callbacks, deps) {
  const m = deps.modules;
  // The map receives the button (it sits beside the zoom group); the finder's legend block becomes its panel.
  const sources = m['ui-sources'].createSources(deps.common, panels.map.parentElement);
  const factControls = m['ui-fact-controls'].createFactControls(deps.common, deps.engine);
  const wizardDeps = {
    ...deps,
    factControls,
    parts: {
      createSituation: m['ui-wizard-situation'].createSituation,
      createRequirements: m['ui-wizard-requirements'].createRequirements,
      createProfile: m['ui-wizard-profile'].createProfile,
      createAnswerActions: m['ui-wizard-answers'].createAnswerActions,
    },
  };
  const mapDeps = {
    ...deps,
    geo: m['geo-render'],
    attachGestures: m['ui-map-gestures'].attachGestures,
    visibleMapArea: m['ui-map-area'].visibleMapArea,
    publishDockHeight: m['ui-map-area'].publishDockHeight,
    cardSelectors: m['ui-map-area'].CARD_SELECTORS,
    createDetailLayers: m['ui-map-detail'].createDetailLayers,
    createLabelPlacer: m['ui-map-labels'].createLabelPlacer,
    metrics: m['authority-metrics'],
    districts: m['ui-map-districts'],
    createZoomControls: m['ui-map-controls'].createZoomControls,
    sourcesButton: sources.button,
  };
  const finder = m['ui-finder'].createFinder(panels.finder, callbacks, deps);
  sources.attach(finder.legendBlock);
  return {
    topbar: m['ui-topbar'].createTopbar(panels.topbar, callbacks, deps),
    wizard: m['ui-wizard'].createWizard(panels.wizard, callbacks, wizardDeps),
    map: m['ui-map'].createMap(panels.map, callbacks, mapDeps),
    finder,
    detail: m['ui-detail'].createDetail(panels.detail, callbacks, deps),
    authority: m['ui-authority'].createAuthorityCard(panels.authority, callbacks, deps),
  };
}

function createInitialState(rules, store, common) {
  return {
    rules, manifest: null, geo: null, geoStatus: common.GEO_STATUS.LOADING, topicId: null, step: common.STEP_TOPIC,
    selectedIso2: null, result: null, today: formatMonth(new Date()), facts: store.facts(),
    isPersistent: store.isPersistent, profileOpen: false, forgetPending: false, answersNotice: null,
    countryNames: buildCountryNames(rules, null), countries: [], disputed: {}, community: {},
    metric: DEFAULT_METRIC, selectedAgs: null, revealAgs: null, authorityResult: null,
    districts: { status: common.GEO_STATUS.LOADING, collection: null, authorities: null, byAgs: {}, labels: new Map() },
  };
}

/**
 * Loads the district geometry and the authorities file of an authority topic. Both requests are
 * static files carrying only the cache buster, never an answer.
 * @param {function(string): Promise<object>} loadGeo cached geo-pack loader
 * @param {function(string): Promise<object>} fetchJson
 * @param {{country: string, authorities_file: string}} topic
 * @param {{staticBase: string, version: string, indexAuthorities: function(object): object}} urls
 *   `indexAuthorities` is the engine's `authorityIndex`; this module cannot import it.
 * @returns {Promise<{collection: object, authorities: object, byAgs: Object<string, object>}>}
 *   rejects with RangeError when two authorities cover the same AGS
 */
export async function loadDistrictData(loadGeo, fetchJson, topic, urls) {
  const authoritiesUrl = `${urls.staticBase}${AUTHORITIES_DATA_DIRECTORY}/${topic.authorities_file}?v=${urls.version}`;
  const [collection, authorities] = await Promise.all([
    loadGeo(districtLayerPath(topic.country)), fetchJson(authoritiesUrl),
  ]);
  return { collection, authorities, byAgs: urls.indexAuthorities(authorities) };
}

/**
 * Loads the district layer once; a failure (network, bad JSON, duplicate AGS) sets the ERROR
 * status and a later call retries. A load already running or finished is not repeated.
 * @param {object} app  `{state, update, loadGeo, fetchJson, modules, common, settings}`
 * @param {object} topic authority topic
 */
export async function loadDistrictLayer(app, topic) {
  const { state, common: { GEO_STATUS } } = app;
  if (state.districts.status === GEO_STATUS.READY || app.isLoadingDistricts) return;
  app.isLoadingDistricts = true;
  state.districts.status = GEO_STATUS.LOADING;
  app.update({});
  try {
    const loaded = await loadDistrictData(app.loadGeo, app.fetchJson, topic, app.settings);
    Object.assign(state.districts, loaded, {
      labels: app.modules['authority-metrics'].districtLabels(loaded.collection), status: GEO_STATUS.READY,
    });
  } catch (error) {
    if (!isLoadFailure(error) && !(error instanceof RangeError)) throw error;
    state.districts.status = GEO_STATUS.ERROR;
  } finally {
    app.isLoadingDistricts = false;
  }
  app.update({});
}

/** Cached, versioned fetch of one geo-pack file; a failed fetch is not cached so Retry works. */
function createGeoLoader(settings) {
  const cache = new Map();
  return (path) => {
    if (!cache.has(path)) {
      const request = fetchJson(`${settings.geoBase}${path}?v=${settings.version}`);
      request.catch(() => cache.delete(path));
      cache.set(path, request);
    }
    return cache.get(path);
  };
}

async function loadGeoPack(app) {
  const { state, common: { GEO_STATUS } } = app;
  app.update({ geoStatus: GEO_STATUS.LOADING });
  try {
    const [manifest, countries, cities, land] = await Promise.all(
      [GEO_MANIFEST_PATH, GEO_COUNTRIES_PATH, GEO_CITIES_PATH, GEO_LAND_PATH].map(app.loadGeo));
    state.manifest = manifest;
    state.geo = { countries, cities, land };
    app.refreshCountries();
    app.update({ geoStatus: GEO_STATUS.READY });
  } catch (error) {
    if (!isLoadFailure(error)) throw error;
    app.update({ geoStatus: GEO_STATUS.ERROR });
  }
}

/**
 * Escape closes the card unless something else already handled the key (an open select or
 * a month picker uses Escape itself).
 * @param {{key: string, defaultPrevented: boolean, target: {tagName?: string}}} event
 * @param {{selectedIso2: ?string, selectedAgs: ?string}} state
 * @returns {boolean}
 */
export function shouldCloseOnEscape(event, state) {
  const hasSelection = Boolean(state.selectedIso2 || state.selectedAgs);
  if (event.key !== ESCAPE_KEY || !hasSelection || event.defaultPrevented) return false;
  return !ESCAPE_IGNORED_TAGS.includes(event.target?.tagName);
}

/**
 * Returns the function the detail card calls to open the report dialog. The dialog gets the
 * endpoint URLs the shell published and never the fact set or the app state.
 */
function createReportOpener(modules, settings) {
  return (context) => modules['ui-report'].openReportDialog({
    common: modules['ui-common'], pow: modules.pow, client: modules['report-client'], proofAhead: modules['ui-proof-ahead'],
    reportUrls: settings.reportUrls,
  }, context);
}

/** Opens the experience dialog; it is handed the endpoint URLs the shell published, never the fact set or app state. */
function createExperienceOpener(modules, settings) {
  return (context) => modules['ui-experience'].openExperienceDialog({
    common: modules['ui-common'], pow: modules.pow, client: modules['report-client'], report: modules['ui-report'],
    buildPayload: modules['experience-client'].buildExperiencePayload,
    proofAhead: modules['ui-proof-ahead'], monthField: modules['ui-fact-controls'],
    urls: settings.experienceUrls, privacyUrl: settings.experienceUrls.privacy,
  }, context);
}

/** The selected district's milestones, checks and estimate; null while nothing is selected. */
function evaluateSelectedAuthority(app) {
  const { state, modules } = app;
  const authority = state.selectedAgs === null ? undefined : state.districts.byAgs[state.selectedAgs];
  if (!state.topicId || authority === undefined) return null;
  return modules.engine.evaluateAuthority(state.rules, modules.engine.findTopic(state.rules, state.topicId), authority, {
    factSet: state.facts, today: state.today, isConfirmed: modules['authority-metrics'].isConfirmed,
  });
}

/** Wires state, store, views and the keyboard handler; resolves when the geo pack has loaded. */
function createApp(root, rules, modules, settings) {
  const store = modules['factset-store'].createFactStore(browserStorage(), rules);
  const common = modules['ui-common'];
  const state = createInitialState(rules, store, common);
  const app = {
    state, store, common, modules, loadGeo: createGeoLoader(settings), fetchJson, views: null,
    isLoadingDistricts: false,
    settings: { staticBase: settings.staticBase, version: settings.version, indexAuthorities: modules.engine.authorityIndex },
  };
  app.refreshCountries = () => {
    state.countryNames = buildCountryNames(rules, state.geo);
    state.countries = rules.groups[COVERED_GROUP].map((iso2) => ({ iso2, name: state.countryNames[iso2] }));
  };
  app.update = (changes) => {
    Object.assign(state, changes);
    state.facts = store.facts();
    state.result = state.topicId ? modules.engine.evaluate(rules, state.topicId, state.facts, state.today) : null;
    state.authorityResult = evaluateSelectedAuthority(app);
    Object.values(app.views).forEach((view) => view.render(state));
  };
  const callbacks = createCallbacks(app, modules);
  callbacks.onRetryGeo = () => loadGeoPack(app);
  callbacks.onRetryDistricts = () => loadDistrictLayer(app, modules.engine.findTopic(rules, state.topicId));
  app.views = createViews(mountPanels(root, modules['ui-common']), callbacks, {
    common: modules['ui-common'], engine: modules.engine, modules, loadGeo: app.loadGeo,
    reportsEnabled: settings.reportsEnabled, openReport: createReportOpener(modules, settings),
    experiencesEnabled: settings.experiencesEnabled, openExperience: createExperienceOpener(modules, settings),
    isDisputed: modules['status-client'].isDisputed,
    today: Date.now(), staleAfterDays: settings.staleAfterDays,
  });
  store.subscribe(() => app.update({}));
  document.addEventListener('keydown', (event) => {
    if (shouldCloseOnEscape(event, state)) callbacks.onClose();
  });
  app.refreshCountries();
  app.update({});
  // Best effort and only while reports are on: a failure leaves the map without the overlay.
  if (settings.reportsEnabled) modules['status-client'].fetchDisputedStatus(settings.statusUrl).then((disputed) => app.update({ disputed }));
  // Best effort and only while the community flag is on: a failure leaves the map without community figures.
  if (settings.communityEnabled) modules['community-client'].fetchCommunityFigures(settings.communityUrl).then((community) => app.update({ community }));
  return loadGeoPack(app);
}

function createCallbacks(app, modules) {
  const { store, state } = app;
  const { engine } = modules;
  const update = (changes) => app.update(changes);
  const { rules } = state;
  const { serializeExport, parseExport, FactSetImportError } = modules['factset-store'];
  const { NOTICE_KIND, STEP_TOPIC, STEP_SITUATION } = app.common;
  const notice = (kind, text) => ({ kind, text });
  return {
    onPickTopic: (topicId) => {
      // Once per open, before the first render of step 2, so the map starts coloured. Not in
      // `update`: a visitor who clears a fact later in the visit must not get the default back.
      const defaults = modules.engine.defaultFactsFor(rules, topicId, store.facts());
      for (const [factId, value] of Object.entries(defaults)) store.set(factId, value);
      const topic = engine.findTopic(rules, topicId);
      const isAuthority = engine.isAuthorityTopic(topic);
      update({
        topicId, step: STEP_SITUATION, answersNotice: null, selectedAgs: null, metric: DEFAULT_METRIC,
        ...(isAuthority ? { selectedIso2: null } : {}),
      });
      if (isAuthority) loadDistrictLayer(app, topic);
    },
    onBack: () => update({ topicId: null, step: STEP_TOPIC, selectedAgs: null }),
    onSelectDistrict: (selectedAgs) => update({ selectedAgs, revealAgs: null }),
    // Only the finder list reveals: a district chosen there may be off-screen, one chosen on the map is not.
    onFindDistrict: (selectedAgs) => update({ selectedAgs, revealAgs: selectedAgs }),
    onSetMetric: (metric) => update({ metric }),
    onSetFact: (factId, value) => { state.answersNotice = null; store.set(factId, value); },
    onUnsetFact: (factId) => { state.answersNotice = null; store.unset(factId); },
    onToggleProfile: () => update({ profileOpen: !state.profileOpen }),
    onSelectCountry: (selectedIso2) => update({ selectedIso2 }),
    onClose: () => {
      const [previousIso2, previousAgs] = [state.selectedIso2, state.selectedAgs];
      update({ selectedIso2: null, selectedAgs: null });
      if (previousAgs !== null) app.views.map.focusDistrict(previousAgs);
      else app.views.map.focusCountry(previousIso2);
    },
    onDownload: () => triggerDownload(serializeExport(store.facts(), rules)),
    onLoadText: (text) => {
      try {
        const facts = parseExport(text, rules);
        state.answersNotice = notice(NOTICE_KIND.OK, STRINGS.answersLoaded);
        store.replaceAll(facts);
      } catch (error) {
        if (!(error instanceof FactSetImportError)) throw error;
        update({ answersNotice: notice(NOTICE_KIND.ERROR, error.message) });
      }
    },
    onFileProblem: (text) => update({ answersNotice: notice(NOTICE_KIND.ERROR, text) }),
    onForgetAsk: () => update({ forgetPending: true }),
    onForgetCancel: () => update({ forgetPending: false }),
    onForgetConfirm: () => { state.forgetPending = false; state.answersNotice = null; store.clear(); },
  };
}

/** Loads modules and rules; a load failure shows the banner and returns null. */
async function loadResources(root, settings, staticBase) {
  try {
    const [modules, rules, overrides] = await Promise.all([
      importModules(staticBase, settings.version, loadRetryCount),
      fetchJson(`${staticBase}${RULES_PATH}?v=${settings.version}`),
      loadDefaultOverrides(settings.version),
    ]);
    applyDefaultOverrides(rules, overrides);
    applyPilotSwitch(rules, settings.isDePilotEnabled, modules.engine.isAuthorityTopic);
    return { modules, rules };
  } catch (error) {
    if (!isLoadFailure(error)) throw error;
    showRulesBanner(root, () => { loadRetryCount += 1; start(); });
    return null;
  }
}

let isStarted = false;
/** Failed load attempts so far; feeds the cache-busting retry parameter of the module imports. */
let loadRetryCount = 0;

/**
 * Loads rules and modules, then builds the app once. Only the load phase is guarded: a rules
 * failure shows a banner with Retry, while render or programming errors propagate. Retry
 * re-enters here before anything is mounted; `isStarted` keeps the panels from mounting twice.
 */
async function start() {
  if (isStarted) return;
  const root = document.getElementById(ROOT_ID);
  const { staticBase, version } = root.dataset;
  const settings = {
    geoBase: root.dataset.geoBase, staticBase, version,
    reportsEnabled: root.dataset.reportsEnabled === REPORTS_ENABLED_VALUE,
    experiencesEnabled: root.dataset.experiencesEnabled === EXPERIENCES_ENABLED_VALUE,
    communityEnabled: root.dataset.communityEnabled === COMMUNITY_ENABLED_VALUE, communityUrl: root.dataset.communityUrl,
    isDePilotEnabled: root.dataset.dePilotEnabled === DE_PILOT_ENABLED_VALUE,
    statusUrl: root.dataset.statusUrl, staleAfterDays: Number.parseInt(root.dataset.staleAfterDays, DECIMAL_RADIX),
    reportUrls: { challenge: root.dataset.reportChallengeUrl, submit: root.dataset.reportSubmitUrl },
    experienceUrls: {
      challenge: root.dataset.experienceChallengeUrl, submit: root.dataset.experienceSubmitUrl,
      privacy: root.dataset.experiencePrivacyUrl,
    },
  };
  const resources = await loadResources(root, settings, staticBase);
  if (resources === null) return;
  isStarted = true;
  await createApp(root, resources.rules, resources.modules, settings);
}

if (typeof document !== 'undefined') start();
