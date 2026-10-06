# orchestrate: thin orchestrator, packet subagents, file checkpoints

Status: draft, 2026-10-04, partly superseded. The one-plan document (2026-10-05-program-plan.md) now sets scope and order: build the core (meter, reminders, checkpoint and resume, pace line, scoreboard, repository snapshot, production guard) first. Parallel code-writing workers are dropped (one writer per working copy). Burn windows and the backlog wait for scoreboard data. `orchestrate:init` is folded into `cstack init`. This document will be rewritten through `plain` before building. Track A only. OpenSpec adoption in precordia and
onehearthealth (Track B) is a separate spec.

## 1. Why

Two Max 20x accounts each run out of their weekly limit 2.5 to 3.5 days into the week, with
1.5 to 2 day full stops when both are locked. Transcripts from Sep 7 to Oct 4 show the cause:

| Project | Share of burn | Main-chat context p50 / p90 | Subagent first-turn context | Via T3 Code |
|---|---|---|---|---|
| smsMarketing | 79% | 278k / 784k | 48k | 24% |
| onehearthealth | 12.5% | 292k / 740k | 57k | 3% |
| precordia | 7.4% | 232k / 797k | 52k | 7% |

- 72% of weighted burn is cache reads: the conversation being re-read every turn. 70% comes
  from turns with more than 200k context.
- The top sessions already orchestrate (up to 274 subagents), but the main chat runs
  850 to 1,566 turns pinned near the 1M ceiling. The pattern is right; the orchestrator is fat.
- The habit is identical in all three repos. smsMarketing only has the volume.

A thin orchestrator is a quality fix as much as a cost fix: a 60-line status file is a more
reliable memory than a chat compacted five times.

## 2. Goals and success criteria

Measured over two full weekly cycles after Phase 2 ships, with `orchestrate:report`:

| Metric | Now | Target |
|---|---|---|
| Account week ends at | locked by day 2.5 to 3.5 | 90 to 100% used, at the reset |
| Lockout before reset | 1.5 to 4.7 days | never more than 12 hours |
| Main-chat context p90 | ~780k | under 300k |
| Subagent first-turn context | 48k to 57k | under 25k |
| Reviewer first-pass approval | baseline from Phase 1 | no drop (quality guard) |

If the quality guard drops, the change that caused it is reverted, whatever it saved.

The aim is to use the whole subscription, not to use less of it. Efficiency matters because the
cap is fixed: usage that goes to re-reading context can't go to build and verify loops.

## 3. Non-goals

- Blocking anything. Every hook only adds context (owner decision: nudge only).
- OpenSpec rollout (Track B).
- Changing implementer models by default. Model changes happen only through the A/B in section 9.
- Replacing project agents (karen, the sms experts). The kit adds three generic agents and
  works alongside existing ones.
- Status-line features. Ghostty only, so nothing may depend on them.

## 4. Constraints

- **Two front ends.** Ghostty (Claude Code CLI) and T3 Code (Agent SDK, `sdk-ts`). Observed in
  transcripts: project hooks fire in T3 (PreToolUse, PostToolUse, Stop), and T3 sessions use
  project agents and plugin agents (`codex:codex-rescue`). SessionStart was seen from T3 in only
  one project. Everything else is unverified until Phase 0.
- **Two profiles.** `~/.claude-work` and `~/.claude-personal` share `settings.json`, `skills/` and
  `projects/` through `~/.claude-shared`. Plugins are per profile, and cstack is already a known
  marketplace in both.
- **T3 worktrees** live under `~/.t3/worktrees`, separate checkouts. Uncommitted files in the
  main checkout are invisible there, so work files must be committed or stored outside the repo.
- **onehearthealth has teammates.** Nothing the kit needs may require a committed change there.
- **cstack rules.** Rule of three (met: three repos). Per-repo facts go in `.claude/cstack.md`;
  procedure stays in skills.

## 5. Architecture

```
cstack/plugins/orchestrate/          one plugin, installed in both profiles
  .claude-plugin/plugin.json
  hooks/hooks.json                   SessionStart, PostToolUse, PreToolUse(Agent)
  scripts/                           python, stdlib only
    meter.py                         current context size from transcript tail
    adapter.py                       resolve repo config and the active work item
    on_session_start.py              auto-resume
    on_post_tool.py                  context nudges
    on_pre_agent.py                  packet injection
    report.py                        burn + A/B ledger, offline
    pace.py                          account meters, pace, mode
    burn.sh                          headless backlog runner (one item, one worktree)
  skills/conduct  packet  checkpoint  loop  burn  report  init
  agents/builder.md  scout.md  verifier.md
  templates/STATUS.md  packet.md

per repo (optional)                  adapter: facts only
  .claude/cstack.md  "## orchestrate" json block    committed
  .claude/orchestrate.local.json                    gitignored override, wins

per work item                        state lives in files, not in chat
  STATUS (checkpoint), packets/<id>.md, log/<id>.md
```

