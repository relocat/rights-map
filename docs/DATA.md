# The Rights Map data

This page explains the two data files so that you can fix one fact end to end:
find the record, change it, cite the source, validate, open a pull request.
It describes only what the files and their JSON schemas contain today. When this
page and a schema disagree, the schema is right; please open an issue.

Both files are plain JSON in `web/static/public/rights_map/data/`. They are
licensed CC BY 4.0 (see `LICENSE-DATA`). Their JSON schemas are in the
`schema/` folder next to them.

| File | Holds | Schema |
|---|---|---|
| `authorities.de.v1.json` | one record per German naturalisation authority: what it covers, how applications are handled, and how long they take, each with its source | `schema/authorities.schema.json` |
| `rules.v1.json` | the questions the map asks, the sources it cites, and the rules that turn answers into a result, for three topics | `schema/rules.schema.json` |

Most fixes touch `authorities.de.v1.json`. The rest of this page starts there.

## authorities.de.v1.json

### Top level

| Field | Meaning |
|---|---|
| `schema` | always `relocat-rights-map/authorities@1` |
| `country` | two capital letters, `DE` |
| `topic` | the topic id in `rules.v1.json` that uses this file (`de-naturalisation`) |
| `generated` | date (`YYYY-MM-DD`) of the last edit of the file; update it when you change anything |
| `notes` | list of plain-text notes about how the file was compiled |
| `authorities` | the list of records, described next |

### An authority record

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | unique, stable key, for example `de-sh-stadt-kiel` (country, Land, place). Never rename an id. |
| `name` | yes | the authority's official name |
| `unit` | yes | the department or office that decides (may be empty text) |
| `covers` | yes | list of the districts this authority decides for, as **5-digit AGS keys** (Amtlicher Gemeindeschluessel of the district, for example `01002` for Kiel). At least one. |
| `covers_label` | yes | the same coverage in words, shown on the map ("City of Kiel") |
| `mode` | yes | how to apply, see below |
| `address` | no | reserved for a postal or visiting address; an object, a string or `null`. Currently `null` wherever it appears. |
| `times` | yes | the three time figures `wait`, `proc`, `total`, see below |
| `community` | no | summary of user-reported times, see below. Do not edit by hand. |
| `evidence` | yes | at least one source entry, see below |

**`covers` rules.** Every key must be 5 digits and must exist in the shipped
district layer (`web/static/geo/v1/l2/DE.json`, property `ags`). A district may
be claimed by **one** authority only. The file's `notes` explain the cases where
a large town decides for itself inside a district.

**`mode`** says how an application is submitted.

| Field | Required | Meaning |
|---|---|---|
| `value` | yes | a short code or `null` when unknown. In use today: `online`, `appointment`, `paper`, `waiting_list`. |
| `text` | yes | the sentence shown to readers; `Not verified yet` when nobody has checked |
| `src` | yes | the kind of source, see "Source kinds" |
| `date` | no | when the statement was published or read |

### Time figures

`times` has exactly three entries. `wait` is the time before the authority starts
processing, `proc` is the processing time itself, and `total` is from application
to decision. **All numbers are months.** Each entry is an object:

| Field | Meaning |
|---|---|
| `src` | required. The kind of source, see below. `none` means no figure is known. |
| `lo` | the lower bound in months, a number of 0 or more. Required unless `src` is `none`. |
| `hi` | the upper bound in months. Omit it when the source gives one number; if present it must not be below `lo`. The map paints the district from `hi` if present, otherwise from `lo`. |
| `text` | the wording shown to readers ("7-9 months"). Required unless `src` is `none`. |
| `date` | when the source was published, or when you read it if the page is undated. `YYYY-MM-DD`, or `YYYY-MM` for a month. Required unless `src` is `none`. |
| `note` | optional free text: how you read the source, caveats |
| `partial` | `true` when the source gives only a lower limit ("more than 14 months"). The map marks the figure as open-ended. |
| `stale_exempt` | `true` for an official figure that cannot go out of date, such as "there is no waiting list". Use sparingly and explain it in `note`. |
| `evidence` | list of evidence ids (see below) that support this figure. Required for `src` `official`; every id must exist in the same record's `evidence`. |
| `n`, `range` | only for `src` `community`; see below |

A figure with `src` `none` carries nothing else: `{"src": "none"}`.

### Source kinds (`src`)

| `src` | Use it when | Counts as confirmed on the map |
|---|---|---|
| `official` | the authority, its Land ministry or a parliament document states the figure | yes, while fresh (below) |
| `press` | a news report quotes the authority or a statistic | no |
| `estimate` | a third party (for example a law firm) estimates the figure | no |
| `community` | the figure comes from user reports in this project's own pipeline | yes, with at least 5 reports |
| `none` | nothing is known | no |

**Stale figures.** An `official` figure whose `date` is more than 12 months old
is stale, and so is one without a valid date. The map shows it as unconfirmed
with the age in months. Re-check the source and update `date`, or set
`stale_exempt` where it is justified.

### Evidence entries

Every record lists the sources its figures rely on. Each entry:

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | unique within the record; time figures point to it |
| `kind` | yes | `official`, `press`, `community`, `estimate` or `none` |
| `title` | yes | what the source is, for example "City of Kiel, naturalisation page" |
| `text` | yes | the passage the figure comes from, as a short quote or close paraphrase |
| `date` | yes | publication date, or the date you read an undated page |
| `url` | no | link to the source. **Required for `official`; must start with `https://`.** |
| `via` | no | the outlet and date when the source is reported by someone else. **Required for `press`.** |
| `todo` | no | an open follow-up, for example "Link the primary council document." |

