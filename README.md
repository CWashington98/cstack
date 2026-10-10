# cstack

Personal Claude Code plugin marketplace, with one goal: **make any repository
AI-native** — a constitution the agent reads, experts it routes to, gates it can't
talk its way past, and skills for the procedures. One place for the generic skills
that used to be copy-pasted (and drift) across every repo, plus sha-pinned
third-party skill repos, plus stable python snippets. Licensing/attribution:
[LICENSE](LICENSE) + [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Install

From your project's folder, run:

```bash
curl -fsSL https://raw.githubusercontent.com/CWashington98/cstack/main/install.sh | bash
```

Inside Claude Code, put `!` in front to run it there. Run the same command again later to update.

It installs the everyday set for you, in every project: `cstack`, `plain`, `verify`, `pstack-picks`, `ponytail-picks` and `caveman-picks`. Then it looks at the project's `package.json` files and adds what the project uses, for this project only, so an Expo app's skills don't load in your web projects:

| Group | Added when | Plugins |
|---|---|---|
| `expo` | A `package.json` lists `expo` as a dependency | `expo-picks`, `rn-callstack-picks`, `rn-vercel-picks` |
| `web` | A `package.json` without `expo` lists `react-dom` or `next` | `vercel-react-picks`, `good-css-picks` |
| `vercel` | The project has `vercel.json` or a `.vercel` folder | `vercel-deploy-picks` |

To choose the groups yourself, name them: `... | bash -s -- expo web`, or `all`. A plugin already installed for you, or for this project, is updated instead. One installed only in another project doesn't count. Folders inside `node_modules` and hidden folders, such as old worktree copies, are skipped. Restart Claude Code afterwards. To install one plugin by hand: `claude plugin install <name>@cstack`.

Borrowed skills are pinned pointers, never copies. Install the ones a project needs:

| Pointer | What it gives you | Install where |
|---|---|---|
| `pstack-picks` | TypeScript best practices, engineering principles, review and system-building skills | Everywhere |
| `ponytail-picks` | The simplest change that fully works; call it with `/ponytail` | Everywhere |
| `caveman-picks` | Terse replies that save tokens | Everywhere |
| `vercel-react-picks` | React rules, composition patterns, view transitions, web interface review | React web apps |
| `vercel-deploy-picks` | Deploying to Vercel, its command line, making a deployed app faster | Apps hosted on Vercel |
| `good-css-picks` | Modern styling techniques | Web apps |
| `expo-picks` | Expo's own skills | Expo apps |
| `rn-callstack-picks`, `rn-vercel-picks` | React Native performance, navigation and coding rules | React Native apps |

Where each skill came from is in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Skills invoke as `cstack:deslop`, `cstack:upkeep`, etc. A project-local `.claude/skills/deslop`
always wins over the plugin version; both coexist (namespacing makes collisions impossible).
The core plugin also ships the **claims-auditor** agent. Run it after any agent claims work is
done: it re-runs the tests and builds itself, checks the scope against the claim, and returns
a "ready" or "not ready" verdict.
It was called `karen` until core 3.0.0. If you called `cstack:karen`, call `cstack:claims-auditor` instead.

## Matt Pocock's skills

cstack used to ship copies of these. Install them from his own marketplace, which carries his latest release. The copy in Anthropic's official marketplace lags behind it (on 2026-10-05 it was 27 commits older than his version 1.3.1):

    claude plugin marketplace add mattpocock/skills
    claude plugin install mattpocock-skills@mattpocock

| Old cstack name | Name in his plugin |
|---|---|
| tdd | tdd |
| diagnose | diagnosing-bugs |
| triage | triage |
| to-prd | to-spec |
| to-issues | to-tickets |
| grill-with-docs | grill-with-docs |
| grill-me | grill-me |
| handoff | handoff |
| improve-codebase-architecture | improve-codebase-architecture |
| prototype | prototype |

## plain

Keeps everything we publish readable for a junior developer or product manager with no outside context. It has writing rules, a checker script, a blank cold reader and a hold before anything is posted to GitHub, published as a page, or committed as a spec or plan.

    claude plugin install plain@cstack

The hold does nothing until a repository opts in with `.claude/plain.json` (shared) or `.claude/plain.local.json` (personal). Details: `plugins/plain/skills/plain/glossary-format.md`.

It also has to-diagram, a skill that draws a diagram in plain English. Diagrams are always dark, use a fixed palette that passes accessibility contrast rules, and are proved by a checker. Details: `plugins/plain/skills/to-diagram/SKILL.md`.

## Keeping skills current

Run the `upkeep` skill monthly, or `node plugins/core/scripts/upkeep.mjs`. It checks every Claude account on this machine and the repositories listed in `~/.config/cstack/upkeep.json`. It reports deprecated or outdated plugins, stale catalogs, changed upstream skills behind our pinned pointers, and skill copies inside repositories, with the command that fixes each one. It only reports; you choose what to apply.

## React Native projects

Install these only in a project that has a React Native or Expo app, using `--scope local` so other projects don't load them:

    claude plugin install expo@expo-plugins --scope local          # Expo's official skills
    claude plugin install rn-callstack-picks@cstack --scope local  # performance, navigation, upgrades
    claude plugin install rn-vercel-picks@cstack --scope local     # everyday React Native coding rules

Expo's older `expo-app-design`, `upgrading-expo` and `expo-deployment` plugins are deprecated; the `expo` plugin replaces all three.

**Sharing:** this repo is public — the two commands above work for anyone. New machine or
new person: start at [`recipes/bootstrap.md`](recipes/bootstrap.md) (day-one installs,
companion plugins, templates, enforcement hooks, adoption order).

## Customization model — "change what a skill KNOWS, not what it DOES"

1. **Ambient (free):** skills read the repo's CLAUDE.md for commands/conventions — it's always in context.
2. **Delta file:** per-repo `.claude/cstack.md` (20–40 lines) with per-skill factual overrides.
   Template: [`templates/cstack.md.template`](templates/cstack.md.template). Skills check for it.
3. **Local override:** project `.claude/skills/<name>` — only when the _procedure_ genuinely
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
- **Client-repo copies decay in place.** Don't chase the drifted copies in client repos —
  the installed plugin outranks them for you; teammates keep theirs. Never write into
  client/team repos; recipes travel by consented PR only.
- **Externals are sha-pinned; updates are deliberate sha bumps.** Auto-update stays off.
- **Reference over vendoring.** Default to pointers (install commands, pinned URL+SHA)
  with a one-line "what it's for." Vendor a copy only when the upstream license is
  verified permissive AND stability demands it — record it in THIRD-PARTY-NOTICES.md.
  Unlicensed upstreams are pointer-only, forever. See `recipes/skills-ecosystem.md`.

## Names say what things do

Agents, skills, scripts and plugins are named by their job, never by a person or a joke.
A reader should know what something does from its name alone: `claims-auditor` checks
claims that work is done, `check-pointers` checks pinned pointers. The description then
says when to use it. The `bootstrap-agents` skill and its agent template follow the same
rule. A test fails if an agent file's name doesn't match the name inside it.

## Layout

```
.claude-plugin/marketplace.json   # catalog: core plugin + pinned externals
plugins/core/                     # the "cstack" plugin (skills/)
snippets/py/                      # copy-paste by design: atomic write, telegram sink, launchd, curl_cffi
templates/                        # stamped once at project birth: CLAUDE.md constitution + cstack.md delta
recipes/                          # agent-stack-brief (operating model) · bootstrap (zero→agent-ready) · expert-agents · review-pipeline
```

## Success / kill criteria — check once, Q4 2026

Success: a new project goes zero → hooks + CLAUDE.md + skills in under 1 hour, and no generic
skill has been copy-pasted since install. If it fails: shrink to `plugins/core` + the
mutation-testing recipe and stop growing it.
