# Run log

One entry per build step: the date, the tasks, the commit, the result, and any rulings made along the way. A ruling says what was decided, why, and the cost if it turns out wrong.

## 2026-10-11 · tasks 1.1 and 1.2 · commit 5015d36

Red result: 30 tests, 30 failing, 0 passing. The file loads, and every failure is an assertion. 26 tests find no compliance.json, because the command doesn't exist yet. 3 find no spec-match brief. 1 finds no command file.

Full suite: 519 tests, 31 failing. That is these 30 plus one guard timing test, "round 4 … in time". It also fails on the untouched branch head, taking 7.4 seconds under the current machine load.

- Ruling: the samples' run-by-name commands escape the opening bracket, as `\{name}`. Why: Node's runner reads the name as a pattern. Unescaped, `[seat-added-under-limit]` reads as a set of characters, and Node stops with an error. Other pattern-based runners do the same. Cost if wrong: if the check escapes names itself, the samples escape twice and need a `Spec-Change:` edit. The settings guide in task 3.1 should explain this.
- Ruling: `Covers: all` on the acceptance-test task doesn't count as a scenario's task. Why: the spec says no task's `Covers:` line "names" the scenario. The acceptance task always exists, so counting it would mean the check never holds. Cost if wrong: `[scenario-without-a-task]` needs an edit.
- Ruling: the tests look for compliance.json anywhere in the sample repository outside `.git`, and take the newest. Why: the design says only "next to the change's evidence runs". Cost if wrong: none, since any place inside the repository works.
- Ruling: the tests rely on four report details the design's example doesn't show. Each hold's `check` is the requirement ID, as in the example. A break's entry has `file` and a `line` counted from 1. An allowed edit or a covered line can sit anywhere in the report outside `holds`. The reviewer's mismatches have a key containing "mismatch". Why: these are the smallest additions the scenarios need. Cost if wrong: renaming a field means editing locked tests with a `Spec-Change:` line.
- Ruling: an approval fingerprint is the sha256 hash of the spec file's bytes. Why: that is how this change's own approval.json was recorded. I checked: `c8307d…` matches. Cost if wrong: the samples' approval.json files need new values. Fingerprinting more than one spec file is left to task 4.3; every sample has one.
- Ruling: the executable-spec samples bind a step by quoting its exact text in a step file, as in `Then("the seat is refused", …)`. Why: the design names only the tool and the command. It doesn't say how the check finds bindings or assertions. The two tests assert only the holds the spec describes. Cost if wrong: if task 8.1 finds bindings another way, `[unbound-then-line]` and `[binding-without-an-assertion]` need a `Spec-Change:` edit. The design should settle this before task 8.1.
- Ruling: the Python sample runs its tests with a 30-line runner over Python's built-in `unittest`. Why: pytest isn't installed. A Python method name can't contain brackets, so the runner matches each test's description instead. It exits like pytest: 0 passed, 1 failed, 2 a file couldn't load, 5 nothing matched. Cost if wrong: none for the check, which only reads the settings.
- Ruling: `[a-test-is-weakened-or-skipped]` uses an existing test that isn't an acceptance test, and expects the hold under `locked-acceptance-tests-stay-locked`. Why: that is the requirement the scenario sits in. Cost if wrong: one expected `check` value changes.
- Ruling: a test can name its scenario in either of two forms. The short form is `[scenario-id]`. The long form is `[<domain>/<capability>:<requirement>/<scenario-id>]`, with the scenario ID last. The TypeScript sample uses the long form and the Python sample the short one. Their two tests check that each scenario's test is found in its form. Why: projects already using OpenSpec name tests the long way, and the spec's words, "the scenario's ID in square brackets", cover both. Cost if wrong: none for the spec. It does change one thing for the build. The check must replace `{name}` with the bracket exactly as the test's name writes it, not with `[scenario-id]`. Neither sample's runner finds `[seat-added-under-limit]` inside the long form. This fixes the design's line "`{name}` is replaced with `[scenario-id]`". Also, for the build: Node lists a test file with no matching test as a passing entry, so the check must count bracketed names, not Node's total.

## 2026-10-11 · task 2.1 · commit 0885092

