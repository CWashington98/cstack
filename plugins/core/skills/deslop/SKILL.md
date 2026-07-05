---
name: deslop
description: Remove AI-generated code slop from a branch diff without changing behavior. Use when the user says "deslop", "clean up the slop", "remove AI cruft", or after generating a chunk of code and before shipping. Strips needless comments, speculative defensive code, `any` casts, and convention drift.
---

<!-- provenance: vendored 2026-07-05 from BetInsights/betinsights-frontend/.claude/skills/deslop; only copy found (not present in CodeHouseSolutions/InternalWork/smsMarketing, onehearthealth/mobileapp-v2, precordia, or precordia/mvp) -->

## Project context
Read the repo's CLAUDE.md for commands and conventions. If `.claude/cstack.md` exists and has a `## deslop` section, apply those overrides — they are per-repo facts (commands, paths, policies) that take precedence over generic guidance below.

# Deslop

Strip AI-generated slop from a branch's diff while keeping behavior **identical**. This is the enforcement arm of the project's standing rules — it does not invent new behavior, it removes cruft that crept in.

## Scope

Review the **committed branch diff against the project's main integration branch** (not just the working tree) — committed PR changes are easy to miss otherwise. Check CLAUDE.md for the branch name (`main`, `dev`, `develop`, etc.):

```bash
git fetch origin
git diff origin/<integration-branch>...HEAD
```

If the user is mid-edit, also include `git diff` (unstaged). Only touch lines introduced/changed by this branch — never reformat untouched code.

## What to remove

1. **Narration comments.** Default to NO comments unless the project's conventions say otherwise. Delete:
   - Comments restating what the code obviously does (`// loop over items`)
   - "Dev-blog" comments (`// without this, X would break`)
   - Quoted ticket/doc text pasted inline
   - Any ticket ID, PR number, or issue URL in a comment — these belong in the commit/PR body, not the code
   - Keep ONLY: non-obvious WHY, or a real `TODO`.

2. **Speculative defensive code.** Remove try/catch, null-guards, and fallbacks added "just in case" that don't match the surrounding code paths. If a guard can't be tied to a reproducible failure in live data, it's slop. **Do NOT** remove guards that enforce data integrity (e.g. dropping incomplete records rather than defaulting them) — those are usually intentional.

3. **Type-bypass casts.** Replace `as any` / `@ts-ignore` (or the language's equivalent escape hatch) with the correct type. If the real type is genuinely unknown, flag it rather than leaving the bypass.

4. **Excessive nesting.** Flatten with early returns / guard clauses where it doesn't change behavior.

5. **Convention drift.** Align with the file and codebase:
   - Bare framework primitives where the project defines wrapped equivalents (e.g. a bare `query`/`mutation` call where the project has a security/auth wrapper around it) → use the project's wrapper. Illustrative example only — check the project's actual conventions.
   - Naming conventions (file casing, component casing, hook-naming patterns, etc.)
   - Match surrounding comment density, naming, idiom

## Guardrails

- **Keep behavior unchanged** unless fixing a clear, demonstrable bug — and if you fix a bug, call it out separately.
- **Minimal, focused edits** over broad rewrites. If a change is structural (extracting modules, reshaping abstractions), that's not deslop — that's a deeper architecture-review skill's job (e.g. `improve-codebase-architecture` or a project's own deep-review skill).
- **Verify after**: run the project's lint and test commands (see CLAUDE.md), or the relevant scoped subset, so the cleanup didn't regress anything. Don't claim it's clean without evidence.
- Watch parallel work: check `git status --short` before staging, and avoid broad staging commands (`git add -A` / `git add .`) that could sweep up someone else's uncommitted work.

## Output

Conclude with a **1–3 sentence** summary of what was removed and why. No essay.
