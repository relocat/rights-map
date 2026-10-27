// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025-2026 Ruslan Zykun and Relocat contributors
//
// "Legend & sources" on a phone. The finder, metric switch, legend and attribution do not fit
// beside a fixed-height bottom card, so on a phone they hide and this module gives them one
// home: a small button on the map that opens the legend block as a panel over the card. The
// attribution (CC BY 4.0, dl-de/by-2-0) stays reachable and the metric can still be changed.
// Which width counts as a phone is decided by the CSS media query alone: this module only
// builds the button and the panel header, and toggles one class on the page root.

const STRINGS = Object.freeze({
  buttonLabel: 'Legend & sources',
  panelTitle: 'Legend & sources',
  closeLabel: 'Close legend and sources',
  closeSymbol: '×',
});
const ESCAPE_KEY = 'Escape';
const OPEN_CLASS = 'rm-sources-open';
const PANEL_ID = 'rm-sources-panel';
const PANEL_TITLE_ID = 'rm-sources-title';
const PANEL_ROLE = 'dialog';
const ICON_VIEW_BOX = '0 0 24 24';
const ICON_SIZE = '20';
/** Three list lines: the usual "legend" glyph, decorative because the button has an accessible name. */
const ICON_PATHS = Object.freeze(['M4 6h16', 'M4 12h16', 'M4 18h10']);

function buildIcon(common) {
  return common.s('svg', {
    attrs: { viewBox: ICON_VIEW_BOX, width: ICON_SIZE, height: ICON_SIZE, 'aria-hidden': 'true', focusable: 'false' },
  }, ICON_PATHS.map((path) => common.s('path', { cls: 'rm-icon-stroke', attrs: { d: path } })));
}

/**
 * Builds the "Legend & sources" button now and wires it to the panel once the panel exists.
 * @param {object} common ui-common helpers (`h`, `s`)
 * @param {HTMLElement} root the page root that carries the open class
 * @returns {{button: HTMLElement, attach: function(HTMLElement): void}} `attach` takes the
 *   legend block (metric switch, legend, attribution) and turns it into the panel
 */
export function createSources(common, root) {
  const { h } = common;
  let isOpen = false;
  let panel = null;
  const button = h('button', {
    cls: 'rm-map-button rm-sources-button',
    attrs: {
      type: 'button', 'aria-label': STRINGS.buttonLabel, title: STRINGS.buttonLabel,
      'aria-expanded': 'false', 'aria-controls': PANEL_ID, 'aria-haspopup': PANEL_ROLE,
    },
  }, [buildIcon(common)]);
  const closeButton = h('button', {
    cls: 'rm-icon-button', text: STRINGS.closeSymbol, attrs: { type: 'button', 'aria-label': STRINGS.closeLabel },
  });

  const apply = () => {
    root.classList.toggle(OPEN_CLASS, isOpen);
    button.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      panel.setAttribute('role', PANEL_ROLE);
      panel.setAttribute('aria-labelledby', PANEL_TITLE_ID);
    } else {
      panel.removeAttribute('role');
      panel.removeAttribute('aria-labelledby');
    }
  };
  const open = () => { isOpen = true; apply(); closeButton.focus(); };
  const close = (shouldRefocus) => {
    if (!isOpen) return;
    isOpen = false;
    apply();
    if (shouldRefocus) button.focus();
  };

  // Capture phase and preventDefault, like the privacy panel: the page's own Escape handler then
  // leaves an open district or country card alone.
  document.addEventListener('keydown', (event) => {
    if (event.key !== ESCAPE_KEY || !isOpen) return;
    event.preventDefault();
    close(true);
  }, true);
  document.addEventListener('click', (event) => {
    if (!isOpen || panel.contains(event.target) || button.contains(event.target)) return;
    close(false);
  });
  button.addEventListener('click', () => (isOpen ? close(true) : open()));
  closeButton.addEventListener('click', () => close(true));

  return {
    button,
    attach(legendBlock) {
      panel = legendBlock;
      panel.id = PANEL_ID;
      panel.prepend(h('div', { cls: 'rm-sources-header' }, [
        h('h2', { cls: 'rm-sources-title', text: STRINGS.panelTitle, attrs: { id: PANEL_TITLE_ID } }),
        closeButton,
      ]));
    },
  };
}
