---
name: bootstrap-agents
description: Wizard that builds out the agent operating layer for a codebase — explores the repo, maps its risk domains, then generates a CLAUDE.md constitution, 2-3 domain expert agents, a routing table, and enforcement-hook skeletons, confirming each step with the operator. Use on a repo with no .claude/ layer yet, or when the user says "set up agents for this codebase", "build me experts for this repo", or "bootstrap this project for agent development".
---

# bootstrap-agents

Interview a codebase, then generate its agent operating layer. Explore → propose →
confirm → generate → verify. Never generate before the operator has confirmed the
risk map — wrong domains produce confidently wrong experts.

Companion docs: `recipes/expert-agents.md` (anatomy), `recipes/review-pipeline.md`
(how the generated agents hand off work), `recipes/bootstrap.md` (installs + hooks),
`templates/` (the skeletons this skill fills in).

## 1 · Explore (read-only)

Detect, don't ask, whatever the repo can answer itself:

- **Stack**: package.json / lockfile / framework configs — language, framework,
  database, test runner, existing scripts (`test`, `build`, `typecheck`, `lint`).
- **Risk domains**: where does money move (payment SDK imports, webhook routes,
  billing dirs)? Where does user data live (auth, DB schema, PII fields)? What is
  compliance-shaped (consent, messaging, health/finance data)? What is
  hard-to-reverse (migrations, deploy scripts, webhook handlers)?
- **Existing layer**: CLAUDE.md / AGENTS.md, `.claude/{agents,skills,commands}`,
  hooks, ADR directories, CI config. Never overwrite existing material — extend it.
- **Gates that already work**: run the detected test/typecheck commands once to learn
  what actually passes today. A generated agent that cites broken commands is dead
  on arrival.

## 2 · Propose the risk map (operator confirms)

Present one compact table — proposed domains ranked by blast radius, the file
patterns for each, and which 2-3 deserve experts now. Ask the operator to confirm or
correct: domain ranking, the source-of-truth systems (tracker, decision docs,
production DB), the non-negotiables, and any protected files. This conversation IS
the requirements gathering — don't skip it, don't stretch it past one round.

## 3 · Generate

From the confirmed map, using the templates (fill every placeholder — a template
line left in the output is a defect):

1. **`CLAUDE.md`** from `templates/CLAUDE.md.template` — non-negotiables,
   source-of-truth table, validate-before-done (the commands proven in step 1),
   routing table.
2. **One expert agent per confirmed domain** (2-3, not more) from
   `templates/agents/domain-expert.md.template` into `.claude/agents/` — each loaded
   with that domain's real paths, real commands, and any decisions the operator
   named. karen ships with the cstack plugin; reference her, don't regenerate her.
3. **Hooks skeleton** from the `recipes/bootstrap.md` starter into
   `.claude/settings.json` + `.claude/hooks/` — wired to the proven commands,
   exit-code gated, no bypass flags.
4. **Optional**: a `/ship-check`-style command that spawns the security-lens expert
   - karen in parallel on the current diff (see `recipes/review-pipeline.md` §3).

## 4 · Verify (the wizard eats its own contract)

- Every generated validation command: run it once, confirm the exit code matches
  today's reality (document a currently-red gate as such — don't ship a lie).
- Every file path and agent name referenced anywhere: confirm it exists.
- Grep the generated files for `<` placeholders: must be zero.

## 5 · Hand off

Report what was created (paths), the routing table, the first-use flow ("edit a file
in <domain>/ and watch it route"), and what was deliberately NOT set up yet (more
experts, worktree tooling, scheduled agents) with the trigger for each — growth
happens on pain, not on day one.
