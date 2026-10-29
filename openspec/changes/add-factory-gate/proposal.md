# Proposal: the factory's first step, a merge gate in shadow mode plus usage meters

**Status: groups 1–5 built and merged, and supported: the gate decides whether a pull request is ready for the owner. Group 6, the run in merge mode, parked on 2026-10-29 by the owner.** See `LATER.md`.

## Why

The factory design ([docs/specs/2026-10-25-factory-design.md](../../../docs/specs/2026-10-25-factory-design.md)) wants agents to merge small, safe pull requests without the owner. That needs two things that don't exist yet:

1. **A rule in code for "safe enough to merge".** It has to earn trust by recording its calls next to what the owner actually did, before it ever merges anything.
2. **Usage readings for every subscription.** Agents have been running two of the owner's three Claude accounts out of their weekly limit mid-week. Nothing tells a run how much room is left, or where the usage goes.

This change builds both, and merges nothing. It is step 0 of the design's order of work.

## Who it's for

The owner, who today reads and merges almost every pull request and runs out of usage mid-week. Also any cstack user who wants the same gate in their own project.

## Before / After

- **Before:** whether a pull request is safe to merge is a judgment the owner makes alone, every time. Nobody knows how much of each subscription is left, or which work used it.
- **After:** for every pull request, a script records "would merge" or "would hold, because…". A second script shows each subscription's usage and pace, and a third shows where last week's usage went, by project and model.

## What Changes

- **A new `factory` plugin with one command, `factory`.** It has three subcommands.
- **`factory gate <pr>`** checks a pull request against fixed rules:
  - checks are green;
  - the risk zone is worked out from the diff;
  - the base is allowed;
  - the change is fresh against trunk;
  - review verdicts exist for this exact change;
  - there is live proof where users can see the change;
  - size is within the limit;
  - a flag is named where the project requires one.

  It prints a shadow call with every reason, and saves the call in the project's shared git folder. Asking it to merge is refused in this version.
- **`factory budget`** reads every Claude account's last known usage and the Codex subscription's usage. It prints:
  - percent used and reset time;
  - pace;
  - a mode for each account (normal, lean or stop);
  - which model the cross-family review lane should use right now.
- **`factory tokens`** reads the local Claude and Codex logs for a period. It reports tokens and API-rate dollars by project, model, and main chat versus subagent, plus dollars per merged pull request for the projects named.
- **A `factory` block in each project's existing settings file, `.claude/verify.json`.**

## Capabilities

### New Capabilities

- `factory/gate`: the shadow merge gate and its record of calls.
- `factory/budget`: subscription usage, pace, modes and the review lane's model.
- `factory/tokens`: where the usage went.

### Modified Capabilities

None.

## Non-goals

- **Merging anything.** Switching a zone on is a later change, after the record shows the gate's calls match the owner's.
- **Comparing the gate's calls with what the owner did.** The record keeps each call. Comparing calls with outcomes belongs to the morning report, the next step. It can be done later from GitHub's history.
- **Running agents.** No builders, coordinators or review lanes start in this change.
- **Considered and rejected: posting each call as a pull request label or comment.** It adds noise to every pull request while the gate is unproven. The record is enough.
- **Considered and rejected: a dollar budget.** Subscriptions lock on percent of a limit, not dollars. Dollars are reported only to show where usage goes.

## Impact

- New: `plugins/factory/**`, an entry in `.claude-plugin/marketplace.json`.
- Docs: `docs/project-settings.md` gains the `factory` block, and `how-to-use-cstack` lists the new commands.
- Reads, never writes: the `verify` plugin's verdicts, compliance reports and evidence runs. The gate uses `verify`'s existing functions to read them.
- Writes only under `<git common dir>/factory/` in the project being checked.
