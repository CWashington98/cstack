# Tasks

## 1. Acceptance tests, written first and failing

- [x] 1.1 Add the TypeScript and Python sample repositories under `plugins/verify/tests/fixtures/compliance/`, each with a settings file, a spec with scenarios, a task list, and tests named with scenario IDs. Setup: no scenario. Touches: plugins/verify/tests/fixtures/compliance/**. Verify each sample's own tests run with its settings commands.
- [x] 1.2 Write one test per scenario in `specs/runner/spec-compliance/spec.md`, in `plugins/verify/tests/spec-compliance.test.mjs`, each named with its `[scenario-id]`. Verify every one fails on the current code by an assertion, not a crash, and commit them as locked acceptance tests. Covers: all. Touches: plugins/verify/tests/spec-compliance.test.mjs

## 2. Tracing scenarios to tasks and tests

- [x] 2.1 Extend `checkScenarios` in `plan.mjs` to return each scenario's ID, requirement and step lines. Verify with its existing tests plus the tracing scenarios. Covers: scenario-without-a-task, task-cites-an-unknown-scenario, setup-task-needs-no-scenario. Touches: plugins/verify/scripts/lib/plan.mjs
- [x] 2.2 Read `Covers:` and `Touches:` from the task list, and find test names carrying `[scenario-id]`. Verify the tracing scenarios pass. Covers: scenario-without-a-test, test-cites-an-unknown-scenario. Touches: plugins/verify/scripts/lib/compliance.mjs

## 3. Running the scenario tests

- [x] 3.1 Add the `tests` settings fields to the settings check, with a clear message when `tests.byName` is missing. Verify with settings tests. Covers: all-scenario-tests-ran. Touches: plugins/verify/scripts/lib/app-skill.mjs
- [x] 3.2 Run each scenario's tests by name and count them. Verify the run-count scenarios pass on both sample repositories. Covers: all-scenario-tests-ran, a-scenario-test-did-not-run. Touches: plugins/verify/scripts/lib/compliance.mjs
- [ ] 3.3 Run the tests on the starting commit in a temporary worktree and on the latest commit. Tell an assertion failure apart from a crash using the test command's exit code and output. Verify the fail-first scenarios pass on both samples. Covers: fails-on-old-passes-on-new, passes-on-old-code-too, crash-is-not-a-real-failure, fails-on-new-code. Touches: plugins/verify/scripts/lib/compliance.mjs

## 4. Locks, scope and the approved spec

- [ ] 4.1 Hold edits to locked acceptance tests and weakened or skipped tests unless a `Spec-Change:` line explains them. Verify the lock scenarios pass. Covers: builder-edits-a-locked-test, spec-change-allows-the-edit, a-test-is-weakened-or-skipped. Touches: plugins/verify/scripts/lib/compliance.mjs
- [ ] 4.2 List changed files no task declares. Verify the scope scenarios pass and that the list is a warning only. Covers: unexplained-file-is-listed, declared-file-is-not-listed. Touches: plugins/verify/scripts/lib/compliance.mjs
- [ ] 4.3 Record a fingerprint of the spec at approval, and hold when it changes. Verify the approval scenario passes. Covers: spec-edited-after-approval. Touches: plugins/verify/scripts/lib/compliance.mjs

## 5. Breaking changed lines (high-risk lane)

- [ ] 5.1 Break each changed condition and boundary in turn, run that task's scenario tests, and restore the exact file content. Refuse to start on uncommitted changes. Verify the break scenarios pass on both samples, and that the samples' trees are unchanged afterwards. Covers: break-is-caught, break-goes-unnoticed, normal-lane-skips-the-breaks. Touches: plugins/verify/scripts/lib/breaks.mjs

## 6. The command and its report

- [ ] 6.1 Add `spec-compliance.mjs`, which writes `compliance.json` and a plain-English summary. It exits 0 when proven, 1 when held, and 2 for a settings problem. Verify end to end on both samples, and that the summary passes the plain-English check. Covers: record-has-the-numbers, typescript-sample, python-sample. Touches: plugins/verify/scripts/spec-compliance.mjs
- [ ] 6.2 Add a test that searches the check's source for project, framework and language names. Covers: no-framework-names-in-the-code. Touches: plugins/verify/tests/portability.test.mjs

## 7. The spec-match reviewer

- [ ] 7.1 Add `spec-match-brief.md` to the pr-review skill, with the inputs listed in the spec and the same answer format as the claims auditor. Make pr-review start it on the normal and high-risk lanes, without the pull request description. Verify with pr-review's tests, and with one live run on a sample change whose test checks less than its THEN line. Covers: test-checks-something-else, reviewer-never-sees-the-description, spec-looks-wrong. Touches: plugins/verify/skills/pr-review/**

## 8. Executable specs (opt-in)

- [ ] 8.1 When `executableSpecs` is set, check every step line is bound, every THEN binding contains an assertion, and run the specs by name in place of named tests. Verify with a sample repository that turns it on, and that the other samples are unchanged. Covers: unbound-then-line, binding-without-an-assertion, setting-off-changes-nothing. Touches: plugins/verify/scripts/lib/compliance.mjs, plugins/verify/tests/fixtures/compliance/**

## 9. Integration

- [ ] 9.1 Run the whole check on this change itself before review, and attach its report to the pull request. Verify the report shows every scenario proven, with every hold resolved or ruled on. Setup: no scenario.
