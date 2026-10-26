## ADDED Requirements

### Requirement: diagrams-carry-a-stamp

**Every diagram is listed.** Every `.svg` file in a folder named `diagrams` SHALL have an entry in that folder's `diagrams.json`. Each entry holds:

- `file`;
- `question`, the one question the diagram answers;
- `depicts`, the file paths or patterns it shows;
- `made`;
- `lastValidated`.

Both dates are in `YYYY-MM-DD` form.

**The picture shows its date.** The diagram SHALL show its last-validated date in visible words, in the form "Last checked … on <day> <month> <year>". That date SHALL match `lastValidated`.

#### Scenario: unlisted-diagram-is-unstamped

- **GIVEN** a `diagrams/` folder holding `flow.svg` and a `diagrams.json` with no entry for it
- **WHEN** `diagram-age` runs
- **THEN** it reports `flow.svg` as unstamped and exits 1
- **EXAMPLE:** `docs/diagrams/flow.svg` was added last week, but nobody updated `docs/diagrams/diagrams.json`. The output reads `unstamped  docs/diagrams/flow.svg: no entry in diagrams.json`.

#### Scenario: visible-date-disagrees

- **GIVEN** an entry with `lastValidated` `2026-10-25`, and a picture that says "Last checked on 1 September 2026"
- **WHEN** `diagram-age` runs
- **THEN** it reports the diagram as unstamped, because the two dates disagree
- **EXAMPLE:** Someone re-validated `gate-flow.svg` and updated the file, but forgot the words in the picture. The output reads `unstamped  gate-flow.svg: the picture says 1 September 2026, diagrams.json says 2026-10-25`.

### Requirement: freshness-is-reported

`diagram-age` SHALL report each stamped diagram as exactly one of the states below. It SHALL take the first state in this order that applies:

1. **remove?:** `lastValidated` is more than `diagramRemoveAfterDays` ago. The default is 180 days.
2. **stale:** `lastValidated` is more than `diagramMaxAgeDays` ago. The default is 90 days.
3. **lagging:** git shows a commit after the `lastValidated` date that changed a path matching `depicts`. The report names that commit's date and one changed file.
4. **current:** otherwise.

Ages are counted from today's date, and both settings live in `.claude/plain.json`.

It SHALL exit 1 when any diagram is unstamped, and 0 otherwise. Lagging, stale and remove? are reported for a person to act on. They never fail a commit.

#### Scenario: depicted-file-changed-is-lagging

- **GIVEN** a diagram validated on 2026-10-25 that depicts `plugins/factory/scripts/lib/gate.mjs`
- **AND** a commit on 2026-11-03 changed that file
- **WHEN** `diagram-age` runs on 2026-11-05
- **THEN** it reports the diagram as lagging, naming 2026-11-03 and `gate.mjs`
- **EXAMPLE:** The output reads `lagging  gate-flow.svg: gate.mjs changed on 3 November 2026, after it was last checked on 25 October 2026`.

#### Scenario: unchecked-ninety-days-is-stale

- **GIVEN** a diagram whose `lastValidated` is 100 days ago, and whose depicted files haven't changed since
- **WHEN** `diagram-age` runs
- **THEN** it reports the diagram as stale
- **EXAMPLE:** `onboarding-flow.svg` was last checked on 17 July 2026, and nothing it shows has changed. On 25 October 2026 the output reads `stale  onboarding-flow.svg: last checked 100 days ago`.

#### Scenario: unchecked-half-year-proposes-removal

- **GIVEN** a diagram whose `lastValidated` is 200 days ago
- **WHEN** `diagram-age` runs
- **THEN** it reports it as `remove?`, and deletes nothing
- **EXAMPLE:** `old-sync.svg` was last checked on 8 April 2026. The output reads `remove?  old-sync.svg: last checked 200 days ago. Re-check it or delete it.` The file is still there afterwards.

#### Scenario: current-diagram-is-quiet

- **GIVEN** a diagram validated 10 days ago whose depicted files haven't changed since
- **WHEN** `diagram-age` runs
- **THEN** it reports the diagram as current and exits 0
- **EXAMPLE:** `gate-flow.svg` was checked on 15 October 2026. On 25 October 2026 the output reads `current  gate-flow.svg (checked 10 days ago)`.

### Requirement: validating-updates-both-dates

`diagram-age --validate <file>` SHALL set `lastValidated` to today. It SHALL also update the visible "Last checked … on" date in the picture. It SHALL refuse, and change nothing, when the diagram fails the `to-diagram` checker. It SHALL never change `made`.

#### Scenario: validate-updates-stamp-and-picture

- **GIVEN** a stale diagram that passes the `to-diagram` checker
- **WHEN** `diagram-age --validate` runs on it on 2026-10-25
- **THEN** its entry's `lastValidated` and the date shown in the picture both become 25 October 2026
- **EXAMPLE:** Someone re-reads `onboarding-flow.svg` against the code and finds it still right. They run `diagram-age --validate docs/diagrams/onboarding-flow.svg`. The next `diagram-age` run reports it as current.

#### Scenario: validate-refuses-a-failing-diagram

- **GIVEN** a diagram that fails the `to-diagram` checker
- **WHEN** `diagram-age --validate` runs on it
- **THEN** it exits 1 and changes neither file
- **EXAMPLE:** `onboarding-flow.svg` uses a red that isn't in the palette. `--validate` prints the checker's hold lines, and `lastValidated` keeps its old date.
