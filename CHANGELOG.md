# Changelog

Phaseline follows semantic versioning. Before 1.0, a minor version may change behavior;
each change that can alter an existing result is marked **Changed behavior**.

## 0.5.0 (release candidates; install with @next)

### Licensing and releases
- Licensed under Apache-2.0, published from github.com/verifyrun/phaseline with npm
  provenance and a signed GitHub release. First release from the public repository: rc.53.

### Changed behavior
- A malformed record is refused with exit 1 and names the record: a date string or
  fraction in `at` or `recorded`, a field other than subject, at, recorded, source, by
  and value, or a missing field. Before, such a record was skipped and the fact held as
  missing. Convert dates to whole numbers on one clock before calling decide.
- A case is refused when it has a field other than subject, at, asOf and records, or a
  key repeated in one JSON object.
- The case error now names the field that is wrong.

### Added
- `latest`: the most recently written eligible record settles a fact.
- `within N`: only records written within N time units of the review count.
- `standing`: an approval recorded for an earlier event can serve later requests, read
  as in force at the review time.
- `standing at event`: the same, read as in force at the request's own time, using every
  record known by the review. Use it for audits and historical questions.
- `decide --gate GUARANTEE`: exit 0 on release and 2 on hold or withhold.
- `serve`: a local HTTP service for decide, gate and compare.
- A library entry (`import {decide, gate, compare, serve} from "@verifyrun/phaseline"`)
  with TypeScript types that compile without @types/node.
- `#` note lines in rule and observer files.
- `phaseline --help` lists everyday commands; `--help all` lists every command.

### Fixed
- Decisions with many unrecorded facts stay fast instead of trying every combination.

## 0.4.1 and earlier

Published versions on npm. See the package README of each version.
