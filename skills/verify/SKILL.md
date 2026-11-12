---
name: verify
description: The proof standard for any claim that work works, and how to plan the proof before building. Use when writing a spec or plan, when filling a pull request's Evidence section or choosing its status, and before saying anything is done, fixed or working.
---

# verify

Tests prove that code passes tests. They don't prove that the product works. This skill says what counts as proof, and how to plan it before the work starts.

## Before building: plan the proof

Read [planning.md](planning.md). In short:

- Every spec scenario gets a "Proved by" line: where it is checked, the evidence, and what passing looks like.
- Every plan item ends with `Evidence:` naming what will show it is done. Tick it only when that evidence exists.
- Every pull request in a plan has three proof boxes: verify unit, verify live, and verify performance when speed or size could change.
- The plan has a "Done when:" line with a count, fixed before work starts and never relaxed.

## While proving: the standard

Read [proof-standard.md](proof-standard.md) before any live check, and before claiming anything works. Its ten rules apply to every check, by every agent.

## After proving: the status

Each pull request gets exactly one status, tied to its latest commit. A new commit clears it.

| Status | Meaning |
|---|---|
| verified live | Proven on the running app, on the surface the change touches |
| verified by tests | Unit or integration tests prove it. Allowed only for changes with no user-facing behavior. |
| type check only | Not enough for any behavior change |
| blocked | The check couldn't run. This is never a pass. |
| failed | The check ran and the work didn't hold |

"Inconclusive" counts as failed. So does a check run on the wrong surface, such as a unit test for a screen change.

If the repository has an app verification skill (for example `.claude/skills/verify-<app>/`), run live checks through it.

## Sizing the checks to the risk

| Risk | Example | What to run |
|---|---|---|
| Low | Copy, styling, docs, tooling | Scope check and fast checks |
| Standard | Most features and fixes | Those, plus a failing test first, live proof, and an independent review (the `claims-auditor` agent) for bigger changes |
| High | Customer data, money, sign-in, consent, security | Everything, including mutation testing (deliberately breaking the code to see whether the tests notice) on changed files |

A repository can name its own high-risk paths in its CLAUDE.md or AGENTS.md.
