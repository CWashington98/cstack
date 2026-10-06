# One plan: close the /insights findings and use both accounts well, in every project

Status: draft for review, second version, 2026-10-05.

Two reviews shaped this version. Karen, our automated reality-check reviewer, checked every claim. A research pass compared the plan with published practice from Anthropic, HumanLayer, Simon Willison, Kent Beck, Mitchell Hashimoto, Geoffrey Huntley, Cognition, Cursor and Stripe. The changes:

- The security fix now targets the part of the plugin that actually creates the extra sessions.
- The savings estimate is lower and shows its arithmetic.
- Scope is cut: build the core first, and add the rest only when the weekly scoreboard shows it's needed.
- Code is written by one agent per working copy. Helper agents research and review; they don't write code in parallel.
- Checks are sized to the risk of the change.
- New: rules become automatic checks rather than instructions, a short CLAUDE.md, a research step, tests for our own skills, a guard for production systems, and isolation for unattended runs.
- onehearthealth gets nothing committed that changes how teammates work.

## 1. The goal

Ship better software with less of the owner's time, across every project. Get the most out of both Claude accounts: fewer lockouts before a reset, and spare capacity spent on checking work rather than wasted.

The "/insights" report mentioned throughout is Claude Code's built-in usage report. It examined 11 sessions in depth from October 2 to 4, 2026.

## 2. What changes in practice: the setup

This is the setup we use, in priority order. Each part says where it lives.

| # | Practice | Why | Where |
|---|---|---|---|
| 1 | **CLAUDE.md under 150 lines, used as a map.** It points to docs and skills instead of holding everything. Standing facts (branch model, environments, access, who reviews what) live in a short facts file it points to. | Anthropic: long CLAUDE.md files "cause Claude to ignore your actual instructions" | Each project |
| 2 | **Rules that matter become automatic checks, not instructions.** Formatting and type checks after edits; fast checks and the `plain` writing check when a turn ends; a guard that blocks production deploy targets and the clinical databases. | Anthropic: hooks run every time; CLAUDE.md is advisory. Hashimoto: when an agent makes a mistake, engineer it so it can't happen again | cstack plugins, project settings |
| 3 | **One loop for real work: research, spec, plan, build, verify.** Research is a short written document you can check. The spec comes from being grilled by Claude. Each task gets a fresh session, with progress written to a file and committed to git. | HumanLayer: bad research leads to thousands of bad lines of code. Anthropic: interview, then write a full spec | cstack plugins |
| 4 | **One writer per working copy.** Helper agents do research and review, on cheaper models. They don't write code in parallel. | Cognition, Anthropic and Hashimoto all warn against parallel code writers | Orchestrate plugin |
| 5 | **Failing test first.** Mutation testing and cross-model review only for risky or clinical code, and mutation testing stays local, never in shared automated builds. | Willison and Beck on red-first tests. Anthropic warns reviewers always find something, which leads to over-engineering | `verify` |
| 6 | **Small pull requests with proof,** in the plain layout: what changed and why, how it works, proof (screenshots or test output), risk. You review before teammates see them. | Willison: several small pull requests beat one big one | `plain`, `verify` |
| 7 | **A thin coordinator chat** that checkpoints to a file and starts fresh; reminders as the chat grows; a pace line at session start. | Huntley: the main window should act as a scheduler. HumanLayer keeps context 40 to 60% full | Orchestrate plugin |
| 8 | **A weekly scoreboard,** plus a monthly review that turns repeated problems into checks, keeps about 20 test tasks for our own skills, and audits the tools each outside skill is allowed to use. | Anthropic: test agents on 20 to 50 tasks drawn from real failures. Third-party skills can grant themselves broad access | Machine level, cstack |
| 9 | **Later, only if the scoreboard shows spare allowance:** unattended runs in burn windows, isolated with an allowed-tools list and no production credentials. | Anthropic and Stripe: isolate both files and network for unattended agents | Orchestrate plugin |

## 3. How it reaches every project

| Layer | What lives there | How a project gets it |
|---|---|---|
| **This machine, both accounts** (`~/.claude-shared`) | The account router, usage meters and pace, the weekly scoreboard | Automatically |
| **cstack plugins** | Orchestrate kit, `plain`, `verify`, and pinned pointers to outside skills | Installed once per account. For precordia and smsMarketing, also declared in the repository's settings so teammates are offered them, once the teammate test confirms this works. |
| **Each project** | Facts file, short CLAUDE.md, `GLOSSARY.md`, plugin settings and trims | `cstack init`, one command. This is the only setup command name; the earlier `orchestrate:init` and `plain init` are folded into it. |

**onehearthealth is different,** because it has teammates. Its facts and plugin settings go in git-ignored local files. No hold or rule that changes teammates' work is committed there. Its plugin trim (vercel and convex off) sits in a local commit on the branch `chore/audio-provider-wiring`, and reaches teammates only if that branch is merged.

## 4. Usage: what we can honestly expect

### The levers

| Lever | Arithmetic | Saving |
|---|---|---|
| Thin coordinator chat with checkpoints | Main chat is about 34% of usage (measured from Sep 7, security sessions excluded). Restarting fresh cuts its cost by 30 to 50%. | 10 to 17 points |
| Trim plugins that load in every session | Plugins add about 11,500 tokens to every session and helper agent | 2 to 4 points |
| Commit security review in its cheaper single-call mode (`SG_AGENTIC_COMMIT_REVIEW=0`) | The commit reviewer's agent mode made 1,737 sessions since Sep 7, 4.4% of usage | Up to 4 points |
| Minus: re-reading context more often after restarts | | A few points |
| **Total** | | **About 10 to 25%, if the habits stick** |

### What that means

