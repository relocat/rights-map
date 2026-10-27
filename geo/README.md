# Relocat geo pack v1

Static, unprojected WGS84 (`[lon, lat]`, 3 decimals) GeoJSON that backs the
Rights Map (`relocat.org/map/`). Built reproducibly into `web/static/geo/v1/`.

## Sources

| Source | Version | Licence | Pin |
|---|---|---|---|
| Natural Earth 1:10m Admin 0 Countries, **Ukraine point of view** (`ne_10m_admin_0_countries_ukr`) | 5.1.1 | Public domain | sha256 in `sources.lock.json` |
| Natural Earth 1:10m Admin 0 Countries, **default** (`ne_10m_admin_0_countries`) — used only for the Kosovo polygon | 5.1.1 | Public domain | sha256 in `sources.lock.json` (recorded on first download) |
| Natural Earth 1:50m Land (`ne_50m_land`) — the world land layer `land.json` | 5.1.1 | Public domain | sha256 in `sources.lock.json` (recorded on first download) |
| Natural Earth 1:10m Admin 1 States, Provinces | 5.1.1 | Public domain | sha256 in `sources.lock.json` |
| BKG VG250 Verwaltungsgebiete 1:250 000, Kreise (`vg250_krs`), 01.01.2026, UTM32 (EPSG:25832) shapefile, reprojected to WGS84 — the layer `l2/DE.json` | 2026-01-01 | dl-de/by-2-0 | sha256 in `sources.lock.json` |
| GeoNames `cities15000` | daily dump | CC BY 4.0 | not pinned; snapshot date + zip sha256 in `sources.lock.json` under `cities.snapshot`; the filtered `inputs/cities-europe.tsv` is the committed build input |

Attribution strings (also in `manifest.json`): `Natural Earth`, `GeoNames (CC BY 4.0)`.
The VG250 layer carries its own credit under `layers["l2/DE.json"]` in `manifest.json`, copied from
`sources.lock.json` (`vg250_krs`): `attribution`, `licence` (`dl-de/by-2-0`), `licence_url`,
`provider_url`, `datasources_url`, `dataset_url` and the change note `modified`.

BKG's own terms of use (`dokumentation/nutzungsbedingungen_vg250.pdf` in the VG250 archive, section 2
"Quellenvermerk") require this credit verbatim, and a change note (Veränderungshinweis):

```
© BKG (Jahr des letzten Datenbezugs) dl-de/by-2-0, Datenquellen: https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg_nuts.pdf
```

The year of the last data retrieval is **2026**. On a web page "BKG" links to
https://www.bkg.bund.de and "dl-de/by-2-0" to https://www.govdata.de/dl-de/by-2-0. The map footer,
shown while the district layer is visible, reads:

```
Districts: © BKG (2026) dl-de/by-2-0, Datenquellen: https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg_nuts.pdf · Data changed: geometry simplified and reprojected.
```

When the VG250 archive is refreshed, update the year in `attribution` (it is the year of the data
retrieval) and rebuild the pack.

### Germany districts (`l2/DE.json`)

Built by `build-l2.mjs` from `vg250_ebenen_0101/VG250_KRS.shp` inside
`vg250_01-01.utm32s.shape.ebenen.zip`. 2026 is published only as UTM32, so the
build reprojects with `-proj wgs84`. Findings from the 2026 edition:

- `GF = 4` marks land; the other values are water bodies and sea and are dropped.
- Features are dissolved by `AGS` (the 5-digit district key), copying `GEN` (name) and `BEZ`.
- `BEZ` values are mapped to `city` or `district` through an allow-list in
  `build-l2.mjs` (`Kreisfreie Stadt`, `Stadtkreis` → `city`; `Kreis`, `Landkreis`,
  `Regionalverband`, `Region`, `Städteregion` → `district`). An unknown value fails the build.
- `state` comes from the first two AGS digits (16 Länder). Berlin is the single district `11000`.
- Output: 401 features, properties `ags`, `name`, `type`, `state`, sorted by AGS.
- Budget: 700,000 bytes (`L2_DE_MAX_BYTES`, pinned by `tests/js/geo/geo-pack.test.mjs`);
  simplification is `SIMPLIFY_L2` (7%), the lowest value that passes. The build also
  fails outside 390 to 410 districts.

BKG publishes a new edition each 01.01. To refresh: update the URL, archive and
version in `sources.lock.json`, drop the old `sha256` so the build records the new
one, rebuild, review the `BEZ` and count checks, and commit the output.

Natural Earth admin-1 has no point-of-view variant and files Crimea (`UA-43`)
and Sevastopol (`UA-40`) under Russia. The build forces them to Ukraine
(`CRIMEA_ADMIN1_CODES`) so L1 agrees with the Ukraine-POV L0 layer.

The Ukraine point-of-view file has no Kosovo feature: its territory lies inside
Serbia. Decision (2026-10-20): Kosovo is shown as its own grey,
non-covered context region (`iso2: "XK"`, `covered: false`) and Serbia (`RS`,
covered) loses that area. The build takes the Kosovo polygon from the default
admin-0 file and erases it from Serbia only (`KOSOVO_NAME`, `KOSOVO_ISO2`).
Natural Earth admin-1 already files Kosovo's districts under `XK`, so `RS.json`
has none of them and no `XK` admin-1 file is written; `inputs/cities-europe.tsv`
has no Kosovo city. Crimea stays Ukrainian.

## Output

`land.json` (whole world, unclipped, dissolved, simplified to stay ≤ 400 KB), `countries.json` (covered countries plus context neighbours inside the Europe frame), `admin1/<ISO2>.json` (39 covered countries), `cities-t1.json`,
`cities-t2/<ISO2>.json`, `cities-t3/<ISO2>.json`, `l2/DE.json` (Germany districts, ≤ 700 KB), `manifest.json` (sha256 of every file and per-layer licence data).

## Rebuild

    npm ci --prefix geo && node geo/fetch-cities.mjs && node geo/build-geo-pack.mjs

`mapshaper` is pinned (`0.6.111`) and build-time only; it is never shipped.
`fetch-cities.mjs` is only needed to refresh GeoNames data. Any change to
inputs or build parameters requires re-running the build and committing the
output. Two consecutive
builds must be byte-identical.

Requires Node 22+ and the system `unzip`.
