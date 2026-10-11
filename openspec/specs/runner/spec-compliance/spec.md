# runner/spec-compliance Specification

## Purpose
Proves that a change does what its approved spec says. Code proves what it can, the same way on every run: every scenario has a task and a test that failed on the old code and passes on the new, locked tests stay locked, and the spec still matches what was approved. A spec-match reviewer judges what code can't: whether each test checks the whole outcome its scenario promises. It works in any project through that project's settings file alone.

## Requirements

### Requirement: every-scenario-is-traced

The compliance check SHALL confirm that every scenario in the change's specs is covered by at least one task, and by at least one test whose name carries the scenario's ID in square brackets. It SHALL hold the change when any link is missing, and name each missing link.

#### Scenario: scenario-without-a-task

- **GIVEN** a change whose spec has a scenario `export-csv-downloads`
- **AND** no task's `Covers:` line names `export-csv-downloads`
- **WHEN** the compliance check runs
- **THEN** it holds the change
- **AND** the report says `export-csv-downloads` has no task

#### Scenario: task-cites-an-unknown-scenario

- **GIVEN** a task whose `Covers:` line names `export-pdf`
- **AND** no scenario in the change has that ID
- **WHEN** the compliance check runs
- **THEN** it holds the change
- **AND** the report names the task and the unknown ID

#### Scenario: setup-task-needs-no-scenario

- **GIVEN** a task marked `Setup:` with no `Covers:` line
- **WHEN** the compliance check runs
- **THEN** that task is not reported as missing a scenario

#### Scenario: scenario-without-a-test

- **GIVEN** a scenario `export-csv-downloads` with a task
- **AND** no test name contains `[export-csv-downloads]`
- **WHEN** the compliance check runs
- **THEN** it holds the change
- **AND** the report says `export-csv-downloads` has no test

#### Scenario: test-cites-an-unknown-scenario

- **GIVEN** a test named with `[export-xlsx]`
- **AND** no scenario in the change or the project's specs has that ID
- **WHEN** the compliance check runs
- **THEN** it holds the change
- **AND** the report names the test and the unknown ID

### Requirement: scenario-tests-really-ran

The compliance check SHALL run each scenario's tests by name, using the project's command for running tests by name. It SHALL hold the change when any scenario's tests did not run, and it SHALL report how many ran against how many were expected.

#### Scenario: all-scenario-tests-ran

- **GIVEN** a change with 4 scenarios, each with one test
- **WHEN** the compliance check runs the tests by name
- **THEN** the report says 4 of 4 ran

#### Scenario: a-scenario-test-did-not-run

- **GIVEN** a change with 4 scenarios
- **AND** one scenario's test is skipped or not picked up by the test command
- **WHEN** the compliance check runs
- **THEN** it holds the change
- **AND** the report says 3 of 4 ran and names the scenario whose test did not run

### Requirement: tests-fail-first-then-pass

For each scenario, the compliance check SHALL run its tests on the commit the change started from and on the change's latest commit. The tests SHALL fail on the first and pass on the second. A failure only counts when a test ran and an assertion failed. A crash, a missing file or a test that never ran SHALL NOT count as failing first.

#### Scenario: fails-on-old-passes-on-new

- **GIVEN** a scenario whose test fails on the starting commit because an assertion is not met
- **AND** passes on the latest commit
- **WHEN** the compliance check runs
- **THEN** the report marks that scenario as proven

#### Scenario: passes-on-old-code-too

- **GIVEN** a scenario whose test passes on the starting commit as well as the latest
- **WHEN** the compliance check runs
- **THEN** it holds the change
- **AND** the report says the test doesn't depend on the change

#### Scenario: crash-is-not-a-real-failure

- **GIVEN** a scenario whose test, on the starting commit, fails only because a module it imports doesn't exist yet
- **WHEN** the compliance check runs
- **THEN** that does not count as failing first
- **AND** the report asks for a test that reaches an assertion on the old code, for example through a stub

#### Scenario: fails-on-new-code

- **GIVEN** a scenario whose test fails on the latest commit
- **WHEN** the compliance check runs
- **THEN** it holds the change and names the failing test

### Requirement: locked-acceptance-tests-stay-locked

Once acceptance tests are committed as locked, the compliance check SHALL hold the change if any locked test file was changed or deleted afterwards. The exception is a commit that carries a `Spec-Change:` line naming the spec change that requires the edit.

#### Scenario: builder-edits-a-locked-test

- **GIVEN** acceptance tests locked in an earlier commit
- **AND** a later commit edits one of them with no `Spec-Change:` line
- **WHEN** the compliance check runs
- **THEN** it holds the change and names the commit and file

#### Scenario: spec-change-allows-the-edit

- **GIVEN** acceptance tests locked in an earlier commit
- **AND** a later commit edits one of them with a `Spec-Change:` line naming the spec change
- **WHEN** the compliance check runs
- **THEN** that edit is not held
- **AND** the report lists it as an allowed edit

#### Scenario: a-test-is-weakened-or-skipped

- **GIVEN** a change that marks an existing test as skipped, deletes it, or removes one of its assertions
- **AND** no `Spec-Change:` line explains it
- **WHEN** the compliance check runs
- **THEN** it holds the change and names the test

### Requirement: nothing-built-outside-the-spec

The compliance check SHALL list every changed file that no task declares it touches. Test files, the change's own spec files and files matching the project's always-allowed patterns are exempt. In version 0 the list SHALL be a warning in the report, not a hold.

#### Scenario: unexplained-file-is-listed