Three layers, one dependency direction: plugin reads adapter, adapter points at work files.
The plugin knows nothing project-specific. A repo with no adapter gets defaults.

## 6. Components

### 6.1 Context meter (`meter.py`)
Reads the last 256 KB of `transcript_path`, finds the last assistant `usage`, and returns
`input + cache_read + cache_creation` tokens. It must run in under 50 ms because it runs on
every tool call. If the transcript can't be read it returns nothing, and every caller stays
silent.

Main thread or subagent: use `agent_id` in the hook input if present (docs say yes; Phase 0
verifies). Fallback, verified from file layout: subagent transcripts live under `/subagents/`.

### 6.2 Context nudges (PostToolUse, main thread)
Each threshold fires once per session. State is kept in `$TMPDIR/orchestrate/<session_id>.json`.

| Context | Injected `additionalContext` (short) |
|---|---|
| 150k | "Orchestrator at 150k. Delegate file reading and test runs; ask subagents for summaries." |
| 250k | "Checkpoint at the next boundary: run orchestrate:checkpoint when this slice or task ends." |
| 400k | "Checkpoint now. Write STATUS and start a fresh chat; it resumes automatically." |

In subagents, a single nudge at 150k: "Wrap up: finish the current step, write your log, return
your report." The adapter can override thresholds. Wording is final in the plan, at 40 words
or fewer per nudge.

### 6.3 Auto-resume (SessionStart)
- On `startup`, `clear` and `compact`: resolve the active work item (6.6) and inject its STATUS
  (2k-token cap, truncated with a pointer to the file) plus the orchestrator contract summary
  (about 300 tokens, the full text lives in `orchestrate:conduct`).
- On `resume`: inject nothing, because the history already has it.
- No active item: inject nothing.

In Ghostty, `/clear` after a checkpoint resumes in one keystroke. In T3, a new thread does the
same. Re-injecting on `compact` puts the plan back after a lossy compaction.

Fallback if SessionStart doesn't fire in T3: run `orchestrate:conduct` by hand, which loads the
same text.

### 6.4 Packet injection (PreToolUse on the Agent tool)
If the subagent prompt contains a line `packet: <path>`, the hook rewrites the prompt through
`updatedInput`:

```
<subagent contract: scope, report format, where to write the log>
<packet file contents>
<original prompt>
```

The subagent gets its packet on turn one without spending a turn reading files, and the
orchestrator never holds the packet's full text. Prompts without a `packet:` line pass through
untouched, so existing habits keep working.

Fallback if `updatedInput` doesn't work on the Agent tool: `orchestrate:packet` writes the
dispatch prompt as "Read <packet path> first, then follow it," which costs one extra turn.

### 6.5 Agents
All three have explicit `tools:` allowlists, so no MCP servers, web tools or browser tools are
loaded.

| Agent | Model | Tools | Use |
|---|---|---|---|
| `orchestrate:builder` | opus | Read, Edit, Write, Bash, Grep, Glob | implements one packet |
| `orchestrate:scout` | sonnet | Read, Grep, Glob | reads code and returns a summary under 300 words |
| `orchestrate:verifier` | sonnet | Bash, Read, Grep | runs the adapter's verify commands and returns failures only |

Scout and verifier start on Sonnet because they summarize rather than judge, which keeps the
quality risk low. Builder stays on Opus until the A/B says otherwise. Reviewers stay
project-level (karen).

### 6.6 Adapter and active work item (`adapter.py`)
Lookup order: `.claude/orchestrate.local.json`, then the json block under `## orchestrate` in
`.claude/cstack.md`, then defaults.

```json
{
  "kind": "superpowers",
  "plans": "docs/superpowers/plans",
  "workDir": "{plan}.work",
  "status": "{workDir}/STATUS.md",
  "statusSection": null,
  "slugFromBranch": null,
  "storeOutsideRepo": false,
  "verify": { "fast": "bun run lint && bunx vitest run --changed", "full": "bun run test:run" },
  "reviewer": "karen",
  "builderModel": "opus",
  "thresholds": { "main": [150000, 250000, 400000], "subagent": 150000 }
}
```