`checkScenarios` now also returns `scenarios`: each one's ID (the first word of its heading), requirement, heading line and step lines. Its existing findings are unchanged. Covered by two new unit tests in `compliance-lib.test.mjs`, and `plan.test.mjs` still passes. No acceptance test can go green on this task alone: they all need the command, which arrives with 2.2.

- Ruling: the working folder started this session with uncommitted edits to two locked sample tests (qualified test names such as `[accounts/seats:seat-limit/seat-added-under-limit]`). Why: not mine, so I left them untouched and uncommitted and asked the lead. Cost if wrong: the TypeScript sample's runs use whichever names are on disk.

## 2026-10-11 · task 2.2 · commit 626d9b7

Added `lib/compliance.mjs` (tracing: tasks, test names, scenario links) and a minimal `scripts/spec-compliance.mjs` entry point (report written under `.verify/runs/spec-compliance/<time>-<commit>/compliance.json`, plain summary, exit 0/1/2). Green now: `[scenario-without-a-task]`, `[task-cites-an-unknown-scenario]`, `[scenario-without-a-test]`, `[test-cites-an-unknown-scenario]`. Also green, but only because nothing else can hold yet: `[setup-task-needs-no-scenario]`, `[declared-file-is-not-listed]`, `[normal-lane-skips-the-breaks]`, `[setting-off-changes-nothing]`, `[record-has-the-numbers]`, `[no-framework-names-in-the-code]`. Unit tests added for the readers.

- Ruling: a test name is a quoted string holding `[id]` (not preceded by a word character or a closing bracket, so `items[index]` and comments don't count), in a tracked file that sits in a test folder, is named like a test, or matches `tests.acceptance`. Why: the design says nothing about how to find test names without running them; reading the files keeps the check free of any test tool. Cost if wrong: a test name built at run time is not seen, and its scenario is held as having no test.
- Ruling: a scenario's run-by-name token is whatever bracket form its own tests use (plain `[id]` or qualified), one run per distinct token. Why: a plain `[id]` pattern cannot match a qualified name, because the qualified bracket opens earlier. Cost if wrong: one extra run per qualified scenario.
- Ruling: `Covers: all` is accepted only on a task whose Touches are all acceptance files (when `tests.acceptance` is set). Why: the design says it is allowed only for the acceptance-test task. Cost if wrong: a hold on a task list that uses it elsewhere.

## 2026-10-11 · task 3.1 · commit e54a9b6

`app-skill.mjs` now checks `tests.all`, `tests.byName` (must contain `{name}`), `tests.acceptance`, `tests.alwaysAllowed` and `executableSpecs` (`tool`, and `command` with `{name}`), and exports `complianceSettings`, which also refuses to run without `tests.byName` and says which field to add and how to escape the bracket. The command now exits 2 with that message. Unit tests added; `app-skill.test.mjs` unchanged and green. No new acceptance test goes green (settings are exercised by every run).

- Ruling: `tests.byName` is required by the compliance command only, not by `checkRepoSettings`. Why: projects that never use the check should not be told to add it; the existing settings tests expect an empty problem list for a file with only `integrationBranch`. Cost if wrong: one more message in the generic settings check.

## 2026-10-11 · task 3.2 · commit @@3.2@@

The check now runs each scenario's tests by name (`tests.byName`, one run for each bracket form the scenario's tests use), reads what the test tool printed, and counts. Green now: `[all-scenario-tests-ran]`, `[a-scenario-test-did-not-run]`. On both samples every scenario shows `ran: true`; the two sample acceptance tests stay red only on fail-first (task 3.3).

- Ruling: a scenario "ran" when at least one test carrying its ID passed or failed and none was skipped. Why: the spec holds a change when any of a scenario's tests did not run. Cost if wrong: a scenario with one skipped test beside a passing one is held when it need not be.
- Ruling: results are read from output lines that show a result mark (TAP `ok`/`not ok`, the spec reporter's check marks, `... ok`/`... FAIL`/`skipped`) and a bracketed ID; the exit code alone is never trusted. Why: Node's runner exits 0 when no name matches. Cost if wrong: a tool with another output format needs another mark added in `readRun`.
- Ruling: the child environment drops `NODE_TEST_CONTEXT`. Why: the locked tests run the command from inside Node's own runner, and a nested `node --test` that inherits the variable prints nothing readable. Cost if wrong: none.
