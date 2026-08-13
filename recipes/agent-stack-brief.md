# The Agent Stack — operating model

The why behind this repo: how we run AI-agent-first development, what we build in-house
per project, and what we install from the ecosystem. The hands-on transplant guide
(commands, templates, hooks) is [`bootstrap.md`](./bootstrap.md).

## The operating idea

Nearly all real work is done by coding agents (Claude Code, with a second-opinion GPT
agent), and the human acts as operator and reviewer. That only works if you assume the
agent **will** cut corners — and design for it. Three pillars:

1. **Knowledge** — binding written decisions (ADRs), a project constitution (CLAUDE.md),
   persistent memory — so agents don't re-derive or contradict what's settled.
2. **Delegation** — domain expert agents, reusable skills, one-word slash commands — so
   work routes to the right specialist with the right context every time.
3. **Enforcement** — gates that check exit codes (never text), plus independent
   verification — so "done" is proven rather than trusted.

Fool-proof, defined: every gate is machine-checked, every decision is written and
binding, and every claim of completion is verified by a _different actor_ than the one
that made it.

## Layer 1 — build per project (the part you can't install)

- **A CLAUDE.md constitution** — non-negotiables, terminology rules, protected files,
  a source-of-truth table (which system beats which), and an agent routing table.
  Skeleton: [`templates/CLAUDE.md.template`](../templates/CLAUDE.md.template).
- **Binding decisions** — ADRs (+ product decision records) with an auto-generated
  digest and a check-decisions step before domain work. Agents extend decisions instead
  of relitigating them every session.
- **Enforcement gates** — layered hooks: fast lint/secret checks at commit, the FULL
  test suites + typecheck at push, a preflight (adds a production build) that fires
  automatically when the agent opens a PR. Two laws: gates read **exit codes**, never
  pattern-match output (text-matching gates get gamed — we learned this the hard way);
  and bypass flags are banned — if a hook is wrong, fix the hook. Layer in ratchets as
  they earn their place: mutation testing on money-critical code, an accessibility
  contrast test, lockfile guards, a supply-chain release-age quarantine.
- **karen** — the independent READY / NOT READY verifier (ships with this plugin).
  After any agent claims "done," karen re-runs the gates herself, checks scope against
  the claim, and cuts through framing like "pre-existing" and "merge-ready."
- **Domain expert agents** — 2–3 to start (your billing / compliance / frontend
  equivalents), mapped to file patterns so edits route by risk, not size: three lines
  of billing goes to an expert; fifty lines of CSS doesn't.
- **Autonomous programs** — a scheduled overnight agent that validates main, picks ONE
  job, and produces exactly one reviewable artifact (it never merges); and periodic
  adversarial campaigns: scan the whole codebase → findings database → cross-model
  revalidation (a second model re-judges the first's findings — different blind spots)
  → wave remediation where every fix is red-proven (revert it, watch the test fail).

## Layer 2 — install from the ecosystem

- **This marketplace** — the generic skills (tdd, diagnose, triage, grill-me, to-prd,
  to-issues, …) + karen + templates. Two commands, see [`bootstrap.md`](./bootstrap.md).
- **superpowers** (official marketplace) — the discipline layer: skill-check before any
  action, brainstorm before building, verification before completion claims.
- **code-review** — diff/PR review at variable effort, up to multi-agent deep review.
- **context7** — live library docs on demand; stops stale-training-data answers.
- **codex** (OpenAI) — cross-model second opinion; the cheapest independent check.
- **skills.sh** — the open skills registry (`npx skills add <name>`) for everything else.
- Stack plugins (vercel, convex, posthog, stripe, playwright, …) enabled per-project so
  each session's context stays lean.

## The doctrine

- **Exit codes, not vibes.** Every gate checks a process exit code.
- **Independent verification.** The actor that did the work never certifies it.
- **Written, binding decisions.** If it isn't a decision record, every session relitigates it.
- **Reproduce first.** No fix without a failing test that demonstrates the bug.
- **Ratchets, not audits.** Gates that only tighten, running on every push.
- **Ground truth over docs.** For money/vendor/auth state: query production, then compare.
- **Risk routes, not size.** Delegation is decided by blast radius, not line count.