How the active item is found, in order:
1. A STATUS file whose frontmatter `branch:` equals the current branch.
2. `slugFromBranch` regex applied to the branch name, giving `{workDir}`.
3. None, in which case the hooks stay silent.

`storeOutsideRepo: true` moves work files to
`~/.claude-shared/orchestrate/work/<repo>/<branch>/`. They are visible from any checkout,
including T3 worktrees, and never committed.

### 6.7 Per-repo mapping

| Repo | Adapter | Work files |
|---|---|---|
| smsMarketing | committed in existing `.claude/cstack.md`: `kind: openspec`, `workDir: openspec/changes/{slug}`, `status: tasks.md`, `statusSection: "Status and how to pick this back up"`, `slugFromBranch` set | next to the change, committed, like today |
| precordia | committed `.claude/cstack.md` with defaults and `bun` verify commands | `docs/superpowers/plans/<plan>.work/`, committed |
| onehearthealth | `.claude/orchestrate.local.json` only, gitignored | `storeOutsideRepo: true`, nothing in git |

onehearthealth can switch to committed files after the Track B pitch. Only its adapter changes.

`orchestrate:init` adds `**/.claude/orchestrate.local.json` to the personal global ignore
(`~/.config/git/ignore`), since today that file only covers `settings.local.json`. That entry is
currently repeated about 30 times, so something appends it on every run. `init` must check
before appending.

### 6.8 Skills
- `orchestrate:conduct`: the orchestrator contract. Delegate reads, tests and builds; read
  reports, not code; keep state in STATUS; checkpoint at slice boundaries.
- `orchestrate:packet <id>`: writes `packets/<id>.md` from the plan, specs and scenario IDs
  using the template, then gives the one-line dispatch.
- `orchestrate:checkpoint`: rewrites STATUS (done, in flight, next, decisions, open questions)
  and tells you to `/clear` (Ghostty) or open a new thread (T3).
- `orchestrate:report`: weekly burn by account (inferred from reset times), project, main
  versus subagent, context bands, and the A/B ledger. Reads `~/.claude-shared/projects`
  offline. Generalizes the analysis scripts from 2026-10-04.
- `orchestrate:init`: writes the adapter for the current repo after asking which layout
  applies.

### 6.9 Pace (`pace.py`)
**Source.** Each profile's `.claude.json` holds `cachedUsageUtilization`: utilization and
`resets_at` for the `five_hour`, `seven_day` and model-scoped weekly windows. This is what
`~/.claude-shared/bin/route.py` (`cc`, `cu`) already reads. The cache refreshes only while an
interactive session is open; a reading older than 12 hours is marked stale and pace stays quiet.
The current account comes from `CLAUDE_CONFIG_DIR`.

**Pace** = 7-day usage % ÷ share of the window elapsed. Example: 60% used 1.6 days into the
week is 60 ÷ 23 = 2.6×, a lockout by day 3.

| Mode | When | What changes (all advisory) |
|---|---|---|
| lean | pace above 1.25 with more than 24 h to reset | main thresholds × 0.7 (105k, 175k, 280k); prefer scout and verifier summaries; checkpoint earlier |
| normal | otherwise | defaults |
| burn | under 80% used with under 24 h to reset | SessionStart says a burn window is open, how much is left, and how many backlog items fit |

SessionStart adds one line, e.g. `Pace: work 2.6× (60%, day 1.6 of 7). Lean mode.` The report
charts each account's week against the ideal line.

**Routing.** `route.py` changes from "lowest usage" to **earliest reset first**: of the accounts
with headroom (7-day under 95%, 5-hour under 90%), launch the one whose window resets soonest,
because its unused allowance expires first. Ties and missing data go to work, as today.
`route.py` lives in `~/.claude-shared/bin`, outside git; the change is small and listed in the plan.

### 6.10 Loop runner and burn backlog
**`orchestrate:loop <packet>`**, the per-packet build and verify loop the orchestrator runs:

1. Dispatch `builder` with the packet (6.4).
2. Dispatch `verifier` to run the packet's "Done when" commands. It returns pass, or a failure
   summary of 300 words or fewer plus a **failure signature** (sorted failing test IDs and
   error kinds).
3. Red: dispatch a new `builder` with the packet, the failure summary and the attempt number.
   It never gets the previous builder's history.
4. Stop when:
   - green, then go to the reviewer gate at the end of the slice
   - the same signature appears twice, then hand off to an Opus diagnosis (`cstack:diagnose`)
     and report to the owner
   - `loop.maxAttempts` is reached (adapter, default 3), then report to the owner
