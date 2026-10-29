# Design: the ready check and the pull request step

## Picture

The [delivery loop diagram](../../../docs/diagrams/delivery-loop.svg) shows where this sits. This change builds the "Ready to merge?" box, the "Open for merge" and "Stuck: needs you" boxes, and makes the return trip after a fix cheap.

## Layout

```
plugins/verify/scripts/
  gate.mjs                verify gate <pr> [--json]        (was factory gate)
  pr-open.mjs           apply <pr> [--stuck]
  evidence.mjs           + publish --pr <n>
  review-prep.mjs        + --follow-up
  verdict.mjs            + earlier-finding accounting on write
  lib/gate/{decide,facts,zone,record,settings}.mjs   (moved from plugins/factory/scripts/lib)
plugins/verify/skills/pr-open/SKILL.md
plugins/factory/                 keeps tokens and budget only
```

The move is a `git mv` with history, then edits. The gate's tests move with it and keep their scenario IDs, so `add-factory-gate`'s scenarios stay covered.

## Settings

`.claude/verify.json` gets a `gate` block with the gate's fields: `allowedBases`, `zone`, `runtimeSurface`, `flagsRequired`, `sizeLimit`, `notCounted`, plus the new `reviews` (`"always"` or `"highRisk"`). `neverMerge` and `merge` are dropped. A `factory` block is still read when there is no `gate` block, with a warning, so Hermes and the OneHeartHealth app keep working until they rename it.

## How each reason gets its kind

| Today's gate reason | Kind |
|---|---|
| checks still running | wait |
| every other hold the gate has today, including "can't read" | fix |
| a verdict finding with severity `decide` that the verdict lists as open | owner, question = the finding's claim |
| a spec-match finding of kind `spec-wrong` | owner, question = "The spec looks wrong here: <claim>. Change the spec?" |
| pull request is a draft | removed |
| zone merge mode, never-merge path | removed |

`pr-open.mjs apply --stuck` turns all remaining reasons into one owner question: "Three fix rounds didn't clear: <reasons>. How do you want to handle it?"

## Fix rounds

`pr-open.mjs` records each call in `<git-common-dir>/verify/gate/<pr>.rounds.json`: the head and whether it was ready. A round is a new head that ends not ready with a `fix` reason. The `pr-open` skill reads the count and calls `--stuck` at three. The count is kept outside the branch, so it never lands in a commit.

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
- 2026-10-29: three fix rounds without clearing means stuck; the owner is asked (owner).
- 2026-10-29: the command keeps the name gate: `verify gate`, settings block `gate`. `factory gate` is removed (owner).
- 2026-10-29: proof capture stays in each project's app skill; cstack keeps only the run record, publishing and the gate's check (owner).

## Proof: cstack owns the contract, each project owns the capture

cstack defines what a proof run is (`.verify/runs/<app>/<stamp>-<sha>/run.json`: commit, steps, status, files), how it gets into the pull request (`evidence.mjs publish`), and how the gate reads it. How a project captures proof stays in that project's app skill, which `verify-setup` writes: a branch preview for a web dashboard, the simulator for a mobile app, a terminal for a script. cstack never learns a project's hosts, accounts or devices.

Hermes adopts this in its own pull request. Its `ui:evidence` script keeps its capture: changed pages, the branch preview, the test sign-in, hiding that identity, and failing on console errors or leaked secrets. It writes what it captured as a `verify` run and hands the upload to `evidence.mjs publish`. Its old `ui-evidence` branch stays, so links in past pull requests keep working.

## Names

Skills in a family start with the family name, so they sort together: `pr-open` and `pr-review`; later `change-start` and `change-continue`. Commands are `<plugin> <noun>`: `verify gate`, `verify evidence`, `verify verdict`, `factory tokens`. Existing names outside a family stay.
