# Design: the ready check and the pull request step

## Picture

The [delivery loop diagram](../../../docs/diagrams/delivery-loop.svg) shows where this sits. This change builds the "Ready to merge?" box, the "Open for merge" and "Stuck: needs you" boxes, and makes the return trip after a fix cheap.

## Layout

```
plugins/verify/scripts/
  ready.mjs              verify ready <pr> [--json]       (was factory gate)
  pr-state.mjs           apply <pr> [--stuck]
  evidence.mjs           + publish --pr <n>
  review-prep.mjs        + --follow-up
  verdict.mjs            + earlier-finding accounting on write
  lib/ready/{decide,facts,zone,record,settings}.mjs   (moved from plugins/factory/scripts/lib)
plugins/verify/skills/ready-pr/SKILL.md
plugins/factory/                 keeps tokens and budget only
```

The move is a `git mv` with history, then edits. The gate's tests move with it and keep their scenario IDs, so `add-factory-gate`'s scenarios stay covered.

## Settings

`.claude/verify.json` gets a `ready` block with the gate's fields: `allowedBases`, `zone`, `runtimeSurface`, `flagsRequired`, `sizeLimit`, `notCounted`, plus the new `reviews` (`"always"` or `"highRisk"`). `neverMerge` and `merge` are dropped. A `factory` block is still read when there is no `ready` block, with a warning, so Hermes and the OneHeartHealth app keep working until they rename it.

## How each reason gets its kind

| Today's gate reason | Kind |
|---|---|
| checks still running | wait |
| every other hold the gate has today, including "can't read" | fix |
| a verdict finding with severity `decide` that the verdict lists as open | owner, question = the finding's claim |
| a spec-match finding of kind `spec-wrong` | owner, question = "The spec looks wrong here: <claim>. Change the spec?" |
| pull request is a draft | removed |
| zone merge mode, never-merge path | removed |

`pr-state.mjs apply --stuck` turns all remaining reasons into one owner question: "Three fix rounds didn't clear: <reasons>. How do you want to handle it?"

## Fix rounds

`pr-state.mjs` records each call in `<git-common-dir>/verify/ready/<pr>.rounds.json`: the head and whether it was ready. A round is a new head that ends not ready with a `fix` reason. The `ready-pr` skill reads the count and calls `--stuck` at three. The count is kept outside the branch, so it never lands in a commit.

## Follow-up reviews

`review-prep.mjs --follow-up` finds the newest verdicts in `<git-common-dir>/verify/verdicts/` whose `head` is an ancestor of the new head on the same branch. Their open findings go first in the packet, with the diff since that head. `verdict.mjs write` checks that a follow-up verdict accounts for every earlier open finding, as `fixed`, `still open` or `no longer applies`. A finding the new review didn't account for can't silently disappear.

## Evidence

Modeled on Hermes's `scripts/ui-evidence.ts`:
- an orphan branch, built in a temporary worktree;
- pushed with no project hooks, because the branch has none;
- a description section between markers, replaced on each run.

Links use `https://github.com/<owner>/<repo>/blob/verify-evidence/<path>?raw=true`, which shows the image to anyone who can read a private repository. Only files inside the run folder are copied; `run.json` paths are resolved and checked first.

## Reuse

- The gate's facts, zone and record code: moved, not rewritten.
- `plain`'s pull request layout: its first line, "What you need to do", is where the owner's question goes.
- `verdict.mjs check`: already accepts the fallback; the ready check stops second-guessing it.

## Decisions

- 2026-10-29: the gate is kept as the ready check; only merging without the owner is parked (owner, PR #42).
- 2026-10-29: cstack reviews only high-risk changes (owner).

## Open questions for the owner

1. **Three fix rounds before asking you.** Is three right?
2. **Hermes's evidence branch.** Hermes uses `ui-evidence`. Should Hermes switch to `verify-evidence` when it adopts this, or keep its own script?
3. **`factory gate`.** Remove it, as proposed, or keep it for a while as another name for `verify ready`?
