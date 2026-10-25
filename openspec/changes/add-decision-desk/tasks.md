# Tasks

Builds after `add-factory-gate`. Each numbered group after group 1 is one small pull request.

## 1. Acceptance tests, written first and failing

- [ ] 1.1 Add one acceptance test per scenario, 14 in all, each named with its `[scenario-id]`, in two locked files:
  - `plugins/factory/tests/decisions.test.mjs`, using fixture question files and a stand-in model command that returns a fixed pick;
  - `plugins/factory/tests/gate-decisions.test.mjs`.

  Verify that all 14 fail by an assertion on the current code, then commit them as locked. Covers: all. Touches: plugins/factory/tests/decisions.test.mjs, plugins/factory/tests/gate-decisions.test.mjs

## 2. The question path

- [ ] 2.1 Add `decisions.mjs`. Read and check question files, then route them through the first three steps: cited answers, paths and tags that can't be undone, and named checks. Verify with the routing tests. Covers: earlier-ruling-applies, cant-be-undone-is-parked, checkable-question-is-proved. Touches: plugins/factory/scripts/lib/decisions.mjs, plugins/factory/scripts/factory.mjs
- [ ] 2.2 Add the blind brief and the second opinion. Shuffle and relabel the options, strip the builder's pick and reasons, pick the model from the budget route, and compare picks. On disagreement, ask the coordinator to pick. Verify with the opinion tests. Covers: brief-hides-the-builders-pick, agreement-decides, disagreement-is-contested, low-codex-budget-uses-fresh-opus. Touches: plugins/factory/scripts/lib/decisions.mjs, plugins/factory/briefs/second-opinion.md

## 3. Cards and answers

- [ ] 3.1 Write cards with their fixed headings. Refuse cards that are missing a heading, or a screenshot for a visible choice. Verify with the card tests. Covers: visible-choice-needs-screenshots, card-without-reversal-refused. Touches: plugins/factory/scripts/lib/decisions.mjs
- [ ] 3.2 Add `factory digest` with its ordering, plus the `keep`, `switch` and `rule` answers. A ruling is written to `rulings.jsonl`, a switch adds a follow-up slice, and a rule drafts a pull request against `objectives.md`. Verify with the digest and answer tests. Covers: digest-puts-contested-first, switch-queues-a-follow-up, keep-becomes-a-ruling. Touches: plugins/factory/scripts/lib/decisions.mjs, plugins/factory/scripts/factory.mjs
- [ ] 3.3 Pause new slices after three unanswered contested decisions, and park the one spec question. Verify with its test. Covers: third-contest-pauses-the-change. Touches: plugins/factory/scripts/lib/decisions.mjs

## 4. Gate and docs

- [ ] 4.1 Add the gate rule that holds pull requests affected by an unanswered contested decision. Verify with its test and the existing gate tests. Covers: contested-decision-holds-merge-only. Touches: plugins/factory/scripts/lib/gate.mjs, plugins/factory/scripts/lib/facts.mjs
- [ ] 4.2 Document the question file, cards, the digest and the answers in the `factory` skill, with one worked card as an example. Verify that the docs pass the plain-English check. Setup: documentation. Touches: plugins/factory/skills/factory/SKILL.md
