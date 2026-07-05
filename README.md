# cstack

Personal Claude Code plugin marketplace. One place for the generic skills that used to be
copy-pasted (and drift) across every repo, plus sha-pinned third-party skill repos, plus
stable python snippets.

## Install

```bash
claude plugin marketplace add CWashington98/cstack
claude plugin install cstack@cstack          # the core skills — everywhere
claude plugin install ui-ux-pro-max@cstack   # externals — only where wanted
```

Skills invoke as `cstack:tdd`, `cstack:diagnose`, etc. A project-local `.claude/skills/tdd`
always wins over the plugin version; both coexist (namespacing makes collisions impossible).

**Sharing:** this repo is private. To share with a friend: add them as a GitHub collaborator —
the same two commands above work with their git credentials. Nothing else changes.

## Customization model — "change what a skill KNOWS, not what it DOES"

1. **Ambient (free):** skills read the repo's CLAUDE.md for commands/conventions — it's always in context.
2. **Delta file:** per-repo `.claude/cstack.md` (20–40 lines) with per-skill factual overrides.
   Template: [`templates/cstack.md.template`](templates/cstack.md.template). Skills check for it.
3. **Local override:** project `.claude/skills/<name>` — only when the *procedure* genuinely
   differs (see excluded-by-rule below). Must earn its existence.

Per-repo forks with minor edits are the failure mode this repo exists to end.

## Excluded by rule — do NOT centralize these

- **Domain skills:** a2p-tcr-reviewer, tcpa-compliance, billing-accuracy, founder-voice,
  betting-calculations, clerk-auth-patterns, hipaa-check, watermelondb-patterns,
  convex-function-security, check-decisions, test-design, environment-safety…
  They are the product context of their repos.
- **Name-collision skills:** `react-hook-pattern` exists in 3 repos with the same name and
  incompatible bodies (RN vs Convex vs Convex+Suspense). That is specialization, not drift.
  It stays local everywhere.

## Operating rules

- **Harvest on pain, never on schedule.** This repo changes only when you catch yourself
  re-solving something in a live project. No roadmap, no backlog.
- **Rule of three.** Nothing enters `plugins/` until it has appeared in a third project.
  Two occurrences = a note in `LATER.md`, at most.
- **Deletion budget = addition budget.** A quarter where something goes unused, it leaves
  before anything new enters.
- **≤2 hrs/month.** Two consecutive months over budget → delete, don't reorganize.
- **Client-repo copies decay in place.** Don't chase the drifted copies in client-B/client-D —
  the installed plugin outranks them for you; teammates keep theirs. Never write into
  client/team repos; recipes travel by consented PR only.
- **Externals are sha-pinned; updates are deliberate sha bumps.** Auto-update stays off.

## Layout

```
.claude-plugin/marketplace.json   # catalog: core plugin + pinned externals
plugins/core/                     # the "cstack" plugin (skills/)
snippets/py/                      # copy-paste by design: atomic write, telegram sink, launchd, curl_cffi
templates/                        # stamped once at project birth: cstack.md delta template
recipes/                          # (post-8/30) mutation-testing operating model, deploy-trap doc, ci-posture
```

## Success / kill criteria — check once, Q4 2026

Success: a new project goes zero → hooks + CLAUDE.md + skills in under 1 hour, and no generic
skill has been copy-pasted since install. If it fails: shrink to `plugins/core` + the
mutation-testing recipe and stop growing it.
