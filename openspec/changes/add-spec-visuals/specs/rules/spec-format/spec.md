## ADDED Requirements

### Requirement: every-scenario-has-a-worked-example

**The rule.** A scenario SHALL end with a bullet that starts `**EXAMPLE:**`. The example gives one real-looking case: concrete names, numbers and the exact output or message. A reader who has never seen the project can follow it.

**The check.** `verify-plan` SHALL hold a scenario that has no example. Scenarios that already existed at the commit given with `--since` only get advice, so older specs don't fail all at once.

#### Scenario: new-scenario-without-example-holds

- **GIVEN** a spec with a scenario added since the `--since` commit, and no `**EXAMPLE:**` bullet
- **WHEN** `verify-plan` runs on it with `--since`
- **THEN** it holds and names the scenario
- **EXAMPLE:** `spec.md` gains the scenario `over-size-holds` with GIVEN, WHEN and THEN only. `verify-plan spec.md --since main` prints `hold  Scenario "over-size-holds" has no worked example. Add an **EXAMPLE:** bullet with real names and numbers.`

#### Scenario: old-scenario-without-example-is-advice

- **GIVEN** a scenario with no example, unchanged since the `--since` commit
- **WHEN** `verify-plan` runs with `--since`
- **THEN** it reports advice for that scenario, not a hold
- **EXAMPLE:** A spec written in September has 12 scenarios and no examples. Run with `--since main`, `verify-plan` prints 12 `advice` lines and exits 0.

#### Scenario: scenario-with-example-passes

- **GIVEN** a new scenario whose last bullet starts `**EXAMPLE:**`
- **WHEN** `verify-plan` runs on it
- **THEN** the example rule raises nothing for it
- **EXAMPLE:** `rerun-replaces-record` ends with "The gate runs on #412 at 9:00 and again at 9:30. The folder holds one file." No example line appears in the output.

### Requirement: every-change-has-a-dated-diagram

**The rule.** An OpenSpec change folder SHALL have a `diagrams/` folder holding:

- at least one diagram that passes `plain`'s diagram checker;
- a `diagrams.json` entry for each diagram.

**The design embeds it.** The change's `design.md` SHALL show each diagram with a one-paragraph caption.

**The check.** `diagram-age --changes` SHALL hold a change folder that breaks either rule.

#### Scenario: change-without-diagram-holds

- **GIVEN** a change folder with no `diagrams/` folder
- **WHEN** `diagram-age --changes` runs
- **THEN** it holds and names the change
- **EXAMPLE:** `openspec/changes/add-thing/` has a proposal, specs, a design and tasks, but no diagrams. The output reads `hold  add-thing has no diagram. Draw one with to-diagram and stamp it in diagrams/diagrams.json.`

#### Scenario: diagram-not-in-design-holds

- **GIVEN** a change whose `diagrams/flow.svg` is stamped but not shown anywhere in `design.md`
- **WHEN** `diagram-age --changes` runs
- **THEN** it holds and names the diagram
- **EXAMPLE:** `add-thing/diagrams/flow.svg` exists, but `design.md` never mentions `diagrams/flow.svg`. The output reads `hold  add-thing: flow.svg isn't shown in design.md.`
