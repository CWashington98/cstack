# Tasks

Builds after `add-factory-gate` group 2 (#32). Each numbered group after group 1 is one small pull request.

## 1. Acceptance tests, written first and failing

- [ ] 1.1 Add one acceptance test per scenario, 24 in all, each named with its `[scenario-id]`, in three locked files. Verify that all 24 fail by an assertion on the current code, then commit them as locked. Covers: all. Touches: plugins/factory/tests/run-plan.test.mjs, plugins/factory/tests/run-next.test.mjs, plugins/factory/tests/run-record.test.mjs
  - `run-plan.test.mjs`: fixture change folders, with and without approval.
  - `run-next.test.mjs`: state and facts objects fed straight to `next.mjs`, plus one temporary git repository with a stand-in `gh`.
  - `run-record.test.mjs`: metrics, lock and `STATUS.md`.

## 2. Plan

- [ ] 2.1 Add `plan.mjs` and `factory plan`. Check approval, the slice fields, the task and scenario coverage, unknown IDs and cycles. Record `plan.json`. Verify with the plan tests. Covers: unapproved-change-is-refused, edited-spec-needs-approval-again, slice-missing-a-field-is-refused, dropped-task-is-refused, dependency-cycle-is-refused. Touches: plugins/factory/scripts/lib/run/plan.mjs, plugins/factory/scripts/factory.mjs

## 3. State, record and next

- [ ] 3.1 Add `state.mjs`, `record.mjs` and `lock.mjs`, and the `record` command. Append events and metrics. Refuse unknown fields. Write `unknown` for missing values. Verify with the record and lock tests. Covers: unknown-values-stay-visible, extra-field-is-refused, second-coordinator-is-refused. Touches: plugins/factory/scripts/lib/run/state.mjs, plugins/factory/scripts/lib/run/record.mjs, plugins/factory/scripts/lib/run/lock.mjs, plugins/factory/scripts/factory.mjs
- [ ] 3.2 Add `facts.mjs` and `next.mjs`, and the `next` command, for one slice. Cover check-before-review, stale reviews, packets, fix-round limits and blocked slices. Verify with the next tests. Covers: slice-plan-waits-for-owner, checks-come-before-review, stale-review-is-redone, review-uses-a-prepared-packet, same-failure-twice-stops, round-limit-stops-with-split-verdict, one-slice-mode-stops-after-that-slice. Touches: plugins/factory/scripts/lib/run/facts.mjs, plugins/factory/scripts/lib/run/next.mjs, plugins/factory/scripts/factory.mjs
- [ ] 3.3 Extend `next.mjs` to the whole spec: move on to the next slice, keep independent slices going, build stacks, cap stack depth, and integrate at the end. Verify with the next tests. Covers: blocked-slice-does-not-stop-independent-work, whole-spec-continues-to-the-next-slice, whole-spec-ends-with-integration, stack-depth-waits-for-the-owner. Touches: plugins/factory/scripts/lib/run/next.mjs

## 4. Resume

- [ ] 4.1 Add `status.mjs`, the `note`, `status` and `pause` commands, and `--take-over`. Keep progress out of `tasks.md`. Verify with the resume tests, including one real temporary repository with two worktrees. Covers: new-session-gets-the-same-next-action, progress-never-edits-tasks-md. Touches: plugins/factory/scripts/lib/run/status.mjs, plugins/factory/scripts/lib/run/lock.mjs, plugins/factory/scripts/factory.mjs

## 5. Briefs and patterns

- [ ] 5.1 Add `patterns.mjs` and `factory patterns lint`. Verify with its test. Covers: pattern-with-missing-file-is-refused. Touches: plugins/factory/scripts/lib/patterns.mjs, plugins/factory/scripts/factory.mjs
- [ ] 5.2 Add `brief.mjs`, the four brief templates and the `brief` command. Match patterns by path, use the builder model from settings, and keep to the line limit. Verify with the brief tests. Covers: brief-links-matching-patterns, builder-model-comes-from-settings. Touches: plugins/factory/scripts/lib/run/brief.mjs, plugins/factory/briefs/*.md, plugins/factory/scripts/factory.mjs

## 6. The command, docs and pilot

- [ ] 6.1 Add the `implement-spec` skill and the `/implement-spec` command, with the loop for T3 Code, Claude Code and the terminal. Document the `run` settings in `docs/project-settings.md`. Verify that the docs pass the plain-English check, and with a dry run on a fixture change using stand-in builders. Setup: documentation. Touches: plugins/factory/skills/implement-spec/SKILL.md, plugins/factory/commands/implement-spec.md, docs/project-settings.md
- [ ] 6.2 Pilot. Run `/implement-spec` on one approved Project B change and one Project A milestone, each with at least two slices, and append the results to `run-log.md`:
  - the metrics lines;
  - the actions taken;
  - every place the loop needed a person that it should not have.

  Each project's pattern records and `run` settings go in through that project's own pull requests, approved by the owner. Verify by reading `metrics.jsonl` and `STATUS.md` from a fresh session. Setup: pilot. Touches: openspec/changes/add-factory-run/run-log.md
