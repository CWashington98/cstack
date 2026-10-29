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

## Parked: the factory's autonomy (2026-10-29, owner decision)

cstack is a portable skill set, not a delivery platform (see the README's "What belongs in cstack"). The coding app already starts agents, makes worktrees, watches pull requests and schedules runs, and the owner merges. Trigger to revisit: the owner decides agents should merge without the owner.

- **Kept and supported:**
  - The merge gate (`factory gate`). It decides whether a pull request is ready for the owner or stays a draft.
  - The token usage report (`factory tokens`) and the subscription budget meter.
  - Review routing by capacity. When Codex is out of quota, the second review falls back to another model.
- **Parked:**
  - The gate merging on its own in low-risk areas, which is `add-factory-gate` group 6.
  - The trigger, morning report, liveness check and proof station in the [factory design](docs/specs/2026-10-25-factory-design.md). None of these has a spec.
- **Approved spec, to be built later as a skill:** `add-decision-desk`.
- **Replaced by a smaller change:** `add-factory-run` (`/implement-spec` as a state machine) becomes the `start-change` and `continue-change` skills already listed as coming in `how-to-use-cstack`, plus one small script that checks a slice plan.

## Explicitly rejected — do not resurrect without new evidence

- Unified one-click deploy layer (audit 2026-07-05: zero live targets)
- npm/pip shared packages (units are snippets; the domain math is client IP)
- Enforced cross-repo testing bar (mature where it matters, premature elsewhere)
- General project-intake framework (2-3 new projects/yr doesn't amortize it)
- caveman, the terse reply mode (2026-10-29): `plain` is the one writing standard, and reply length is a small share of token use. To remove an installed copy: `claude plugin uninstall caveman-picks@cstack --scope user`