The entry with `"id": "none"` and `"kind": "none"` records that a search found no
figure and when. Keep it for records that still have a `none` figure, and leave it
alone otherwise.

**Quote rules.** Quote only what you need, name where it is from, and never copy
long passages: `text` is a pointer so a reviewer can find the sentence, not a
copy of the page. For an undated page use the date you read it and say so in the
time figure's `note`.

### The `community` block

`community` summarises times reported by users of the live map. It is generated;
contributors should not edit it, and a pull request that adds community figures
by hand will not be accepted. What the validator enforces:

- `n` is the number of reports. A block that holds only `{"n": 0}` is empty and fine.
- Figures (`wait_months`, `proc_months`, each a `[lo, hi]` pair, and `lo`/`hi` of
  a `community` time figure) are published only when `n` is **5 or more**, so no
  figure can single out one person.
- The range is the **interquartile range** (25th to 75th percentile), never the
  minimum and maximum, and the block says so with `"range": "iqr"`.
- Every published figure is a whole multiple of **3 months** (3, 6, 9, ...), so
  none is one person's exact value.

## rules.v1.json (overview)

The rules file drives the questions and the results for three topics. It is
larger and changes less often than the authorities file. The top level:

| Field | Meaning |
|---|---|
| `schema`, `fact_schema`, `generated` | format identifiers and the date of the last edit |
| `licence`, `attribution` | `CC-BY-4.0` and the credit line of the data |
| `notes` | plain-text notes about how the file was compiled |
| `groups` | named lists of country codes (`EU27`, `COVERED`) that rules refer to |
| `sources` | the sources rules cite, keyed by id: `label`, an `https://` `url`, and a `kind` of `primary`, `authority` or `news` |
| `facts` | the questions: each has an `id`, a `scope` (`profile` or `topic`), a `type` (`enum`, `month`, `year` or `bool`), a `label`, and for enums the list of `[code, label]` options |
| `migrations` | reserved for changes to stored answers; empty today |
| `topics` | the three topics: `ua-tp`, `eu-blue-card` and `de-naturalisation` |

Two kinds of topic exist.

- **Country topics** (`ua-tp`, `eu-blue-card`) have `rules`: each rule has an `id`,
  the `countries` it applies to (a group name or country codes), a `when`
  condition over the facts, a `status` (`ok`, `restricted`, `blocked`, `unknown`,
  `na`, `origin`) and a `detail` with the `reason` shown. A rule that says `ok`,
  `restricted` or `blocked` must list at least one `sources` id and a
  `last_verified` date, unless it is marked `draft`. Topics also have `tips` and
  `checks` that appear under the same kind of condition.
- **Authority topics** (`de-naturalisation`) point to an authorities file with
  `authorities_file` and `country`, define `requirements` the reader can tick
  off, and `colour` (the metrics the map can paint and the month thresholds of
  its colour buckets).

Cross-checks the validator runs on this file: unique ids, every fact, source and
country a rule names exists, every `when` condition uses a fact the topic reads
and a legal value, and the authorities file is a plain file name next to the
rules file.

## Worked example: an office published its new processing time

Suppose the City of Kiel's naturalisation office (`de-sh-stadt-kiel`) publishes
on its website that applications currently take about 10 to 12 months from
application to decision. Today its record says no figure is known. The numbers
below are made up for the example; use what the source really says.

1. **Find the record.** Search `authorities.de.v1.json` for the id
   `de-sh-stadt-kiel`. Its `times.total` is `{"src": "none"}`, and its `evidence`
   holds only the placeholder entry `none`.

2. **Add the evidence.** Open the page, note the date printed on it (or today's
   date if there is none) and add an entry next to the `none` entry:

   ```json
   {
     "id": "kiel-web-2026-11",
     "kind": "official",
     "title": "City of Kiel, naturalisation: how long it takes",
     "text": "Applications are currently decided within about 10 to 12 months.",
     "date": "2026-11-03",
     "url": "https://example.org/the-page-you-read"
   }
   ```

   The real `url` must start with `https://` because the kind is `official`.

3. **Replace the figure.** Change `times.total` and cite the evidence id:

   ```json
   "total": {
     "lo": 10,
     "hi": 12,
     "text": "About 10-12 months",
     "src": "official",
     "date": "2026-11-03",
     "evidence": ["kiel-web-2026-11"]
   }
   ```

   Leave `wait` and `proc` as `{"src": "none"}` unless the page gives them too.
   If it said "more than 10 months", you would write `"lo": 10`, no `hi`, and
   `"partial": true`.

4. **Tidy up.** Update `generated` at the top of the file. Because the record no
   longer has a `none` figure for `total` but still has `none` for `wait` and
   `proc`, keep the `none` evidence entry.

5. **Run the validator** from the repository root:

   ```
   cd tools && npm ci --ignore-scripts && node validate.mjs --root ..
   ```

   It must print `OK rules: 0 problems; authorities: 0 problems`. A mistake is
   reported as one line, for example `authorities: [evidence] authority
   de-sh-stadt-kiel evidence kiel-web-2026-11: url must start with https://`.

6. **Run the unit tests:** `node --test 'tests/js/**/*.test.mjs'`.

7. **Open a pull request.** Put the source link in the description, sign off
   every commit (`git commit -s`, see [CONTRIBUTING.md](../CONTRIBUTING.md)) and
   expect the change to be ported into the next snapshot rather than merged
   directly.