5. Each attempt is appended to `log/<id>.md`, and the ledger counts attempts per packet.

Opus goes to judgment (spec review, the reviewer gate, diagnosis). Sonnet goes to repetitive
work (running tests, summarizing failures). Loops never run Karen per attempt, only per slice.

**Burn backlog.** `~/.claude-shared/orchestrate/backlog.md` lists valuable, checkable,
non-urgent work, one item per line: repo, kind, packet path, value (1 to 3). Kinds: mutation
pass (Stryker, local pre-PR gate), adversarial review, test-gap closure, spec backfill. An item
without a "Done when" can't enter the backlog.

`orchestrate:burn` runs items while a burn window is open, highest value first, each through
`burn.sh`:
- `CLAUDE_CONFIG_DIR` set to the account about to reset
- a fresh git worktree per item, on its own branch
- `claude -p` running `orchestrate:loop` on the item's packet, with `acceptEdits` and a narrow
  tool allowlist
- never pushes, never merges; output is a branch plus a log line for the owner to review

v1 only announces the window (owner decision: nudge only); you start `orchestrate:burn`.
`burn.auto: true` (a launchd job checking pace hourly) is opt-in, considered after two weeks of
v1 data.

## 7. File formats

**STATUS** (60 lines or fewer, frontmatter required):
```
---
branch: feat/x
plan: docs/superpowers/plans/2026-10-04-x.md
updated: 2026-10-04T21:10
---
## Done        bullets, each with a commit or PR
## In flight   packet ids and who has them
## Next        ordered, each one a packet id or a decision
## Decisions   made this item, one line each, with why
## Open        questions for the owner
```

**Packet** (`packets/<id>.md`, under 1,500 tokens):
```
Goal:       one paragraph
Scenarios:  IDs or acceptance bullets this packet must satisfy
Read only:  design sections and paths (at most 8)
Touch only: paths
Done when:  exact commands that must pass
Not this:   non-goals and the hard rules that apply
Report:     150 words or fewer; full notes go in log/<id>.md
```

**Subagent contract** (injected, about 150 tokens): stay inside "Touch only"; don't widen
scope; if blocked, stop and report the blocker; the last message follows the Report shape;
detail goes in the log, not the report.

## 8. Front-end compatibility

| Feature | Ghostty | T3 Code | Fallback |
|---|---|---|---|
| PostToolUse nudges | expected | observed firing | none needed |
| PreToolUse packet rewrite | docs say yes, unverified | hook fires (observed), rewrite unverified | 6.4 fallback |
| SessionStart resume | expected | seen in one project only | run `orchestrate:conduct` by hand |
| Main vs subagent detection | `agent_id` unverified | same | `/subagents/` path, verified |
| Plugin agents | yes | observed (`codex:codex-rescue`) | none needed |
| Status line | yes | no | not used |

