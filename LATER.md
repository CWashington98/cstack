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

- Mutation-testing operating model write-up — merge Hermes ADR-076 + client-B's mutation ADR; write publishable (consulting collateral)
- Vercel-plus-backend deploy trap write-up — the silent skip-unaffected incident + both fixes; client-A is the first customer
- CI posture write-up — hooks-vs-GHA as a deliberate choose-one doc
- Apply deploy-trap gate to client-A (~30 min)

## Q4, conditional (trigger: SMB consulting lane live)

- An SMB site starter from client-C's tiered component kit. Expiry: unused 2 quarters → delete.

## Parked: the factory plugin (2026-11-04, owner decision)

The owner likes the factory but cstack isn't ready for it. Sixty days of use (2026-09 to 2026-11) showed the token report run 12 times, `tokens` 7 times and the budget meter once. The merge gate had already moved to verify (`verify gate`) and stays there.

- **Where the code is:** `git show b9d9e00:plugins/factory/`, plus its design and build plan under `docs/specs/` and its OpenSpec changes (`add-factory-gate`, `add-factory-run`, `add-decision-desk`) under `openspec/changes/` at the same commit.
- **Trigger to bring it back:** the owner asks for a token or budget report twice in one week, or decides agents should merge without the owner.
- **Still parked from 2026-10-29:** the gate merging on its own in low-risk areas, and the trigger, morning report, liveness check and proof station from the factory design. The coding app already starts agents, watches pull requests and schedules runs, and the owner merges.

## Cut for no use (2026-11-04)

Recoverable with `git show b9d9e00:<path>`:

- Skills: `deslop` (pstack's `unslop` replaced it), `write-a-skill`, `how-to-use-cstack` (the README table does its job), `pr-open`.
- Pointers: `agent-browser`, `ui-ux-pro-max`, `software-factory-picks`.
- Folders: `openspec/` (cstack's own change history; its rules moved to `plugins/core/skills/bootstrap-agents/openspec-config.yaml`), `docs/`, `recipes/`, `templates/`, `snippets/`, `GLOSSARY.md`. What `bootstrap-agents` needs moved into its folder; the `.claude/verify.json` format moved to `plugins/verify/project-settings.md`.

## Explicitly rejected — do not resurrect without new evidence

- Unified one-click deploy layer (audit 2026-07-05: zero live targets)
- npm/pip shared packages (units are snippets; the domain math is client IP)
- Enforced cross-repo testing bar (mature where it matters, premature elsewhere)
- General project-intake framework (2-3 new projects/yr doesn't amortize it)
- caveman, the terse reply mode (2026-10-29): `plain` is the one writing standard, and reply length is a small share of token use. To remove an installed copy: `claude plugin uninstall caveman-picks@cstack --scope user`
