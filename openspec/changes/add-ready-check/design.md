# Design: the ready check and the pull request step

## Picture

The [delivery loop diagram](../../../docs/diagrams/delivery-loop.svg) shows where this sits. This change builds the "Ready to merge?" box, the "Open for merge" and "Stuck: needs you" boxes, and makes the return trip after a fix cheap.

## Layout

```
plugins/verify/scripts/
  gate.mjs                verify gate <pr> [--json] [--apply]   (was factory gate)
  evidence.mjs           + publish --pr <n>
  review-prep.mjs        + --since <commit>
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

On the third fix round, `--apply` turns all remaining reasons into one owner question: "Three fix rounds didn't clear: <reasons>. How do you want to handle it?"

## Fix rounds

The gate already records each call per head in `<git-common-dir>/verify/gate/`. `--apply` counts this pull request's records whose call was not ready with a `fix` reason; the third one is stuck. The records live outside the branch, so they never land in a commit, and no skill has to count.

## Follow-up reviews

`review-prep.mjs --since <commit>` reads the verdicts for that commit from `<git-common-dir>/verify/verdicts/`, puts their open findings first in the packet, and starts from the diff since that commit. `pr-review` gains one sentence telling the agent to pass `--since` when an earlier verdict exists. Nothing checks that the new verdict mentions each earlier finding; the reviewer sees them first, and the gate reads only the new verdict.

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

## Skills stay short

The scripts decide and the skills point to them. `pr-open` is three sentences: open as a draft with the `plain` layout; after each push, publish proof and run `verify gate <pr> --apply`; do what it prints. `pr-review` gains one sentence. The scenarios test the scripts, not the skills' wording.

## Names

Skills in a family start with the family name, so they sort together: `pr-open` and `pr-review`; later `change-start` and `change-continue`. Commands are `<plugin> <noun>`: `verify gate`, `verify evidence`, `verify verdict`, `factory tokens`. Existing names outside a family stay.
