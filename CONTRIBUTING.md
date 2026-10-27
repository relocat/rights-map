# Contributing to the Relocat Rights Map

Thank you for helping. The most useful contribution is a correct, sourced fix
to the data. Code fixes and test improvements are welcome too.

## Licence and sign-off

The code is licensed under the GNU General Public License, version 3 or (at
your option) any later version (`LICENSE`). The rights data is licensed under
CC BY 4.0 (`LICENSE-DATA`). Every contribution is accepted under the same
licence as the file it changes: inbound licence equals outbound licence. There
is no contributor licence agreement and no copyright assignment. You keep the
copyright in your work.

Every source file carries this header; keep it on files you add and do not
remove it from files you change:

```
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) <years> <holder> and Relocat contributors
```

### Developer Certificate of Origin

We use the Developer Certificate of Origin (DCO), version 1.1: a short
statement that you wrote the code, or otherwise have the right to submit it,
under the licence of the file. You agree to it by adding a `Signed-off-by` line
to every commit:

```
Signed-off-by: Your Name <your email address>
```

Use the name you are known by and an email address you control. `git commit -s`
adds the line for you. A pull request is merged only when every commit in it is
signed off. If you forgot, amend the commit (`git commit --amend -s`) or rebase
with `git rebase --signoff`.

The full text of the DCO follows. It is also published at
<https://developercertificate.org/>.

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

## Fixing data

The files `web/static/public/rights_map/data/rules.v1.json` and
`authorities.de.v1.json` are the data. To fix a fact:

1. Find the official source (law text, ministry or authority page). Press
   articles are not enough on their own.
2. Change the JSON and keep the source link and the date you checked it.
3. Run the validator: `cd tools && npm ci --ignore-scripts && node validate.mjs --root ..`.
   It must report 0 problems.
4. Run the unit tests: `node --test 'tests/js/**/*.test.mjs'`.
5. Open a pull request with the source link in the description.

Community figures come from user reports and are published only for a minimum
number of reports. Do not edit them by hand.

## Trademarks

Contributing does not give you any right to the "Relocat" name or logo. See
`TRADEMARKS.md`.

## How contributions flow

The Rights Map is developed in a private repository and published here as
snapshots. The maintainers check issues and pull requests about once a month.
Accepted changes are ported onto the internal development branch, reviewed
there, and shipped here with the next snapshot. We credit you in the release
notes and keep your authorship where the port allows. A quiet pull request is
not a forgotten one. Small, focused changes with tests are the easiest to port.

## Security issues

Do not open public issues for security problems. Follow [SECURITY.md](SECURITY.md).

## AI-assisted development

AI tools are welcome. Say so in the pull request, review the output yourself,
and do not submit code you cannot explain. You are accountable for what you
submit.

## Questions

Open an issue using one of the templates, or write to office@relocat.org.
