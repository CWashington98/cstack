# LATER — parking lot, not a backlog

Things that tempted us but fail the rule of three (or the timing rule). An item graduates
only when it shows up needed in a THIRD project, or its named trigger fires.

Client engagements are referred to by neutral labels (client-A/B/C/D); the mapping lives
in private notes, not this repo.

## Candidate skills (2 occurrences — not yet)

- `zoom-out` (Hermes, client-A/mvp)
- `thermo-nuclear-review` (client-B, Hermes as thermo-nuclear-code-quality-review)
- `branch-review` (Hermes only)
- `agentic-dev` worktree operating model (Hermes only; client-B has scripts/worktree.sh — watch for a third)

## Post-8/30 (trigger: Hermes shipped)

- `recipes/mutation-testing/OPERATING-MODEL.md` — merge Hermes ADR-076 + client-B's mutation ADR; write publishable (consulting collateral)
- `recipes/deploy/vercel-plus-backend-trap.md` — the silent skip-unaffected incident + both fixes; client-A is the first customer
- `recipes/ci-posture.md` — hooks-vs-GHA as a deliberate choose-one doc
- Apply deploy-trap gate to client-A (~30 min)

## Q4, conditional (trigger: SMB consulting lane live)

- `templates/smb-site/` from client-C's tiered component kit. Expiry: unused 2 quarters → delete.

## Parked: the factory (2026-10-29, owner decision)

cstack is a portable skill set, not a delivery platform (see the README's "What belongs in cstack"). The coding app already starts agents, makes worktrees, watches pull requests and schedules runs, and the owner merges. So these stop here. Trigger to revisit: the owner decides agents should merge without the owner.

- **Kept and supported:** `factory tokens`, the token usage report. It measures whether the way we work saves money.
- **Built, tested, parked:** the shadow merge gate (`factory gate`, `add-factory-gate` groups 1–5, #31–#36 and #40), the subscription budget meter and review routing by capacity. The code stays in `plugins/factory/` with its tests, so `npm test` keeps it working, but nothing in cstack's skills calls it.
- **Specced, not built, parked:** `add-factory-gate` group 6 (a run on real pull requests), `add-decision-desk`, and the unspecced trigger, morning report, proof station and review-convergence orchestration in the [factory design](docs/specs/2026-10-25-factory-design.md).
- **Replaced by a smaller change:** `add-factory-run` (`/implement-spec` as a state machine) becomes the `start-change` and `continue-change` skills already listed as coming in `how-to-use-cstack`, plus one small script that checks a slice plan.

## Explicitly rejected — do not resurrect without new evidence

- Unified one-click deploy layer (audit 2026-07-05: zero live targets)
- npm/pip shared packages (units are snippets; the domain math is client IP)
- Enforced cross-repo testing bar (mature where it matters, premature elsewhere)
- General project-intake framework (2-3 new projects/yr doesn't amortize it)
