# The skills ecosystem — reference, don't re-share

The goal of this whole repo is an **AI-native repository**: one where an agent lands
with a constitution to read, experts to route to, gates it can't talk its way past,
and skills for the procedures. Most of those skills already exist in the open
ecosystem — the job is knowing what's there and pointing at it, not copying it.

## The sources

- **skills.sh** — the open agent-skills registry. Browse at https://skills.sh, install
  with `npx skills add <name>`, or use its `find-skills` skill to discover from inside
  a session. Skills install per-repo (or user-level) as plain folders — inspect them
  before trusting them.
- **Anthropic's official plugin marketplace** — built into Claude Code (`/plugin`).
  Plugins bundle skills + agents + hooks + MCP servers and update centrally.
- **This marketplace** — the curated core (vendored where licenses allow, for
  SHA-stability) + pinned pointers to externals.

## Recommended set, and what each is for

**Process discipline (mattpocock/skills, via skills.sh or vendored here):**
`tdd` — red-green-refactor loop with real assertions · `diagnose` — reproduce →
minimise → hypothesise → instrument → fix → regression-test · `triage` — issue state
machine · `grill-me` / `grill-with-docs` — interrogate a plan until shared
understanding; the docs variant updates ADRs as decisions land · `to-prd` /
`to-issues` — conversation → PRD → tracer-bullet issues · `handoff` — compact a
session for the next agent · `prototype` — throwaway builds to flush out a design ·
`improve-codebase-architecture` — deepening/refactoring survey.

**Craft (Vercel-authored):** `web-design-guidelines` — UI/accessibility review ·
`react-best-practices`, `next-best-practices` — framework review checklists ·
`email-best-practices` — deliverability/compliance.

**Plugins (official marketplace):** `superpowers` — the discipline layer (skill-first,
brainstorm-first, verify-before-done) · `code-review` — variable-effort diff review ·
`context7` — live library docs · `typescript-lsp` — language-server intelligence ·
plus per-stack plugins (vercel, convex, posthog, stripe, playwright), enabled only
where relevant.

## The reference-over-vendoring rule

DEFAULT: point at things — install commands, pinned URLs+SHAs in `marketplace.json`,
and one-line "what it's for" descriptions like the list above. Referencing is always
license-safe, always fresh, and costs nothing to maintain.

Vendor a copy ONLY when all three hold: (1) upstream license is permissive
(MIT/Apache — verify, don't assume; one of our pinned externals has NO license and
must never be vendored), (2) you need SHA-stability or offline/two-command install,
(3) you record provenance in the file and the origin in `THIRD-PARTY-NOTICES.md`.

Adaptation happens at the knowledge layer, not by forking: skills read the repo's
CLAUDE.md and `.claude/cstack.md` delta file for local facts — change what a skill
KNOWS, never re-share a modified copy of what it DOES.
