---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me".
---

<!-- provenance: vendored 2026-07-05 from client-B/.agents/skills/grill-me (identical to HERMES copy); also existed in: HERMES -->

## Project context
Read the repo's CLAUDE.md for commands and conventions. If `.claude/cstack.md` exists and has a `## grill-me` section, apply those overrides — they are per-repo facts (commands, paths, policies) that take precedence over generic guidance below.

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time.

If a question can be answered by exploring the codebase, explore the codebase instead.