Ending the full stops (1.5 to 2 days a week with both accounts locked) needs a cut of about 21 to 29%, so it's borderline. **We measure for two weeks before deciding anything else.** If lockouts continue, the options are extra usage credits for heavy weeks, or a third account. The subscription terms on holding several accounts should be checked first.

### The router

Today the router launches the account with the lower usage. The plan changes it to launch the account whose week resets soonest, because that allowance expires first. This only helps when demand sits between one and two accounts' worth, so it's a small win until usage comes down. Safeguards:

- back up `route.py` first, since it has no history
- treat a stale meter reading (older than 12 hours) as unknown, never as low
- avoid an account close to its 5-hour limit
- never default to an account that is locked

Burn windows and the backlog of spare-capacity work are deferred until the scoreboard shows real unused allowance.

## 5. Closing each finding

| Finding | Fix | Closed when |
|---|---|---|
| Claude planned around facts that weren't true: an update branch that didn't exist, "can't read prod", the wrong table, a route that didn't exist | Standing facts file. A snapshot of real repository state at session start: branch, remote branches, open pull requests. Confirm a route or table exists before relying on it. | No wrong-premise corrections in a month's sample |
| Code read before a pull or rebase went stale | The snapshot reruns after a pull or rebase | Same |
| Status pages left items out: one missed 10 blockers and 22 to-dos | List every item from each source first, with counts, then build the page from that list. A separate checker compares the page with the sources. A gap never counts as a pass. | A planted missing item is caught every time |
| Explanations you had to ask for again | `plain`: writing rules, a checker script, a blank cold reader, a hold before posting | 90% of texts pass within two rewrites; "what does this mean?" questions near zero |
| Unwanted process: a reviewer added, priority set wrong | Preferences in the facts file | None in the monthly sample |
| Production steps blocked and finished by hand | Facts file rule: hand over owner-only steps at the start, as exact commands | Owner confirms monthly |
| Quality checks built on Claude Code hooks | `verify`'s checks are plain scripts that also run in git hooks | Each check runs from a terminal |
| The pull request review routine repeated by hand | `verify` review mode: tests before and after, a plain verdict, posted after you approve | One command reviews a pull request |
| Long builds stalled mid-slice | Build loop: fresh session per attempt, a check after each, stop after the same failure twice, checkpoint every slice | Every stalled loop ends in a report |
| Handoff notes only at the very end | Checkpoint at slice boundaries and past about 250,000 tokens; new chats resume from the checkpoint | Main chat under 300,000 tokens for 90% of turns |
| Mid-run approvals left the agent idle about 7.6 minutes each | Two gates (spec and finished pull request), plus a short mid-course look on long tasks, as Beck and HumanLayer advise. Other interruptions only for a stuck loop, a scope change, a risky area or unclear design. | Interruptions per merged pull request fall month over month |
| Several unrelated goals in one session | One goal per session and working copy | Rare in the monthly sample |
| Large pastes into the chat | A reminder to save them to a file | Median prompt size falls |
| The security plugin's commit reviewer used 4.4% of usage | `SG_AGENTIC_COMMIT_REVIEW=0` | The plugin log shows the setting active; review sessions drop on the scoreboard |

## 6. The order of work

| Step | What | Done when |
|---|---|---|
| **1. Quick wins** (about a day) | `SG_AGENTIC_COMMIT_REVIEW=0` in shared settings. Plugin trims in precordia and smsMarketing. Facts files and a CLAUDE.md under 150 lines in each project (git-ignored in onehearthealth). Compare local cstack with GitHub before syncing. Update cstack and Matt Pocock's skills in both accounts. Router change with the safeguards above. The one-minute teammate test. | Each item done and checked; first scoreboard taken as the baseline |
| **2. `plain`** | Rules, checker, cold reader, hold in precordia and smsMarketing, reply style, glossaries | The `plain` rollout is complete |
| **3. Orchestrate core** | Context meter and reminders, checkpoint and resume, repository snapshot, pace line, production guard, scoreboard, `cstack init` | Main chat under 300,000 tokens for 90% of turns; pace line matches the meters |
| **4. `verify`** | Checks sized to risk, the item-list-and-checker method for summaries, review mode | Planted bugs caught; review mode works |
| **Then decide** | From two weeks of scoreboard data: burn windows, parallel review, a spec gate review page, a third account or extra credits | Owner decides |
| **Every month** | Skills upkeep in both accounts; review of a sample of sessions; skill tests; audit of outside skills' allowed tools | Scoreboard trends hold |

Whether any advisory reminder becomes a hard stop is always the owner's decision.

## 7. Not yet confirmed

These are planned on, but untested:

- **The cold reader starts blank.** We expect a separate `claude -p` call from an empty folder, with `--setting-sources local` and no tools, to see no project context. Step 2 tests it with a probe.
- **T3 Code runs session-start hooks.** None were seen from T3 Code in smsMarketing, which is 79% of usage. The fallback is that the coordinator skill loads the same text when invoked.
- **Teammates are offered plugins declared in repository settings.** Documentation says yes, after they trust the folder. The one-minute test confirms it. If not, the fallback is generated copies marked "do not edit".
- **`cstack init` takes about ten minutes.** The command doesn't exist yet. Approving glossary entries may take longer.

## 8. What can go wrong

| Risk | What we do about it |
|---|---|
| Building this uses the allowance it's meant to save | Step 1 pays back first; the scope is cut to the core until data says otherwise |
| Habits slip, because reminders are advisory | The scoreboard shows it within a week; the owner decides on any change |
| Model reviewers over-flag | Reviewers report correctness problems only; each finding must be reproduced |
| Outside skills change under us | Pointers pinned to exact versions; upkeep shows changes first; allowed tools audited |
| onehearthealth teammates | Nothing committed there changes how they work |
