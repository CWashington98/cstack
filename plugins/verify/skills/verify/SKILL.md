---
name: verify
description: The proof standard for any claim that work works, and how to plan the proof before building. Use it when writing a spec or plan, so every scenario gets a "Proved by" line and every plan item names its evidence. Use it when filling a pull request's "Proof it works" section or deciding its verification status. Use it before saying anything is done, fixed or working.
---

# verify

Tests prove that code passes tests. They don't prove that the product works. This skill says what counts as proof, and how to plan it before the work starts.

## Before building: plan the proof

Read `planning.md`. In short:

- Every spec scenario gets a "Proved by" line: where it is checked, the evidence, and what passing looks like.
- Every plan item ends with `Evidence:` naming what will show it is done. Tick it only when that evidence exists.
- Every pull request section in a plan has three proof boxes: verify unit, verify live, and verify performance when speed or size could change. Tests alone never verify a pull request.
- The plan has a "Done when:" line with a count, fixed before work starts and never relaxed.

Check a spec or plan with the script in this plugin's `scripts` folder, two levels above this file:

    node <this skill's folder>/../../scripts/verify-plan.mjs <file>

Fix every "hold" line. After work starts, add `--since <the commit where the plan was approved>` so a relaxed done condition is caught.

## While proving: the standard

Read `proof-standard.md` before any live check, and before claiming anything works. Its ten rules apply to every check, by every agent.

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

Live checks run through the app's verification skill (`.claude/skills/verify-<app>/`). If the app has none, create one with `verify-setup` first.

## Sizing the checks to the risk

| Risk | Example | What to run |
|---|---|---|
| Low | Copy, styling, docs, tooling | Scope check and fast checks |
| Standard | Most features and fixes | Those, plus failing test first, spec coverage, live proof, and an independent review for bigger changes |
| High | Patient or customer data, results, recording, sync, sign-in, billing, consent, security | Everything, including mutation testing (deliberately breaking the code to see whether tests notice) on changed files |

Each repository names its own high-risk paths in `.claude/verify.json`.
