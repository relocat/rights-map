// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// README: browser test for the Rights Map page. Run `scripts/test-rights-map-browser.sh` from the
// repository root; it starts tests/browser/rights_map/server.mjs on a free port, runs this driver
// with the pinned Playwright from scripts/test-web-e2e and exits non-zero if any assertion fails.
// Asserts the strict CSP (no console/CSP errors), that no request URL carries a fact value or id,
// and the map, wizard, detail card, finder, keyboard and phone-sheet behaviour.
// Environment: RM_BASE_URL (required, set by the script), RM_SHOTS_DIR (screenshots, default is a
// fresh directory under the OS temp dir), RM_STATIC_SHELL=1 (the static demo page is the shell: the
// groups that need a server switch, endpoint or the site header are skipped and each is logged).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..', '..', '..');
const PLAYWRIGHT_ENTRY = path.join(REPO_ROOT, 'scripts', 'test-web-e2e', 'node_modules', 'playwright', 'index.mjs');
const { chromium } = await import(pathToFileURL(PLAYWRIGHT_ENTRY).href);
const RULES_PATH = path.join(REPO_ROOT, 'web', 'static', 'public', 'rights_map', 'data', 'rules.v1.json');
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rights-map-browser-'));
const ANSWERS_FILE = path.join(WORK_DIR, 'answers.json');
const BAD_FILE = path.join(WORK_DIR, 'bad.json');
const BASE = process.env.RM_BASE_URL;
if (!BASE) throw new Error('RM_BASE_URL is required; run scripts/test-rights-map-browser.sh');
const SHOTS = process.env.RM_SHOTS_DIR || path.join(WORK_DIR, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
// 39 covered + context countries of the geo pack, Kosovo included as its own region.
const EXPECTED_COUNTRY_PATHS = 74;
const NOTICE_TIMEOUT_MS = 5000;
const KOSOVO_ZOOM_STEPS = 4;
const WHEEL_ZOOM_DELTA = 600;
const PHONE_WIDTH = 390;
const MESSAGE_MIN_HEIGHT_PX = 24;
const LAYOUT_TOLERANCE_PX = 1;
const NARROW_PHONE = { width: 360, height: 740 };
const NAV_LABELS = ['Home', 'Rights map', 'Why Relocat?', 'Source'];
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`); };
/** True when the static demo page is the shell, so only the groups that need no Relocat server run. */
const IS_STATIC_SHELL = process.env.RM_STATIC_SHELL === '1';
const SKIP_REASON = 'needs server';
/** Names a group and tells whether to skip it; in static-shell mode every skip is printed by name. */
const shouldSkipGroup = (groupName) => {
  if (IS_STATIC_SHELL) console.log(`SKIP ${groupName} (${SKIP_REASON})`);
  return IS_STATIC_SHELL;
};
const requests = [];
const consoleProblems = [];
const MIN_TEXT_CONTRAST = 4.5;
const BRAND_INK_RGB = 'rgb(18, 24, 31)';
const SELECTED_OPTION_SELECTOR = '.rm-option[aria-pressed="true"]';
const INK_RGB = 'rgb(26, 26, 26)';
const WHITE_RGB = 'rgb(255, 255, 255)';
const BRAND_RGB = 'rgb(242, 184, 32)';
const PROFILE_PANEL_RGB = 'rgb(245, 245, 243)';
const DARK_CARD_RGB = 'rgb(18, 18, 18)';
const DARK_SEA_RGB = 'rgb(10, 15, 20)';
const LIGHT_SEA_RGB = 'rgb(220, 230, 239)';
const CAVEAT_BG_RGB = 'rgb(255, 244, 229)';
const CAVEAT_INK_RGB = 'rgb(106, 58, 6)';
const SRGB_CHANNEL_MAX = 255;
/** Red, green and blue (0-255) of a computed colour: `rgb()`/`rgba()`, or `color(srgb r g b / a)` as color-mix() computes to. */
const rgbChannels = (colour) => (colour.startsWith('color(srgb')
  ? colour.match(/[\d.]+/g).slice(0, 3).map((channel) => Math.round(Number(channel) * SRGB_CHANNEL_MAX))
  : colour.match(/\d+/g).slice(0, 3).map(Number));
const relativeLuminance = (rgb) => {
  const [r, g, b] = rgbChannels(rgb).map((c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrastRatio = (first, second) => {
  const [light, dark] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
};
/** Computed style properties of the first match, read in the page. */
const styleOf = (pg, selector, ...properties) => pg.locator(selector).first().evaluate(
  (element, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(element)[name]])), properties);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on('request', (r) => requests.push(r.url()));
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) consoleProblems.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => consoleProblems.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => consoleProblems.push(`requestfailed: ${r.url()}`));


const MAX_ZOOM_IN_FRACTION = 0.1;
const EUROPE_BBOX = [-25, 34, 45, 71];
const EUROPE_WIDTH_TOLERANCE = 0.05;
const ZOOM_OUT_CLICKS = 12;
const SETTLE_MS = 400;
const POLL_INTERVAL_MS = 50;
// Resolves with the first log reading that satisfies `isReady`, or the last reading after NOTICE_TIMEOUT_MS.
const pollLog = async (readLog, isReady) => {
  const deadline = Date.now() + NOTICE_TIMEOUT_MS;
  let reading = await readLog();
  while (!isReady(reading) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    reading = await readLog();
  }
  return reading;
};
/** The page keeps this gap between the fitted map and the cards (VIEW_PADDING_PX in ui-map-area.js). */
const VIEW_PADDING_PX = 16;
const SOUTH_AMERICA_POINT = [-60, -15];
const AUSTRALIA_POINT = [135, -25];
const MERCATOR_WORLD_UNITS = 1024;
const MERCATOR_MAX_LATITUDE = 85.05112878;
const DEGREES_PER_TURN = 360;
/** Web Mercator in the page's WORLD_UNITS, written independently of the page code. */
const mercator = ([lon, lat]) => {
  const radians = (Math.max(-MERCATOR_MAX_LATITUDE, Math.min(MERCATOR_MAX_LATITUDE, lat)) * Math.PI) / 180;
  return [((lon + 180) / DEGREES_PER_TURN) * MERCATOR_WORLD_UNITS,
    MERCATOR_WORLD_UNITS / 2 - (Math.log(Math.tan(Math.PI / 4 + radians / 2)) / (2 * Math.PI)) * MERCATOR_WORLD_UNITS];
};
const readViewBox = async (pg) => (await pg.locator('.rm-svg').getAttribute('viewBox')).split(' ').map(Number);
// BKG's Quellenvermerk (VG250 terms of use, section 2), verbatim, plus the change note.
const BKG_FOOTER_TEXT = 'Districts: © BKG (2026) dl-de/by-2-0, Datenquellen: https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg_nuts.pdf · Data changed: geometry simplified and reprojected.';
const BKG_DATASOURCES_URL = 'https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg_nuts.pdf';
const BKG_FOOTER_LINK_REL = 'noopener noreferrer';
const BKG_FOOTER_LINKS = [
  ['BKG', 'https://www.bkg.bund.de', BKG_FOOTER_LINK_REL],
  ['dl-de/by-2-0', 'https://www.govdata.de/dl-de/by-2-0', BKG_FOOTER_LINK_REL],
  [BKG_DATASOURCES_URL, BKG_DATASOURCES_URL, BKG_FOOTER_LINK_REL],
];
/** Records two checks: the footer holds the exact BKG credit, and its links are the three required ones. */
const checkBkgFooter = async (pg, label) => {
  const footer = pg.locator('.rm-attribution');
  const footerText = await footer.innerText();
  check(`${label}: the footer holds the exact BKG credit and change note`, footerText.includes(BKG_FOOTER_TEXT), footerText);
  const links = await footer.locator('a').evaluateAll((nodes) => nodes.map((node) => [node.textContent, node.getAttribute('href'), node.getAttribute('rel')]));
  check(`${label}: the footer has the three BKG links, each rel noopener noreferrer`, JSON.stringify(links) === JSON.stringify(BKG_FOOTER_LINKS), JSON.stringify(links));
};
const viewBoxContains =([x, y, width, height], [px, py]) => px >= x && px <= x + width && py >= y && py <= y + height;
/** Visible rect (page px) between the cards, and the boxes of PT/FI marks, evaluated in the page. */
const fitReport = (pg, phoneMode) => pg.evaluate((isPhone) => {
  const rectOf = (sel) => { const e = document.querySelector(sel); return e && !e.hidden && e.getClientRects().length ? e.getBoundingClientRect() : null; };
  const map = document.querySelector('.rm-map').getBoundingClientRect();
  const top = rectOf('.rm-topbar'); const wiz = rectOf('.rm-wizard'); const det = rectOf('.rm-detail'); const fin = rectOf('.rm-legend-block');
  const finderCard = rectOf('.rm-finder');
  // Desktop: the finder card keeps the right column (above the detail card) whether or not the detail is open.
  const area = isPhone
    ? { left: map.left, top: map.top, right: map.right, bottom: det ? det.top : map.bottom }
    : { left: wiz.right, top: top.bottom, right: finderCard.left, bottom: fin.top };
  const box = (sel) => document.querySelector(sel).getBoundingClientRect();
  const inside = (r) => r.left >= area.left - 1 && r.right <= area.right + 1 && r.top >= area.top - 1 && r.bottom <= area.bottom + 1;
  const lisbon = document.querySelector('.rm-layer-cities .rm-capital-dot[cx]');
  const pt = [...document.querySelectorAll('.rm-layer-covered .rm-country')].find((e) => e.getAttribute('aria-label').startsWith('Portugal'));
  const fi = [...document.querySelectorAll('.rm-layer-covered .rm-country')].find((e) => e.getAttribute('aria-label').startsWith('Finland'));
  const ptBox = pt.getBoundingClientRect();
  return { area, fi: inside(fi.getBoundingClientRect()), ptMainland: ptBox.right <= area.right + 1 && ptBox.top >= area.top - 1 && ptBox.right > area.left,
    ptCentreInside: ptBox.left + 200 >= area.left, fiBox: fi.getBoundingClientRect().toJSON(), ptBox: ptBox.toJSON() };
}, phoneMode);

const country = (name) => page.locator(`.rm-layer-covered [aria-label^="${name}:"]`).first();
const cls = async (name) => (await country(name).getAttribute('class')) ?? '';
const fact = (id, code) => page.locator(`[data-focus-key="fact:${id}:${code}"]`);

await page.goto(`${BASE}/map/`);
await page.waitForSelector('.rm-country');
check('page loads, map built', (await page.locator('.rm-country').count()) === EXPECTED_COUNTRY_PATHS);
{ const r = await fitReport(page, false);
  check('desktop initial view: FI inside visible rect', r.fi, JSON.stringify(r.area) + ' FI ' + JSON.stringify(r.fiBox));
  check('desktop initial view: PT mainland (right/top/bottom) inside, Azores allowed outside left', r.ptMainland, JSON.stringify(r.ptBox));
  check('PT west edge clear of the wizard card', r.ptBox.right > r.area.left + 20 && (await page.locator('.rm-layer-covered [aria-label^="Portugal"]').boundingBox()).x + 120 > r.area.left - 200, 'Azores extend west of the 25W frame; mainland checked above'); }
{ await page.waitForTimeout(SETTLE_MS);
  check('at load no admin-1 request was made', !requests.some((u) => u.includes('/admin1/')));
  const area = (await fitReport(page, false)).area;
  const [west, north] = mercator([EUROPE_BBOX[0], EUROPE_BBOX[3]]);
  const [east, south] = mercator([EUROPE_BBOX[2], EUROPE_BBOX[1]]);
  const mapBox = await page.locator('.rm-svg').boundingBox();
  const unitsPerPixel = Math.max((east - west) / (area.right - area.left - 2 * VIEW_PADDING_PX),
    (south - north) / (area.bottom - area.top - 2 * VIEW_PADDING_PX));
  const expectedWidth = mapBox.width * unitsPerPixel;
  const [, , loadWidth] = await readViewBox(page);
  check('at load the viewBox is the Europe fit (within 5%)', Math.abs(loadWidth - expectedWidth) / expectedWidth <= EUROPE_WIDTH_TOLERANCE,
    `${loadWidth.toFixed(1)} vs ${expectedWidth.toFixed(1)}`);
  check('land layer exists and its paths have no stroke', await page.evaluate(() => {
    const paths = [...document.querySelectorAll('.rm-layer-land path')];
    return paths.length > 0 && paths.every((p) => getComputedStyle(p).stroke === 'none');
  }));
  check('context neighbours have no border stroke, covered countries keep theirs', await page.evaluate(() => {
    const stroke = (sel) => getComputedStyle(document.querySelector(sel)).stroke;
    return stroke('.rm-layer-context .rm-country') === 'none' && stroke('.rm-layer-covered .rm-country') !== 'none';
  }));
  const landRequests = requests.filter((u) => u.includes('/land.json'));
  check('land.json fetched once, versioned', landRequests.length === 1 && landRequests[0].includes('?v='), landRequests.join(' '));
  await page.screenshot({ path: `${SHOTS}/desktop-load-1440x900.png` });
  if (!shouldSkipGroup('site header navigation')) { const navLinks = await page.locator('.top nav a').allTextContents();
    check('header nav order: Home / Rights map / Why Relocat? / Source', JSON.stringify(navLinks) === JSON.stringify(NAV_LABELS), navLinks.join(' | '));
    const mapLink = page.locator('.top nav a', { hasText: 'Rights map' });
    check('header Rights map link points to /map/ and is the current page', (await mapLink.getAttribute('href')) === '/map/'
      && (await mapLink.getAttribute('aria-current')) === 'page');
    const otherCurrent = await page.locator('.top nav a:not([aria-current])').count();
    check('header: only the Rights map link is marked current', otherCurrent === NAV_LABELS.length - 1);
    await page.locator('.top').screenshot({ path: `${SHOTS}/desktop-header-map.png` }); }
{ const pill = page.locator('.rm-pill-privacy');
  const panel = page.locator('#rm-privacy-panel');
  const title = page.getByText('Your answers stay on this device', { exact: true });
  const beforeCount = requests.length;
  check('privacy pill is a button, collapsed, with an aria-hidden icon', (await pill.evaluate((el) => el.tagName)) === 'BUTTON'
    && (await pill.getAttribute('aria-expanded')) === 'false' && (await pill.getAttribute('aria-controls')) === 'rm-privacy-panel'
    && (await pill.locator('svg').getAttribute('aria-hidden')) === 'true' && !(await title.isVisible()));
  await pill.click();
  check('clicking the privacy pill opens the panel', (await pill.getAttribute('aria-expanded')) === 'true' && (await title.isVisible())
    && (await panel.getByRole('link', { name: 'How we store them' }).getAttribute('href')) === '/cookies/');
  const panelBox = await panel.boundingBox();
  check('privacy panel is at most 360px wide', panelBox !== null && panelBox.width <= 360, JSON.stringify(panelBox));
  await page.screenshot({ path: `${SHOTS}/desktop-privacy-panel.png` });
  await panel.getByRole('link', { name: 'How we store them' }).focus();
  await page.keyboard.press('Escape');
  check('Escape closes the privacy panel and focus returns to the pill', (await pill.getAttribute('aria-expanded')) === 'false'
    && !(await title.isVisible()) && (await pill.evaluate((el) => el === document.activeElement)));
  await pill.press('Enter');
  check('Enter on the pill opens the panel', (await pill.getAttribute('aria-expanded')) === 'true');
  await page.locator('.rm-title').click();
  check('clicking outside closes the privacy panel', (await pill.getAttribute('aria-expanded')) === 'false' && !(await title.isVisible()));
  check('opening and closing the privacy panel makes no request', requests.length === beforeCount, requests.slice(beforeCount).join(' ')); }
  for (let i = 0; i < ZOOM_OUT_CLICKS; i += 1) await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.waitForTimeout(SETTLE_MS);
  const world = await readViewBox(page);
  check('fully zoomed out covers South America and Australia',
    viewBoxContains(world, mercator(SOUTH_AMERICA_POINT)) && viewBoxContains(world, mercator(AUSTRALIA_POINT)), world.join(' '));
  await page.screenshot({ path: `${SHOTS}/desktop-world-zoomed-out.png` });
  await page.getByRole('button', { name: 'Reset view' }).click(); }
check('neutral map before topic', (await cls('Hungary')).includes('rm-status-neutral'));
{ const kosovo = page.locator('.rm-layer-context .rm-country', { has: page.locator('title', { hasText: /^Kosovo$/ }) });
  check('Kosovo is its own grey context region, not selectable', (await kosovo.count()) === 1
    && (await kosovo.getAttribute('role')) === null && (await kosovo.getAttribute('tabindex')) === null);
  check('Serbia stays a covered, selectable country', (await country('Serbia').getAttribute('role')) === 'button');
  const kosovoBox = await kosovo.boundingBox();
  await page.mouse.move(kosovoBox.x + kosovoBox.width / 2, kosovoBox.y + kosovoBox.height / 2);
  for (let i = 0; i < KOSOVO_ZOOM_STEPS; i += 1) await page.mouse.wheel(0, -WHEEL_ZOOM_DELTA);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/desktop-balkans-kosovo.png` });
  await page.getByRole('button', { name: 'Reset view' }).click(); }
check('non-covered countries not focusable', (await page.locator('.rm-layer-context [tabindex]').count()) === 0);
check('covered countries are role=button + tabindex', (await page.locator('.rm-layer-covered [role=button]').count()) >= 39
  && (await country('Germany').getAttribute('tabindex')) === '0');

// Step 1 -> TP
// supportedTopics includes the authority topic (the pilot switch can hide it).
check('topics listed', (await page.locator('.rm-topic').count()) === 6);
check('planned topics disabled', (await page.locator('.rm-topic-planned[disabled]').count()) === 3);
{ const panel = await styleOf(page, '.rm-profile', 'backgroundColor', 'borderTopLeftRadius', 'paddingTop');
  check('profile panel has the grey panel background, padding and rounding',
    panel.backgroundColor === PROFILE_PANEL_RGB && parseFloat(panel.borderTopLeftRadius) > 0 && parseFloat(panel.paddingTop) > 0, JSON.stringify(panel)); }
await page.screenshot({ path: `${SHOTS}/desktop-step1-profile.png` });
await page.getByRole('button', { name: /Ukrainian temporary protection/ }).click();
check('step 2 shown', (await page.locator('.rm-step-label').textContent()).includes('STEP 2'));
check('no missing-questions prompt: defaults answer the required facts', (await page.locator('.rm-prompt').count()) === 0);
check('defaults show as selected options', (await fact('nat', 'UA').getAttribute('aria-pressed')) === 'true'
  && (await fact('ua_military_obligation', 'yes').getAttribute('aria-pressed')) === 'true'
  && (await fact('ua_holds_tp', 'no').getAttribute('aria-pressed')) === 'true');
check('HU is ok with no fact clicked', (await cls('Hungary')).includes('rm-status-ok'));
check('DE is restricted with no fact clicked', (await cls('Germany')).includes('rm-status-restricted'));
check('UA is origin with no fact clicked', (await cls('Ukraine')).includes('rm-status-origin'));
const defaultBadge = await fact('ua_exit_proof', 'yes').locator('.rm-gain').textContent();
check('exit lever badge is +25 with no fact clicked', defaultBadge === '+25', defaultBadge);
await fact('nat', 'OTHER').click();
check('visitor can change a default', (await fact('nat', 'OTHER').getAttribute('aria-pressed')) === 'true'
  && (await cls('Hungary')).includes('rm-status-neutral') === false);
await page.getByRole('button', { name: 'All topics' }).click();
await page.getByRole('button', { name: /Ukrainian temporary protection/ }).click();
check('own answer survives reopening the topic', (await fact('nat', 'OTHER').getAttribute('aria-pressed')) === 'true'
  && (await fact('nat', 'UA').getAttribute('aria-pressed')) === 'false');
await fact('nat', 'UA').click();
await fact('ua_exit_proof', 'no').click();
check('aria-label carries status label', (await country('Hungary').getAttribute('aria-label')) === 'Hungary: Protection available',
  await country('Hungary').getAttribute('aria-label'));
const badge = await fact('ua_exit_proof', 'yes').locator('.rm-gain').textContent();
check('exit lever badge is +25', badge === '+25', badge);
check('focus survives re-render', await page.evaluate(() => document.activeElement?.getAttribute('data-focus-key') === 'fact:ua_exit_proof:no'));
check('legend shows counts', (await page.locator('.rm-legend-item').count()) >= 3, await page.locator('.rm-legend').innerText());
check('live region announces', (await page.locator('[role=status][aria-live=polite]').textContent()).startsWith('Map updated: 1 Protection available'),
  await page.locator('[role=status][aria-live=polite]').textContent());
check('PROFILE tag on profile fact', (await page.locator('.rm-fact:has([data-focus-key="fact:nat:UA"]) .rm-tag').count()) === 1);
check('tips rendered', (await page.locator('.rm-tip').count()) >= 1, await page.locator('.rm-tip').first().innerText());
{ const tipTag = await styleOf(page, '.rm-tip > .rm-tag-tip', 'backgroundColor', 'color');
  const tipCard = await styleOf(page, '.rm-tip', 'backgroundColor');
  const [red, green, blue] = rgbChannels(tipTag.backgroundColor);
  check('tip tag badge is yellow with dark text, the card is not', red > green && green > blue && red > 200 && tipTag.color === BRAND_INK_RGB
    && tipCard.backgroundColor !== tipTag.backgroundColor, JSON.stringify({ tipTag, tipCard })); }
{ const back = page.locator('.rm-back');
  check('back link: one aria-hidden svg arrow before the text', (await back.locator('svg[aria-hidden="true"]').count()) === 1
    && await back.evaluate((el) => el.firstElementChild.tagName.toLowerCase() === 'svg' && el.textContent.trim() === 'All topics'));
  check('back link keeps the accessible name "All topics"', (await page.getByRole('button', { name: 'All topics', exact: true }).count()) === 1); }

