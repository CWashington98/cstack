## MODIFIED Requirements

### Requirement: tests-fail-first-then-pass

The fail-first rule applies to each scenario that is neither a guard nor carried over from the living spec. For such a scenario, the compliance check SHALL run its tests on the commit the change started from and on the change's latest commit. The tests SHALL fail on the first and pass on the second. A failure only counts when a test ran and an assertion failed. A crash, a missing file or a test that never ran SHALL NOT count as failing first.

#### Scenario: fails-on-old-passes-on-new

- **GIVEN** a scenario whose test fails on the starting commit because an assertion is not met
- **AND** passes on the latest commit
- **WHEN** the compliance check runs
- **THEN** the report marks that scenario as proven

#### Scenario: passes-on-old-code-too

- **GIVEN** a scenario not marked as a guard, whose test passes on the starting commit as well as the latest
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

## ADDED Requirements

### Requirement: guard-scenarios-are-proven-by-breaking-what-they-protect

A scenario whose first bullet is a `**GUARDS**` line describes existing behavior the change must not alter. For such a scenario, the compliance check SHALL require its tests to pass on the starting commit and on the latest commit. It SHALL then break conditions and limits in the files that the scenario's covering task touches, at most 30 breaks per scenario, and SHALL require at least one break to make the scenario's tests fail. It SHALL restore every file exactly and never change the working folder.

#### Scenario: guard-passes-before-and-after

- **GIVEN** a scenario marked as a guard, whose test passes on the starting commit and on the latest commit
- **AND** breaking a condition in a file its task touches makes the test fail
- **WHEN** the compliance check runs
- **THEN** the report marks the scenario as proven as a guard
- **AND** the report names the break that the test caught

#### Scenario: guard-fails-on-old-code

- **GIVEN** a scenario marked as a guard, whose test fails on the starting commit
- **WHEN** the compliance check runs
- **THEN** it holds the change
- **AND** the report says a guard's test must pass before the change too

#### Scenario: guard-fails-on-new-code

- **GIVEN** a scenario marked as a guard, whose test passes on the starting commit and fails on the latest commit
- **WHEN** the compliance check runs
- **THEN** it holds the change
- **AND** the report says the change altered behavior the guard protects, and names the test

#### Scenario: guard-catches-no-break

- **GIVEN** a scenario marked as a guard, whose test passes on both commits
- **AND** no break in the files its task touches makes the test fail
- **WHEN** the compliance check runs
- **THEN** it holds the change
- **AND** the report says the guard's test doesn't protect the code its task names, and how many breaks were tried

#### Scenario: guard-breaks-respect-the-cap

- **GIVEN** a scenario marked as a guard whose task touches files with more than 30 conditions and limits
- **WHEN** the compliance check runs
- **THEN** it tries at most 30 breaks for that scenario
- **AND** the report says how many it tried and that the cap was reached

### Requirement: carried-over-scenarios-must-still-pass

A scenario in a MODIFIED requirement is carried over when the living specs under `openspec/specs/` hold a scenario with the same ID. Its GIVEN, WHEN, THEN and AND lines must also match after trimming whitespace. OpenSpec makes a change copy a modified requirement's whole block. So the block holds scenarios the change did not write. For a carried-over scenario, the compliance check SHALL require its tests to pass on the starting commit and on the latest commit. It SHALL NOT require a task for it, and SHALL NOT break code for it. A scenario whose wording changed is new, and the fail-first rule applies to it.

#### Scenario: carried-over-passes-before-and-after

- **GIVEN** a scenario in a MODIFIED requirement with the same ID and the same wording as a scenario in the living spec
- **AND** no task covers it, and its test passes on the starting commit and on the latest commit
- **WHEN** the compliance check runs
- **THEN** the report marks the scenario as proven as carried over
- **AND** it holds nothing for the missing task or for passing on the old code

#### Scenario: carried-over-fails-on-new-code

- **GIVEN** a carried-over scenario whose test passes on the starting commit and fails on the latest commit
- **WHEN** the compliance check runs
- **THEN** it holds the change
- **AND** the report says the change broke a scenario it carried over, and names the test

#### Scenario: carried-over-wording-changed

- **GIVEN** a scenario in a MODIFIED requirement with the same ID as a living scenario but different wording
- **AND** its test passes on the starting commit as well as the latest
- **WHEN** the compliance check runs
- **THEN** it holds the change, because a scenario with changed wording is new
- **AND** the report says the test doesn't depend on the change
