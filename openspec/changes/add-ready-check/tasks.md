# Tasks

Four slices, each one pull request, in order A, B, C, D. B and C don't depend on A and can be built at the same time; D needs A and C.

| Slice | Groups | What you can see when it's done | Scenarios |
|---|---|---|---|
| A. Ready check | 1, 2, 3 | `verify ready 41 --json` sorts every reason into fix, wait or owner | all in `verify/ready` |
| B. Follow-up reviews | 4 | a second review starts from the earlier findings and the new diff | all in `verify/review-follow-up` |
| C. Evidence | 5 | screenshots appear in the pull request | all in `verify/evidence-publish` |
| D. Pull request step | 6, 7 | a draft turns ready only when the check passes, or asks one question | all in `verify/ready-pr` |

Verify every slice with `npm test` and `node plugins/plain/scripts/plain-check.mjs` on every changed skill or doc. Slice A is high risk under cstack's own list once group 7 lands, so it gets both reviews; so do B and D, which change the review and verdict scripts.

## 1. Acceptance tests, written first and failing

- [ ] 1.1 Add one test per scenario, 24 in all, each named with its `[scenario-id]`: `plugins/verify/tests/ready.test.mjs`, `pr-state.test.mjs`, `evidence-publish.test.mjs`, `review-follow-up.test.mjs`. Use the gate tests' stand-in `gh` on `PATH` and temporary git repositories. Verify all 24 fail by an assertion, not a crash, then commit them as locked. Each slice commits only its own file's tests. Covers: all. Touches: plugins/verify/tests/**

## 2. Move the gate (slice A)

- [ ] 2.1 `git mv` the gate's `gate`, `facts`, `zone`, `ledger` and `settings` libraries and their tests into `plugins/verify/scripts/lib/ready/`, add `ready.mjs`, and remove `gate` from `factory.mjs`. Settings read the `ready` block, or the `factory` block with a warning. Records go to `<git-common-dir>/verify/ready/`. Verify: the moved gate tests pass unchanged except paths. Covers: old-factory-block-still-read. Touches: plugins/factory/**, plugins/verify/scripts/**

## 3. Sort the reasons (slice A)

- [ ] 3.1 Give every reason a kind; add `--json`; stop holding on drafts, zone merge modes and never-merge paths; report the zone. Covers: ready-when-every-fact-passes, failing-checks-are-fix, running-checks-wait, unreadable-fact-is-fix, workflow-change-is-not-held-by-path. Touches: plugins/verify/scripts/lib/ready/**
- [ ] 3.2 Read open `decide` and `spec-wrong` findings from the verdicts for the head as `owner` reasons. Covers: decide-finding-needs-owner, spec-wrong-needs-owner. Touches: plugins/verify/scripts/lib/ready/facts.mjs
- [ ] 3.3 Accept `claude-fallback` in the second slot; add `reviews: "highRisk"`. Covers: fallback-verdict-accepted, low-risk-change-needs-no-review, high-risk-change-needs-reviews, reviews-required-by-default. Touches: plugins/verify/scripts/lib/ready/**

## 4. Follow-up reviews (slice B)

- [ ] 4.1 `review-prep.mjs --follow-up`: find earlier verdicts on the branch, write findings first plus both diffs, fall back on a rewritten branch. Covers: follow-up-packet-has-findings-and-delta, rewritten-branch-falls-back-to-full. Touches: plugins/verify/scripts/review-prep.mjs, plugins/verify/scripts/lib/**
- [ ] 4.2 `verdict.mjs write` refuses a follow-up verdict that leaves out an earlier open finding; `pr-review` SKILL.md uses `--follow-up` when earlier verdicts exist. Covers: follow-up-verdict-accounts-for-earlier-findings. Touches: plugins/verify/scripts/verdict.mjs, plugins/verify/scripts/lib/verdict.mjs, plugins/verify/skills/pr-review/SKILL.md

## 5. Evidence in the pull request (slice C)

- [ ] 5.1 `evidence.mjs publish --pr <n>`: newest run for the head, checked paths, orphan branch in a temporary worktree, description section between markers. Covers: all in `verify/evidence-publish`. Touches: plugins/verify/scripts/evidence.mjs, plugins/verify/scripts/lib/evidence.mjs, plugins/verify/skills/verify/SKILL.md

## 6. The pull request step (slice D)

- [ ] 6.1 `pr-state.mjs apply [--stuck]` and its rounds record. Covers: all in `verify/ready-pr`. Touches: plugins/verify/scripts/pr-state.mjs
- [ ] 6.2 `ready-pr` SKILL.md: open as a draft with `plain`'s layout, `evidence.mjs publish`, `pr-state.mjs apply`, then fix, wait, or stop at three rounds. Update `how-to-use-cstack`. Verify with `plain-check`. Touches: plugins/verify/skills/ready-pr/**, plugins/core/skills/how-to-use-cstack/SKILL.md

## 7. Settings and docs (slice D)

- [ ] 7.1 Document the `ready` block in `docs/project-settings.md` and `templates/verify.example.json`. Give cstack's `.claude/verify.json` a `ready` block with `reviews: "highRisk"` and a `highRisk` list: `plugins/core/scripts/**`, `plugins/verify/scripts/**`, `install.sh`, `.claude/verify.json`. Mark `add-factory-gate` group 6 as replaced by this change. Touches: docs/project-settings.md, templates/verify.example.json, .claude/verify.json, openspec/changes/add-factory-gate/**
