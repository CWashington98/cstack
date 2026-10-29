# Proposal: one command works an approved spec from slices to merge-ready pull requests, and picks up where it stopped

**Status: being replaced, 2026-10-29.** The owner chose a smaller version: the `start-change` and `continue-change` skills plus a slice-plan check. A new change will replace this one. See `LATER.md`.

## Why

The owner writes a spec and a prototype, then wants to come back to built, proven and reviewed pull requests that are ready to merge. Today the owner, or one long orchestrator chat, is the loop. That chat decides the next step, remembers what passed, and re-explains the project to every new agent.

The Project A pilot (25–27 October 2026, see [the pilot evidence](../../../docs/specs/2026-10-27-pilot-evidence-mobileapp-v2.md)) showed where that costs:

- **Setup in every fresh agent:** about 100k–200k tokens each, re-reading the standards, the guardrails, the spec and the plan.
- **Review rounds:** about half of each slice, because reviewers re-read the repository every round.
- **Loops that never converged:** about 3M–5M tokens, with no rule that stopped them.
- **A shared `tasks.md`:** slices that ticked it conflicted, and the merge made every review stale.

The factory design ([section 7](../../../docs/specs/2026-10-25-factory-design.md#7-the-loop)) already names the fix: a script decides the next step from saved state, and agents do the judgment work. This change builds that script for one approved spec, started by the owner.

## Who it's for

- **The owner,** who starts a spec and comes back to merge-ready pull requests, or to a short list of exact blockers.
- **Builders and reviewers,** who get a short brief with the files to read instead of a long conversation.
- **Any session that resumes the work,** in Claude Code, T3 Code or a terminal, which reads state instead of chat history.

## Before / After

- **Before:** the owner says "build `add-reminders`". One chat plans, builds, reviews, fixes and keeps track, and is 400k tokens deep by the third slice. When it compacts or the laptop sleeps, nobody knows which review was for which commit.
- **After:** the owner runs `/implement-spec add-reminders`. The script reads the approved slice plan and prints one next action: "build slice 2.1". A fresh builder gets a 40-line brief. Checks run, then two reviews of the exact head, then at most two fix rounds. When slice 2.1 is merge-ready the script moves on to 2.2. The next morning, any session that runs `/implement-spec add-reminders` gets the same next action from the saved state.

## What Changes

**`/implement-spec <change>` works the whole approved spec by default.** It goes slice by slice in dependency order. It stops when every slice is merge-ready or merged, or when everything left is blocked or waiting on the owner. `--slice <id>` works a single slice and stops.

**The slice plan is written by a model and checked by a script.** Opus groups the change's tasks into slices and writes `slices.json` in the change folder. `factory plan` refuses the plan unless:

- every slice names an outcome, scenario IDs, dependencies, the files it touches, exact check commands, an integration checkpoint and release conditions;
- every task belongs to exactly one slice;
- every scenario is covered;
- the dependencies have no cycle.

In projects that require it, the owner approves the slice plan the same way specs are approved.

**`factory next` prints exactly one next action as JSON, from saved state.** The actions are build, check, review, fix, integrate, wait and done. The coordinator carries it out, then records the result with `factory record`. The script enforces the order:

- checks run before reviews;
- a review counts only for the head commit it reviewed;
- at most two fix rounds;
- the same failure twice stops the slice.

The script never merges.

**Every builder and reviewer gets a brief file, not a conversation.** `factory brief` writes:

- the slice's spec block and its scenarios;
- the paths to read;
- the check commands;
- the project's canonical pattern records whose paths the slice touches.

Reviewers get the packet `verify:pr-review` already prepares, plus the slice block.

**Projects describe the patterns agents should copy.** A pattern record is a short Markdown file in `.claude/patterns/`. It says when to use the pattern, the canonical code and tests, the invariants, known exceptions, the automated checks, and what still needs a reviewer. `factory patterns lint` checks the headings and that every cited file exists.

**State lives in files, one writer each.** It is kept under the git common directory, so every worktree sees it and nothing is committed. A lock stops two coordinators from working one change at once. `STATUS.md` is generated from state for the next session to read.

**Each stage writes one metrics entry.** The entry holds the project, change, slice, pull request, session, head, base, stage, start and end, model, confirmed findings, wait reason and status. Unknown values are written as `unknown`. The writer refuses any field outside that list, so prompts, code, customer data and patient data can't get in.

## What does not change

- Specs still need the owner's approval before anything is built.
- The owner still merges. Nothing here merges, deploys or turns a flag on.
- Each project's checks, review lanes and required verdicts stay as its settings say. This change orders them and records them. It does not replace them.
- Model choice stays a project setting. The default builder model is Opus. See design.md, "Builder model".

## Out of scope

- Starting runs from a schedule or a pull request event, the morning report, and the liveness check. Those are `add-factory-trigger`.
- More than one builder at a time.
- The merge gate and zones (`add-factory-gate`), and questions answered mid-work (`add-decision-desk`).
- Writing the pattern records for Project A and Project B. Those are project pull requests, drafted from the pattern surveys and approved by the owner.