## 9. Model A/B (quality guard)
The ledger is built offline by `report.py` from transcripts. It needs no hooks.
- **Packet id:** the `packet:` line in a subagent's first prompt.
- **Per dispatch:** agent type, model, turns, peak context.
- **Outcome:** how many builder dispatches per packet id (more than one means rework), the
  reviewer verdict (READY or NOT READY in karen's last message), and whether the packet's
  "Done when" commands passed on the verifier's run.

The adapter can set `builderModel` per packet prefix (for example `"skeleton-*": "sonnet"`).
A packet type moves to Sonnet only if its rework rate and first-pass approval match Opus over
at least 5 packets. The hermes-atlas A1 skeleton is already marked `sonnet builder`, which
makes it the first data point.

## 10. Running and testing

**Running it:**
- **Development:** `claude --plugin-dir ~/Source/cstack/plugins/orchestrate` loads the plugin
  from the folder for one Ghostty session, without installing it.
- **T3 Code:** sees installed plugins only, so testing there needs an install in the profile T3
  runs under. Finding that profile is part of P0.

**Four test layers:**
1. **Unit tests** (stdlib `unittest`, no model calls):
   - meter: transcript tails at 50k, 300k and 900k, a subagent path, a cut-off last line, and a
     transcript with no usage
   - adapter: the three repo layouts and branch resolution
   - hooks: stdin JSON in, stdout JSON out; each threshold fires once; silent on error
   - report: golden test against a fixture projects dir
   - plugin structure: `claude plugin validate`
2. **Live hook contract (P0):** a logging-only hook runs the same five-step script in Ghostty
   and T3. Low thresholds in `orchestrate.local.json` (e.g. 20k) make nudges fire in cheap
   sessions.
3. **Skill behavior:** `claude plugin eval` with a no-plugin baseline. Checks: `packet`
   produces a valid packet; `checkpoint` keeps STATUS at 60 lines or fewer with frontmatter;
   `conduct` makes the main chat delegate.
4. **Field:** P1 and P2 on hermes-atlas, measured by `orchestrate:report` against section 2.

**Per-plugin overhead:** `claude plugin details <plugin>` reports each plugin's always-on token
cost. Measured 2026-10-04, the enabled plugins add about 11.5k tokens to every session and
subagent:

| Plugin | Always-on tokens |
|---|---|
| vercel | ~4.2k |
| convex | ~2.5k |
| mattpocock-skills | ~1.6k |
| cstack | ~1.2k |
| superpowers | ~0.8k |
| codex, expo, notion and others | ~1.0k combined |

That is about a quarter of the 47k subagent first-turn context. P0 breaks down the rest
(system prompt, tool lists, CLAUDE.md, memory).

Already applied: onehearthealth disables vercel and convex in `.claude/settings.local.json`,
commit 0ffdfe786. That file is tracked in that repo, so the change is shared.

## 11. Rollout

| Phase | Work | Exit criteria |
|---|---|---|
| P0 Verify | A logging-only hook in both front ends: dump stdin for SessionStart, PostToolUse, PreToolUse(Agent), Stop. Test `updatedInput` on Agent. Measure subagent first-turn context: `orchestrate:builder` with allowlist versus `general-purpose`. Measure what disabling unused plugins in `.claude/settings.local.json` saves per repo. | Section 8 fully marked; overhead breakdown known; fallbacks chosen |
| P1 Meter, nudges, resume, pace | meter, 6.2, 6.3, adapter, 6.9 (pace line, modes, earliest-reset routing), `conduct`, `checkpoint`, `report`. Install in both profiles; adapters in all three repos. | Nudges fire once per threshold in both front ends; `/clear` resumes from STATUS; pace line matches `cu`; one weekly report as the baseline |
| P2 Packets, agents, loop | 6.4, 6.5, 6.10 loop, `packet`, `init`, ledger. First real use: hermes-atlas slices. | 5 or more packets run through `orchestrate:loop`; same-signature stop seen working once; ledger populated |
| P2b Burn backlog | 6.10 backlog, `burn`, `burn.sh` (notify only). Seed backlog from existing plans (mutation passes, OHH test-gap and backfill plans). | One burn window used end to end: branches produced, nothing pushed |
| P3 A/B | Sonnet builder on skeleton and mechanical packets only. | Section 9 rule applied per packet type |
| P4 Review | Two weekly cycles against section 2. | Keep, tune thresholds, or revert parts |

Each phase is its own PR to cstack. The local cstack clone is currently diverged from origin
(2 ahead, 11 behind); reconcile it before P1.

## 12. Risks
- **Nudges get ignored late at night.** Mitigation: checkpoint is one skill and one `/clear`;
  P4 measures whether it's working. If not, revisit the owner's nudge-only decision.
- **Hook latency on every tool call.** Mitigation: tail-read only; P0 measures it; the meter
  exits early in subagents with no thresholds left.
- **Clash with smsMarketing's existing hooks.** Its hooks are PreToolUse and PostToolUse on
  file tools and Bash. The kit's PreToolUse matches only the Agent tool, and its PostToolUse
  only reads the transcript and adds context, so neither changes a file. P0 checks that sms's
  SecretReadGuard doesn't block the meter reading transcripts. Transcripts are outside the
  repo, so it shouldn't.
- **Status files go stale.** Mitigation: `checkpoint` stamps `updated`; resume shows the age
  and warns after 48 hours.
- **Stale meters.** The usage cache refreshes only while an interactive session is open.
  Mitigation: pace stays quiet when stale; `cu` shows the age.
- **Burn loops produce churn instead of value.** Mitigation: backlog items need a "Done when"
  and a value; output is branches only; the ledger shows what each burn window produced.
- **Headless runs and permissions.** Mitigation: a worktree per item, `acceptEdits`, a narrow
  allowlist, no push or merge, and smsMarketing's existing pre-push and merge gates still apply.
- **The plugin needs installing per profile.** One command per profile, listed in the cstack
  README install block.

## 13. Open questions
- Whether 150k, 250k and 400k are the right thresholds. Start there and tune from P1 data.
- Whether to also nudge on Stop (end of turn) or only on PostToolUse. Decide after P0 shows
  which one reads better in T3.