- **GIVEN** a change that edits `src/billing.ts`
- **AND** no task declares that it touches `src/billing.ts`
- **WHEN** the compliance check runs
- **THEN** the report lists `src/billing.ts` as possible scope creep
- **AND** the change is not held for it

#### Scenario: declared-file-is-not-listed

- **GIVEN** a change that edits `src/export.ts`
- **AND** a task declares that it touches `src/export.ts`
- **WHEN** the compliance check runs
- **THEN** `src/export.ts` is not listed as possible scope creep

### Requirement: spec-matches-what-was-approved

The compliance check SHALL compare the change's spec files with the text recorded at approval. When they differ, it SHALL hold the change and send it back for approval, naming what changed.

#### Scenario: spec-edited-after-approval

- **GIVEN** a spec approved with a recorded fingerprint of its text
- **AND** a scenario's THEN line edited afterwards
- **WHEN** the compliance check runs
- **THEN** it holds the change
- **AND** the report says the spec needs approval again and shows the edited lines

### Requirement: tests-exercise-their-code

On the high-risk lane, the compliance check SHALL break each changed line in turn and run the tests of the scenarios whose tasks changed that line. Each break SHALL make at least one of those tests fail. A break no test notices SHALL hold the change unless it carries a written reason.

#### Scenario: break-is-caught

- **GIVEN** a high-risk change whose task changed a condition in `src/seats.ts`
- **WHEN** the check flips that condition
- **THEN** a test of that task's scenarios fails
- **AND** the report marks the line as covered

#### Scenario: break-goes-unnoticed

- **GIVEN** a high-risk change whose task changed a limit in `src/seats.ts`
- **WHEN** the check moves that limit by one and every test of that task's scenarios still passes
- **THEN** it holds the change
- **AND** the report names the line and the break

#### Scenario: normal-lane-skips-the-breaks

- **GIVEN** a change on the normal lane
- **WHEN** the compliance check runs
- **THEN** it does not break any lines
- **AND** the report says this check was skipped for the lane

### Requirement: spec-match-review

In the review step, on the normal and high-risk lanes, a spec-match reviewer SHALL be given the change's specs, its task list, the change itself, its tests and the compliance report. It SHALL NOT be given the pull request description or the author's reasoning. It SHALL return a verdict for each scenario: matches, partly, or missing. Each finding SHALL state what breaks, for whom, how likely it is, and the cost to fix. A finding that says the spec itself looks wrong SHALL send the change back for approval rather than to the build.

#### Scenario: test-checks-something-else

- **GIVEN** a scenario whose THEN line says the seat count drops by one
- **AND** its test only checks that the call succeeds
- **WHEN** the spec-match reviewer runs
- **THEN** it marks that scenario as partly
- **AND** its finding says which part of the THEN line is unchecked

#### Scenario: reviewer-never-sees-the-description

- **GIVEN** a change with a pull request description
- **WHEN** the spec-match reviewer is started
- **THEN** its inputs contain the specs, task list, change, tests and compliance report
- **AND** they do not contain the pull request description

#### Scenario: spec-looks-wrong

- **GIVEN** a scenario that contradicts another scenario in the same spec
- **WHEN** the spec-match reviewer reports it
- **THEN** the change goes back to the spec approval step
- **AND** it does not go back to the build step

### Requirement: executable-specs-when-turned-on

When a project's settings turn on executable specs and name the tool and command that runs them, every GIVEN, WHEN, THEN and AND line in the change's scenarios SHALL be bound to test code. Every binding for a THEN or AND line under THEN SHALL contain at least one assertion. Running the specs SHALL count as running the scenarios' tests for every other requirement here. Projects that don't turn it on SHALL see no change.

#### Scenario: unbound-then-line

- **GIVEN** a project with executable specs turned on
- **AND** a scenario whose THEN line has no binding
- **WHEN** the compliance check runs
- **THEN** it holds the change and names the unbound line

#### Scenario: binding-without-an-assertion

- **GIVEN** a project with executable specs turned on
- **AND** a THEN line bound to code that asserts nothing
- **WHEN** the compliance check runs
- **THEN** it holds the change and names the binding

#### Scenario: setting-off-changes-nothing

- **GIVEN** a project whose settings don't turn on executable specs
- **WHEN** the compliance check runs
- **THEN** it uses the tests named with scenario IDs
- **AND** it never asks for bindings

### Requirement: each-run-is-measured

Each compliance run SHALL add to the run's record:

- how many scenarios were checked, and which checks held the change;
- how many mismatches the spec-match reviewer found, and how long each part took.

When executable specs are on, it SHALL also record:

- the time spent writing bindings;
- the mismatches between tests and THEN lines that the bindings prevented.

#### Scenario: record-has-the-numbers

- **GIVEN** a completed compliance run
- **WHEN** the run's record is read
- **THEN** it shows scenarios checked, holds by check, reviewer mismatches and time per part

### Requirement: works-in-any-project

The compliance check SHALL work in any repository using only that repository's settings file. It SHALL name no project, test framework or language in its own code. A portability test SHALL run it end to end on two small sample repositories, one using TypeScript and one using Python.

#### Scenario: typescript-sample

- **GIVEN** a sample TypeScript repository whose settings give its test command and its run-by-name command
- **WHEN** the compliance check runs on a sample change there
- **THEN** it produces a complete report

#### Scenario: python-sample

- **GIVEN** a sample Python repository whose settings give its test command and its run-by-name command
- **WHEN** the compliance check runs on a sample change there
- **THEN** it produces a complete report

#### Scenario: no-framework-names-in-the-code

- **GIVEN** the compliance check's source files
- **WHEN** they are searched for project, test framework or language names
- **THEN** none are found outside example settings and tests