/**
 * Opens the privacy panel and reports what `elementFromPoint` finds at its title and at the centre of
 * the centre of every area where it overlaps a finder or detail card (or at its lower edge when it overlaps none).
 */
const privacyPanelHits = async (pg) => {
  await pg.locator('.rm-pill-privacy').click();
  const report = await pg.evaluate(() => {
    const panel = document.querySelector('#rm-privacy-panel');
    const rect = panel.getBoundingClientRect();
    const overlaps = [...document.querySelectorAll('.rm-finder, .rm-detail')].map((card) => card.getBoundingClientRect()).map((other) => ({
      left: Math.max(rect.left, other.left), right: Math.min(rect.right, other.right), top: Math.max(rect.top, other.top), bottom: Math.min(rect.bottom, other.bottom),
    })).filter((box) => box.right > box.left && box.bottom > box.top);
    const title = document.querySelector('.rm-privacy-title').getBoundingClientRect();
    const inside = (point) => panel.contains(document.elementFromPoint(point.x, point.y));
    const centres = overlaps.length > 0 ? overlaps.map((box) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 })) : [{ x: rect.left + rect.width / 2, y: rect.bottom - 1 }];
    return { titleOnTop: inside({ x: title.left + title.width / 2, y: title.top + title.height / 2 }), overlapOnTop: centres.every(inside), overlapCount: overlaps.length };
  });
  await pg.screenshot({ path: `${SHOTS}/${pg === page ? 'desktop' : 'phone'}-privacy-panel-over-cards.png` });
  await pg.keyboard.press('Escape');
  return report;
};

// Finder -> Hungary -> detail card
const finderCardBox = () => page.locator('.rm-finder').boundingBox();
const finderBoxClosed = await finderCardBox();
await page.selectOption('#rm-finder-select', 'HU');
const detail = page.locator('.rm-detail:not(.rm-authority-card)');
check('detail card visible', await detail.isVisible());
{ const finderBoxOpen = await finderCardBox();
  const detailBox = await detail.boundingBox();
  check('desktop: finder card is above the detail card, same width and right edge', finderBoxOpen.y + finderBoxOpen.height <= detailBox.y
    && Math.abs(finderBoxOpen.width - detailBox.width) < 1 && Math.abs(finderBoxOpen.x - detailBox.x) < 1, JSON.stringify({ finderBoxOpen, detailBox }));
  check('desktop: finder card stays in the right column when the detail card is closed', Math.abs(finderBoxClosed.x - finderBoxOpen.x) < 1
    && Math.abs(finderBoxClosed.y - finderBoxOpen.y) < 1 && Math.abs(finderBoxClosed.width - finderBoxOpen.width) < 1, JSON.stringify({ finderBoxClosed, finderBoxOpen })); }
check('detail shows Protection available', (await detail.textContent()).includes('Protection available'));
check('detail has legal basis + sources', (await detail.locator('a[target=_blank][rel="noopener noreferrer"]').count()) >= 1);
// Report dialog (proof of work + anonymous post) against the stub endpoints in server.mjs
if (!shouldSkipGroup('report dialog (proof of work, anonymous post)')) { const REPORT_BUTTON_NAME = 'Report outdated info';
  const MODE_ACCEPT = 'accept';
  const MODE_PROOF_REJECTED_ONCE = 'proof-rejected-once';
  const MODE_PROOF_REJECTED_ALWAYS = 'proof-rejected-always';
  const WIRE_KEYS = ['topic_id', 'country', 'kind', 'source_url', 'description', 'since_month', 'token', 'counter'];
  const DESCRIPTION_LIMIT = 1000;
  const STUB_BITS = 4;
  const SOURCE_URL = 'https://example.org/law';
  const SEPARATOR = ':';
  const BITS_PER_BYTE = 8;
  const UINT32_BITS = 32;
  const setMode = (mode) => fetch(`${BASE}/__test/report-mode?mode=${mode}`);
  const stubLog = async () => (await fetch(`${BASE}/__test/reports`)).json();
  const storageSnapshot = () => page.evaluate(async () => JSON.stringify({
    local: Object.keys(localStorage).sort(), session: Object.keys(sessionStorage).sort(), cookie: document.cookie,
    databases: (await indexedDB.databases()).map((database) => database.name).sort(),
  }));
  const leadingZeroBits = (bytes) => { let bits = 0; for (const byte of bytes) { if (byte === 0) { bits += BITS_PER_BYTE; continue; } return bits + Math.clz32(byte) - (UINT32_BITS - BITS_PER_BYTE); } return bits; };
  const reportButton = detail.getByRole('button', { name: REPORT_BUTTON_NAME });
  const dialog = page.locator('.rm-report-dialog');
  const openDialog = async () => { await reportButton.click(); await dialog.waitFor(); };
  const submitButton = () => dialog.getByRole('button', { name: 'Send report' });
  const fillValid = async () => { await dialog.locator('input[type=url]').fill(SOURCE_URL); await dialog.locator('textarea').fill('Threshold changed'); };
  const crypto = await import('node:crypto');

  check('no mailto link; the report button is shown', (await detail.locator('a[href^="mailto:"]').count()) === 0 && await reportButton.isVisible());
  const storageBefore = await storageSnapshot();
  await setMode(MODE_ACCEPT);
  await openDialog();
  await page.waitForTimeout(SETTLE_MS);
  const openedOnly = await stubLog();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(SETTLE_MS);
  check('solve-ahead: opening and cancelling the dialog requests no challenge',
    openedOnly.challenges === 0 && (await stubLog()).challenges === 0, JSON.stringify(openedOnly));
  await openDialog();
  await dialog.locator('textarea').focus();
  const aheadLog = await pollLog(stubLog, (log) => log.challenges >= 1);
  await page.waitForTimeout(SETTLE_MS);
  check('solve-ahead: the challenge is requested at the first input, before Send, exactly once',
    aheadLog.challenges === 1 && aheadLog.submissions.length === 0 && (await stubLog()).challenges === 1, JSON.stringify(aheadLog));
  check('report dialog: role dialog, aria-modal, labelled by its heading', await dialog.getAttribute('role') === 'dialog' && await dialog.getAttribute('aria-modal') === 'true'
    && await page.locator(`#${await dialog.getAttribute('aria-labelledby')}`).textContent() === REPORT_BUTTON_NAME);
  check('report dialog: focus moves into the dialog', await page.evaluate(() => document.activeElement?.closest('.rm-report-dialog') !== null));
  check('report dialog: four kinds, textarea limit 1000, month input', (await dialog.locator('input[type=radio]').count()) === 4
    && await dialog.locator('textarea').getAttribute('maxlength') === String(DESCRIPTION_LIMIT) && (await dialog.locator('input[type=month]').count()) === 1);
  check('report dialog: names the privacy note and the disputed explanation', (await dialog.textContent()).includes('No answers or personal data are sent') && (await dialog.textContent()).includes('disputed'));
  check('report dialog: the form notice links /map/report-privacy/ on "privacy notice for reports"',
    await dialog.locator('.rm-report-notice a').getAttribute('href') === '/map/report-privacy/'
    && (await dialog.locator('.rm-report-notice a').textContent()) === 'privacy notice for reports');
  await dialog.locator('textarea').fill('abc');
  check('report dialog: live character counter', (await dialog.locator('.rm-report-counter').textContent()) === `3 / ${DESCRIPTION_LIMIT}`);
  check('report dialog: link required for "rule changed"', await dialog.locator('input[type=url]').evaluate((input) => input.required));
  await dialog.getByLabel('The colour is wrong for my case').check();
  check('report dialog: link optional for other kinds', !(await dialog.locator('input[type=url]').evaluate((input) => input.required)));
  await dialog.getByLabel('The rule has changed').check();
  await submitButton().click();
  check('report dialog: missing link blocks the send, no request made', (await stubLog()).submissions.length === 0 && (await dialog.locator('.rm-notice-error').isVisible()));
  await page.screenshot({ path: `${SHOTS}/desktop-report-dialog.png` });
  await fillValid();
  await submitButton().dblclick();
  await dialog.getByRole('heading', { name: 'Thank you' }).waitFor();
  const sent = await stubLog();
  check('report: a double click sends exactly one request', sent.submissions.length === 1, String(sent.submissions.length));
  check('solve-ahead: Send after the solve finished posts the proof without a second challenge', sent.challenges === 1, String(sent.challenges));
  const [payload] = sent.submissions;
  check('report: payload has exactly the eight allowed keys', JSON.stringify(Object.keys(payload).sort()) === JSON.stringify([...WIRE_KEYS].sort()), Object.keys(payload).join(','));
  check('report: payload names topic and country only', payload.topic_id === 'ua-tp' && payload.country === 'HU' && payload.kind === 'rule_changed' && payload.source_url === SOURCE_URL);
  const hash = crypto.createHash('sha256').update(`${payload.token}${SEPARATOR}${payload.counter}`).digest();
  check('report: the counter solves the stub challenge', leadingZeroBits(hash) >= STUB_BITS, String(payload.counter));
  check('report: no fact id or value in the posted body', !JSON.stringify(payload).includes('ua_military_obligation') && !JSON.stringify(payload).includes('"nat"'));
  await dialog.getByRole('button', { name: 'Close' }).click();
  check('report dialog closes after done and focus returns to the report button', (await dialog.count()) === 0
    && await page.evaluate(() => document.activeElement?.getAttribute('data-focus-key') === 'detail-report'));
  await openDialog();
  await page.keyboard.press('Escape');
  check('Escape closes the dialog only; the detail card stays open', (await dialog.count()) === 0 && await detail.isVisible()
    && await page.evaluate(() => document.activeElement?.getAttribute('data-focus-key') === 'detail-report'));
  await openDialog();
  await dialog.getByRole('button', { name: 'Cancel' }).focus();
  await page.keyboard.press('Tab');
  check('report dialog: Tab from the last control stays inside the dialog', await page.evaluate(() => document.activeElement?.closest('.rm-report-dialog') !== null));
  await page.keyboard.press('Escape');
  const problemsBefore = consoleProblems.length;
  await setMode(MODE_PROOF_REJECTED_ONCE);
  await openDialog();
  await fillValid();
  await submitButton().click();
  await dialog.getByRole('heading', { name: 'Thank you' }).waitFor();
  const retried = await stubLog();
  check('E-RM02 once: one retry with a fresh challenge, then success', retried.challenges === 2 && retried.submissions.length === 2
    && retried.submissions[0].token !== retried.submissions[1].token, JSON.stringify({ challenges: retried.challenges, submissions: retried.submissions.length }));
  await dialog.getByRole('button', { name: 'Close' }).click();
  await setMode(MODE_PROOF_REJECTED_ALWAYS);

  await openDialog();
  await fillValid();
  await submitButton().click();
  await dialog.locator('.rm-notice-error').filter({ hasText: 'E-RM02' }).waitFor();
  const rejected = await stubLog();
  check('E-RM02 twice: exactly one retry, then an error state (no loop)', rejected.challenges === 2 && rejected.submissions.length === 2, JSON.stringify({ challenges: rejected.challenges, submissions: rejected.submissions.length }));
  check('E-RM02 twice: the form stays open and can be sent again', await submitButton().isEnabled());
  // Chromium logs every 4xx fetch as a console error by itself; these are the stub's deliberate rejections.
  await page.waitForTimeout(SETTLE_MS);
  consoleProblems.splice(problemsBefore).filter((problem) => !problem.includes('status of 400')).forEach((problem) => consoleProblems.push(problem));
  await page.keyboard.press('Escape');
  check('a full report flow leaves storage, cookies and databases untouched', (await storageSnapshot()) === storageBefore);
}
// Solve time at the shipped difficulty, measured in the page (no network); logged so a slowdown shows in the run output.
{ const SHIPPED_BITS = 14;
  const MEASURE_TOKENS = ['measure-a.sig', 'measure-b.sig', 'measure-c.sig'];
  const POW_MODULE_URL = '/static/public/rights_map/pow.js';
  const solved = await page.evaluate(async ({ url, bits, tokens }) => {
    const pow = await import(url);
    const runs = [];
    for (const token of tokens) {
      const startedAt = performance.now();
      const counter = await pow.solveProofOfWork({ token, bits });
      runs.push({ counter, ms: Math.round(performance.now() - startedAt) });
    }
    return runs;
  }, { url: POW_MODULE_URL, bits: SHIPPED_BITS, tokens: MEASURE_TOKENS });
  console.log(`MEASURE  solve time at ${SHIPPED_BITS} bits (ms per token): ${JSON.stringify(solved)}`);
  const crypto = await import('node:crypto');
  const bitsOk = (token, counter) => { const d = crypto.createHash('sha256').update(`${token}:${counter}`).digest(); let n = 0; for (const b of d) { if (b === 0) { n += 8; continue; } return n + Math.clz32(b) - 24 >= SHIPPED_BITS; } return true; };
  check('pow measure: every measured counter solves 14 bits', solved.every((run, index) => bitsOk(MEASURE_TOKENS[index], run.counter)), JSON.stringify(solved));
}
{ const r = await fitReport(page, false);
  check('desktop with detail open: FI inside rect between cards', r.fi, JSON.stringify(r.area) + ' FI ' + JSON.stringify(r.fiBox)); }
{ const hits = await privacyPanelHits(page);
  check('desktop: privacy panel is above the finder and the Hungary detail card', hits.overlapCount === 2 && hits.titleOnTop && hits.overlapOnTop, JSON.stringify(hits)); }
await page.screenshot({ path: `${SHOTS}/desktop-tp-hungary.png` });

