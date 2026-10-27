# Relocat Rights Map

An interactive map of residence, work and family rights for people who move
between European countries: pick a country and a topic, and the map shows the
rules, the authority in charge, the deadlines and the sources. It runs entirely
in the browser: static files, no account and no tracking.

Live: <https://relocat.org/map/>

This repository is a published snapshot of the map app, its data and its geo
pack. The map is developed in a private repository; see
[CONTRIBUTING.md](CONTRIBUTING.md) for how changes flow.

## Try the demo

```
npx serve .
```

Then open `/demo/` (the port is printed by `serve`). Any static file server
that serves this directory works. The demo is the same map app on a static
page.

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

## Layout

| Path | What |
|---|---|
| `web/static/public/rights_map/` | the map app (JavaScript, CSS) and the data |
| `web/static/geo/v1/` | the built geo pack (countries, regions, districts, cities) |
| `geo/` | the scripts that build the geo pack, and the city input list |
| `tests/js/`, `tests/browser/` | unit tests and the browser test driver |
| `tools/` | the Node data validator |
| `demo/` | the static demo page |

## Licences

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
