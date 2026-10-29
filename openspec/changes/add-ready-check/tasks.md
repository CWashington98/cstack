# Tasks

Four slices, each one pull request, in order A, B, C, D. B and C don't depend on A and can be built at the same time; D needs A and C.

| Slice | Groups | What you can see when it's done | Scenarios |
|---|---|---|---|
| A. Ready check | 1, 2, 3 | `verify gate 41 --json` sorts every reason into fix, wait or owner | all in `verify/gate` |
| B. Follow-up reviews | 4 | a second review starts from the earlier findings and the new diff | all in `verify/review-follow-up` |
| C. Evidence | 5 | screenshots appear in the pull request | all in `verify/evidence-publish` |
| D. Pull request step | 6, 7 | a draft turns ready only when the check passes, or asks one question | all in `verify/pr-open` |

Verify every slice with `npm test` and `node plugins/plain/scripts/plain-check.mjs` on every changed skill or doc. Slice A is high risk under cstack's own list once group 7 lands, so it gets both reviews; so do B and D, which change the review and gate scripts.

## 1. Acceptance tests, written first and failing

- [ ] 1.1 Add one test per scenario, 23 in all, each named with its `[scenario-id]`: `plugins/verify/tests/gate-reasons.test.mjs`, `gate-apply.test.mjs`, `evidence-publish.test.mjs`, `review-follow-up.test.mjs`. Use the gate tests' stand-in `gh` on `PATH` and temporary git repositories. Verify all 23 fail by an assertion, not a crash, then commit them as locked. Each slice commits only its own file's tests. Covers: all. Touches: plugins/verify/tests/**

## 2. Move the gate (slice A)

- [ ] 2.1 `git mv` the gate's `gate`, `facts`, `zone`, `ledger` and `settings` libraries and their tests into `plugins/verify/scripts/lib/gate/`, add `gate.mjs`, and remove `gate` from `factory.mjs`. Settings read the `gate` block, or the `factory` block with a warning. Records go to `<git-common-dir>/verify/gate/`. Verify: the moved gate tests pass unchanged except paths. Covers: old-factory-block-still-read. Touches: plugins/factory/**, plugins/verify/scripts/**

## 3. Sort the reasons (slice A)

- [ ] 3.1 Give every reason a kind; add `--json`; stop holding on drafts, zone merge modes and never-merge paths; report the zone. Covers: ready-when-every-fact-passes, failing-checks-are-fix, running-checks-wait, unreadable-fact-is-fix, workflow-change-is-not-held-by-path. Touches: plugins/verify/scripts/lib/gate/**
- [ ] 3.2 Read open `decide` and `spec-wrong` findings from the verdicts for the head as `owner` reasons. Covers: decide-finding-needs-owner, spec-wrong-needs-owner. Touches: plugins/verify/scripts/lib/gate/facts.mjs
- [ ] 3.3 Accept `claude-fallback` in the second slot; add `reviews: "highRisk"`. Covers: fallback-verdict-accepted, low-risk-change-needs-no-review, high-risk-change-needs-reviews, reviews-required-by-default. Touches: plugins/verify/scripts/lib/gate/**

## 4. Follow-up reviews (slice B)

- [ ] 4.1 `review-prep.mjs --since <commit>`: earlier open findings first, the diff since that commit, the full diff available, and a full packet when the commit isn't an ancestor. Add one sentence to `pr-review` SKILL.md. Covers: all in `verify/review-follow-up`. Touches: plugins/verify/scripts/review-prep.mjs, plugins/verify/scripts/lib/**, plugins/verify/skills/pr-review/SKILL.md

## 5. Evidence in the pull request (slice C)

- [ ] 5.1 `evidence.mjs publish --pr <n>`: newest run for the head, checked paths, orphan branch in a temporary worktree, description section between markers. Covers: all in `verify/evidence-publish`. Touches: plugins/verify/scripts/evidence.mjs, plugins/verify/scripts/lib/evidence.mjs, plugins/verify/skills/verify/SKILL.md

## 6. The pull request step (slice D)

- [ ] 6.1 `verify gate <pr> --apply`: set draft or ready and the description's first line, and count fix rounds from the gate's records. Covers: all in `verify/pr-open`. Touches: plugins/verify/scripts/gate.mjs, plugins/verify/scripts/lib/gate/**
- [ ] 6.2 `pr-open` SKILL.md, three sentences as in the design. Update `how-to-use-cstack`. Verify with `plain-check`. Touches: plugins/verify/skills/pr-open/**, plugins/core/skills/how-to-use-cstack/SKILL.md

## 7. Settings and docs (slice D)

- [ ] 7.1 Document the `gate` block in `docs/project-settings.md` and `templates/verify.example.json`. Give cstack's `.claude/verify.json` a `gate` block with `reviews: "highRisk"` and a `highRisk` list: `plugins/core/scripts/**`, `plugins/verify/scripts/**`, `install.sh`, `.claude/verify.json`. Mark `add-factory-gate` group 6 as replaced by this change. Add the naming rule to the README's "Names say what things do" section. Touches: docs/project-settings.md, templates/verify.example.json, .claude/verify.json, openspec/changes/add-factory-gate/**, README.md
