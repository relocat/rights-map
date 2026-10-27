// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// Floating top bar: page title and the privacy pill. The site header around
// the page already carries the logo and navigation, so only map-specific
// content lives here. The pill is a button that opens a small panel explaining
// where the answers are kept.

const STRINGS = Object.freeze({
  title: 'Rights map',
  privacyPill: 'Answers stay in your browser',
  notRemembered: "Your answers won't be remembered after you close this page.",
  privacyTitle: 'Your answers stay on this device',
  privacyParagraphs: Object.freeze([
    'The map is worked out right here in your browser. Your answers are never sent to Relocat or to anyone else — no account, no tracking, nothing stored on our servers.',
    'They are saved only in this browser on this device, so they are still here next time. You can delete them at any time with “Forget my answers”, or keep a copy with “Export my answers”.',
    'Anyone who uses this browser on this device can see them. On a shared or borrowed device, use a private window.',
  ]),
  privacyLink: 'How we store them',
});
const ESCAPE_KEY = 'Escape';
const COOKIES_PATH = '/cookies/';
const PRIVACY_PANEL_ID = 'rm-privacy-panel';
const PRIVACY_TITLE_ID = 'rm-privacy-title';
const PRIVACY_FOCUS_KEY = 'privacy-pill';
const ICON_VIEW_BOX = '0 0 24 24';
const INFO_CIRCLE = Object.freeze({ cx: '12', cy: '12', r: '10' });
const INFO_STROKE_PATH = 'M12 16v-4';
const INFO_DOT_PATH = 'M12 8h.01';

/** Decorative "i in a circle"; the button's text carries the meaning. */
function infoIcon(s) {
  return s('svg', {
    cls: 'rm-icon-stroke rm-pill-icon',
    attrs: { viewBox: ICON_VIEW_BOX, 'aria-hidden': 'true', focusable: 'false' },
  }, [
    s('circle', { attrs: INFO_CIRCLE }),
    s('path', { attrs: { d: INFO_STROKE_PATH } }),
    s('path', { attrs: { d: INFO_DOT_PATH } }),
  ]);
}

/** The explanation card; static text only, no data from the visitor's answers. */
function buildPrivacyPanel(h, isOpen) {
  return h('div', {
    cls: 'rm-privacy-panel',
    attrs: { id: PRIVACY_PANEL_ID, role: 'group', 'aria-labelledby': PRIVACY_TITLE_ID, hidden: !isOpen },
  }, [
    h('h2', { cls: 'rm-privacy-title', text: STRINGS.privacyTitle, attrs: { id: PRIVACY_TITLE_ID } }),
    ...STRINGS.privacyParagraphs.map((paragraph) => h('p', { text: paragraph })),
    h('a', { cls: 'rm-privacy-link', text: STRINGS.privacyLink, attrs: { href: COOKIES_PATH } }),
  ]);
}

/**
 * Creates the top bar view.
 * @param {HTMLElement} rootElement the <header> element to fill
 * @param {object} callbacks unused; kept for the shared create…() signature
 * @param {{common: object}} deps injected helpers
 * @returns {{render: function(object): void}}
 */
export function createTopbar(rootElement, callbacks, deps) {
  const { h, s, rebuild, focusKey } = deps.common;
  let isOpen = false;
  let current = null;

  /** Reflects `isOpen` on the live pill and panel without rebuilding them. */
  const apply = () => {
    if (current === null) return;
    current.pill.setAttribute('aria-expanded', String(isOpen));
    current.panel.hidden = !isOpen;
  };
  const close = (shouldRefocus) => {
    if (!isOpen) return;
    isOpen = false;
    apply();
    if (shouldRefocus) current?.pill.focus();
  };
  // Document-level so a click or Escape anywhere else closes the panel. Escape is marked handled
  // so the map's own Escape handler does not also close the open country card.
  document.addEventListener('keydown', (event) => {
    if (event.key !== ESCAPE_KEY || !isOpen) return;
    event.preventDefault();
    close(true);
  });
  document.addEventListener('click', (event) => {
    if (!isOpen || current === null || current.wrapper.contains(event.target)) return;
    // Give focus back only when the click did not move it to something else.
    close(document.activeElement === document.body || document.activeElement === null);
  });

  return {
    /** @param {{isPersistent: boolean}} state */
    render(state) {
      rebuild(rootElement, () => {
        const pill = h('button', {
          cls: 'rm-pill rm-pill-privacy',
          attrs: { type: 'button', 'aria-expanded': String(isOpen), 'aria-controls': PRIVACY_PANEL_ID, ...focusKey(PRIVACY_FOCUS_KEY) },
          on: { click: () => { isOpen = !isOpen; apply(); } },
        }, [infoIcon(s), h('span', { text: STRINGS.privacyPill })]);
        const panel = buildPrivacyPanel(h, isOpen);
        const wrapper = h('div', { cls: 'rm-privacy' }, [pill, panel]);
        current = { pill, panel, wrapper };
        return [
          h('h1', { cls: 'rm-title', text: STRINGS.title }),
          h('div', { cls: 'rm-topbar-notes' }, [
            wrapper,
            state.isPersistent ? null : h('span', {
              cls: 'rm-pill rm-pill-warning', text: STRINGS.notRemembered, attrs: { role: 'status' },
            }),
          ]),
        ];
      });
    },
  };
}
