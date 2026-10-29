# Proposal: a pull request is marked ready for the owner only when it can merge

**Status: draft, waiting for the owner's approval (2026-10-29).**

## Why

The owner reads every pull request that is marked ready, and merges it. Today a pull request is marked ready whenever the agent decides it's done. So the owner opens pull requests that still have red checks, reviews of an older commit, or a question buried in a review comment. Each one costs a read and a round trip.

cstack already has a merge gate (`factory gate`, built in `add-factory-gate`) that checks a pull request against fixed rules. It was built to let agents merge on their own, which the owner parked on 2026-10-29. Its checks are still the right ones; only its use changes. See the [delivery loop diagram](../../../docs/diagrams/delivery-loop.svg).

Three more gaps make the loop expensive:

- **A return trip costs a full review.** After a fix, `pr-review` reviews the whole branch again from scratch, even when one line changed.
- **Proof doesn't reach the pull request.** `verify` records screenshots and recordings in `.verify/runs/`, but nothing puts them in the pull request. Hermes has its own script for this; the OneHeartHealth mobile app (OHH) and cstack have none.
- **Two bugs in the gate.** It treats a draft as a reason to hold, so it can't decide when a draft becomes ready. And it rejects the Claude fallback reviewer, which `pr-review` uses when Codex is out of quota.

## Who it's for

The owner, who should open a pull request only when the only thing left is to merge it, or to answer one question. Also every agent building a slice, which needs one command that says what is left to do.

## Before / After

- **Before:** an agent marks a pull request ready when it thinks it's done. The owner finds what's missing. A fix triggers a full new review. Screenshots stay on the agent's machine.
- **After:** a pull request opens as a draft. It's marked ready only when the ready check passes. When something is left that an agent can fix, the agent fixes it. When only the owner can decide, the pull request stays a draft and its first line asks one question. A fix is reviewed from the earlier findings and the new diff. Screenshots and recordings appear in the pull request.

## What Changes

- **The ready check** (`verify gate <pr>`), the merge gate moved into the `verify` plugin. It keeps every check the gate has today, and:
  - sorts each reason into one of three kinds: the agent can fix it, it's waiting on running checks, or only the owner can decide;
  - adds two reasons only the owner can settle: a review finding marked "decide", and a finding that says the spec looks wrong;
  - runs on drafts;
  - accepts the Claude fallback in place of Codex;
  - can require reviews only for changes that touch high-risk paths, set per project;
  - drops merge modes and never-merge paths, because the owner merges everything.
- **The pull request step** (`pr-open` skill plus a small script). It opens a draft with the layout from `plain`, publishes the proof and runs the ready check. Then it does one of three things: marks the pull request ready; keeps it a draft and goes back to fixing; or keeps it a draft with the owner's question on top. A new commit on a ready pull request turns it back into a draft. After three fix rounds without becoming ready, it stops and asks the owner.
- **Follow-up reviews.** When a pull request already has a review of an earlier commit, `pr-review` starts from that review's findings and the diff since that commit. The new verdict is still for the exact new commit, and it says which earlier findings are fixed.
- **Evidence in the pull request** (`evidence.mjs publish`). It copies a run's screenshots and recordings to a separate `verify-evidence` branch and writes a "Proof it works" section into the pull request's description. Hermes's `ui:evidence` script is the model.
- **Names.** Skills in a family start with the family name (`pr-open`, `pr-review`), and commands are `<plugin> <noun>`. The README's naming section gets this rule.
- **cstack's own settings.** cstack's `.claude/verify.json` lists its high-risk paths: the guard, the review and verdict scripts, the ready check and `install.sh`. Reviews are required only when a change touches them.

## Capabilities

### New

- `verify/gate`: the ready check.
- `verify/pr-open`: the pull request step.
- `verify/evidence-publish`: proof in the pull request.
- `verify/review-follow-up`: follow-up reviews.

### Modified

- `factory/gate` from `add-factory-gate` moves to `verify/gate`. `factory gate` becomes `verify gate`; `factory` keeps `tokens` and `budget`. Group 6 of `add-factory-gate` is replaced by this change.

## Non-goals

- Merging. Nothing in this change merges a pull request.
- Watching pull requests or starting agents. The coding app does that; the `pr-open` step runs when an agent calls it.
- The `start-change` and `continue-change` skills. They come in a later change and will call `pr-open`.
- How a project captures proof. That stays in each project's app skill; cstack only defines the run record and publishes it.
- Changing Hermes's or the OneHeartHealth app's own pull request checks. Each project adopts the step in its own pull request.

## Impact

- Code: `plugins/factory/scripts/lib/{gate,facts,zone,ledger,settings}.mjs` move to `plugins/verify/scripts/lib/`, with their tests. New `plugins/verify/scripts/gate.mjs` and `pr-open.mjs`. Changes to `evidence.mjs`, `review-prep.mjs`, `verdict.mjs`.
- Skills: new `pr-open`; changes to `pr-review`, `verify` and `how-to-use-cstack`.
- Settings: `.claude/verify.json` gains a `gate` block, which replaces the `factory` block; `docs/project-settings.md` documents it. Old `factory` blocks are still read, with a warning.
