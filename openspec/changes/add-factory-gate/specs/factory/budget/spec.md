## ADDED Requirements

### Requirement: budget-reads-every-subscription

`factory budget` SHALL read usage from two places:

- **Claude accounts.** The last known usage of every Claude account folder given with `--claude-dir`. With no `--claude-dir`, it reads every folder in the home directory whose name starts with `.claude` and whose `.claude.json` holds a usage reading. Folders whose names contain `.bak` are skipped.
- **Codex.** The newest rate-limit reading in the Codex session logs under `--codex-dir`, which defaults to `~/.codex/sessions`.

For each subscription it SHALL print:

- the percent used of the 5-hour and weekly limits;
- the weekly reset time;
- the pace: weekly percent used divided by the percent of the week that has passed;
- a mode.

With `--json` it SHALL print the same as JSON.

**Mode** follows these rules, checked in this order:

1. **stop:** either limit at 90% or more;
2. **lean:** the reading is older than 12 hours, or pace is above 1.25 with more than 24 hours to the weekly reset;
3. **normal:** otherwise.

A stale reading SHALL say it is stale.

#### Scenario: fast-pace-is-lean

- **GIVEN** an account at 60% of its weekly limit, 1.6 days into its week, read 1 hour ago
- **WHEN** `factory budget` runs
- **THEN** that account's pace is about 2.6 and its mode is lean

#### Scenario: ninety-percent-is-stop

- **GIVEN** an account at 92% of its weekly limit
- **WHEN** `factory budget` runs
- **THEN** its mode is stop

#### Scenario: stale-reading-is-lean

- **GIVEN** an account whose reading is 20 hours old and shows 10% used
- **WHEN** `factory budget` runs
- **THEN** its mode is lean and it is marked stale

#### Scenario: backup-folders-skipped

- **GIVEN** a home folder with `.claude-work` and `.claude-work.bak-2026-08-21`, both holding readings
- **WHEN** `factory budget` runs with no `--claude-dir`
- **THEN** only `.claude-work` is listed

### Requirement: budget-routes-the-cross-family-lane

`factory budget` SHALL say which model the Breaker review lane uses for each zone. The rules are:

| Codex reading | Low zone | Standard and high zones |
|---|---|---|
| Weekly under 70% and 5-hour under 90% | Codex | Codex |
| Weekly from 70% up to 90% | Opus | Codex |
| Weekly at 90% or more, or 5-hour at 90% or more | Opus | Opus |
| No reading, or a stale one | Opus | Opus |

Every route SHALL come with a one-line reason.

#### Scenario: codex-under-seventy-everywhere

- **GIVEN** a Codex reading of 66% weekly and 11% of the 5-hour limit, 1 hour old
- **WHEN** `factory budget` runs
- **THEN** the Breaker uses Codex for every zone

#### Scenario: codex-seventy-to-ninety-saves-it

- **GIVEN** a Codex reading of 75% weekly
- **WHEN** `factory budget` runs
- **THEN** the Breaker uses Codex for the standard and high zones and Opus for the low zone

#### Scenario: codex-missing-uses-opus

- **GIVEN** no Codex session logs
- **WHEN** `factory budget` runs
- **THEN** the Breaker uses Opus for every zone, with the reason "no Codex reading"
