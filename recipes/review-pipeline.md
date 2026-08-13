# The review pipeline — agentic handoff from build to merge

How work flows between agents: who builds, who reviews with what lens, who verifies,
and what gates the merge. The principle underneath every stage: **the actor that did
the work never certifies it.**

## The flow

```
route & brief → isolate → build (TDD) → adversarial review (parallel, multi-round)
                                      → cross-model second opinion (high-stakes)
                                      → mechanical gates → merge → cleanup
```

### 0 · Route & brief

Pick the builder from the routing table (see [`expert-agents.md`](./expert-agents.md)).
Subagents start blank — the brief must carry the file paths, the binding decisions
pasted in, the validation commands, and the exact return shape expected.

### 1 · Isolate

One worktree = one actor = one branch = one PR. Main is merge-target only. Parallel
actors can't collide if they never share a tree. Commit early and often — uncommitted
work in a worktree has no safety net.

### 2 · Build, test-first

The builder works TDD: failing test that demonstrates the requirement or bug, then the
code. Every fix must be **red-provable** — revert it and a test fails. A fix that
can't be red-proven is unpinned and will regress silently.

### 3 · Adversarial review — parallel lenses, multiple rounds

When the builder claims done, spawn reviewers **in parallel, in one message**:

- **Expert lens** — the domain expert(s) NOT involved in building review the diff
  against their blocking classes. Define those classes from your constitution, e.g.:
  BLOCKING = tenant-isolation leaks, payment-gate bypasses, webhook/signature changes,
  hardcoded secrets, injection; HIGH = compliance gaps, breaking schema changes,
  missing error handling, race conditions, sensitive data in logs; MEDIUM = dead code,
  missing tests, type-safety gaps.
- **karen** — re-runs the full suites + build herself, checks
  `git diff --stat` proportionality, verifies each specific claim, returns
  READY / NOT READY.

Findings go back to the builder; then **review again. Do not stop at one clean-looking
round** — in practice rounds 2–4 keep surfacing real issues, because fixes introduce
their own bugs and reviewers anchor on the previous round's findings. Stop when a full
round comes back clean.

Reviewer rules: harsh but fair; no style nits dressed as risks; every finding has a
file:line and a fix; a single failing test is BLOCK; if the diff is too large to
review properly, say so — that's a decomposition failure, not a review pass.

### 4 · Cross-model second opinion (high-stakes changes)

For security-sensitive, money-path, or hard-to-reverse changes, add a reviewer from a
_different model family_. Different models have different blind spots; agreement means
more, and disagreement is exactly the signal you want before merging. This is the
cheapest independent check available.

### 5 · Mechanical gates

Hooks — not judgment — enforce the floor: full test suites + typecheck at push,
preflight (plus production build) fired automatically at PR creation. Exit codes only;
no bypass flags. Judgment layers (steps 3–4) never substitute for the mechanical
layer, and vice versa.

### 6 · Merge & cleanup

Merge, remove the worktree, and **promote what was learned**: a lesson that matters
becomes a test, a lint rule, or a hook — hard enforcement over prose, because prose is
the weakest layer and agents drift under task pressure. A lesson that can't be
enforced yet goes into the constitution or a decision record.

## Automated verification wiring (optional but cheap)

If your platform supports lifecycle hooks, wire verification in so it happens without
anyone remembering to ask:

- **On task completion** → a small agent re-runs typecheck + targeted tests for the
  changed files and confirms the diff is proportional.
- **On subagent completion** → a small agent audits the subagent's claims against the
  diff (did it actually edit what it says? did it bail out quietly? did it violate a
  convention?).

## Verdicts

Two vocabularies, used consistently so orchestrators can act without interpretation:

- Reviewers: **BLOCK / APPROVE WITH NOTES / APPROVE** — any blocking issue, failing
  test, or failed build is BLOCK, never "approve with notes."
- Verifier (karen): **READY / NOT READY** — never softened when a hard gate failed.
