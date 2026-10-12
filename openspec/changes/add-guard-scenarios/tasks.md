# Tasks

## 1. Acceptance tests, written first and failing

- [x] 1.1 Add one acceptance test per new scenario to a new locked file `plugins/verify/tests/guard-scenarios.test.mjs`, each named with its `[scenario-id]`, using small sample changes built in the test. Verify all five fail by an assertion on the current code, then commit them as locked. Covers: all. Touches: plugins/verify/tests/guard-scenarios.test.mjs

## 2. Reading and proving guards

- [x] 2.1 Note a `**GUARDS**` first bullet when reading scenarios, and carry it into the report. Verify with the guard tests that need it. Covers: guard-passes-before-and-after. Touches: plugins/verify/scripts/lib/plan.mjs, plugins/verify/scripts/lib/compliance.mjs
- [x] 2.2 Expect a guard's tests to pass on both commits, holding when they fail on either. Keep the fail-first rule for every other scenario: the existing acceptance tests must still pass. Verify the guard and existing tests. Covers: guard-fails-on-old-code, guard-fails-on-new-code, passes-on-old-code-too, fails-on-old-passes-on-new. Touches: plugins/verify/scripts/lib/compliance.mjs
- [x] 2.3 Break conditions and limits in the guard task's touched files, in a temporary copy, stopping at the first caught break or at 30. Restore exactly. Verify the break scenarios. Covers: guard-passes-before-and-after, guard-catches-no-break, guard-breaks-respect-the-cap. Touches: plugins/verify/scripts/lib/breaks.mjs, plugins/verify/scripts/lib/compliance.mjs, plugins/verify/.claude-plugin/plugin.json
- [x] 2.4 A scenario in a MODIFIED requirement is carried over when the living spec holds its ID with the same wording. Expect a pass on both commits, ask for no task and make no breaks. A changed wording stays new. Verify with the carried-over tests and the existing tests. Covers: carried-over-passes-before-and-after, carried-over-fails-on-new-code, carried-over-wording-changed. Touches: plugins/verify/scripts/lib/plan.mjs, plugins/verify/scripts/lib/compliance.mjs

## 3. Docs and rules

- [x] 3.1 Document guard scenarios in `docs/project-settings.md` and add the marker to cstack's OpenSpec rules in `openspec/config.yaml`. Verify both pass the plain-English check. Setup: documentation for the new marker. Touches: docs/project-settings.md, openspec/config.yaml

## 4. Prove it on a real change

- [x] 4.1 Re-run the precordia dry run on `seat-membership-integrity` in a throwaway clone, with its five unaffected scenarios marked as guards in that clone only. Verify all 18 scenarios are proven, and save the output as evidence. Setup: real-project proof. Touches: openspec/changes/add-guard-scenarios/evidence/**
