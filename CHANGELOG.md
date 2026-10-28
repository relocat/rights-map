# Changelog

All notable changes to the Relocat Rights Map are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This
repository is published as dated snapshots, so each release below is a
snapshot date rather than a version number. Contributors whose pull requests
were ported into a snapshot are credited in its commit and named here.

## [Unreleased]

### Added

- `CODE_OF_CONDUCT.md`: the Contributor Covenant 2.1, linked from the README and
  CONTRIBUTING.
- REUSE compliance: licence texts in `LICENSES/` (GPL-3.0-or-later, CC-BY-4.0,
  CC0-1.0, OFL-1.1 and the Datenlizenz Deutschland 2.0 text), a `REUSE.toml`
  for the files without an SPDX header, and a `reuse lint` CI job.
- `docs/DATA.md`: the two data files, field by field, with a worked example of
  fixing one authority.
- This changelog, and an upfront description of the snapshot contribution model
  in the README and CONTRIBUTING.
- Dependabot updates (weekly) for the npm dev dependencies and the GitHub
  Actions.

### Changed

- The demo is started with `python3 -m http.server 8000` instead of `npx serve`.
- The README documents the one-time Chromium install for the browser test.
- Comments in the stylesheet and the browser test refer to the host page's theme
  tokens (`demo/demo.css` in the demo) instead of a site file.
- The DCO check tolerates trailing whitespace and a carriage return after the
  `Signed-off-by` line, and has a time limit.
- Snapshot commits now carry a `Signed-off-by` trailer, and a
  `Co-authored-by` trailer for every ported contributor.

## [2026-10-28]

### Changed

- The demo bundles the Albert Sans and JetBrains Mono fonts (SIL Open Font
  License 1.1, licence texts alongside), so the demo looks like the live page and
  the layout tests no longer depend on the fonts installed on the machine.

## [2026-10-27]

### Added

- Initial snapshot: the Rights Map browser app, the rules data
  (`rules.v1.json`) and the German authorities data (`authorities.de.v1.json`)
  with their JSON schemas, the geo pack and the scripts that build it, the Node
  data validator, the unit and browser tests, and a static demo.
- Licensing: GPL-3.0-or-later for the code, CC BY 4.0 for the rights data, and
  per-source licences for the geo data (see `NOTICE`); trademark policy,
  security policy, contribution guide with the Developer Certificate of Origin,
  and issue and pull request templates.
