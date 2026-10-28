# Relocat Rights Map

An interactive map of residence, work and family rights for people who move
between European countries: pick a country and a topic, and the map shows the
rules, the authority in charge, the deadlines and the sources. It runs entirely
in the browser: static files, no account and no tracking.

Live: <https://relocat.org/map/>

## How this repository works

This repository is published as **snapshots** from the maintainers' development
tree. Pull requests are welcome, but they are **reviewed here and then ported
into the next snapshot**, not merged directly, so a pull request stays open
until the snapshot that contains it is published. You are credited with a
`Co-authored-by:` trailer in that snapshot commit. Details are in
[CONTRIBUTING.md](CONTRIBUTING.md). To fix a fact in the data, start with
[docs/DATA.md](docs/DATA.md). All participants follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Try the demo

```
python3 -m http.server 8000
```

Then open <http://localhost:8000/demo/>. Run it from the repository root. Any
static file server that serves this directory works. The demo is the same map
app on a static page.

Scope: the report and experience forms need the Relocat server and are off in
this build. The demo shows the rules, the authorities and the geography only.

## Validate the data

```
cd tools && npm ci --ignore-scripts && node validate.mjs --root ..
```

The validator checks `web/static/public/rights_map/data/rules.v1.json` and
`authorities.de.v1.json` against the JSON schemas in
`web/static/public/rights_map/data/schema/` and runs the cross-checks (unique
ids, sources, dates, districts claimed once, community minimums).

## Run the tests

```
bash scripts/test-web-js.sh              # unit tests (installs tools/ first), Node 22 or newer
bash scripts/test-rights-map-browser.sh  # static browser test (Playwright)
```

The browser test needs a Chromium build once. After `npm ci --ignore-scripts
--prefix scripts/test-web-e2e`, install it with:

```
npx --prefix scripts/test-web-e2e playwright install chromium
```

On a fresh Linux machine add `--with-deps` (as the CI workflow does) to also
install the system libraries.

## Layout

| Path | What |
|---|---|
| `web/static/public/rights_map/` | the map app (JavaScript, CSS) and the data |
| `web/static/geo/v1/` | the built geo pack (countries, regions, districts, cities) |
| `geo/` | the scripts that build the geo pack, and the city input list |
| `tests/js/`, `tests/browser/` | unit tests and the browser test driver |
| `tools/` | the Node data validator |
| `demo/` | the static demo page |
| `docs/` | [DATA.md](docs/DATA.md): the data files, field by field, and how to fix one |

## Licences

Every file states its licence: in its own header, or in [REUSE.toml](REUSE.toml)
(check with `reuse lint`). The licence texts are in `LICENSES/`.

- Code: GNU GPL, version 3 or later ([LICENSE](LICENSE)).
- Rights data (`rules.v1.json`, `authorities.de.v1.json`) and their JSON schemas:
  CC BY 4.0 ([LICENSE-DATA](LICENSE-DATA)). Attribution: "Relocat Rights Map
  (https://relocat.org/map/), CC BY 4.0".
- Geographic data: each source keeps its own licence and credit, see
  [NOTICE](NOTICE). Natural Earth is public domain, GeoNames is CC BY 4.0, and
  the district boundaries of Germany are © BKG (2026) dl-de/by-2-0.

## Trademark

The name Relocat and the Relocat logo are trademarks and are not licensed under
the GPL or CC BY; forks must use a different name. See
[TRADEMARKS.md](TRADEMARKS.md).

## Security

Report vulnerabilities as described in [SECURITY.md](SECURITY.md).
