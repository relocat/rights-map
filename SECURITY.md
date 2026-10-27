# Security policy

This repository holds the browser app of the Relocat Rights Map, its data and
its geo pack. It has no server code. As published here, the map sends no user data to any server: your answers stay in your browser, and the report and experience forms are switched off because they need the Relocat server.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

- Preferred: GitHub private vulnerability reporting on this repository
  (Security, then Report a vulnerability).
- Alternative: email security@relocat.org with the subject line `SECURITY`.

You will get an acknowledgement within 7 days and a status update at least
every 14 days until the report is resolved.

## Scope

Welcome: script injection or unsafe handling of the data files in the map app,
a build or workflow that could leak secrets, and a data file that could
mislead users in a way that harms them (for example a wrong legal claim). The
hosted service at relocat.org is not part of this repository; reports about it
are welcome at the same address.
