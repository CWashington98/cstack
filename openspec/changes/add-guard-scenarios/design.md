# Design: guard scenarios

## The marker

A guard scenario's first bullet is `- **GUARDS** <what must stay the same>`. It sits in the spec, so you see it at approval. It needs no other syntax, and OpenSpec's own validation still passes.

## How a guard is proven

1. Run its tests on the starting commit and the latest, exactly as for other scenarios. Both runs must pass.
2. In a temporary copy at the latest commit, break conditions and limits in the files named in the covering task's `Touches:` line, one at a time, using the same breaks as the high-risk lane. Stop at the first break the guard's tests catch, or at 30 breaks.
3. Restore every file exactly. Never touch the working folder.

The guard check runs on every lane. It's cheap, because it stops at the first caught break, and it's the only way to prove a guard.

## Reuse

| Piece | Exists in | Extended or new |
|---|---|---|
| Reading scenarios and their bullets | `plan.mjs` (`checkScenarios`) | Extended: notes a `**GUARDS**` first bullet |
| Running tests on the starting and latest commits | `compliance.mjs` | Extended: guards expect a pass on both |
| Breaking lines in a temporary copy | `breaks.mjs` | Extended: can break any condition in a file, not only changed lines, with a cap and an early stop |

## Decisions

- **2026-10-11, owner:** guard scenarios are marked and proven by breaking what they protect (option 1 of two offered after the precordia dry run).

- **2026-10-11, owner, at spec approval:**
  - Guard breaks are capped at **30 per scenario**.
  - Guard breaks run on **every lane**, including small.
