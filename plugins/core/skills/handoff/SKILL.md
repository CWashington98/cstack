---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up. Useful when switching worktrees, pausing work, or splitting context-heavy sessions.
argument-hint: "What will the next session be used for?"
---

<!-- provenance: vendored 2026-07-05 from BI-FE/.claude/skills/handoff (more complete than the HERMES copy, which was a stale, unexpanded stub); also existed in: HERMES; upstream origin: mattpocock/skills -->

## Project context
Read the repo's CLAUDE.md for commands and conventions. If `.claude/cstack.md` exists and has a `## handoff` section, apply those overrides — they are per-repo facts (commands, paths, policies) that take precedence over generic guidance below.

Write a handoff document summarising the current conversation so a fresh agent (or a fresh you, after compaction) can continue the work. Save it to a path produced by `mktemp -t handoff-XXXXXX.md` (read the file before you write to it).

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.

## What to include

- **One-line goal** — what the next session is for.
- **Current state** — branch, worktree, what's committed vs uncommitted, any in-flight PRs.
- **Key decisions made** — only the ones not yet captured in a PR/commit/ADR. Reference existing artifacts by path or URL; do not duplicate.
- **Open questions / blockers** — what's waiting on a teammate, reviewer, or external dependency.
- **Suggested skills for the next session** — whichever project-specific workflow skills/commands apply (e.g. a feature-implementation skill, a diagnostic skill, this repo's grilling or shipping skills).
- **Suggested first commands** — e.g. a worktree-listing command, `git status`, a log-tailing command.

## What NOT to include

- Content already in PRDs, plans, ADRs, tickets, commits, or memory entries — reference by path/ID instead.
- Generic codebase orientation (the repo's CLAUDE.md handles that).
- Step-by-step task lists if the work already has a structured work-package doc — point at it.

## Project-specific context to surface

When relevant, include:

- **Worktree status** — output of the repo's worktree-listing command if multiple are in flight; flag any with uncommitted changes.
- **Parallel sessions** — if other branches/worktrees are mid-flight that the next agent might collide with.
- **Ticket reference** — ID + status/section. Don't paste the ticket body; the next session can fetch it.
- **Non-default environment/deployment** — if one is in use, call it out.
- **Active change requests** — partially-processed ones.
- **Memory entries created this session** — list slugs so the next session knows what's new in the memory file.

## Output

After writing the file, print:

```
Handoff: <path>
Next session: invoke this doc + run `<suggested first command>`
```

Keep the doc under ~150 lines. If it grows past that, you're duplicating something that should be referenced instead.
