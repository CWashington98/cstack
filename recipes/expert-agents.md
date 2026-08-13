# Expert agents — anatomy, routing, and why yours stay home

How to build the domain-expert layer for a codebase. The finished example that ships
with this plugin is **karen** (`plugins/core/agents/karen.md`); this recipe is how you
build the rest — your billing expert, your compliance expert, your frontend expert.
The generator wizard is the `bootstrap-agents` skill.

## Why experts instead of one generalist

An expert agent is valuable because of what's _in_ it, not what it's called. "You are a
billing expert" is worthless; a billing agent that carries your pricing decisions, your
webhook invariants, your validation commands, and your known failure modes catches
things a generalist never will. Corollary: **real expert agents are product IP and stay
in their repo** — publish the pattern (this recipe), never the loaded agents.

## Anatomy of a domain expert (five parts, all load-bearing)

1. **Identity & scope** — one domain, stated blast radius ("revenue-critical",
   "compliance-critical"), and what it does NOT cover.
2. **Knowledge payload** — the binding decisions (ADR/PDR excerpts), the source-of-truth
   table for its domain, terminology rules, non-negotiables. This is 60% of the file.
3. **Real validation commands** — the exact test/typecheck/build commands for its
   domain, copy-pasteable. An expert that can't verify its own work is a liability.
4. **Known failure modes** — the specific bugs this domain has produced before, and the
   "common lies" (framings like "pre-existing", "harmless") reviewers should test.
5. **Output contract** — the exact report shape (checklist, verdict, file:line refs) so
   the orchestrator can act on the result without parsing prose.

Skeleton: [`templates/agents/domain-expert.md.template`](../templates/agents/domain-expert.md.template).

## Routing — the table that makes experts fire

Experts only pay off if edits actually route to them. In CLAUDE.md:

```markdown
## Routing — delegate, don't edit directly

| Files            | Agent           |
| ---------------- | --------------- |
| src/billing/\*\* | billing-expert  |
| src/auth/\*\*    | security-expert |
| **/**tests**/**  | test-engineer   |
```

Rules that make it work:

- **Risk routes, not size.** Three lines of billing → expert. Fifty lines of CSS → direct.
- **Subagents start blank.** They don't inherit your conversation or the files you've
  read. Hand each one: the paths, the binding decisions pasted into the prompt, the
  contract, and exactly what to return. (Check your platform's inheritance rules —
  some built-in agent types skip project config entirely.)
- **Structured returns.** Have agents return a strict shape and validate it; don't
  parse prose.
- **Start with 2–3.** Your top two risk domains (usually: where money moves, where
  user data lives) plus a test engineer. Grow the roster on pain, not on org-chart
  symmetry.

## The verifier is not optional

Every roster needs one agent whose only job is disbelief — karen. Builders self-report
"done" against narrow criteria; the verifier re-runs the gates, checks scope against
claim, and returns READY / NOT READY. She ships with this plugin; wire her into your
review pipeline (see [`review-pipeline.md`](./review-pipeline.md)) rather than calling
her occasionally by hand.