// Keyboard: Escape closes, focus returns to the country
await page.keyboard.press('Escape');
check('Escape closes detail', !(await detail.isVisible()));
check('focus returned to selected country', await page.evaluate(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Hungary')));
await country('Germany').focus();
await page.keyboard.press('Enter');
check('Enter selects focused country', (await detail.textContent()).includes('Germany'));
check('DE warning not shown with valid passport unset', (await detail.locator('.rm-warning').count()) === 0);

// Passport check badge
check('passport options are ordered Expired, Valid', (await page.locator('.rm-fact:has([data-focus-key="fact:passport:valid"]) .rm-option').allTextContents()).join() === 'Expired,Valid');
check('no month input before Valid is chosen', (await page.locator('.rm-month-input').count()) === 0);
await fact('passport', 'valid').click();
const monthInput = page.locator('.rm-month-input');
const saveDate = page.getByRole('button', { name: 'Save date' });
{ const [validBox, inputBox, saveBox] = await Promise.all([fact('passport', 'valid').boundingBox(), monthInput.boundingBox(), saveDate.boundingBox()]);
  const centreY = (box) => box.y + box.height / 2;
  check('month input and Save button share the row of the passport buttons',
    Math.abs(centreY(inputBox) - centreY(validBox)) < 2 && Math.abs(centreY(saveBox) - centreY(validBox)) < 2
    && inputBox.x > validBox.x && saveBox.x > inputBox.x, JSON.stringify({ validBox, inputBox, saveBox }));
  const saveStyle = await styleOf(page, '.rm-month-save', 'backgroundColor');
  check('Save button is an ink square with an aria-hidden icon (light mode)', saveStyle.backgroundColor === INK_RGB && Math.abs(saveBox.width - saveBox.height) < 1
    && (await saveDate.locator('svg[aria-hidden="true"]').count()) === 1, JSON.stringify({ saveStyle, saveBox })); }
check('month input is a numeric text field with placeholder and aria-label, no separate hint', (await monthInput.getAttribute('aria-label')) === 'Valid until'
  && (await monthInput.getAttribute('placeholder')) === 'until MM/YYYY' && (await monthInput.getAttribute('inputmode')) === 'numeric'
  && (await monthInput.getAttribute('type')) === 'text' && (await page.locator('.rm-month-hint').count()) === 0
  && (await page.locator('.rm-month-label').count()) === 0 && (await page.locator('.rm-fact:has(.rm-month-input) .rm-fact-legend > span').first().textContent()) === 'Passport'
  && !(await page.locator('.rm-fact:has(.rm-month-input)').innerText()).includes('Valid until'));
{ const [validBox, inputBox, saveBox, expiredBox] = await Promise.all([fact('passport', 'valid').boundingBox(), monthInput.boundingBox(), saveDate.boundingBox(), fact('passport', 'expired').boundingBox()]);
  await monthInput.fill('03/2028');
  const fit = await monthInput.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  const ROW_TOP_TOLERANCE_PX = 4;
  check('passport row: buttons, input and save share one row (tops within 4 px)',
    [validBox, inputBox, saveBox].every((box) => Math.abs(box.y - expiredBox.y) <= ROW_TOP_TOLERANCE_PX), JSON.stringify({ expiredBox, validBox, inputBox, saveBox }));
  check('passport date input is not truncated', fit.scrollWidth <= fit.clientWidth, JSON.stringify(fit)); }
await monthInput.fill('2027-06');
check('typing a month does not commit it', (await detail.locator('.rm-warning').count()) === 0);
await saveDate.click();
check('Save button commits the month', (await detail.locator('.rm-warning').textContent()).includes('Jun 2027'), await detail.locator('.rm-warning').textContent());
await monthInput.fill('2027-08');
await monthInput.press('Enter');
check('Enter in the month input saves it', (await detail.locator('.rm-warning').textContent()).includes('Aug 2027'));
await monthInput.fill('03/2028');
await monthInput.press('Enter');
await page.reload();
await page.waitForSelector('.rm-country');
await page.getByRole('button', { name: /Ukrainian temporary protection/ }).click();
check('MM/YYYY + Enter stores 2028-03 and shows 03/2028 after reload', (await monthInput.inputValue()) === '03/2028', await monthInput.inputValue().catch(() => 'no input'));
await monthInput.fill('');
await monthInput.press('Enter');
check('saving an empty date shows the red message and keeps 2028-03 stored', (await page.locator('.rm-month-message-error').count()) === 1
  && (await page.evaluate(() => localStorage.getItem('relocat.factset.v1') ?? '')).includes('2028-03'));
await monthInput.click();
await page.keyboard.type('062029');
check('typing 062029 shows 06/2029', (await monthInput.inputValue()) === '06/2029', await monthInput.inputValue());
await page.keyboard.press('Enter');
check('typed 062029 + Enter stores 2029-06', (await page.evaluate(() => localStorage.getItem('relocat.factset.v1') ?? '')).includes('2029-06'));
await page.reload();
await page.waitForSelector('.rm-country');
await page.getByRole('button', { name: /Ukrainian temporary protection/ }).click();
check('reload shows 06/2029 for the typed date', (await monthInput.inputValue()) === '06/2029');
await monthInput.fill('');
await monthInput.click();
await page.keyboard.type('3');
check('typing 3 shows 3, uncorrected', (await monthInput.inputValue()) === '3', await monthInput.inputValue());
await page.keyboard.type('3');
check('typing 33 shows 33/', (await monthInput.inputValue()) === '33/', await monthInput.inputValue());
await page.keyboard.press('Backspace');
check('Backspace after the auto slash removes slash and digit', (await monthInput.inputValue()) === '3', await monthInput.inputValue());
await monthInput.fill('03/2028');
await monthInput.press('Enter');
await country('Germany').focus();
await page.keyboard.press('Enter');
await monthInput.fill('2027-06');
await monthInput.press('Enter');
await monthInput.fill('09/2027');
await page.locator('.rm-wizard').screenshot({ path: `${SHOTS}/desktop-passport-row.png` });
await monthInput.fill('13/2027');
await saveDate.click();
check('month 13 shows a red message, stays in the field and keeps the saved one', (await page.locator('.rm-month-message-error').isVisible())
  && (await monthInput.inputValue()) === '13/2027' && (await detail.locator('.rm-warning').textContent()).includes('Jun 2027'), await page.locator('.rm-month-message').textContent());
check('warning badge with formatted month', (await detail.locator('.rm-warning').textContent()).includes('Jun 2027'), await detail.locator('.rm-warning').textContent());

// Passport date: validation happens on Save only, with a reserved message line
const storedFacts = () => page.evaluate(() => localStorage.getItem('relocat.factset.v1') ?? '');
const apostilleTop = async () => (await page.locator('.rm-fact:has([data-focus-key="fact:apostille:yes"]) .rm-fact-legend').boundingBox()).y;
const messageLine = page.locator('.rm-month-message');
await monthInput.fill('03/2028');
await monthInput.press('Enter');
await monthInput.fill('');
await monthInput.click();
const topWithoutMessage = await apostilleTop();
await page.keyboard.type('552025');
check('typing 552025 shows 55/2025 uncorrected', (await monthInput.inputValue()) === '55/2025', await monthInput.inputValue());
await saveDate.click();
const topWithRed = await apostilleTop();
check('invalid month: red message, text kept, nothing stored', (await messageLine.textContent()) === 'Month must be 01–12.'
  && (await monthInput.inputValue()) === '55/2025' && !(await storedFacts()).includes('2025-55')
  && (await styleOf(page, '.rm-month-message', 'color')).color === 'rgb(138, 31, 31)');
await monthInput.fill('03/2028');
check('typing clears the message but keeps the line reserved', (await messageLine.textContent()) === '' && (await messageLine.boundingBox()).height >= MESSAGE_MIN_HEIGHT_PX);
await monthInput.press('Enter');
const topWithGreen = await apostilleTop();
check('valid month: green message and 2028-03 stored', (await messageLine.textContent()) === 'Saved: March 2028.'
  && (await storedFacts()).includes('2028-03') && (await messageLine.getAttribute('aria-live')) === 'polite'
  && (await styleOf(page, '.rm-month-message', 'color')).color === 'rgb(30, 91, 58)');
check('Apostille heading does not move with no message, red message or green message',
  Math.abs(topWithRed - topWithoutMessage) <= LAYOUT_TOLERANCE_PX && Math.abs(topWithGreen - topWithoutMessage) <= LAYOUT_TOLERANCE_PX, JSON.stringify({ topWithoutMessage, topWithRed, topWithGreen }));
await fact('passport', 'expired').click();
check('Expired keeps the empty message line reserved', (await page.locator('.rm-month-message').count()) === 1
  && Math.abs((await apostilleTop()) - topWithoutMessage) <= LAYOUT_TOLERANCE_PX);
await fact('passport', 'valid').click();
await monthInput.fill('06/2027');
await monthInput.press('Enter');
await page.keyboard.press('Escape');
// Regression: Valid -> date -> Expired -> Valid used to leave no date field to fill in.
await fact('passport', 'expired').click();
check('Expired hides the month input', (await monthInput.count()) === 0);
await fact('passport', 'valid').click();
{ const wizardBox = await page.locator('.rm-wizard').boundingBox();
  const inputBox = await monthInput.boundingBox();
  check('passport Valid -> Expired -> Valid: date input visible again, inside the wizard card', (await monthInput.isVisible()) && inputBox !== null
    && inputBox.y >= wizardBox.y && inputBox.y + inputBox.height <= wizardBox.y + wizardBox.height, JSON.stringify({ wizardBox, inputBox })); }
check('previously saved month is restored from the store', (await monthInput.inputValue()) === '06/2027');

// Persistence
await page.reload();
await page.waitForSelector('.rm-country');
await page.getByRole('button', { name: /Ukrainian temporary protection/ }).click();
check('answers persisted across reload', (await fact('nat', 'UA').getAttribute('aria-pressed')) === 'true'
  && (await cls('Hungary')).includes('rm-status-ok'));

// Download / load
{ const exportBox = await page.getByRole('button', { name: 'Export my answers' }).boundingBox();
  const rowBoxes = await Promise.all(['Load answers', 'Forget my answers'].map((name) => page.getByRole('button', { name }).boundingBox()));
  const rowLeft = Math.min(...rowBoxes.map((box) => box.x));
  const rowRight = Math.max(...rowBoxes.map((box) => box.x + box.width));
  check('Export button spans the width of the Load + Forget row', Math.abs(exportBox.x - rowLeft) < 1 && Math.abs(exportBox.x + exportBox.width - rowRight) < 1,
    JSON.stringify({ exportBox, rowLeft, rowRight }));
  check('Load and Forget labels stay on one line', rowBoxes.every((box) => box.height < 2 * 44), JSON.stringify(rowBoxes.map((box) => box.height)));
  check('Export button is above the Load + Forget row', exportBox.y + exportBox.height <= Math.min(...rowBoxes.map((box) => box.y)));
  const exportStyle = await styleOf(page, '[data-focus-key="answers-export"]', 'backgroundColor', 'color');
  check('Export button is ink with white text in light mode', exportStyle.backgroundColor === INK_RGB && exportStyle.color === WHITE_RGB, JSON.stringify(exportStyle));
  const forgetStyle = await styleOf(page, '[data-focus-key="answers-forget"]', 'backgroundColor', 'color');
  const [forgetRed, forgetGreen] = rgbChannels(forgetStyle.backgroundColor);
  check('Forget button is red with white text', forgetRed > 150 && forgetGreen < 80 && forgetStyle.color === WHITE_RGB, JSON.stringify(forgetStyle));
  check('Forget button contrast is at least 4.5:1', contrastRatio(forgetStyle.backgroundColor, forgetStyle.color) >= MIN_TEXT_CONTRAST,
    contrastRatio(forgetStyle.backgroundColor, forgetStyle.color).toFixed(2)); }
const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export my answers' }).click()]);
check('download filename', download.suggestedFilename() === 'relocat-answers.json');
await download.saveAs(ANSWERS_FILE);
fs.writeFileSync(BAD_FILE, '{"nope":1}');
await page.locator('.rm-answers input[type=file]').setInputFiles(BAD_FILE);
// The import is asynchronous (file read), so wait for the notice instead of sampling once.
const badImportNoticeShown = await page.locator('.rm-notice-error').waitFor({ timeout: NOTICE_TIMEOUT_MS }).then(() => true, () => false);
check('bad import shows inline error', badImportNoticeShown, await page.locator('.rm-notice-error').textContent().catch(() => ''));

// Forget
await page.getByRole('button', { name: 'Forget my answers' }).click();
await page.getByRole('button', { name: 'Cancel' }).click();
check('cancel keeps answers', (await fact('nat', 'UA').getAttribute('aria-pressed')) === 'true');
await page.getByRole('button', { name: 'Forget my answers' }).click();
await page.getByRole('button', { name: 'Yes, forget them' }).click();
check('forget clears answers and neutralises map', (await cls('Hungary')).includes('rm-status-neutral')
  && (await fact('nat', 'UA').getAttribute('aria-pressed')) === 'false');
await page.locator('.rm-answers input[type=file]').setInputFiles(ANSWERS_FILE);
// The load is asynchronous (file read): the success notice appears together with the restored answers.
await page.locator('.rm-notice-ok').waitFor({ timeout: NOTICE_TIMEOUT_MS });
check('load restores answers', (await cls('Hungary')).includes('rm-status-ok'));

// Blue Card neutral prompt
await page.getByRole('button', { name: 'All topics' }).click();
await page.getByRole('button', { name: /EU Blue Card/ }).click();
await page.getByRole('button', { name: 'Forget my answers' }).click();
await page.getByRole('button', { name: 'Yes, forget them' }).click();
const blueCardPrompt = await page.locator('.rm-prompt').textContent();
{ const promptStyle = await styleOf(page, '.rm-prompt', 'backgroundColor', 'color', 'borderTopColor');
  check('missing-questions prompt uses the yellow caveat colours', promptStyle.backgroundColor === CAVEAT_BG_RGB && promptStyle.color === CAVEAT_INK_RGB, JSON.stringify(promptStyle)); }
check('Blue Card prompt names the unanswered questions by label',
  blueCardPrompt.includes('Answer 2 questions to colour the map: Highest education (recognised), Binding job offer above the salary threshold'),
  blueCardPrompt);
check('reopening Blue Card applies the defaults again', await (async () => {
  await page.getByRole('button', { name: 'All topics' }).click();
  await page.getByRole('button', { name: /EU Blue Card/ }).click();
  return (await page.locator('.rm-prompt').count()) === 0 && (await fact('degree', 'uni').getAttribute('aria-pressed')) === 'true';
})());
check('Blue Card opens with DE restricted', (await cls('Germany')).includes('rm-status-restricted'), await cls('Germany'));
const jobOfferBadge = await fact('bc_job_offer', 'yes').locator('.rm-gain').textContent();
check('job-offer lever shows +1', jobOfferBadge === '+1', jobOfferBadge);

// Zoom + detail layers
await page.getByRole('button', { name: 'All topics' }).click();
await page.getByRole('button', { name: /Ukrainian temporary protection/ }).click();
await fact('nat', 'UA').click();
const before = requests.length;
for (let i = 0; i < 6; i += 1) await page.getByRole('button', { name: 'Zoom in' }).click();
await page.waitForTimeout(1500);
const zoomRequests = requests.slice(before);
check('zoom triggers admin1 requests', zoomRequests.some((u) => u.includes('/admin1/')), zoomRequests.length + ' reqs');
check('city dots appear', (await page.locator('.rm-city').count()) > 0, String(await page.locator('.rm-city').count()));
check('level class set', /rm-level-[12]/.test(await page.locator('.rm-svg').getAttribute('class')));
await page.screenshot({ path: `${SHOTS}/desktop-zoomed.png` });
for (let i = 0; i < 20; i += 1) await page.getByRole('button', { name: 'Zoom in' }).click();
await page.mouse.move(900, 400); for (let i = 0; i < 10; i += 1) await page.mouse.wheel(0, -600);
await page.waitForTimeout(300);
const deepWidth = Number((await page.locator('.rm-svg').getAttribute('viewBox')).split(' ')[2]);
await page.getByRole('button', { name: 'Reset view' }).click();
await page.waitForTimeout(200);
const initialWidth = Number((await page.locator('.rm-svg').getAttribute('viewBox')).split(' ')[2]);
check('max zoom-in stops at initial x MAX_ZOOM_IN_FRACTION', deepWidth >= initialWidth * MAX_ZOOM_IN_FRACTION * 0.99 && deepWidth < initialWidth * 0.15, `${deepWidth.toFixed(2)} vs ${(initialWidth * MAX_ZOOM_IN_FRACTION).toFixed(2)}`);
check('reset returns to level 0', (await page.locator('.rm-svg').getAttribute('class')).includes('rm-level-0'));
const viewBoxBefore = await page.locator('.rm-svg').getAttribute('viewBox');
await page.mouse.move(900, 400);
await page.mouse.wheel(0, -400);
await page.waitForTimeout(200);
check('wheel zoom changes viewBox', (await page.locator('.rm-svg').getAttribute('viewBox')) !== viewBoxBefore);
const viewBoxZoomed = await page.locator('.rm-svg').getAttribute('viewBox');
await page.mouse.move(900, 400); await page.mouse.down(); await page.mouse.move(800, 350, { steps: 6 }); await page.mouse.up();
check('drag pans viewBox', (await page.locator('.rm-svg').getAttribute('viewBox')) !== viewBoxZoomed);
check('drag did not select a country', (await page.locator('.rm-detail:not(.rm-authority-card)').isHidden()));
await page.getByRole('button', { name: 'Reset view' }).click();

// Main screenshot state: TP, HU selected
await fact('ua_military_obligation', 'yes').click();
await fact('ua_holds_tp', 'no').click();
await fact('ua_exit_proof', 'no').click();
await page.selectOption('#rm-finder-select', 'HU');
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/desktop-1440x900.png` });

// Phone
const phone = await browser.newContext({ viewport: { width: PHONE_WIDTH, height: 844 }, hasTouch: true });
const mobile = await phone.newPage();
mobile.on('console', (m) => { if (['error', 'warning'].includes(m.type())) consoleProblems.push(`mobile ${m.type()}: ${m.text()}`); });
mobile.on('request', (r) => requests.push(r.url()));
await mobile.goto(`${BASE}/map/`);
await mobile.waitForSelector('.rm-country');
{ const r = await fitReport(mobile, true);
  check('phone initial view: FI inside map area', r.fi, JSON.stringify(r.area) + ' FI ' + JSON.stringify(r.fiBox));
  check('phone initial view: PT mainland inside', r.ptMainland, JSON.stringify(r.ptBox)); }
await mobile.screenshot({ path: `${SHOTS}/phone-step1.png` });
{ const pill = mobile.locator('.rm-pill-privacy');
  await pill.click();
  const box = await mobile.locator('#rm-privacy-panel').boundingBox();
  check('phone: privacy panel is open and fits the screen width', (await pill.getAttribute('aria-expanded')) === 'true' && box !== null
    && box.x >= 0 && box.x + box.width <= PHONE_WIDTH, JSON.stringify(box));
  await mobile.screenshot({ path: `${SHOTS}/phone-privacy-panel.png` });
  await mobile.keyboard.press('Escape'); }
await mobile.getByRole('button', { name: /Ukrainian temporary protection/ }).click();
for (const [id, code] of [['nat', 'UA'], ['ua_military_obligation', 'yes'], ['ua_holds_tp', 'no'], ['ua_exit_proof', 'no']]) {
  await mobile.locator(`[data-focus-key="fact:${id}:${code}"]`).click();
}
await mobile.waitForTimeout(300);
await mobile.screenshot({ path: `${SHOTS}/phone-390x844.png` });
await mobile.locator('[data-focus-key="fact:passport:valid"]').click();
await mobile.locator('.rm-month-input').fill('03/2028');
{ const phoneFit = await mobile.locator('.rm-month-input').evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  check('phone: passport date input is not truncated', phoneFit.scrollWidth <= phoneFit.clientWidth, JSON.stringify(phoneFit)); }
await mobile.screenshot({ path: `${SHOTS}/phone-step2-passport.png` });
await mobile.locator('[data-focus-key="fact:passport:expired"]').click();
// The finder is hidden on a phone (the map is the way in); force drives the hidden select as a setup shortcut.
await mobile.selectOption('#rm-finder-select', 'HU', { force: true });
await mobile.waitForTimeout(300);
await mobile.waitForTimeout(300);
{ const r = await fitReport(mobile, true);
  check('phone with sheet open: FI inside area above sheet', r.fi, JSON.stringify(r.area) + ' FI ' + JSON.stringify(r.fiBox)); }
{ const hits = await privacyPanelHits(mobile);
  check('phone: privacy panel is above the finder and detail sheet', hits.titleOnTop && hits.overlapOnTop, JSON.stringify(hits)); }
check('phone detail card takes the wizard card\'s place in the page flow', await mobile.evaluate(() => getComputedStyle(document.querySelector('.rm-detail')).position === 'static'));
await mobile.screenshot({ path: `${SHOTS}/phone-sheet-open.png` });


// Phone header at 360x740: both phone links, logo and theme toggle fit on one line.
if (!shouldSkipGroup('phone header at 360x740')) { const narrowContext = await browser.newContext({ viewport: NARROW_PHONE, hasTouch: true });
  const narrow = await narrowContext.newPage();
  await narrow.goto(`${BASE}/map/`);
  const headerHeight = async () => (await narrow.locator('.top').boundingBox()).height;
  const withLink = await headerHeight();
  const boxes = await narrow.evaluate(() => ['.top .logo', '.top nav a', '.top .theme-toggle']
    .map((selector) => [...document.querySelectorAll(selector)].filter((el) => el.offsetParent !== null)
      .map((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; })).flat());
  const sameLine = boxes.length > 0 && boxes.every((b) => b.top < boxes[0].bottom && b.bottom > boxes[0].top);
  check('phone 360: header items share one line', sameLine, JSON.stringify(boxes));
  const visibleLinks = await narrow.locator('.top nav a:visible').allTextContents();
  check('phone 360: Rights map and Why Relocat? are the visible links', JSON.stringify(visibleLinks) === JSON.stringify(['Rights map', 'Why Relocat?']), visibleLinks.join(' | '));
  await narrow.locator('.top').screenshot({ path: `${SHOTS}/phone-header-360x740.png` });
  const overflow = await narrow.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('phone 360: no horizontal overflow', overflow <= 0, String(overflow));
  const headerOverflow = await narrow.locator('.top .wrap').evaluate((el) => el.scrollWidth - el.clientWidth);
  check('phone 360: header content does not overflow its bar', headerOverflow <= 0, String(headerOverflow));
  await narrow.locator('.top nav a', { hasText: 'Rights map' }).evaluate((el) => el.remove());
  check('phone 360: header height is the same without the link', Math.abs((await headerHeight()) - withLink) <= LAYOUT_TOLERANCE_PX, `${withLink} vs ${await headerHeight()}`);
  await narrowContext.close(); }

// Tab order: topbar -> wizard -> map -> finder/legend -> detail
const tabPage = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
tabPage.on('request', (r) => requests.push(r.url()));
await tabPage.goto(`${BASE}/map/`);
await tabPage.waitForSelector('.rm-country');
await tabPage.getByRole('button', { name: /Ukrainian temporary protection/ }).click();
for (const [id, code] of [['nat', 'UA'], ['ua_military_obligation', 'yes'], ['ua_holds_tp', 'no'], ['ua_exit_proof', 'no']]) {
  await tabPage.locator(`[data-focus-key="fact:${id}:${code}"]`).click();
}
await tabPage.selectOption('#rm-finder-select', 'HU');
// The click sets the Tab starting point: the site header on the site page. The static demo has no site
// header, so it starts from the Rights map bar, which is the first thing on that page.
const tabStartPoint = IS_STATIC_SHELL ? tabPage.locator('.rm-topbar') : tabPage.locator('body');
await tabStartPoint.click({ position: { x: 5, y: 5 } });
await tabPage.evaluate(() => document.activeElement?.blur());
const regionOrder = [];
for (let i = 0; i < 160; i += 1) {
  await tabPage.keyboard.press('Tab');
  const region = await tabPage.evaluate(() => {
    const el = document.activeElement;
    const rootEl = document.getElementById('rights-map');
    if (!el || !rootEl.contains(el)) return 'outside';
    if (el.closest('.rm-topbar')) return 'topbar';
    if (el.closest('.rm-wizard')) return 'wizard';
    if (el.closest('.rm-finder-cluster')) return 'finder';
    if (el.closest('.rm-detail')) return 'detail';
    if (el.closest('.rm-map')) return 'map';
    return 'other';
  });
  if (regionOrder.at(-1) !== region) regionOrder.push(region);
  if (region === 'outside' && regionOrder.length > 2) break;
}
check('tab order topbar>wizard>map>finder>detail', regionOrder.filter((r) => r !== 'outside').join('>') === 'wizard>map>finder>detail'
  || regionOrder.filter((r) => r !== 'outside').join('>') === 'topbar>wizard>map>finder>detail', regionOrder.join('>'));
const ringSizes = await tabPage.evaluate(() => ['Malta', 'Luxembourg', 'Liechtenstein'].map((n) => {
  const r = document.querySelector(`.rm-ring-hit[aria-label^="${n}:"]`).getBoundingClientRect();
  return `${n} ${r.width.toFixed(1)}x${r.height.toFixed(1)}`;
}));
check('MT/LU/LI hit targets >= 44x44 px', ringSizes.every((t) => { const [w, h] = t.split(' ')[1].split('x').map(Number); return w >= 43.9 && h >= 43.9; }), ringSizes.join(', '));
const ringTarget = tabPage.locator('.rm-ring-hit[aria-label^="Malta"]');
await ringTarget.focus();
await tabPage.keyboard.press('Space');
check('micro-state ring is focusable and selects on Space', (await tabPage.locator('.rm-detail:not(.rm-authority-card)').textContent()).includes('Malta'));
check('detail heading focused after selection', await tabPage.evaluate(() => document.activeElement?.tagName === 'H2' && document.activeElement.closest('.rm-detail') !== null));

const focusStyle = await tabPage.evaluate(() => { const b = document.querySelector('.rm-option'); b.focus(); return getComputedStyle(b).outlineStyle + ' ' + getComputedStyle(b).outlineWidth; });
check('visible focus ring on buttons', /solid 3px/.test(focusStyle), focusStyle);
const smallTargets = await tabPage.evaluate(() => [...document.querySelectorAll('#rights-map button, #rights-map select, #rights-map input:not([type=file]), #rights-map a.rm-button')]
  .filter((e) => e.offsetParent !== null).map((e) => [e, e.getBoundingClientRect()]).filter(([, r]) => r.height < 43.5 || r.width < 43.5).map(([e]) => e.className + ':' + e.textContent.slice(0, 20)));
check('touch targets >= 44px', smallTargets.length === 0, smallTargets.join(' | '));
// Pinch (synthetic two-pointer sequence)
const pinchBefore = (await tabPage.locator('.rm-svg').getAttribute('viewBox')).split(' ').map(Number)[2];
await tabPage.evaluate(() => {
  const svg = document.querySelector('.rm-svg');
  const fire = (type, id, x, y) => svg.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch' }));
  fire('pointerdown', 1, 700, 450); fire('pointerdown', 2, 800, 450);
  fire('pointermove', 2, 900, 450); fire('pointermove', 2, 1000, 450);
  fire('pointerup', 2, 1000, 450); fire('pointerup', 1, 700, 450);
});
const pinchAfter = (await tabPage.locator('.rm-svg').getAttribute('viewBox')).split(' ').map(Number)[2];
check('pinch out zooms in', pinchAfter < pinchBefore, `${pinchBefore} -> ${pinchAfter}`);

// Export completeness: every answered fact of every topic (profile, topic facts, the passport month) and nothing else
{ const exportRules = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
  const exportPage = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  exportPage.on('console', (m) => { if (['error', 'warning'].includes(m.type())) consoleProblems.push(`export ${m.type()}: ${m.text()}`); });
  await exportPage.goto(`${BASE}/map/`);
  await exportPage.waitForSelector('.rm-country');
  const exportFact = (id, code) => exportPage.locator(`[data-focus-key="fact:${id}:${code}"]`);
  const answered = {};
  const answer = async (id, code) => { await exportFact(id, code).click(); answered[id] = code; };
  await exportPage.getByRole('button', { name: /Ukrainian temporary protection/ }).click();
  for (const [id, code] of [['nat', 'BY'], ['ua_military_obligation', 'no'], ['ua_holds_tp', 'yes'], ['ua_exit_proof', 'yes'], ['apostille', 'yes'], ['passport', 'valid']]) await answer(id, code);
  await exportPage.locator('.rm-month-input').fill('06/2027');
  await exportPage.getByRole('button', { name: 'Save date' }).click();
  answered.passport_until = '2027-06';
  await exportPage.getByRole('button', { name: 'All topics' }).click();
  await exportPage.getByRole('button', { name: /EU Blue Card/ }).click();
  for (const [id, code] of [['degree', 'voc'], ['german', 'B1'], ['bc_job_offer', 'yes']]) await answer(id, code);
  const [exported] = await Promise.all([exportPage.waitForEvent('download'), exportPage.getByRole('button', { name: 'Export my answers' }).click()]);
  const exportedJson = JSON.parse(fs.readFileSync(await exported.path(), 'utf8'));
  const missing = Object.entries(answered).filter(([id, code]) => exportedJson.facts[id] !== code).map(([id]) => id);
  check('export lists every answered fact of both topics with its value (incl. passport_until)', missing.length === 0, `missing/wrong: ${missing.join(',')}`);
  check('export sets fact_schema to the rules version', exportedJson.fact_schema === exportRules.fact_schema, String(exportedJson.fact_schema));
  const topicDefaults = exportRules.topics.filter((topic) => ['ua-tp', 'eu-blue-card'].includes(topic.id)).flatMap((topic) => Object.keys(topic.defaults ?? {}));
  const unexpected = Object.keys(exportedJson.facts).filter((id) => !(id in answered) && !topicDefaults.includes(id));
  check('export holds nothing but answers and the defaults of the opened topics', unexpected.length === 0
    && Object.keys(exportedJson).sort().join() === 'fact_schema,facts', unexpected.join(',')); }

// Geo failure: finder still works, map says so, Retry recovers
const failContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const failPage = await failContext.newPage();
await failPage.route('**/static/geo/**', (route) => route.abort());
await failPage.goto(`${BASE}/map/`);
await failPage.waitForSelector('.rm-map-message button');
check('geo failure shows message + Retry', (await failPage.locator('.rm-map-message').textContent()).includes('Map could not be loaded'));
check('finder list works without geo', (await failPage.locator('#rm-finder-select option').count()) === 40);
await failPage.selectOption('#rm-finder-select', 'HU');
check('detail card opens without geo', (await failPage.locator('.rm-detail:not(.rm-authority-card)').textContent()).includes('Hungary'));
await failPage.unroute('**/static/geo/**');
await failPage.locator('.rm-map-message button').click();
await failPage.waitForSelector('.rm-country');
check('Retry loads the map', (await failPage.locator('.rm-country').count()) === EXPECTED_COUNTRY_PATHS);

// Rules failure: banner + Retry
const rulesPage = await (await browser.newContext()).newPage();
await rulesPage.route('**/data/rules.v1.json*', (route) => route.abort());
await rulesPage.goto(`${BASE}/map/`);
await rulesPage.waitForSelector('.rm-banner');
check('rules failure shows banner', (await rulesPage.locator('.rm-banner').textContent()).includes('Rules could not be loaded.'));
check('no colours on rules failure', (await rulesPage.locator('.rm-country').count()) === 0);
await rulesPage.unroute('**/data/rules.v1.json*');
await rulesPage.locator('.rm-banner button').click();
await rulesPage.waitForSelector('.rm-country');
check('rules Retry recovers', true);

// Module import failure: Retry must ask the server again under a fresh URL (a failed dynamic
// import is cached per URL), and the first attempt must keep the plain ?v= URL.
const moduleContext = await browser.newContext();
const modulePage = await moduleContext.newPage();
const moduleUrls = [];
modulePage.on('request', (r) => { if (r.url().includes('/ui-topbar.js')) moduleUrls.push(r.url()); });
await modulePage.route('**/ui-topbar.js*', (route) => route.abort());
await modulePage.goto(`${BASE}/map/`);
await modulePage.waitForSelector('.rm-banner');
await modulePage.unroute('**/ui-topbar.js*');
await modulePage.locator('.rm-banner button').click();
await modulePage.waitForSelector('.rm-country');
check('module retry uses a fresh URL and recovers',
  moduleUrls.length === 2 && !moduleUrls[0].includes('retry=') && moduleUrls[1].includes('&retry=1'), moduleUrls.join(' | '));

// Non-persistent storage notice
const memoryPage = await (await browser.newContext()).newPage();
await memoryPage.addInitScript(() => {
  Storage.prototype.setItem = () => { throw new DOMException('blocked', 'QuotaExceededError'); };
});
await memoryPage.goto(`${BASE}/map/`);
await memoryPage.waitForSelector('.rm-country');
check("non-persistent notice shown", (await memoryPage.locator('.rm-pill-warning').textContent()).includes("won't be remembered"));

// Theme: the page follows the host page's theme tokens (demo/demo.css in the public demo) in both ways the host decides it
const THEME_STORAGE_KEY = 'relocat-theme';
const MIN_GRAPHIC_CONTRAST = 3;
const MIN_STATUS_LIGHTNESS_RATIO = 1.3;
const OPAQUE_STATUSES = ['rm-status-ok', 'rm-status-restricted', 'rm-status-blocked', 'rm-status-na', 'rm-status-origin'];
const FILLED_STATUSES = ['rm-status-ok', 'rm-status-restricted', 'rm-status-blocked'];
const SEA_SELECTOR = '.rm-svg';

const openThemedMap = async (contextOptions, storedTheme) => {
  const themedContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...contextOptions });
  const themed = await themedContext.newPage();
  themed.on('console', (m) => { if (['error', 'warning'].includes(m.type())) consoleProblems.push(`theme ${m.type()}: ${m.text()}`); });
  if (storedTheme) await themed.addInitScript(([key, value]) => localStorage.setItem(key, value), [THEME_STORAGE_KEY, storedTheme]);
  await themed.goto(`${BASE}/map/`);
  await themed.waitForSelector('.rm-country');
  return themed;
};
/** Opens the Ukrainian TP topic and selects Hungary, so the card, the legend and the detail card are all on screen. */
const showTopicWithHungary = async (pg) => {
  await pg.getByRole('button', { name: /Ukrainian temporary protection/ }).click();
  await pg.selectOption('#rm-finder-select', 'HU');
  await pg.waitForTimeout(SETTLE_MS);
};
/** Colours a status badge gets, measured on a probe element built with DOM calls. */
const probeBadge = (pg, statusClass) => pg.evaluate((statusName) => {
  const probe = document.createElement('span');
  probe.className = `rm-badge ${statusName}`;
  document.querySelector('.rm-root').append(probe);
  const computed = getComputedStyle(probe);
  const result = { color: computed.color, background: computed.backgroundColor };
  probe.remove();
  return result;
}, statusClass);
const countryFill = (pg, statusClass) => pg.evaluate((statusName) => {
  const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  probe.setAttribute('class', `rm-country ${statusName}`);
  document.querySelector('.rm-layer-covered').append(probe);
  const { fill } = getComputedStyle(probe);
  probe.remove();
  return fill;
}, statusClass);
const hatchFills = (pg) => pg.evaluate(() => ['.rm-hatch-base', '.rm-hatch-stripe'].map((selector) => getComputedStyle(document.querySelector(selector)).fill));

/** Every dark-mode assertion for one way of turning the dark theme on; `label` names the mode. */
const checkDarkTheme = async (pg, label) => {
  await showTopicWithHungary(pg);
  const wizard = await styleOf(pg, '.rm-wizard', 'backgroundColor');
  const sea = await styleOf(pg, SEA_SELECTOR, 'backgroundColor');
  const exportStyle = await styleOf(pg, '[data-focus-key="answers-export"]', 'backgroundColor', 'color');
  check(`${label}: wizard card is the dark site surface`, rgbChannels(wizard.backgroundColor).join() === rgbChannels(DARK_CARD_RGB).join(), wizard.backgroundColor);
  check(`${label}: the sea is dark`, sea.backgroundColor === DARK_SEA_RGB, sea.backgroundColor);
  check(`${label}: Export button is brand yellow with dark text`, exportStyle.backgroundColor === BRAND_RGB && exportStyle.color === BRAND_INK_RGB, JSON.stringify(exportStyle));
  const selectedOption = await styleOf(pg, SELECTED_OPTION_SELECTOR, 'backgroundColor', 'color');
  check(`${label}: selected option is brand yellow with dark text`, selectedOption.backgroundColor === BRAND_RGB && selectedOption.color === BRAND_INK_RGB, JSON.stringify(selectedOption));
  const bodyText = await styleOf(pg, '.rm-wizard .rm-fact-legend', 'color');
  const forget = await styleOf(pg, '[data-focus-key="answers-forget"]', 'backgroundColor', 'color');
  const legendText = await styleOf(pg, '.rm-legend-item', 'color');
  const legendBox = await styleOf(pg, '.rm-legend', 'backgroundColor');
  const ratios = {
    'card body text': contrastRatio(wizard.backgroundColor, bodyText.color),
    'Export text': contrastRatio(exportStyle.backgroundColor, exportStyle.color),
    'Forget text': contrastRatio(forget.backgroundColor, forget.color),
    'legend labels': contrastRatio(legendBox.backgroundColor, legendText.color),
  };
  for (const status of OPAQUE_STATUSES) { const badge = await probeBadge(pg, status); ratios[`${status} badge`] = contrastRatio(badge.background, badge.color); }
  const [hatchLight, hatchDark] = await hatchFills(pg);
  const unknownInk = (await probeBadge(pg, 'rm-status-unknown')).color;
  ratios['unknown badge on light stripe'] = contrastRatio(hatchLight, unknownInk);
  ratios['unknown badge on dark stripe'] = contrastRatio(hatchDark, unknownInk);
  const weak = Object.entries(ratios).filter(([, ratio]) => ratio < MIN_TEXT_CONTRAST).map(([name, ratio]) => `${name} ${ratio.toFixed(2)}`);
  check(`${label}: text contrast is at least 4.5:1 (card, Export, Forget, legend, every status badge)`, weak.length === 0,
    weak.join('; ') || Object.entries(ratios).map(([name, ratio]) => `${name} ${ratio.toFixed(1)}`).join('; '));
  const fills = await Promise.all(FILLED_STATUSES.map((status) => countryFill(pg, status)));
  const lightness = fills.map(relativeLuminance);
  const pairRatios = [[0, 1], [0, 2], [1, 2]].map(([first, second]) => contrastRatio(fills[first], fills[second]));
  check(`${label}: ok, restricted and blocked differ in lightness, not only hue`, pairRatios.every((ratio) => ratio >= MIN_STATUS_LIGHTNESS_RATIO),
    `${fills.join(' ')} L=${lightness.map((value) => value.toFixed(3)).join('/')} pairs=${pairRatios.map((ratio) => ratio.toFixed(2)).join('/')}`);
  const seaContrasts = fills.map((fill) => contrastRatio(fill, sea.backgroundColor));
  check(`${label}: ok, restricted and blocked stand out from the sea (3:1)`, seaContrasts.every((ratio) => ratio >= MIN_GRAPHIC_CONTRAST), seaContrasts.map((ratio) => ratio.toFixed(2)).join('/'));
  const symbols = await pg.locator('.rm-legend .rm-swatch').allTextContents();
  check(`${label}: legend swatches keep their symbols`, symbols.length >= 3 && symbols.every((symbol) => symbol.trim() !== ''), symbols.join(','));
  check(`${label}: detail card shows its status symbol`, (await pg.locator('.rm-detail .rm-badge').first().textContent()).trim().length > 1);
};

{ const emulated = await openThemedMap({ colorScheme: 'dark' });
  await checkDarkTheme(emulated, 'prefers-color-scheme dark');
  await emulated.screenshot({ path: `${SHOTS}/dark-desktop-tp-hungary.png` });
  await emulated.locator('.rm-pill-privacy').click();
  await emulated.screenshot({ path: `${SHOTS}/dark-desktop-privacy-panel.png` });
  await emulated.keyboard.press('Escape');
  const kosovo = emulated.locator('.rm-layer-context .rm-country', { has: emulated.locator('title', { hasText: /^Kosovo$/ }) });
  const kosovoBox = await kosovo.boundingBox();
  await emulated.mouse.move(kosovoBox.x + kosovoBox.width / 2, kosovoBox.y + kosovoBox.height / 2);
  for (let i = 0; i < KOSOVO_ZOOM_STEPS; i += 1) await emulated.mouse.wheel(0, -WHEEL_ZOOM_DELTA);
  await emulated.waitForTimeout(SETTLE_MS);
  await emulated.screenshot({ path: `${SHOTS}/dark-desktop-balkans.png` });
  const step1 = await openThemedMap({ colorScheme: 'dark' });
  await step1.screenshot({ path: `${SHOTS}/dark-desktop-step1.png` });
  const phoneDarkContext = await browser.newContext({ viewport: { width: PHONE_WIDTH, height: 844 }, hasTouch: true, colorScheme: 'dark' });
  const phoneDark = await phoneDarkContext.newPage();
  await phoneDark.goto(`${BASE}/map/`);
  await phoneDark.waitForSelector('.rm-country');
  await phoneDark.getByRole('button', { name: /Ukrainian temporary protection/ }).click();
  await phoneDark.waitForTimeout(SETTLE_MS);
  await phoneDark.screenshot({ path: `${SHOTS}/dark-phone-step2.png` }); }
if (!shouldSkipGroup('stored site theme (data-theme)')) { const stored = await openThemedMap({ colorScheme: 'light' }, 'dark');
  check('data-theme="dark" is set by the site script', (await stored.locator('html').getAttribute('data-theme')) === 'dark');
  await checkDarkTheme(stored, 'data-theme dark'); }
{ const lightPage = await openThemedMap({ colorScheme: 'light' });
  await showTopicWithHungary(lightPage);
  const lightSea = await styleOf(lightPage, SEA_SELECTOR, 'backgroundColor');
  const lightExport = await styleOf(lightPage, '[data-focus-key="answers-export"]', 'backgroundColor', 'color');
  check('light mode: light sea and ink Export button with white text', lightSea.backgroundColor === LIGHT_SEA_RGB && lightExport.backgroundColor === INK_RGB && lightExport.color === WHITE_RGB, JSON.stringify({ lightSea, lightExport }));
  const lightOption = await styleOf(lightPage, SELECTED_OPTION_SELECTOR, 'backgroundColor', 'color');
  check('light mode: selected option is ink with white text', lightOption.backgroundColor === INK_RGB && lightOption.color === WHITE_RGB, JSON.stringify(lightOption));
  await lightPage.screenshot({ path: `${SHOTS}/light-desktop-tp-hungary.png` });
  if (!shouldSkipGroup('header theme toggle')) {
  await lightPage.evaluate(() => { window.rmNoReloadMarker = true; });
  await lightPage.locator('#theme-toggle').click();
  const toggledSea = await styleOf(lightPage, SEA_SELECTOR, 'backgroundColor');
  const toggledCard = await styleOf(lightPage, '.rm-wizard', 'backgroundColor');
  check('header theme toggle flips the map to dark without a reload', toggledSea.backgroundColor === DARK_SEA_RGB
    && rgbChannels(toggledCard.backgroundColor).join() === rgbChannels(DARK_CARD_RGB).join() && (await lightPage.evaluate(() => window.rmNoReloadMarker === true)));
  await lightPage.locator('#theme-toggle').click();
  check('header theme toggle flips the map back to light without a reload', (await styleOf(lightPage, SEA_SELECTOR, 'backgroundColor')).backgroundColor === LIGHT_SEA_RGB
    && (await lightPage.evaluate(() => window.rmNoReloadMarker === true))); } }

// Focus: a pointer click leaves only the selection stroke; keyboard focus gets a stroke, never a box outline
const MAX_TAB_PRESSES = 300;
const NO_OUTLINE = 'none';
const MAP_SHAPE_SELECTOR = '.rm-country, .rm-ring-hit';
/** Computed outline-style of every focusable map shape that is not `none`. */
const shapesWithOutline = (pg) => pg.evaluate((selector) => [...document.querySelectorAll(selector)]
  .filter((shape) => getComputedStyle(shape).outlineStyle !== 'none').map((shape) => shape.getAttribute('aria-label')), MAP_SHAPE_SELECTOR);
{ const focusPage = await openThemedMap({ colorScheme: 'light' });
  const germany = focusPage.locator('.rm-layer-covered [aria-label^="Germany:"]');
  await germany.click();
  await focusPage.waitForTimeout(SETTLE_MS);
  check('mouse click on DE: the path has outline-style none', (await styleOf(focusPage, '.rm-layer-covered [aria-label^="Germany:"]', 'outlineStyle')).outlineStyle === NO_OUTLINE);
  check('mouse click on DE: no map shape has an outline', (await shapesWithOutline(focusPage)).length === 0, (await shapesWithOutline(focusPage)).join());
  check('mouse click on DE: no focus stroke, the selection stroke is drawn', await focusPage.evaluate(() => !document.querySelector('.rm-outline-focus').hasAttribute('d')
    && document.querySelector('.rm-outline-selected').hasAttribute('d')));
  await focusPage.screenshot({ path: `${SHOTS}/desktop-de-selected-by-click.png` });
  await focusPage.close(); }
{ const keyPage = await openThemedMap({ colorScheme: 'dark' });
  const isGermanyFocused = () => keyPage.evaluate(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Germany:') === true);
  let presses = 0;
  while (!(await isGermanyFocused()) && presses < MAX_TAB_PRESSES) { await keyPage.keyboard.press('Tab'); presses += 1; }
  check('Tab reaches DE', await isGermanyFocused(), `${presses} presses`);
  check('keyboard focus on DE: outline-style none and the focus stroke follows the shape', await keyPage.evaluate(() => {
    const path = document.activeElement;
    const stroke = document.querySelector('.rm-outline-focus');
    return getComputedStyle(path).outlineStyle === 'none' && stroke.getAttribute('d') === path.getAttribute('d')
      && parseFloat(getComputedStyle(stroke).strokeWidth) > parseFloat(getComputedStyle(document.querySelector('.rm-outline-selected')).strokeWidth);
  }));
  check('keyboard focus on DE: no map shape has an outline', (await shapesWithOutline(keyPage)).length === 0);
  await keyPage.screenshot({ path: `${SHOTS}/dark-desktop-de-focused-by-keyboard.png` });
  await keyPage.close(); }

// City labels: colliding labels are hidden, their dots stay
const RUHR_POINT = [7.2, 51.45];
const RUHR_ZOOM_ATTEMPTS = 20;
const RUHR_WHEEL_DELTA = -300;
const ALL_CITIES_LEVEL_CLASS = 'rm-level-2';
const VISIBLE_LABELS_MIN = 2;
/** Screen boxes of the city labels that are drawn (not display:none, not visibility:hidden), plus the HTML capital label. */
const visibleLabelBoxes = (pg) => pg.evaluate(() => [...document.querySelectorAll('.rm-city-label, .rm-capital-label')]
  .filter((element) => !element.hidden && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden')
  .map((element) => ({ text: element.textContent, ...element.getBoundingClientRect().toJSON() })));
const boxesOverlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const overlappingPairs = (boxes) => boxes.flatMap((box, index) => boxes.slice(index + 1)
  .filter((other) => boxesOverlap(box, other)).map((other) => `${box.text}/${other.text}`));
{ const labelPage = await openThemedMap({ colorScheme: 'light' });
  for (let attempt = 0; attempt < RUHR_ZOOM_ATTEMPTS; attempt += 1) {
    const [x, y, width, height] = await readViewBox(labelPage);
    const svgBox = await labelPage.locator('.rm-svg').boundingBox();
    const [ruhrX, ruhrY] = mercator(RUHR_POINT);
    await labelPage.mouse.move(svgBox.x + ((ruhrX - x) / width) * svgBox.width, svgBox.y + ((ruhrY - y) / height) * svgBox.height);
    await labelPage.mouse.wheel(0, RUHR_WHEEL_DELTA);
    await labelPage.waitForTimeout(SETTLE_MS);
    const isDeepEnough = (await labelPage.locator('.rm-svg').getAttribute('class')).includes(ALL_CITIES_LEVEL_CLASS)
      && (await labelPage.locator('.rm-city-t3').count()) > 0;
    if (isDeepEnough) break;
  }
  await labelPage.waitForTimeout(SETTLE_MS);
  const labelCount = await labelPage.locator('.rm-city-label').count();
  const boxes = await visibleLabelBoxes(labelPage);
  check('Ruhr zoom reaches the level where tier-3 cities show', (await labelPage.locator('.rm-city-t3').count()) > 0);
  check('Ruhr: some city labels are hidden by collision avoidance, some stay', boxes.length >= VISIBLE_LABELS_MIN && boxes.length < labelCount, `${boxes.length} of ${labelCount}`);
  check('Ruhr: no two visible city labels intersect', overlappingPairs(boxes).length === 0, overlappingPairs(boxes).join(', '));
  check('Ruhr: every city keeps its dot when its label is hidden', (await labelPage.locator('.rm-city').count()) > labelCount);
  await labelPage.screenshot({ path: `${SHOTS}/desktop-ruhr-labels.png` });
  await labelPage.close(); }

// Operator default overrides (/map/defaults.json): an override wins over the rules file; a failing endpoint keeps the file defaults
{ const DEFAULTS_FIXTURE = process.env.RM_DEFAULTS_FIXTURE;
  if (!DEFAULTS_FIXTURE) throw new Error('RM_DEFAULTS_FIXTURE is required; run scripts/test-rights-map-browser.sh');
  const OVERRIDDEN_CODE = 'no';
  const FILE_CODE = 'yes';
  const SERVER_FAILURE_FIXTURE = 'FAIL';
  const openTpTopic = async (serverError) => {
    const defaultsPage = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    // A 500 makes Chromium log "Failed to load resource" by itself, so only the override page joins the console audit.
    if (!serverError) defaultsPage.on('console', (m) => { if (['error', 'warning'].includes(m.type())) consoleProblems.push(`defaults ${m.type()}: ${m.text()}`); });
    const pageErrors = [];
    defaultsPage.on('pageerror', (error) => pageErrors.push(error.message));
    await defaultsPage.goto(`${BASE}/map/`);
    await defaultsPage.waitForSelector('.rm-country');
    await defaultsPage.getByRole('button', { name: /Ukrainian temporary protection/ }).click();
    const pressed = async (code) => (await defaultsPage.locator(`[data-focus-key="fact:ua_military_obligation:${code}"]`).getAttribute('aria-pressed')) === 'true';
    const result = { overridden: await pressed(OVERRIDDEN_CODE), fromFile: await pressed(FILE_CODE), pageErrors };
    await defaultsPage.context().close();
    return result;
  };
  fs.writeFileSync(DEFAULTS_FIXTURE, JSON.stringify({ 'ua-tp': { nat: 'UA', ua_military_obligation: OVERRIDDEN_CODE } }));
  const overridden = await openTpTopic(false);
  check('operator default overrides the rules-file default on topic open', overridden.overridden && !overridden.fromFile);
  fs.writeFileSync(DEFAULTS_FIXTURE, SERVER_FAILURE_FIXTURE);
  const failed = await openTpTopic(true);
  check('endpoint 500: rules-file defaults still apply and the map works', failed.fromFile && !failed.overridden && failed.pageErrors.length === 0, failed.pageErrors.join(' | '));
  fs.rmSync(DEFAULTS_FIXTURE, { force: true }); }

// Disputed overlay and staleness: a stub status endpoint and a fixed browser clock
if (!shouldSkipGroup('disputed overlay and staleness')) { const STATUS_MODE_DISPUTED = 'disputed';
  const STATUS_MODE_EMPTY = 'empty';
  const STATUS_MODE_FAILING = 'failing';
  const MS_PER_DAY = 86400000;
  const STALE_AFTER_DAYS = 30;
  const HU_LAST_VERIFIED_MS = Date.UTC(2026, 9, 22);
  const FAILING_TEXT = /could not|error|failed/i;
  const setStatusMode = (mode) => fetch(`${BASE}/__test/status-mode?mode=${mode}`);
  /** Opens a fresh page (own context, optional fixed clock), picks the TP topic and selects Hungary. */
  const openHungary = async ({ nowMs } = {}) => {
    const pageContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pg = await pageContext.newPage();
    const problems = [];
    pg.on('console', (message) => { if (['error', 'warning'].includes(message.type())) problems.push(message.text()); });
    pg.on('pageerror', (error) => problems.push(error.message));
    if (nowMs !== undefined) await pg.addInitScript((fixed) => { Date.now = () => fixed; }, nowMs);
    await pg.goto(`${BASE}/map/`);
    await pg.waitForSelector('.rm-country');
    await pg.getByRole('button', { name: /Ukrainian temporary protection/ }).click();
    await pg.locator('.rm-layer-covered [aria-label^="Hungary:"]').first().click();
    return { pg, problems, pageContext, hungary: pg.locator('.rm-layer-covered [aria-label^="Hungary:"]').first() };
  };

  await setStatusMode(STATUS_MODE_DISPUTED);
  const disputed = await openHungary();
  check('disputed overlay: the HU path carries rm-disputed', ((await disputed.hungary.getAttribute('class')) ?? '').includes('rm-disputed'));
  check('disputed overlay: the status fill class is unchanged', ((await disputed.hungary.getAttribute('class')) ?? '').includes('rm-status-ok'));
  check('disputed overlay: only Hungary is marked', (await disputed.pg.locator('.rm-layer-covered .rm-disputed').count()) === 1);
  check('disputed overlay: dotted outline paths are drawn', (await disputed.pg.locator('.rm-outline-disputed[d]').count()) === 1
    && (await disputed.pg.locator('.rm-outline-disputed-under[d]').count()) === 1);
  check('disputed overlay: aria-label names the open report', (await disputed.hungary.getAttribute('aria-label')).endsWith('open report'));
  check('disputed overlay: legend entry "Open report" exists', (await disputed.pg.locator('.rm-legend-item', { hasText: 'Open report' }).count()) === 1);
  check('disputed overlay: the detail card shows the moderator-review note', (await disputed.pg.locator('.rm-disputed-note').textContent()).includes('Open reports about this rule are waiting for moderator review'));
  check('disputed overlay: no stale warning for a fresh rule', (await disputed.pg.locator('.rm-detail .rm-warning', { hasText: 'out of date' }).count()) === 0);
  await disputed.pg.screenshot({ path: `${SHOTS}/desktop-disputed-overlay.png` });
  await disputed.pg.getByRole('button', { name: 'All topics' }).click();
  await disputed.pg.getByRole('button', { name: /Blue Card/ }).click();
  check('disputed overlay: another topic shows no overlay or legend entry', (await disputed.pg.locator('.rm-layer-covered .rm-disputed').count()) === 0
    && (await disputed.pg.locator('.rm-legend-item', { hasText: 'Open report' }).count()) === 0);
  check('disputed overlay: no console problems', disputed.problems.length === 0, disputed.problems.join(' | '));
  await disputed.pageContext.close();

  await setStatusMode(STATUS_MODE_FAILING);
  const failing = await openHungary();
  check('status fetch failing: the map renders with no overlay and no error text', (await failing.pg.locator('.rm-layer-covered .rm-disputed').count()) === 0
    && (await failing.hungary.getAttribute('class')).includes('rm-status-ok')
    && !FAILING_TEXT.test(await failing.pg.locator('.rm-detail, .rm-legend, .rm-map-message').allTextContents().then((texts) => texts.join(' '))));
  // Chromium logs the 500 itself; anything else (a thrown error) would be a real problem.
  check('status fetch failing: no page error', failing.problems.every((problem) => problem.includes('status of 500')), failing.problems.join(' | '));
  await failing.pageContext.close();

  await setStatusMode(STATUS_MODE_EMPTY);
  const boundaryDays = (days) => HU_LAST_VERIFIED_MS + days * MS_PER_DAY;
  const atBoundary = await openHungary({ nowMs: boundaryDays(STALE_AFTER_DAYS) });
  check('staleness: exactly 30 days old shows no warning (boundary)', (await atBoundary.pg.locator('.rm-detail', { hasText: 'out of date' }).count()) === 0);
  await atBoundary.pageContext.close();
  const pastBoundary = await openHungary({ nowMs: boundaryDays(STALE_AFTER_DAYS + 1) });
  const staleWarning = pastBoundary.pg.locator('.rm-detail .rm-warning[role=status]', { hasText: 'out of date' });
  check('staleness: 31 days old shows the warning with the day count', (await staleWarning.textContent()).includes('Last verified 31 days ago — may be out of date'));
  await pastBoundary.pg.screenshot({ path: `${SHOTS}/desktop-stale-warning.png` });
  await pastBoundary.pageContext.close(); }

// Smoke: choosing the authority topic swaps the country map for the district layer.
{ const MIN_DISTRICT_PATHS = 380;
  const districtContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const districtPage = await districtContext.newPage();
  districtPage.on('request', (r) => requests.push(r.url()));
  districtPage.on('console', (m) => { if (['error', 'warning'].includes(m.type())) consoleProblems.push(`${m.type()}: ${m.text()}`); });
  districtPage.on('pageerror', (e) => consoleProblems.push(`pageerror: ${e.message}`));
  districtPage.on('requestfailed', (r) => consoleProblems.push(`requestfailed: ${r.url()}`));
  await districtPage.goto(`${BASE}/map/`);
  await districtPage.waitForSelector('.rm-country');
  await districtPage.getByRole('button', { name: /Naturalisation/ }).click();
  await districtPage.waitForSelector('.rm-layer-districts .rm-district');
  const districtCount = await districtPage.locator('.rm-layer-districts .rm-district').count();
  check('districts: about 400 district paths after choosing the topic', districtCount >= MIN_DISTRICT_PATHS, String(districtCount));
  check('districts: svg is in district mode', (await districtPage.locator('svg.rm-mode-districts').count()) === 1);
  check('districts: the other countries are inert context',
    (await districtPage.locator('.rm-layer-covered .rm-country-context[role]').count()) === 0);
  const METRIC_RADIO_COUNT = 3;
  const LEGEND_ROW_COUNT = 7;
  const radios = districtPage.getByRole('radio');
  check('districts: the metric switch has three radios with the first checked',
    (await radios.count()) === METRIC_RADIO_COUNT && (await radios.first().getAttribute('aria-checked')) === 'true');
  await radios.first().focus();
  await districtPage.keyboard.press('ArrowRight');
  check('districts: ArrowRight checks the next metric and keeps focus on it',
    (await radios.nth(1).getAttribute('aria-checked')) === 'true' && (await radios.nth(1).evaluate((node) => node === document.activeElement)));
  check('districts: the legend lists five buckets, no data and unconfirmed', (await districtPage.locator('.rm-legend .rm-legend-item').count()) === LEGEND_ROW_COUNT);
  check('districts: the finder says "Find a district" and lists the districts',
    (await districtPage.locator('.rm-finder').innerText()).includes('Find a district') && (await districtPage.locator('#rm-finder-select option').count()) > MIN_DISTRICT_PATHS);
  await checkBkgFooter(districtPage, 'districts');
  await districtPage.screenshot({ path: `${SHOTS}/desktop-districts-smoke.png` });
  // Authority card: opens on a click, takes focus, lists the figures, and Escape hands focus back to the path.
  const authorityCard = districtPage.locator('.rm-authority-card');
  const berlinPath = districtPage.locator('.rm-layer-districts .rm-district[aria-label^="Berlin"]');
  check('authority card: hidden until a district is selected', !(await authorityCard.isVisible()));
  await berlinPath.click();
  await authorityCard.waitFor({ state: 'visible' });
  check('authority card: click opens it with the authority name in the focused heading',
    await districtPage.evaluate(() => document.activeElement?.tagName === 'H2' && document.activeElement.closest('.rm-authority-card') !== null
      && document.activeElement.textContent.includes('Landesamt')));
  check('authority card: three time rows, evidence and the disclaimer',
    (await authorityCard.locator('.rm-time-row').count()) === 3 && (await authorityCard.locator('.rm-evidence-item').count()) >= 1
    && (await authorityCard.innerText()).includes('General information, not legal advice.'));
  check('authority card: the country card stays hidden', !(await districtPage.locator('.rm-detail:not(.rm-authority-card)').isVisible()));
  await districtPage.screenshot({ path: `${SHOTS}/desktop-authority-card.png` });
  await districtPage.keyboard.press('Escape');
  check('authority card: Escape closes it and focus returns to the district path',
    !(await authorityCard.isVisible())
    && await districtPage.evaluate(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Berlin') === true));
  await districtContext.close(); }

// Colours: bucket ramp, no-data hatch, unconfirmed stripes, focus ring and phone layout, light and dark
const MIN_BUCKET_LUMINANCE_STEP = 0.04;
const BUCKET_COUNT = 5;
const BUCKET_INDEXES = [...Array(BUCKET_COUNT).keys()];
const PHONE_VIEWPORT = { width: PHONE_WIDTH, height: 844 };
const URL_FILL_PREFIX = 'url(';
const DISTRICT_LAYER_SELECTOR = '.rm-layer-districts';
/** Computed fill of a probe district path carrying `classes`, built with DOM calls inside the district layer. */
const districtFill = (pg, classes) => pg.evaluate(([layerSelector, className]) => {
  const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  probe.setAttribute('class', `rm-district ${className}`);
  document.querySelector(layerSelector).append(probe);
  const { fill } = getComputedStyle(probe);
  probe.remove();
  return fill;
}, [DISTRICT_LAYER_SELECTOR, classes]);
const openDistrictMap = async (contextOptions) => {
  const districtColourContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...contextOptions });
  const districtColourPage = await districtColourContext.newPage();
  districtColourPage.on('console', (m) => { if (['error', 'warning'].includes(m.type())) consoleProblems.push(`colours ${m.type()}: ${m.text()}`); });
  await districtColourPage.goto(`${BASE}/map/`);
  await districtColourPage.waitForSelector('.rm-country');
  await districtColourPage.getByRole('button', { name: /Naturalisation/ }).click();
  await districtColourPage.waitForSelector('.rm-layer-districts .rm-district');
  return districtColourPage;
};
/** Bucket 0 to 4 fills are strictly darker and each step is visible; no-data and unconfirmed are patterns, not flat colours. */
const checkBucketColours = async (pg, label) => {
  const fills = await Promise.all(BUCKET_INDEXES.map((bucket) => districtFill(pg, `rm-bucket-${bucket}`)));
  const luminances = fills.map(relativeLuminance);
  const steps = luminances.slice(1).map((value, index) => luminances[index] - value);
  check(`${label}: bucket fills 0 to 4 get strictly darker by at least ${MIN_BUCKET_LUMINANCE_STEP}`,
    steps.every((step) => step >= MIN_BUCKET_LUMINANCE_STEP), `${fills.join(' ')} steps=${steps.map((step) => step.toFixed(3)).join('/')}`);
  const noDataFill = await districtFill(pg, 'rm-nodata');
  check(`${label}: no-data is a hatch pattern, distinguishable from bucket 0`, noDataFill.startsWith(URL_FILL_PREFIX) && noDataFill !== fills[0], noDataFill);
  const unconfirmedFills = await Promise.all(BUCKET_INDEXES.map((bucket) => districtFill(pg, `rm-bucket-${bucket} rm-unconfirmed`)));
  check(`${label}: every unconfirmed bucket is its own stripe pattern`,
    unconfirmedFills.every((fill) => fill.startsWith(URL_FILL_PREFIX)) && new Set(unconfirmedFills).size === BUCKET_COUNT, unconfirmedFills.join(' '));
};
{ const lightColours = await openDistrictMap({ colorScheme: 'light' });
  await checkBucketColours(lightColours, 'light districts');
  await lightColours.keyboard.press('Tab');
  await lightColours.locator('.rm-layer-districts .rm-district').first().focus();
  check('light districts: the focus ring on a district path is a visible stroke', await lightColours.evaluate(() => {
    const style = getComputedStyle(document.activeElement);
    return document.activeElement.classList.contains('rm-district') && style.outlineStyle === 'none'
      && parseFloat(style.strokeWidth) > parseFloat(getComputedStyle(document.querySelector('.rm-outline-selected')).strokeWidth);
  }));
  await lightColours.screenshot({ path: `${SHOTS}/desktop-districts-light.png` });
  await lightColours.context().close(); }
{ const darkColours = await openDistrictMap({ colorScheme: 'dark' });
  check('dark districts: the dark theme is on', (await styleOf(darkColours, SEA_SELECTOR, 'backgroundColor')).backgroundColor === DARK_SEA_RGB);
  await checkBucketColours(darkColours, 'dark districts');
  await darkColours.screenshot({ path: `${SHOTS}/desktop-districts-dark.png` });
  await darkColours.context().close(); }
{ const phoneColours = await openDistrictMap({ viewport: PHONE_VIEWPORT });
  const layout = await phoneColours.evaluate(() => {
    const mapBox = document.querySelector('.rm-svg').getBoundingClientRect();
    const legendBox = document.querySelector('.rm-legend')?.getBoundingClientRect();
    return { mapRight: mapBox.right, legendRight: legendBox?.right ?? 0, viewportWidth: window.innerWidth, pageWidth: document.documentElement.scrollWidth };
  });
  check('phone districts: the map fits the screen width and the page does not scroll sideways',
    layout.mapRight <= layout.viewportWidth + LAYOUT_TOLERANCE_PX && layout.pageWidth <= layout.viewportWidth + LAYOUT_TOLERANCE_PX, JSON.stringify(layout));
  check('phone districts: the legend, when drawn, stays inside the screen width', layout.legendRight <= layout.viewportWidth + LAYOUT_TOLERANCE_PX, JSON.stringify(layout));
  await phoneColours.screenshot({ path: `${SHOTS}/phone-districts.png` });
  await phoneColours.context().close(); }

// End to end: topic switching, the pilot switch, back to Europe, keyboard, finder, checklist and phone sheet.
const NATURALISATION_TOPIC = /Naturalisation/;
const PILOT_BADGE_TEXT = 'Germany pilot';
const DISTRICT_DATA_FILES = ['l2/DE.json', 'authorities.de.v1.json'];
const TOPIC_BUTTONS_WITH_PILOT = 6;
const TOPIC_BUTTONS_WITHOUT_PILOT = 5;
const DISTRICT_PATHS_MIN = 390;
const DISTRICT_PATHS_MAX = 410;
const ACTIVE_METRIC = 'total';
const PUBLISHABLE_SOURCES = ['official', 'press', 'estimate'];
const COMMUNITY_SOURCE = 'community';
const COMMUNITY_MIN_REPORTS = 5;
const AUTHORITIES_PATH = path.join(REPO_ROOT, 'web', 'static', 'public', 'rights_map', 'data', 'authorities.de.v1.json');
const DISTRICTS_PATH = path.join(REPO_ROOT, 'web', 'static', 'geo', 'v1', 'l2', 'DE.json');
const DUPLICATE_NAME_SUFFIX = { city: 'city', district: 'district' };

/** Whether a figure may colour a district: a number from a published source, or a community figure from enough reports. */
const isPublishableFigure = (figure) => Number.isFinite(figure?.lo)
  && (PUBLISHABLE_SOURCES.includes(figure.src) || (figure.src === COMMUNITY_SOURCE && figure.n >= COMMUNITY_MIN_REPORTS));

/**
 * Titles of the districts that must have a non-hatch fill, computed from the shipped files the page loads:
 * every district covered by an authority with a publishable figure for the metric. A district name shared by
 * a city and a district carries its type in brackets, as on the map.
 */
function expectedPaintedDistrictLabels(metric) {
  const { authorities } = JSON.parse(fs.readFileSync(AUTHORITIES_PATH, 'utf8'));
  const { features } = JSON.parse(fs.readFileSync(DISTRICTS_PATH, 'utf8'));
  const paintedAgs = new Set(authorities.filter((a) => isPublishableFigure(a.times?.[metric])).flatMap((a) => a.covers));
  const nameCounts = new Map();
  for (const { properties } of features) nameCounts.set(properties.name, (nameCounts.get(properties.name) ?? 0) + 1);
  return features.filter(({ properties }) => paintedAgs.has(properties.ags)).map(({ properties }) => {
    const suffix = DUPLICATE_NAME_SUFFIX[properties.type];
    return nameCounts.get(properties.name) > 1 && suffix ? `${properties.name} (${suffix})` : properties.name;
  });
}
const NO_DATA_CLASS = 'rm-nodata';
const BUCKET_ZERO_CLASS = 'rm-bucket-0';
const BKG_CREDIT = '© BKG (2026)';
const METRIC_NAME = { total: 'Total', wait: 'Wait to apply', proc: 'Processing' };
const FIXED_TODAY = '2026-10-15T12:00:00Z';
const RESIDENCE_YEAR = '2022';
const PASSPORT_VALID_UNTIL = '03/2028';
const LEIPZIG_CITY_AGS = '14713';
const BERLIN_AGS = '11000';
const LEIPZIG_CITY_LABEL = 'Leipzig (city)';
const LEIPZIG_CARD_HEADING = 'Stadt Leipzig';
const BERLIN_CARD_HEADING = 'Landesamt für Einwanderung';
const STALE_FIGURE_PATTERN = /Official figure \d+ months? old/;
const PASSPORT_DECISION_WARNING = 'before the expected decision';
const SHEET_BOTTOM_TOLERANCE_PX = 2;
const GERMAN_REQUIREMENT_TITLE = 'German B1';
// Shipped authorities: one with only a Total figure, one with Wait or Processing but no Total (finder option text).
const TOTAL_ONLY_DISTRICT = 'Dresden';
const TOTAL_EMPTY_DISTRICT = 'Rostock (district)';
const AUTHORITY_REPORT_BUTTON_NAME ='Report outdated info';
const REPORT_WIRE_KEYS = ['topic_id', 'country', 'kind', 'source_url', 'description', 'since_month', 'token', 'counter'];
// Spelled as in web/static/geo/v1/cities-t1.json (Natural Earth names: English Munich, German Köln).
const GERMANY_BIG_CITY_LABELS = ['Munich', 'Hamburg', 'Köln', 'Berlin'];

const openNaturalisationPage = async (contextOptions, { pilotAttribute, experiencesAttribute, communityAttribute } = {}) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...contextOptions });
  // A Date subclass instead of the Playwright clock: the clock also fakes timers and animation frames.
  await context.addInitScript((fixedMs) => {
    const RealDate = Date;
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [fixedMs])); }
      static now() { return fixedMs; }
    };
  }, Date.parse(FIXED_TODAY));
  const pg = await context.newPage();
  const own = [];
  pg.on('request', (r) => { requests.push(r.url()); own.push(r.url()); });
  pg.on('console', (m) => { if (['error', 'warning'].includes(m.type())) consoleProblems.push(`e2e ${m.type()}: ${m.text()}`); });
  pg.on('pageerror', (e) => consoleProblems.push(`e2e pageerror: ${e.message}`));
  if (pilotAttribute !== undefined || experiencesAttribute !== undefined || communityAttribute !== undefined) {
    await pg.route(`${BASE}/map/`, async (route) => {
      const response = await route.fetch();
      let body = await response.text();
      if (pilotAttribute !== undefined) body = body.replace('data-de-pilot-enabled="true"', `data-de-pilot-enabled="${pilotAttribute}"`);
      if (experiencesAttribute !== undefined) body = body.replace('data-experiences-enabled="true"', `data-experiences-enabled="${experiencesAttribute}"`);
      if (communityAttribute !== undefined) body = body.replace('data-community-enabled="true"', `data-community-enabled="${communityAttribute}"`);
      await route.fulfill({ response, body });
    });
  }
  await pg.goto(`${BASE}/map/`);
  await pg.waitForSelector('.rm-country');
  return { pg, context, own };
};
const requestedDistrictData = (own) => own.filter((url) => DISTRICT_DATA_FILES.some((file) => url.includes(file)));

{ // Pilot switch off: the topic is unreachable and nothing of it is requested.
  const off = await openNaturalisationPage({}, { pilotAttribute: 'false' });
  check('pilot off: the shell publishes the switch as false', (await off.pg.locator('#rights-map').getAttribute('data-de-pilot-enabled')) === 'false');
  check('pilot off: no naturalisation topic and five topic buttons', (await off.pg.locator('.rm-topic').count()) === TOPIC_BUTTONS_WITHOUT_PILOT
    && (await off.pg.getByRole('button', { name: NATURALISATION_TOPIC }).count()) === 0);
  check('pilot off: no district data was requested', requestedDistrictData(off.own).length === 0, requestedDistrictData(off.own).join(' '));
  await off.context.close(); }

{ const { pg, context, own } = await openNaturalisationPage({});
  const europeWidth = (await readViewBox(pg))[2];
  const topicButton = pg.getByRole('button', { name: NATURALISATION_TOPIC });
  check('pilot on: step 1 lists six topics, naturalisation carries the "Germany pilot" badge',
    (await pg.locator('.rm-topic').count()) === TOPIC_BUTTONS_WITH_PILOT && (await topicButton.innerText()).includes(PILOT_BADGE_TEXT));
  check('before the topic is picked no district data is requested', requestedDistrictData(own).length === 0, requestedDistrictData(own).join(' '));
  check('before the topic is picked the footer has no BKG credit', !(await pg.locator('.rm-attribution').innerText()).includes(BKG_CREDIT));
  await topicButton.click();
  await pg.waitForSelector('.rm-layer-districts .rm-district');
  await pg.waitForTimeout(SETTLE_MS);
  const districtPaths = pg.locator('.rm-layer-districts .rm-district');
  const pathCount = await districtPaths.count();
  check('after the pick the map shows about 400 district paths', pathCount >= DISTRICT_PATHS_MIN && pathCount <= DISTRICT_PATHS_MAX, String(pathCount));
  const germanyBox = await readViewBox(pg);
  check('after the pick the view is Germany (viewBox width under half of Europe)', germanyBox[2] < europeWidth / 2, `${germanyBox[2]} vs ${europeWidth}`);
  const visibleCityLabels = await pg.evaluate(() => [...document.querySelectorAll('.rm-layer-cities .rm-city-label')]
    .filter((node) => { const style = getComputedStyle(node); return style.display !== 'none' && style.visibility !== 'hidden'; })
    .map((node) => node.textContent));
  check(`Germany view: the million-plus cities and the capital are labelled (${GERMANY_BIG_CITY_LABELS.join(', ')})`,
    GERMANY_BIG_CITY_LABELS.every((name) => visibleCityLabels.includes(name)), visibleCityLabels.join(', '));
  check('after the pick the footer carries the BKG credit', (await pg.locator('.rm-attribution').innerText()).includes(BKG_CREDIT));
  await checkBkgFooter(pg, 'after the pick');
  const withData = await districtPaths.evaluateAll((paths, noData) => paths.filter((p) => !p.classList.contains(noData)).map((p) => p.querySelector('title').textContent), NO_DATA_CLASS);
  const expectedPainted = expectedPaintedDistrictLabels(ACTIVE_METRIC);
  check('shipped data gives the map something to paint (the expectation below is not vacuous)', expectedPainted.length > 0, String(expectedPainted.length));
  check('exactly the districts covered by a publishable figure have a non-hatch fill, every other district has the hatch (a community figure under five reports never colours)',
    JSON.stringify([...withData].sort()) === JSON.stringify([...expectedPainted].sort()), `${withData.length} painted, ${expectedPainted.length} expected`);

  const berlin = pg.locator('.rm-layer-districts .rm-district[aria-label^="Berlin"]');
  const leipzigCity = pg.locator(`.rm-layer-districts .rm-district[aria-label^="${LEIPZIG_CITY_LABEL}"]`);
  const fillOf = (locator) => locator.evaluate((node) => getComputedStyle(node).fill);
  const classOf = async (locator) => (await locator.getAttribute('class')) ?? '';
  const factOnPage = (id, code) => pg.locator(`[data-focus-key="fact:${id}:${code}"]`);
  const metricRadio = (key) => pg.getByRole('radio', { name: METRIC_NAME[key] });
  const berlinFills = {};
  const leipzigClasses = {};
  for (const key of Object.keys(METRIC_NAME)) {
    await metricRadio(key).click();
    berlinFills[key] = await fillOf(berlin);
    leipzigClasses[key] = await classOf(leipzigCity);
    if (key === 'wait') check('metric Wait: Berlin is bucket 0', (await classOf(berlin)).includes(BUCKET_ZERO_CLASS), await classOf(berlin));
  }
  check('the metric switch changes the fill of Berlin (Wait differs from Total and Processing)',
    berlinFills.wait !== berlinFills.total && berlinFills.wait !== berlinFills.proc, JSON.stringify(berlinFills));
  check('the metric switch changes Leipzig city: Processing has no data, Total has', leipzigClasses.proc.includes(NO_DATA_CLASS)
    && !leipzigClasses.total.includes(NO_DATA_CLASS), JSON.stringify(leipzigClasses));
  await metricRadio('total').click();

  // Leipzig city: the view narrows, the card shows the stale text and, with the passport and residence inputs, the passport warning.
  const overviewWidth = (await readViewBox(pg))[2];
  await leipzigCity.click();
  await pg.waitForTimeout(SETTLE_MS);
  const card = pg.locator('.rm-authority-card');
  check('clicking Leipzig city keeps the zoom', (await readViewBox(pg))[2] === overviewWidth);
  check('the card shows "Stadt Leipzig" and the stale official figure', (await card.locator('h2').innerText()) === LEIPZIG_CARD_HEADING
    && STALE_FIGURE_PATTERN.test(await card.innerText()), await card.innerText());
  check('no passport warning before the passport is answered', (await card.locator('.rm-warning').count()) === 0);

  // Report button on the authority card: same dialog, authority named in heading and description, same wire keys.
  if (!shouldSkipGroup('authority card report dialog')) { const leipzigId = JSON.parse(fs.readFileSync(AUTHORITIES_PATH, 'utf8')).authorities.find((entry) => entry.name === LEIPZIG_CARD_HEADING).id;
    const expectedPrefill = `Authority: ${LEIPZIG_CARD_HEADING} (${leipzigId})\n\n`;
    const reportDialog = pg.locator('.rm-report-dialog');
    await fetch(`${BASE}/__test/report-mode?mode=accept`);
    const authorityReport = card.getByRole('button', { name: AUTHORITY_REPORT_BUTTON_NAME });
    check('authority card: the "Report outdated info" button is present', await authorityReport.isVisible());
    await authorityReport.click();
    await reportDialog.waitFor();
    check('authority card report: the dialog heading names the authority', (await reportDialog.locator('h2').innerText()).includes(LEIPZIG_CARD_HEADING));
    check('authority card report: the description starts with the pre-fill line and a blank line', (await reportDialog.locator('textarea').inputValue()) === expectedPrefill
      && (await reportDialog.locator('.rm-report-counter').innerText()) === `${expectedPrefill.length} / 1000`, JSON.stringify(await reportDialog.locator('textarea').inputValue()));
    await pg.screenshot({ path: `${SHOTS}/desktop-authority-report-dialog.png` });
    await reportDialog.locator('textarea').press('Control+End');
    await reportDialog.locator('textarea').pressSequentially('Processing took 9 months');
    await reportDialog.getByLabel('I experienced it differently').check();
    await reportDialog.getByRole('button', { name: 'Send report' }).click();
    await reportDialog.getByRole('heading', { name: 'Thank you' }).waitFor();
    const [sentReport] = (await (await fetch(`${BASE}/__test/reports`)).json()).submissions;
    check('authority card report: payload keys are exactly the allowed set', JSON.stringify(Object.keys(sentReport).sort()) === JSON.stringify([...REPORT_WIRE_KEYS].sort()), Object.keys(sentReport).join(','));
    check('authority card report: topic de-naturalisation, country DE, description keeps the pre-fill line then the typed text',
      sentReport.topic_id === 'de-naturalisation' && sentReport.country === 'DE' && sentReport.kind === 'experienced_differently'
      && sentReport.description === `${expectedPrefill}Processing took 9 months`, JSON.stringify(sentReport));
    await reportDialog.getByRole('button', { name: 'Close' }).click(); }

  // Time blocks: Total is the main block, Wait and Processing hide behind its "Details" button.
  { const selectByOptionText = async (text) => {
      const value = await pg.locator('#rm-finder-select option').evaluateAll((options, wanted) => options.find((option) => option.textContent.includes(wanted))?.value, text);
      await pg.selectOption('#rm-finder-select', value);
      await pg.waitForTimeout(SETTLE_MS);
    };
    const detailsButton = card.getByRole('button', { name: 'Details' });
    const detailsPanel = card.locator('.rm-time-details');
    const detailsState = async () => ({ expanded: await detailsButton.getAttribute('aria-expanded'), shown: await detailsPanel.isVisible(),
      controls: await detailsButton.getAttribute('aria-controls'), panelId: await detailsPanel.getAttribute('id'), totalText: await card.locator('.rm-time-total > .rm-time-value').innerText() });
    await selectByOptionText(TOTAL_ONLY_DISTRICT);
    const collapsed = await detailsState();
    check('time blocks: Total only is collapsed by default, Wait and Processing are hidden', collapsed.expanded === 'false' && !collapsed.shown
      && collapsed.controls === collapsed.panelId && collapsed.totalText !== 'No data', JSON.stringify(collapsed));
    await pg.screenshot({ path: `${SHOTS}/desktop-authority-details-collapsed.png` });
    await detailsButton.click();
    const expanded = await detailsState();
    check('time blocks: clicking Details shows Wait and Processing and sets aria-expanded=true', expanded.expanded === 'true' && expanded.shown
      && (await detailsPanel.locator('.rm-time-row').count()) === 2 && (await detailsPanel.innerText()).includes('No data'), JSON.stringify(expanded));
    await pg.screenshot({ path: `${SHOTS}/desktop-authority-details-open.png` });
    await pg.keyboard.press('Enter');
    check('time blocks: Enter on the focused Details button collapses it again', (await detailsState()).expanded === 'false');
    await selectByOptionText(TOTAL_EMPTY_DISTRICT);
    const opened = await detailsState();
    check('time blocks: Total empty with Wait or Processing known opens Details by default', opened.expanded === 'true' && opened.shown
      && opened.totalText === 'No data', JSON.stringify(opened));
    await pg.screenshot({ path: `${SHOTS}/desktop-authority-details-default-open.png` });
    await pg.selectOption('#rm-finder-select', LEIPZIG_CITY_AGS);
    await pg.waitForTimeout(SETTLE_MS); }
  const residenceInput = pg.locator('[data-focus-key="fact:de_residence_since"]');
  await residenceInput.fill(RESIDENCE_YEAR);
  await residenceInput.press('Enter');
  await factOnPage('passport', 'valid').click();
  const passportMonth = pg.locator('[data-focus-key="fact:passport_until"]');
  await passportMonth.fill(PASSPORT_VALID_UNTIL);
  await passportMonth.press('Enter');
  const warning = card.locator('.rm-warning');
  check('Leipzig city: the passport warning names the expected decision', (await warning.count()) === 1
    && (await warning.innerText()).includes(PASSPORT_DECISION_WARNING), await warning.allInnerTexts().then((texts) => texts.join(' | ')));
  await pg.screenshot({ path: `${SHOTS}/desktop-leipzig-warning.png` });

  // Finder: Berlin has no warning for the same answers.
  await pg.selectOption('#rm-finder-select', BERLIN_AGS);
  await pg.waitForTimeout(SETTLE_MS);
  check('the finder selects Berlin and its card shows no warning', (await card.locator('h2').innerText()) === BERLIN_CARD_HEADING
    && (await card.locator('.rm-warning').count()) === 0);

  // Checklist and estimate follow `german`.
  const germanRequirement = pg.locator('.rm-requirement', { hasText: GERMAN_REQUIREMENT_TITLE });
  await factOnPage('german', 'A2').click();
  const unmetClass = await classOf(germanRequirement);
  await factOnPage('german', 'B1').click();
  const metClass = await classOf(germanRequirement);
  check('the checklist flips the German requirement when `german` changes', unmetClass.includes('rm-requirement-unmet') && metClass.includes('rm-requirement-met'), `${unmetClass} -> ${metClass}`);
  check('the estimate card shows an earliest application date', (await pg.locator('.rm-estimate-headline').innerText()).length > 0);

  // Keyboard: Tab reaches a district, Enter opens the card, Escape closes it and returns focus.
  await pg.keyboard.press('Escape');
  await pg.evaluate(() => document.activeElement?.blur());
  let reachedDistrict = false;
  for (let press = 0; press < MAX_TAB_PRESSES && !reachedDistrict; press += 1) {
    await pg.keyboard.press('Tab');
    reachedDistrict = await pg.evaluate(() => document.activeElement?.classList.contains('rm-district') === true);
  }
  check('Tab reaches a district path', reachedDistrict);
  const focusedLabel = await pg.evaluate(() => document.activeElement.getAttribute('aria-label'));
  await pg.keyboard.press('Enter');
  await card.waitFor({ state: 'visible' });
  check('Enter on a district opens the authority card', await card.isVisible());
  await pg.keyboard.press('Escape');
  check('Escape closes the card and focus returns to the same district',
    !(await card.isVisible()) && (await pg.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === focusedLabel, focusedLabel);

  // Back to Europe.
  await pg.getByRole('button', { name: 'All topics' }).click();
  await pg.waitForTimeout(SETTLE_MS);
  const backWidth = (await readViewBox(pg))[2];
  check('All topics returns to the Europe view', Math.abs(backWidth - europeWidth) / europeWidth <= EUROPE_WIDTH_TOLERANCE, `${backWidth} vs ${europeWidth}`);
  check('after the way back the country paths are focusable again and the 74-country assertion holds',
    (await pg.locator('.rm-country').count()) === EXPECTED_COUNTRY_PATHS && (await country('Germany').getAttribute('tabindex')) === '0'
    && (await country('Germany').getAttribute('role')) === 'button');
  check('after the way back no district path is visible', await pg.evaluate(() => [...document.querySelectorAll('.rm-layer-districts .rm-district')]
    .every((p) => p.getClientRects().length === 0 && p.getAttribute('tabindex') === null)));
  check('after the way back the BKG credit is gone', !(await pg.locator('.rm-attribution').innerText()).includes(BKG_CREDIT));
  await context.close(); }

{ // Phone: the card is a bottom sheet and the metric switch is reachable.
  const phone = await openNaturalisationPage({ viewport: PHONE_VIEWPORT });
  const { pg } = phone;
  await pg.getByRole('button', { name: NATURALISATION_TOPIC }).click();
  await pg.waitForSelector('.rm-layer-districts .rm-district');
  await pg.getByRole('button', { name: 'Legend & sources' }).click();
  const radio = pg.getByRole('radio', { name: METRIC_NAME.wait });
  await radio.click();
  check('phone: the metric switch is reachable and switches', (await radio.getAttribute('aria-checked')) === 'true');
  await pg.keyboard.press('Escape');
  await pg.selectOption('#rm-finder-select', LEIPZIG_CITY_AGS, { force: true });
  const sheet = pg.locator('.rm-authority-card');
  await sheet.waitFor({ state: 'visible' });
  const box = await sheet.boundingBox();
  const viewport = pg.viewportSize();
  check('phone: the authority card is a bottom sheet spanning the screen width', box !== null && box.x <= LAYOUT_TOLERANCE_PX
    && box.width >= viewport.width - LAYOUT_TOLERANCE_PX && Math.abs(box.y + box.height - viewport.height) <= SHEET_BOTTOM_TOLERANCE_PX, JSON.stringify(box));
  await pg.screenshot({ path: `${SHOTS}/phone-authority-sheet.png` });
  await phone.context.close(); }

// "Share my experience" on the authority card: button position and colour, dialog, validation and the exact wire keys.
const EXPERIENCE_BUTTON_NAME = 'Share my experience';
const EXPERIENCE_PRIVACY_LINK_LABEL = 'privacy notice for experiences';
const EXPERIENCE_PRIVACY_PATH = '/map/experience-privacy/';
const EXPERIENCE_FORM_NOTICE = 'We use your answer only for the waiting times shown on the map, and only once at least 5 people have answered for this authority. '
  + `Please don't add anything that identifies you. Details: ${EXPERIENCE_PRIVACY_LINK_LABEL}.`;
const EXPERIENCE_WIRE_KEYS = ['topic_id', 'authority_id', 'certificate_month', 'wait_months', 'processing_months', 'token', 'counter'];
const EXPERIENCE_FACT_IDS = new Set(JSON.parse(fs.readFileSync(RULES_PATH, 'utf8')).facts.map((fact) => fact.id));
const EXPERIENCE_SENT_MONTH = '2026-03';
const EXPERIENCE_TYPED_MONTH_DIGITS = '032026';
const EXPERIENCE_SHOWN_MONTH = '03/2026';
const EXPERIENCE_INVALID_MONTH_DIGITS = '132026';
const EXPERIENCE_SENT_WAIT = 3;
const EXPERIENCE_SENT_PROCESSING = 11;
const HEX_COLOUR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const HEX_RADIX = 16;
const BRAND_INK_HEX = '#12181F';
const brandToRgb = (hex) => {
  const match = HEX_COLOUR.exec(hex);
  return match ? `rgb(${match.slice(1).map((part) => Number.parseInt(part, HEX_RADIX)).join(', ')})` : hex;
};
const experienceState = async () => (await fetch(`${BASE}/__test/experiences`)).json();
const experienceLog = async () => (await experienceState()).submissions;
const openAuthorityCard = async (ags, contextOptions, options) => {
  const opened = await openNaturalisationPage(contextOptions, options);
  await opened.pg.getByRole('button', { name: NATURALISATION_TOPIC }).click();
  await opened.pg.waitForSelector('.rm-layer-districts .rm-district');
  await opened.pg.selectOption('#rm-finder-select', ags, { force: true }); // force: the finder is hidden on a phone
  await opened.pg.locator('.rm-authority-card').waitFor({ state: 'visible' });
  return opened;
};
const openLeipzigCard = (contextOptions, options) => openAuthorityCard(LEIPZIG_CITY_AGS, contextOptions, options);
const checkExperienceButton = async (pg, scheme) => {
  const card = pg.locator('.rm-authority-card');
  const button = card.getByRole('button', { name: EXPERIENCE_BUTTON_NAME });
  check(`experience (${scheme}): the "Share my experience" button is visible`, await button.isVisible());
  const [header, buttonBox, verification] = await Promise.all([
    card.locator('.rm-detail-header').boundingBox(), button.boundingBox(), card.locator('.rm-authority-mode').boundingBox()]);
  check(`experience (${scheme}): the button sits under the title block and above the verification row`,
    header.y + header.height <= buttonBox.y + LAYOUT_TOLERANCE_PX && buttonBox.y + buttonBox.height <= verification.y + LAYOUT_TOLERANCE_PX,
    JSON.stringify({ header, buttonBox, verification }));
  const colours = await pg.evaluate(() => {
    const element = document.querySelector('.rm-experience-button');
    return { fill: getComputedStyle(element).backgroundColor, ink: getComputedStyle(element).color,
      brand: getComputedStyle(document.querySelector('.rm-root')).getPropertyValue('--brand').trim() };
  });
  check(`experience (${scheme}): the button fill is the brand yellow token and its text is dark`,
    colours.fill === brandToRgb(colours.brand) && colours.ink === brandToRgb(BRAND_INK_HEX), JSON.stringify(colours));
  await pg.screenshot({ path: `${SHOTS}/desktop-authority-experience-button-${scheme}.png` });
};
const checkExperienceDialog = async (pg, scheme) => {
  const card = pg.locator('.rm-authority-card');
  const dialog = pg.locator('.rm-report-dialog');
  await fetch(`${BASE}/__test/experience-mode?mode=accept`);
  await card.getByRole('button', { name: EXPERIENCE_BUTTON_NAME }).click();
  await dialog.waitFor();
  await pg.waitForTimeout(SETTLE_MS);
  const experienceOpened = await experienceState();
  check(`experience (${scheme}): opening the dialog requests no challenge`, experienceOpened.challenges === 0, JSON.stringify(experienceOpened));
  await dialog.locator('input').first().focus();
  const experienceAhead = await pollLog(experienceState, (state) => state.challenges >= 1);
  check(`experience (${scheme}): the challenge is requested at the first input, before Send, exactly once`,
    experienceAhead.challenges === 1 && experienceAhead.submissions.length === 0, JSON.stringify(experienceAhead));
  check(`experience (${scheme}): the dialog heading names the authority`, (await dialog.locator('h2').innerText()) === `Your experience: ${LEIPZIG_CARD_HEADING}`);
  const notice = dialog.locator('.rm-report-notice');
  check(`experience (${scheme}): the form notice is the reviewed text`, (await notice.innerText()) === EXPERIENCE_FORM_NOTICE, await notice.innerText());
  check(`experience (${scheme}): only "privacy notice for experiences" links to the experience privacy page`,
    (await notice.locator('a').count()) === 1 && (await notice.locator('a').innerText()) === EXPERIENCE_PRIVACY_LINK_LABEL
    && (await notice.locator('a').getAttribute('href')) === EXPERIENCE_PRIVACY_PATH);
  await pg.screenshot({ path: `${SHOTS}/desktop-experience-dialog-${scheme}.png` });
  await dialog.getByRole('button', { name: 'Send' }).click();
  const monthError = dialog.locator('.rm-report-error').first();
  check(`experience (${scheme}): the required month blocks Send with a message under the field`, (await monthError.isVisible())
    && (await monthError.innerText()).includes('Choose the month') && (await experienceLog()).length === 0, await monthError.innerText());
  const monthField = dialog.getByLabel('I received my naturalisation certificate in');
  check(`experience (${scheme}): the month field is a numeric text field with the MM/YYYY placeholder, not a month picker`,
    (await monthField.getAttribute('type')) === 'text' && (await monthField.getAttribute('inputmode')) === 'numeric'
    && (await monthField.getAttribute('placeholder')) === 'MM/YYYY');
  await monthField.pressSequentially(EXPERIENCE_INVALID_MONTH_DIGITS);
  check(`experience (${scheme}): typing 132026 shows 13/2026 uncorrected`, (await monthField.inputValue()) === '13/2026', await monthField.inputValue());
  await dialog.getByRole('button', { name: 'Send' }).click();
  check(`experience (${scheme}): an invalid month shows the message under the field and sends nothing`, (await monthError.isVisible())
    && (await monthError.innerText()).includes('like 03/2026') && (await monthField.inputValue()) === '13/2026' && (await experienceLog()).length === 0);
  await monthField.fill('');
  await monthField.pressSequentially(EXPERIENCE_TYPED_MONTH_DIGITS);
  check(`experience (${scheme}): typing 032026 inserts the slash and shows 03/2026`, (await monthField.inputValue()) === EXPERIENCE_SHOWN_MONTH, await monthField.inputValue());
  check(`experience (${scheme}): typing clears the month message`, !(await monthError.isVisible()));
  await pg.screenshot({ path: `${SHOTS}/experience-month-typed-${scheme}.png` });
  await dialog.getByLabel('Waiting to apply took (months)').fill(String(EXPERIENCE_SENT_WAIT));
  await dialog.getByLabel('Processing took (months)').fill(String(EXPERIENCE_SENT_PROCESSING));
  await dialog.getByRole('button', { name: 'Send' }).click();
  await dialog.getByText('Thank you. Your experience counts once at least 5 people have shared theirs for this office.').waitFor();
  check(`experience (${scheme}): the success state shows`, true);
  const [sent] = await experienceLog();
  check(`experience (${scheme}): Send after the solve finished uses the proof solved ahead, no second challenge`,
    (await experienceState()).challenges === 1);
  check(`experience (${scheme}): the request body keys are exactly the allowed set`,
    JSON.stringify(Object.keys(sent).sort()) === JSON.stringify([...EXPERIENCE_WIRE_KEYS].sort()), Object.keys(sent).join(','));
  check(`experience (${scheme}): the body holds the typed figures and no fact id as a key`, sent.certificate_month === EXPERIENCE_SENT_MONTH
    && sent.wait_months === EXPERIENCE_SENT_WAIT && sent.processing_months === EXPERIENCE_SENT_PROCESSING
    && !Object.keys(sent).some((key) => EXPERIENCE_FACT_IDS.has(key)), JSON.stringify(sent));
  await dialog.getByRole('button', { name: 'Close' }).click();
};

for (const scheme of shouldSkipGroup('experience button and dialog') ? [] : ['light', 'dark']) { // Both colour schemes: the button, then the dialog end to end.
  const { pg, context } = await openLeipzigCard({ colorScheme: scheme });
  await checkExperienceButton(pg, scheme);
  await checkExperienceDialog(pg, scheme);
  await context.close();
}

if (!shouldSkipGroup('experience dialog switched off')) { // Switch off: the shell says false, so the card has no button.
  const { pg, context } = await openLeipzigCard({}, { experiencesAttribute: 'false' });
  check('experience off: no "Share my experience" button on the card', (await pg.getByRole('button', { name: EXPERIENCE_BUTTON_NAME }).count()) === 0);
  await context.close(); }

if (!shouldSkipGroup('experience phone sheet')) { // Phone: the button and the dialog fit the sheet.
  const { pg, context } = await openLeipzigCard({ viewport: PHONE_VIEWPORT });
  await pg.screenshot({ path: `${SHOTS}/phone-authority-experience-sheet.png` });
  await pg.locator('.rm-authority-card').getByRole('button', { name: EXPERIENCE_BUTTON_NAME }).click();
  await pg.locator('.rm-report-dialog').waitFor();
  const box = await pg.locator('.rm-report-dialog').boundingBox();
  check('experience phone: the dialog fits the viewport width', box.x >= -LAYOUT_TOLERANCE_PX && box.x + box.width <= PHONE_VIEWPORT.width + LAYOUT_TOLERANCE_PX, JSON.stringify(box));
  await pg.screenshot({ path: `${SHOTS}/phone-experience-dialog.png` });
  await context.close(); }

// Invitation on offices without any figure: shown above the button only when experiences are on.
// Barnim has no figure at all and Frankfurt (Oder) an official total in the shipped data; both cases are proven here.
const NO_FIGURE_AGS = '12060';
const OFFICIAL_FIGURE_AGS = '12053';
const GAP_LINE_SELECTOR = '[data-testid="experience-gap"]';
const GAP_LINE_TEXT = 'No waiting time known for this office yet. Went through naturalisation here? Your experience fills the map.';
const SHARE_TOOLTIP_SUFFIX = ' · Share your experience';
const gapLineCount = (pg) => pg.locator('.rm-authority-card').locator(GAP_LINE_SELECTOR).count();
const checkGapLineAboveButton = async (pg, label) => {
  const card = pg.locator('.rm-authority-card');
  const line = card.locator(GAP_LINE_SELECTOR);
  check(`gap line (${label}): visible with the exact text`, await line.isVisible() && (await line.textContent()) === GAP_LINE_TEXT);
  const [lineBox, buttonBox] = await Promise.all([line.boundingBox(), card.getByRole('button', { name: EXPERIENCE_BUTTON_NAME }).boundingBox()]);
  check(`gap line (${label}): sits above the button`, lineBox.y + lineBox.height <= buttonBox.y + LAYOUT_TOLERANCE_PX, JSON.stringify({ lineBox, buttonBox }));
};
const districtTitles = (pg) => pg.locator('.rm-layer-districts .rm-district').evaluateAll(
  (paths) => paths.map((path) => ({ isNoData: path.classList.contains('rm-nodata'), title: path.querySelector('title').textContent })));
for (const scheme of shouldSkipGroup('experience gap line and tooltip') ? [] : ['light', 'dark']) {
  const { pg, context } = await openAuthorityCard(NO_FIGURE_AGS, { colorScheme: scheme });
  await checkGapLineAboveButton(pg, scheme);
  await pg.screenshot({ path: `${SHOTS}/desktop-authority-gap-line-${scheme}.png` });
  const titles = await districtTitles(pg);
  const noData = titles.filter((entry) => entry.isNoData);
  check(`gap tooltip (${scheme}): both kinds of district exist in the fixture`, noData.length > 0 && noData.length < titles.length);
  check(`gap tooltip (${scheme}): every no-data district invites, no other district does`,
    titles.every((entry) => entry.title.endsWith(SHARE_TOOLTIP_SUFFIX) === entry.isNoData));
  await context.close();
}
if (!shouldSkipGroup('experience gap line, official figure')) { const { pg, context } = await openAuthorityCard(OFFICIAL_FIGURE_AGS);
  check('gap line: an office with an official figure still shows the button', await pg.getByRole('button', { name: EXPERIENCE_BUTTON_NAME }).isVisible());
  check('gap line: absent on an office with an official figure', (await gapLineCount(pg)) === 0);
  await context.close(); }
if (!shouldSkipGroup('experience gap line switched off')) { const { pg, context } = await openAuthorityCard(NO_FIGURE_AGS, {}, { experiencesAttribute: 'false' });
  check('gap line: absent on a no-figure office when experiences are off', (await gapLineCount(pg)) === 0);
  check('gap tooltip: no invitation when experiences are off', (await districtTitles(pg)).every((entry) => !entry.title.includes(SHARE_TOOLTIP_SUFFIX)));
  await context.close(); }
if (!shouldSkipGroup('experience gap line phone')) { const { pg, context } = await openAuthorityCard(NO_FIGURE_AGS, { viewport: PHONE_VIEWPORT });
  await checkGapLineAboveButton(pg, 'phone');
  await pg.screenshot({ path: `${SHOTS}/phone-authority-gap-line.png` });
  await context.close(); }

// Selecting never moves the map: the visitor compares many districts and zooms by hand.
const OFFSCREEN_ZOOM_CLICKS = 4;
const SCALE_TOLERANCE = 1e-6;
const SELECTION_PROBES = ['Leipzig (city)', 'Berlin'];
const DROPDOWN_PROBE = 'Stuttgart';
const SELECTED_DISTRICT_CLASS = 'rm-selected';
const OFFSCREEN_PROBE = 'Görlitz';
const readViewBoxText = (pg) => pg.locator('.rm-svg').getAttribute('viewBox');
const districtOptionValue = (pg, namePrefix) => pg.evaluate((prefix) => [...document.querySelectorAll('#rm-finder-select option')]
  .find((option) => option.textContent.startsWith(prefix))?.value, namePrefix);
const districtIntersectsMap = (pg, namePrefix) => pg.evaluate((prefix) => {
  const path = [...document.querySelectorAll('.rm-layer-districts .rm-district')].find((node) => node.getAttribute('aria-label').startsWith(prefix));
  const box = path.getBoundingClientRect();
  const map = document.querySelector('.rm-svg').getBoundingClientRect();
  return box.right > map.left && box.left < map.right && box.bottom > map.top && box.top < map.bottom;
}, namePrefix);
const openGermanyView = async (contextOptions) => {
  const opened = await openNaturalisationPage(contextOptions);
  await opened.pg.getByRole('button', { name: NATURALISATION_TOPIC }).click();
  await opened.pg.waitForSelector('.rm-layer-districts .rm-district');
  await opened.pg.waitForTimeout(SETTLE_MS);
  return opened;
};
const checkThreeSelectionsKeepView = async (pg, label, { canClick }) => {
  const home = await readViewBoxText(pg);
  const card = pg.locator('.rm-authority-card');
  for (const name of SELECTION_PROBES) {
    const path = pg.locator(`.rm-layer-districts .rm-district[aria-label^="${name}"]`);
    if (canClick) await path.click();
    else await pg.selectOption('#rm-finder-select', await districtOptionValue(pg, name), { force: true });
    await card.waitFor({ state: 'visible' });
    await pg.waitForTimeout(SETTLE_MS);
    check(`selection (${label}): ${name} is highlighted and the view is unchanged`, (await path.getAttribute('class')).includes(SELECTED_DISTRICT_CLASS)
      && (await readViewBoxText(pg)) === home, `${home} -> ${await readViewBoxText(pg)}`);
  }
  await pg.selectOption('#rm-finder-select', await districtOptionValue(pg, DROPDOWN_PROBE), { force: true });
  await pg.waitForTimeout(SETTLE_MS);
  check(`selection (${label}): ${DROPDOWN_PROBE} from the dropdown, visible, leaves the view unchanged`,
    (await card.locator('h2').innerText()).includes(DROPDOWN_PROBE) && (await readViewBoxText(pg)) === home, await readViewBoxText(pg));
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(SETTLE_MS);
  check(`selection (${label}): closing the card does not move the map`, (await readViewBoxText(pg)) === home);
  await pg.selectOption('#rm-finder-select', await districtOptionValue(pg, DROPDOWN_PROBE), { force: true });
  await pg.waitForTimeout(SETTLE_MS);
};
{ const { pg, context } = await openGermanyView({});
  await checkThreeSelectionsKeepView(pg, 'desktop', { canClick: true });
  await pg.screenshot({ path: `${SHOTS}/desktop-germany-three-selections.png` });
  await context.close(); }
{ const { pg, context } = await openGermanyView({ viewport: PHONE_VIEWPORT, hasTouch: true });
  await checkThreeSelectionsKeepView(pg, 'phone', { canClick: false });
  await pg.screenshot({ path: `${SHOTS}/phone-germany-three-selections.png` });
  await context.close(); }
{ const { pg, context } = await openGermanyView({});
  for (let i = 0; i < OFFSCREEN_ZOOM_CLICKS; i += 1) await pg.getByRole('button', { name: 'Zoom in' }).click();
  await pg.waitForTimeout(SETTLE_MS);
  const before = await readViewBox(pg);
  check(`off-screen: ${OFFSCREEN_PROBE} starts outside the zoomed view`, !(await districtIntersectsMap(pg, OFFSCREEN_PROBE)));
  await pg.selectOption('#rm-finder-select', await districtOptionValue(pg, OFFSCREEN_PROBE), { force: true });
  await pg.locator('.rm-authority-card').waitFor({ state: 'visible' });
  await pg.waitForTimeout(SETTLE_MS);
  const after = await readViewBox(pg);
  check('off-screen: the dropdown pick pans (translation changed) without zooming (scale unchanged)',
    Math.abs(after[2] - before[2]) < SCALE_TOLERANCE && Math.abs(after[3] - before[3]) < SCALE_TOLERANCE && (after[0] !== before[0] || after[1] !== before[1]),
    `${before.join(' ')} -> ${after.join(' ')}`);
  check(`off-screen: ${OFFSCREEN_PROBE} is in the map after the pan`, await districtIntersectsMap(pg, OFFSCREEN_PROBE));
  await context.close(); }
{ const opened = await openNaturalisationPage({});
  const { pg, context } = opened;
  await pg.waitForSelector('.rm-country');
  await pg.waitForTimeout(SETTLE_MS);
  const europe = await readViewBoxText(pg);
  for (const name of ['France', 'Germany']) {
    await pg.locator(`.rm-layer-covered [aria-label^="${name}:"]`).first().click();
    await pg.locator('.rm-detail:visible').waitFor();
    await pg.waitForTimeout(SETTLE_MS);
    check(`selection (Europe): clicking ${name} opens the card and the view is unchanged`, (await readViewBoxText(pg)) === europe, `${europe} -> ${await readViewBoxText(pg)}`);
  }
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(SETTLE_MS);
  check('selection (Europe): closing the country card does not move the map', (await readViewBoxText(pg)) === europe);
  await context.close(); }

// Bottom-right controls: the zoom group, metric switch, legend and finder never overlap and stay on screen.
const LAYOUT_VIEWPORTS = [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 1024, height: 768 }, PHONE_VIEWPORT];
const DARK_LAYOUT_VIEWPORTS = [LAYOUT_VIEWPORTS[1], PHONE_VIEWPORT];
const CONTROL_SELECTORS = { zoom: '.rm-zoom-controls', metric: '.rm-metric-switch', legend: '.rm-legend', finder: '.rm-finder', sources: '.rm-sources-button' };
const OVERLAP_TOLERANCE_PX = 0.5;
/** The phone breakpoint of rights_map.css (`@media (max-width: 720px)`). */
const PHONE_MAX_WIDTH = 720;
const GERMANY_VIEW_SHOT_VIEWPORTS = ['1280x720', '1440x900'];
const boxesIntersect = (a, b) => a.x < b.x + b.width - OVERLAP_TOLERANCE_PX && b.x < a.x + a.width - OVERLAP_TOLERANCE_PX
  && a.y < b.y + b.height - OVERLAP_TOLERANCE_PX && b.y < a.y + a.height - OVERLAP_TOLERANCE_PX;

const checkControlLayout = async (pg, label) => {
  const viewport = pg.viewportSize();
  const boxes = {};
  for (const [name, selector] of Object.entries(CONTROL_SELECTORS)) {
    const locator = pg.locator(selector);
    if (await locator.count() && await locator.first().isVisible()) boxes[name] = await locator.first().boundingBox();
  }
  const names = Object.keys(boxes);
  const clashes = names.flatMap((a, i) => names.slice(i + 1).filter((b) => boxesIntersect(boxes[a], boxes[b])).map((b) => `${a}/${b}`));
  check(`${label}: zoom, metric switch, legend and finder do not intersect`, clashes.length === 0 && names.includes('zoom'),
    clashes.length ? clashes.join(' ') : names.join(','));
  const outside = names.filter((n) => boxes[n].x < 0 || boxes[n].y < 0 || boxes[n].x + boxes[n].width > viewport.width || boxes[n].y + boxes[n].height > viewport.height);
  check(`${label}: every control is inside the viewport`, outside.length === 0, outside.join(',') + ' ' + JSON.stringify(boxes));
  return names;
};

const layoutScenarios = [
  ...LAYOUT_VIEWPORTS.map((viewport) => ({ viewport, colorScheme: 'light' })),
  ...DARK_LAYOUT_VIEWPORTS.map((viewport) => ({ viewport, colorScheme: 'dark' })),
];
for (const { viewport, colorScheme } of layoutScenarios) {
  const size = `${viewport.width}x${viewport.height}`;
  const { pg, context } = await openNaturalisationPage({ viewport, colorScheme });
  await pg.waitForTimeout(SETTLE_MS);
  const europeNames = await checkControlLayout(pg, `Europe ${size} ${colorScheme}`);
  check(`Europe ${size} ${colorScheme}: no metric switch`, !europeNames.includes('metric'));
  await pg.getByRole('button', { name: NATURALISATION_TOPIC }).click();
  await pg.waitForSelector('.rm-layer-districts .rm-district');
  await pg.waitForTimeout(SETTLE_MS);
  const germanyNames = await checkControlLayout(pg, `Germany ${size} ${colorScheme}`);
  const isPhone = viewport.width <= PHONE_MAX_WIDTH;
  check(`Germany ${size} ${colorScheme}: the metric switch and legend are ${isPhone ? 'behind "Legend & sources"' : 'shown'}`,
    germanyNames.includes('metric') === !isPhone && germanyNames.includes('legend') === !isPhone && germanyNames.includes('sources') === isPhone);
  if (colorScheme === 'light' && GERMANY_VIEW_SHOT_VIEWPORTS.includes(size)) await pg.screenshot({ path: `${SHOTS}/desktop-germany-controls-${size}.png` });
  await context.close();
}

// Regression: opening the authority topic with every required answer already stored crashed renderCountries
// (country legend built from labels the authority topic lacks) and left the map on "Loading borders…".
const PREFILLED_VIEWPORT = { width: 1137, height: 1180 };
const FACTSET_STORAGE_KEY = 'relocat.factset.v1';
const PREFILLED_FACTSET = { fact_schema: 1, facts: { de_residence_since: '2015', passport: 'expired', apostille: 'no', german: 'B2' } };
const LOADING_TEXT = 'Loading borders';
{ const prefilledContext = await browser.newContext({ viewport: PREFILLED_VIEWPORT });
  const prefilledPage = await prefilledContext.newPage();
  const prefilledErrors = [];
  prefilledPage.on('pageerror', (error) => prefilledErrors.push(error.message));
  await prefilledPage.addInitScript(([key, value]) => localStorage.setItem(key, value), [FACTSET_STORAGE_KEY, JSON.stringify(PREFILLED_FACTSET)]);
  await prefilledPage.goto(`${BASE}/map/`);
  await prefilledPage.waitForSelector('.rm-country');
  await prefilledPage.getByRole('button', { name: NATURALISATION_TOPIC }).click();
  await prefilledPage.waitForSelector('.rm-layer-districts .rm-district');
  await prefilledPage.waitForTimeout(SETTLE_MS);
  check('pre-filled answers: no page error while opening Naturalisation', prefilledErrors.length === 0, prefilledErrors.join(' | '));
  const prefilledDistricts = await prefilledPage.locator('.rm-layer-districts .rm-district').count();
  check('pre-filled answers: the district layer has at least 390 paths', prefilledDistricts >= DISTRICT_PATHS_MIN, String(prefilledDistricts));
  check('pre-filled answers: the loading placeholder is gone', !(await prefilledPage.getByText(LOADING_TEXT).isVisible()));
  check('pre-filled answers: the metric switch and legend are visible',
    await prefilledPage.locator('.rm-metric-switch').isVisible() && await prefilledPage.locator('.rm-legend').isVisible());
  await prefilledContext.close(); }


// Phone layout: one fixed-height bottom card; the finder, metric switch and legend hide behind "Legend & sources".
const PHONE_SIZES = [{ width: 390, height: 844 }, { width: 455, height: 820 }];
const PHONE_SCHEMES = ['light', 'dark'];
const PHONE_SHEET_MAX_FRACTION = 0.45;
const SHEET_HEIGHT_TOLERANCE_PX = 1;
const SOURCES_BUTTON_NAME = 'Legend & sources';
const SOURCES_CLOSE_NAME = 'Close legend and sources';
const SOURCES_PANEL = '#rm-sources-panel';
const TP_TOPIC = /Ukrainian temporary protection/;
const TP_ANSWERS = [['nat', 'UA'], ['ua_military_obligation', 'yes'], ['ua_holds_tp', 'no'], ['ua_exit_proof', 'no']];
const DESKTOP_SIZE = { width: 1440, height: 900 };
const PHONE_HIDDEN_CONTROLS = { finder: '.rm-finder', 'metric switch': '.rm-metric-switch', legend: '.rm-legend' };
/** Box of whichever bottom card is showing (topic/wizard card or info card). */
const visibleCardBox = (pg) => pg.evaluate(() => {
  const card = [...document.querySelectorAll('.rm-wizard, .rm-detail')].find((element) => element.getClientRects().length > 0);
  const { x, y, width, height } = card.getBoundingClientRect();
  return { x, y, width, height };
});
/** The step eyebrow must sit inside the card, below its top padding, with the card scrolled to the top. */
const checkCardStartsAtTop = async (pg, label) => {
  const layout = await pg.evaluate(() => {
    const card = [...document.querySelectorAll('.rm-wizard, .rm-detail')].find((element) => element.getClientRects().length > 0);
    const eyebrow = card.querySelector('.rm-step-label');
    const cardBox = card.getBoundingClientRect();
    const eyebrowBox = eyebrow.getBoundingClientRect();
    return {
      scrollTop: card.scrollTop, paddingTop: parseFloat(getComputedStyle(card).paddingTop), eyebrowOffset: eyebrowBox.top - cardBox.top,
      eyebrowInside: eyebrowBox.top >= cardBox.top && eyebrowBox.bottom <= cardBox.bottom && eyebrowBox.height > 0,
    };
  });
  check(`${label}: the card is scrolled to the top`, layout.scrollTop === 0, JSON.stringify(layout));
  check(`${label}: the step eyebrow is inside the card`, layout.eyebrowInside, JSON.stringify(layout));
  check(`${label}: the eyebrow is at least the card's top padding below its top edge`, layout.eyebrowOffset >= layout.paddingTop - SHEET_HEIGHT_TOLERANCE_PX, JSON.stringify(layout));
};
const checkPhoneChrome = async (pg, label) => {
  for (const [name, selector] of Object.entries(PHONE_HIDDEN_CONTROLS)) {
    check(`${label}: the ${name} is not visible on the map`, !(await pg.locator(selector).first().isVisible()));
  }
  check(`${label}: the "${SOURCES_BUTTON_NAME}" button is visible`, await pg.getByRole('button', { name: SOURCES_BUTTON_NAME }).isVisible());
  const boxes = {
    topbar: await pg.locator('.rm-topbar').boundingBox(), card: await visibleCardBox(pg),
    zoom: await pg.locator('.rm-zoom-controls').boundingBox(), sources: await pg.locator('.rm-sources-button').boundingBox(),
  };
  const names = Object.keys(boxes);
  const clashes = names.flatMap((a, i) => names.slice(i + 1).filter((b) => boxesIntersect(boxes[a], boxes[b])).map((b) => `${a}/${b}`));
  check(`${label}: top bar, card, zoom group and button do not intersect`, clashes.length === 0, clashes.join(' ') || JSON.stringify(boxes));
  const zoomButton = await pg.locator('.rm-zoom-controls button').first().boundingBox();
  check(`${label}: the button is the size of a zoom button`, Math.abs(boxes.sources.width - zoomButton.width) <= SHEET_HEIGHT_TOLERANCE_PX
    && Math.abs(boxes.sources.height - zoomButton.height) <= SHEET_HEIGHT_TOLERANCE_PX, JSON.stringify([boxes.sources, zoomButton]));
};
/** Opens the panel, runs the checks that need it open, then closes it with Esc, a tap outside and ×. */
const checkSourcesPanel = async (pg, label, { hasMetricSwitch, hasLinks, shot }) => {
  const button = pg.getByRole('button', { name: SOURCES_BUTTON_NAME });
  await button.click();
  check(`${label}: the panel opens and the button reports it`, (await pg.locator(SOURCES_PANEL).isVisible()) && (await button.getAttribute('aria-expanded')) === 'true');
  check(`${label}: the panel shows the legend`, await pg.locator(`${SOURCES_PANEL} .rm-legend`).isVisible());
  check(`${label}: the panel ${hasMetricSwitch ? 'shows' : 'hides'} the metric switch`, (await pg.locator(`${SOURCES_PANEL} .rm-metric-switch`).isVisible()) === hasMetricSwitch);
  const attribution = pg.locator(`${SOURCES_PANEL} .rm-attribution`);
  check(`${label}: the panel shows the attribution text`, (await attribution.isVisible()) && (await attribution.innerText()).includes('Natural Earth'));
  if (hasLinks) check(`${label}: the attribution links are visible`, (await attribution.locator('a:visible').count()) >= 2);
  const panelBox = await pg.locator(SOURCES_PANEL).boundingBox();
  const viewport = pg.viewportSize();
  check(`${label}: the panel stays on screen and within 45% of the screen height`, panelBox.x >= 0 && panelBox.x + panelBox.width <= viewport.width
    && panelBox.height <= viewport.height * PHONE_SHEET_MAX_FRACTION + SHEET_HEIGHT_TOLERANCE_PX, JSON.stringify(panelBox));
  await pg.screenshot({ path: shot });
  await pg.keyboard.press('Escape');
  check(`${label}: Esc closes the panel and returns focus to the button`, !(await pg.locator(SOURCES_PANEL).isVisible())
    && (await pg.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === SOURCES_BUTTON_NAME);
  await button.click();
  await pg.locator('.rm-title').click();
  check(`${label}: a tap outside closes the panel`, !(await pg.locator(SOURCES_PANEL).isVisible()));
  await button.click();
  await pg.getByRole('button', { name: SOURCES_CLOSE_NAME }).click();
  check(`${label}: the × button closes the panel`, !(await pg.locator(SOURCES_PANEL).isVisible()));
};
for (const viewport of PHONE_SIZES) {
  for (const colorScheme of PHONE_SCHEMES) {
    const size = `${viewport.width}x${viewport.height}`;
    const tag = `phone ${size} ${colorScheme}`;
    const shotBase = `${SHOTS}/phone-${size}-${colorScheme}`;
    const maxHeight = viewport.height * PHONE_SHEET_MAX_FRACTION;
    const europe = await openNaturalisationPage({ viewport, colorScheme, hasTouch: true });
    await europe.pg.waitForTimeout(SETTLE_MS);
    const europeTopicBox = await visibleCardBox(europe.pg);
    await europe.pg.getByRole('button', { name: TP_TOPIC }).click();
    for (const [id, code] of TP_ANSWERS) await europe.pg.locator(`[data-focus-key="fact:${id}:${code}"]`).click();
    await europe.pg.waitForTimeout(SETTLE_MS);
    await europe.pg.screenshot({ path: `${shotBase}-europe.png` });
    const europeAnswerBox = await visibleCardBox(europe.pg);
    check(`${tag} Europe: the card is at most 45% of the screen and keeps its height from topic list to answers`,
      europeTopicBox.height <= maxHeight && Math.abs(europeAnswerBox.height - europeTopicBox.height) <= SHEET_HEIGHT_TOLERANCE_PX,
      `${europeTopicBox.height} / ${europeAnswerBox.height} <= ${maxHeight}`);
    await checkPhoneChrome(europe.pg, `${tag} Europe`);
    await checkSourcesPanel(europe.pg, `${tag} Europe`, { hasMetricSwitch: false, hasLinks: false, shot: `${shotBase}-sources-europe.png` });
    await europe.context.close();

    const { pg, context } = await openNaturalisationPage({ viewport, colorScheme, hasTouch: true });
    await pg.getByRole('button', { name: NATURALISATION_TOPIC }).click();
    await pg.waitForSelector('.rm-layer-districts .rm-district');
    await pg.waitForTimeout(SETTLE_MS);
    const topicBox = await visibleCardBox(pg);
    const mapBefore = await pg.locator('.rm-svg').boundingBox();
    await pg.screenshot({ path: `${shotBase}-germany-topic.png` });
    await checkPhoneChrome(pg, `${tag} Germany`);
    await checkCardStartsAtTop(pg, `${tag} Germany step 2`);
    await pg.selectOption('#rm-finder-select', LEIPZIG_CITY_AGS, { force: true }); // force: the finder is hidden on a phone
    await pg.locator('.rm-authority-card').waitFor({ state: 'visible' });
    await pg.waitForTimeout(SETTLE_MS);
    const authorityBox = await visibleCardBox(pg);
    const mapDuring = await pg.locator('.rm-svg').boundingBox();
    await pg.screenshot({ path: `${shotBase}-germany-authority.png` });
    await checkPhoneChrome(pg, `${tag} Germany authority card`);
    await pg.keyboard.press('Escape');
    await pg.locator('.rm-authority-card').waitFor({ state: 'hidden' });
    await pg.waitForTimeout(SETTLE_MS);
    await checkCardStartsAtTop(pg, `${tag} Germany back from the authority card`);
    const heights = [topicBox.height, authorityBox.height, (await visibleCardBox(pg)).height];
    check(`${tag} Germany: the topic card and the authority card have the same height (±1px), before and after`,
      heights.every((height) => Math.abs(height - topicBox.height) <= SHEET_HEIGHT_TOLERANCE_PX), heights.join(' / '));
    check(`${tag} Germany: the bottom card is at most 45% of the screen`, heights.every((height) => height <= maxHeight), `${heights.join(' / ')} <= ${maxHeight}`);
    check(`${tag} Germany: the card keeps its edge and the map its area when a district opens`,
      Math.abs(authorityBox.y - topicBox.y) <= SHEET_HEIGHT_TOLERANCE_PX && Math.abs(mapDuring.height - mapBefore.height) <= SHEET_HEIGHT_TOLERANCE_PX,
      JSON.stringify({ topicBox, authorityBox, mapBefore, mapDuring }));
    await checkSourcesPanel(pg, `${tag} Germany`, { hasMetricSwitch: true, hasLinks: true, shot: `${shotBase}-sources-germany.png` });
    await context.close();
  }
}
{ // Desktop is unchanged: finder, metric switch and legend show, and the phone button does not.
  const { pg, context } = await openNaturalisationPage({ viewport: DESKTOP_SIZE });
  await pg.getByRole('button', { name: NATURALISATION_TOPIC }).click();
  await pg.waitForSelector('.rm-layer-districts .rm-district');
  await pg.waitForTimeout(SETTLE_MS);
  for (const [name, selector] of Object.entries(PHONE_HIDDEN_CONTROLS)) {
    check(`desktop 1440x900: the ${name} is visible`, await pg.locator(selector).first().isVisible());
  }
  check('desktop 1440x900: the "Legend & sources" button is hidden', !(await pg.getByRole('button', { name: SOURCES_BUTTON_NAME }).isVisible()));
  await context.close(); }

// Network audit
const origin =new URL(BASE).origin;
const offOrigin = requests.filter((u) => new URL(u).origin !== origin && !u.startsWith('data:'));
check('no off-origin requests', offOrigin.length === 0, offOrigin.join(','));
const rules = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
// The sticky site header and the Rights map bar never overlap, at any scroll position.
const STICKY_VIEWPORTS = [{ width: 1440, height: 900 }, { width: PHONE_WIDTH, height: 844 }];
const STICKY_SCROLL_FRACTIONS = [0, 0.5, 1];
const STICKY_SCHEMES = ['light', 'dark'];
const isBoxInViewport = (box, viewport) => box.y + box.height > 0 && box.y < viewport.height;
for (const viewport of shouldSkipGroup('sticky site header') ? [] : STICKY_VIEWPORTS) {
  for (const colorScheme of STICKY_SCHEMES) {
    const stickyContext = await browser.newContext({ viewport, colorScheme });
    const stickyPage = await stickyContext.newPage();
    await stickyPage.goto(`${BASE}/map/`);
    await stickyPage.waitForSelector('.rm-country');
    const maxScroll = await stickyPage.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    const overlaps = [];
    for (const fraction of STICKY_SCROLL_FRACTIONS) {
      await stickyPage.evaluate((y) => window.scrollTo(0, y), Math.round(maxScroll * fraction));
      await stickyPage.waitForTimeout(SETTLE_MS);
      const header = await stickyPage.locator('.top').boundingBox();
      const bar = await stickyPage.locator('.rm-topbar').boundingBox();
      if (isBoxInViewport(header, viewport) && isBoxInViewport(bar, viewport) && boxesIntersect(header, bar)) {
        overlaps.push(`${fraction}: ${JSON.stringify({ header, bar })}`);
      }
      if (fraction === 1) await stickyPage.screenshot({ path: `${SHOTS}/sticky-${viewport.width}x${viewport.height}-${colorScheme}-scrolled.png` });
    }
    check(`sticky header: never overlaps the Rights map bar (${viewport.width}x${viewport.height}, ${colorScheme})`, overlaps.length === 0, overlaps.join(' | '));
    await stickyContext.close();
  }
}

if (!shouldSkipGroup('community figures')) { // Community figures: fetched only while the shell says so, fail quietly, fill gaps but never beat a sourced figure.
  const COMMUNITY_HITS_URL = `${BASE}/__test/community-hits`;
  const setCommunityMode = (mode) => fetch(`${BASE}/__test/community-mode?mode=${mode}`);
  const communityHits = async () => (await (await fetch(COMMUNITY_HITS_URL)).json()).hits;
  const BARNIM = '.rm-layer-districts .rm-district[aria-label^="Barnim"]';
  const FRANKFURT = '.rm-layer-districts .rm-district[aria-label^="Frankfurt (Oder)"]';
  const NO_DATA_CLASS = 'rm-nodata';
  const COMMUNITY_HEADLINE = 'About 12 months';
  const COMMUNITY_SUMMARY = '5–9 reports · typically 9–15';
  const FRANKFURT_COMMUNITY_ROW_TEXT = 'Community · 10–19 reports: about 60 months (typically 54–63)';
  const FAILING_TEXT = /could not|error|failed/i;
  const open = async (communityAttribute) => {
    const opened = await openNaturalisationPage({}, { communityAttribute });
    await opened.pg.getByRole('button', { name: /Naturalisation/ }).click();
    await opened.pg.waitForSelector('.rm-layer-districts .rm-district');
    return opened;
  };
  const snapshot = async (pg) => ({
    barnim: { cls: await pg.locator(BARNIM).getAttribute('class'), label: await pg.locator(BARNIM).getAttribute('aria-label') },
    frankfurt: { cls: await pg.locator(FRANKFURT).getAttribute('class'), label: await pg.locator(FRANKFURT).getAttribute('aria-label') },
  });

  await setCommunityMode('ok');
  const hitsBeforeOff = await communityHits();
  const off = await open('false');
  const offSnapshot = await snapshot(off.pg);
  check('community off: the shell publishes the switch as false and nothing is fetched',
    (await off.pg.locator('#rights-map').getAttribute('data-community-enabled')) === 'false' && (await communityHits()) === hitsBeforeOff);
  check('community off: the gap district stays "no data"', offSnapshot.barnim.cls.includes(NO_DATA_CLASS), offSnapshot.barnim.cls);
  await off.context.close();

  const hitsBeforeOn = await communityHits();
  const problemsBeforeOn = consoleProblems.length;
  const on = await open('true');
  await on.pg.waitForFunction((selector) => !document.querySelector(selector).classList.contains('rm-nodata'), BARNIM);
  const onSnapshot = await snapshot(on.pg);
  check('community on: fetched exactly once', (await communityHits()) === hitsBeforeOn + 1);
  check('community on: the gap district gets a bucket fill, not the no-data hatch',
    !onSnapshot.barnim.cls.includes(NO_DATA_CLASS) && /rm-bucket-\d/.test(onSnapshot.barnim.cls), onSnapshot.barnim.cls);
  check('community on: a district with an official figure keeps its official class and label',
    JSON.stringify(onSnapshot.frankfurt) === JSON.stringify(offSnapshot.frankfurt), JSON.stringify(onSnapshot.frankfurt));
  await on.pg.locator(BARNIM).click();
  const card = on.pg.locator('.rm-authority-card');
  await card.waitFor({ state: 'visible' });
  const cardText = await card.innerText();
  const totalBlock = card.locator('.rm-time-total').first();
  const totalHeadline = await totalBlock.locator('.rm-time-value').first().innerText();
  check('community on: with no sourced total the headline is "About M months", not "No data"', totalHeadline === COMMUNITY_HEADLINE, totalHeadline);
  check('community on: the Community badge and the count line follow the headline',
    (await totalBlock.locator('.rm-time-meta .rm-source-community').first().innerText()) === 'Community'
    && (await totalBlock.locator('.rm-time-community').first().innerText()) === COMMUNITY_SUMMARY, cardText);
  check('community on: the card shows the Community badge and no exact report count',
    (await card.locator('.rm-source-community').count()) >= 1 && !/\b\d+ reports\b/.test(cardText.replace(/5–9 reports/g, '')));
  await on.pg.getByRole('button', { name: 'Details' }).click();
  check('community on: Details carry the wait and processing community rows', (await card.locator('.rm-time-details .rm-time-community').count()) === 2);
  const processingValue = await card.locator('.rm-time-details .rm-time-proc .rm-time-value').innerText();
  check('community on: Details show "About M months" for processing instead of "No data"', processingValue === 'About 6 months', processingValue);
  check('community on: no console problems', consoleProblems.length === problemsBeforeOn, consoleProblems.slice(problemsBeforeOn).join(' | '));
  await on.pg.screenshot({ path: `${SHOTS}/desktop-community-card-light.png` });
  await on.pg.locator('.rm-layer-districts').screenshot({ path: `${SHOTS}/desktop-community-map.png` });
  await on.pg.locator(FRANKFURT).click();
  await card.getByText(/Frankfurt/).first().waitFor({ state: 'visible' });
  const sourcedText = (await card.innerText()).replace(/\s+/g, ' ');
  check('community on: a sourced total keeps its headline and the community line sits under it',
    sourcedText.includes(FRANKFURT_COMMUNITY_ROW_TEXT) && !sourcedText.includes(COMMUNITY_HEADLINE), sourcedText);
  await on.context.close();

  const darkContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const darkPage = await darkContext.newPage();
  await darkPage.goto(`${BASE}/map/`);
  await darkPage.waitForSelector('.rm-country');
  await darkPage.getByRole('button', { name: /Naturalisation/ }).click();
  await darkPage.waitForSelector('.rm-layer-districts .rm-district');
  await darkPage.waitForFunction((selector) => !document.querySelector(selector).classList.contains('rm-nodata'), BARNIM);
  await darkPage.locator(BARNIM).click();
  await darkPage.locator('.rm-authority-card .rm-time-community').first().waitFor({ state: 'visible' });
  await darkPage.screenshot({ path: `${SHOTS}/desktop-community-card-dark.png` });
  await darkContext.close();

  await setCommunityMode('failing');
  const problemsBeforeFailing = consoleProblems.length;
  const failing = await open('true');
  await failing.pg.locator(BARNIM).click();
  const failingCard = failing.pg.locator('.rm-authority-card');
  await failingCard.waitFor({ state: 'visible' });
  check('community 500: no error text, no community row, the gap district stays "no data"',
    !FAILING_TEXT.test(await failing.pg.locator('#rights-map').innerText()) && (await failingCard.locator('.rm-time-community').count()) === 0
    && (await failing.pg.locator(BARNIM).getAttribute('class')).includes(NO_DATA_CLASS));
  // Chromium itself logs the 500 as "Failed to load resource"; that is the browser, not page code. Anything else stays a problem.
  const browserLoggedFailure = /status of 500/;
  const ownProblems = consoleProblems.splice(problemsBeforeFailing).filter((text) => !browserLoggedFailure.test(text));
  consoleProblems.push(...ownProblems);
  check('community 500: the map still works and the page raised no error of its own',
    (await failing.pg.locator('.rm-layer-districts .rm-district').count()) > 0 && ownProblems.length === 0, ownProblems.join(' | '));
  await failing.context.close();
  await setCommunityMode('empty');
}

const factIds = rules.facts.map((f) => f.id);
// The only query a request may carry is the cache buster the real shell publishes in data-version.
const pageVersion = await page.locator('#rights-map').getAttribute('data-version');
const leaks = requests.filter((u) => {
  const { pathname, search } = new URL(u);
  const queryOk = search === '' || search === `?v=${pageVersion}`;
  return !queryOk || factIds.some((id) => pathname.includes(id));
});
check('no request URL contains a fact value or id', leaks.length === 0, leaks.join(' | '));
check('console + CSP errors: none', consoleProblems.length === 0, consoleProblems.join(' | '));
console.log('\nALL REQUEST URLS (unique):');
for (const u of [...new Set(requests)]) console.log('  ' + u);
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
