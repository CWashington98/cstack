# Proposal: spec compliance

## Why

A pull request can pass every test and still not do what its spec says. Today nothing proves that each acceptance scenario has a test, that the test checks what the scenario says, or that nothing was built outside the spec. Reviewers check this by judgment when they remember to, so it gets missed.

This week showed it more than once:

- A guard fix was marked "fixed" for the database tool. Its tests passed, but they used an input the real tool never sends, so the real production calls still got through. A reviewer found it by reading the tool's source.
- An installer fix passed its tests but stopped finding plugins when run from deep inside a project. No scenario described that case, so no test covered it.
- Tests were named after the behavior they were meant to protect, but some would still pass if that behavior broke. Only breaking the code on purpose showed it.

## Who it's for

Anyone using cstack's fixed flow on any project: the person who approves the spec, and the agents that build and review against it.

## Before / After

- **Before:** "the tests pass" is the bar, and whether they match the spec is a reviewer's opinion.
- **After:** code proves every scenario has a test that ran, failed on the old code and passes on the new. A reviewer then judges only what code can't, and on high-risk code the spec can run as the test itself.

## What Changes

- **A spec-compliance check that code runs,** the same way every time. It runs after building and before any reviewer. It proves:
  - every scenario has a task and a test;
  - the tests ran, and fail on the old code and pass on the new;
  - locked acceptance tests weren't edited;
  - nothing was built that no task explains;
  - the spec is still the one that was approved.
  It writes a report, and it can be run by hand before the runner exists.
- **A spec-match reviewer.** An AI lens in the review step. It reads each scenario next to its test, and checks each requirement's "shall" statement against the change. It also says when the spec itself looks wrong. It is fed the compliance report and never sees the pull request description.
- **Executable specs, as an opt-in project setting.** Each GIVEN, WHEN and THEN line is bound to test code, so running the spec runs the test. It starts with high-risk code in projects that turn it on.
- **Measurements in each run's record,** so the retro can decide from numbers whether executable specs are worth widening.

## Capabilities

### New Capabilities

- `runner/spec-compliance`: proving that a change does what its spec says, by code where possible and by a reviewer where not.

### Modified Capabilities

None. No specs exist in cstack yet.

## Non-goals

- Writing the specs. The spec step and OpenSpec's propose command do that.
- The runner itself. This check is one step the runner will call. It also works on its own until then.
- Forcing executable specs on every project. They cost time to set up, and they pay off only where mistakes are costly.

## Impact

- **New code in the verify plugin:** the compliance check and its report, and a brief for the spec-match reviewer.
- **The project settings file** gains a few optional fields: how to run tests by name, where acceptance tests live, and which tool runs executable specs.
- **cstack's default OpenSpec rules** add a `Covers:` line to each task and a `[scenario-id]` in each acceptance test's name.
- No change for projects that don't use the fixed flow.
