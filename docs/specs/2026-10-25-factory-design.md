# factory: specs in, proven merged pull requests out

Status: draft for the owner's review, 2026-10-25. Nothing here is built yet.

This design replaces the thin orchestrator in
[2026-10-04-orchestrate-design.md](2026-10-04-orchestrate-design.md). That
design's context meter (reads how full an agent's context is), status file (a short file a new session resumes from) and packet files (a short brief for one subagent) are reused below. It was
cross-reviewed against Matt Pocock's skills and Lauren Tan's pstack. See
[Cross-review](#cross-review).

## 1. Why

The owner wants to work on specs and prototypes, then come back to work that is
built, proven, reviewed and merged. Today the owner is the merge step and the
outer loop. The agents also used up the weekly limits on two of the owner's three Claude accounts, mid-week.

Measured over Oct 18–25 in the two main projects:

| | Project A (mobile app, health data) | Project B (web app, SMS) |
|---|---|---|
| Pull requests merged | 134 (128 by the owner) | 29 (all by the owner) |
| Pull requests left open | 7 | 30 |
| Median pull request size, 2 weeks, lines including tests | 334 | 2,204 |
| Share of pull requests over 2,000 lines | 15% | 53% |
| Approximate cost per merged pull request, at API rates | $25 | $60 |

Agents merged no code pull requests in either project.

Across all projects that week, agents used 12.5 billion tokens, worth about $5,400 at API rates.

- **Cache reads were 97% of all tokens.** A main chat re-reads a median of 254k tokens on every turn.
- **Review and verify subagents used 3.2 billion tokens.** That is about 4 Opus runs per merged pull request.
- **Fable was 4% of tokens but 12% of cost.**

## 2. Who it's for

The owner, and anyone else using cstack who wants agents to land safe changes
without them, while risky changes still wait for a person.

## 3. Before / After

- **Before:** every pull request waits for the owner to read and merge it. Long agent chats eat the weekly limits.
- **After:** small pull requests that can be safely undone merge themselves once they pass checks, a review and live proof. The owner reads a 15-minute morning report and decides only the changes that can't be undone.

## 4. Principles

1. **Scripts decide, agents judge.** The order of work, every check, the risk zone, merging, reverting and reporting are all scripts: the same input always gives the same result. Agents only write code, fix it and review it.
2. **Long-lived on disk, short in context.** A run may last days. Each agent session stays small and starts from files.
3. **One pull request is one outcome you can observe.** It is a small vertical slice with its own proof before merge and its own signal after.
4. **Trust is earned, then sampled.** The merge gate runs in shadow mode first. After that, the owner samples merged work instead of blocking it. A revert is a normal correction that adds a check. It is not a failure of the system.
5. **Changes that can't be undone stay with a person.** That covers architecture, schema contracts, health data and turning a feature on for users.
6. **Every file has exactly one writer.** Scripts that run in parallel never write the same file.

## 5. Words

These match Matt Pocock's software-factory vocabulary, so his skills and ours read the same way.

| Word | Meaning here |
|---|---|
| **Orchestrator** | The `factory` script. It holds state and picks the next action. It never chats. |
| **Task** | One kind of standing work, such as "drive a spec to merged", "triage the inbox" or "morning report". |
| **Trigger** | What starts a run: a schedule, a webhook, a pull request event or the owner. |
| **Run** | One agent session doing one step. Runs are disposable. |
| **Coordinator** | A run chain that drives one spec, or one area such as bugs, and never writes code. |
| **Builder** | A run that writes one slice in its own worktree. |
| **Gate** | A question parked with options and a default answer, so work continues around it. |
| **Zone** | Low, standard or high risk. It is worked out from the diff, never from what the pull request says about itself. |

Background terms used below:

| Term | Meaning |
|---|---|
| **The owner** | The person who runs these projects and approves specs. Today they merge almost every pull request themselves. |
| **cstack** | This repository: the owner's library of Claude Code skills, hooks and scripts, shared by every project. |
| **OpenSpec** | The spec format cstack uses. Each change is a folder with a proposal, scenarios, a design and tasks. The owner approves it before building starts. |
| **pstack** | Lauren Tan's published set of agent skills and playbooks. cstack pins a copy. |
| **Matt Pocock's skills** | A published set of agent skills for planning, specs, slicing work into tickets, test-first building and review. |
| **Opus, Sonnet, Fable** | Claude models. Opus is the strong default. Sonnet is cheaper and good for routine work. Fable is the most capable and costs about 2.5 times Opus per token. |
| **Codex verdict** | A second review from a model made by another company. cstack's pull request review can already ask for one. |
| **Accounts** | Three Claude subscriptions (personal, agent, and a work account for the owner's company) plus one smaller Codex subscription. Each has a 5-hour and a weekly usage limit. On 2026-10-25, two of the Claude accounts were at 100% of their weekly limit and the third was at 69%. |
| **Worktree** | A separate checkout of the same repository, so several agents can work at once without touching each other's files. |
| **Trunk** | The branch pull requests merge into: `dev` in Project A, `main` in Project B. |
| **Shadow mode** | The gate records what it would do, but merges nothing. |
| **Ledger** | The gate's record of every call it made and what really happened afterwards. |
| **Door line** | A line in a pull request body saying whether the change can be undone (a two-way door) or not (a one-way door). |
| **Preflight** | A project's own pre-push check script: lint, types, tests and size. |
| **Verification skill** | A per-project guide that tells an agent how to start the app and prove a feature works in it. cstack's `verify-setup` creates it. |
| **`findings.md`** | A running list of confirmed review findings. It is read in batches, so repeated mistakes show up. |
| **Release train** | Deploys happen on a schedule or on demand from the newest green trunk, not on every merge. |
| **Deploy hold** | Project B's existing check, which stops a production deploy when a high-risk change lacks the owner's approval. |

## 6. Layout

```
factory (script): the orchestrator
 ├─ Morning report: scheduled, a fresh run each time
 ├─ Area coordinators: standing, one per area (bugs, perf); state on disk
 └─ Spec coordinators: one per approved spec; Sonnet; a chain of short runs
      ├─ Builder per slice: own worktree; Sonnet by default, Opus when marked hard
      │    └─ optional read-only Explore subagent (the only third level)
      └─ Review lanes per patch: see "Review lanes"
```

- **At most 2 levels of delegation.** Every level loses detail at the handoff and pays a fresh cache write to get started.
- **Runs report through files and the pull request, never through chat.** A pull request event wakes the coordinator, which reads state, not conversation.
- **Run state is mirrored to GitHub** as labels plus one status comment per pull request. Losing the laptop loses nothing.
- **Concurrency is capped:** 3–4 builders per project. Slices that share no files and have no dependency between them run in parallel; the rest run in order.
- **A per-area coordinator keeps its state between runs.** That is how it notices that 30 bug reports share one root cause.

## 7. The loop

| # | Step | Who | How |
|---|---|---|---|
| 1 | Grill, prototype, harvest, spec. Architecture and seams (the few places where tests attach to the code) are agreed here. Every scenario gets a worked example, and the change gets a dated diagram. | Owner + Opus | Matt's `grilling` and `to-spec`, Project B's prototype harvest, `plain`'s `to-diagram` |
| 2 | Approve and lock: approval hash, locked acceptance tests, agreed seams | Script | `factory approve` |
| 3 | Slice the spec. Prefactor slices (tidy-ups that make the feature easy to add) go first. | Script, from `to-tickets` output | `factory plan` (linted like pstack's `check-plan`) |
| 4 | Build one slice, test-first | Builder | `build-slice` brief + Matt's `tdd` |
| 5 | Checks: lint, types, tests, preflight, size, spec compliance, CI. Receipts are saved. | Script | `factory check` |
| 6 | Prove it live, for any runtime surface (UI, query, API) | Sonnet + the project's verification skill | `drive-web` / `drive-expo` |
| 7 | Work out the zone from the diff | Script | `factory zone` |
| 8 | Review, once per patch (see "Review lanes") | Review lanes | `verify:pr-review` |
| 9 | Fix with a fresh builder: at most 2 rounds, and stop if the same failure happens twice | Script decides, builder fixes | `factory next` |
| 10 | Merge gate (see "Merge gate"), bottom of the stack first | Script | `factory gate` |
| 11 | Watch after merge (see "After merge"); revert automatically if red | Script | `factory watch` |
| 12 | Morning report | Script | `factory report` |
| 13 | Sample two pull requests and steer | Owner | 15 minutes |

`factory next` prints exactly one next action as JSON. The coordinator carries
out that action and records the result.

## 8. Slicing

- **What every slice states:**
  - **Behavior:** a spec scenario ID.
  - **Proof:** its locked acceptance test, plus live evidence for any runtime surface.
  - **Watch:** a signal after merge.

  Subtraction and scaffold slices are allowed. Their proof is that the existing suite still passes, and their watch signal is "no regression".
- **Cut vertically, not by layer.**
  - New behavior ships behind a flag that is off by default.
  - Turning the flag on is its own pull request. It needs the owner, and its body carries screenshots and a video.
  - Data changes go expand → migrate → contract. Contract needs the owner.
- **Size limits.** A slice targets about 300 changed lines of non-test code, and it must fit in one fresh builder session of about 150k tokens.
  - Over 400 lines is never auto-merged, unless the slice is a recorded mechanical change that the reviewer reproduces by re-running the recorded script.
  - Tests, fixtures, generated files and lockfiles don't count toward the size.
- **A builder whose diff passes the limit stops, and the slice is split.**
- **Stacks:**
  - Each pull request passes CI on its own base.
  - Merge bottom-up, with at most 5 open per stack.
  - Only the coordinator rearranges stacks (`gh stack`). Builders never rebase.
- **Fallback for work that can't stay green in small pieces:** a shared integration branch whose last slice integrates and verifies everything. That slice always needs the owner.

## 9. Review lanes

| Lane | Model | Sees | When |
|---|---|---|---|
| Claims | Opus (`claims-auditor`) | Pull request body, diff, check receipts (it doesn't re-run them) | Every pull request |
| Breaker | Codex when its budget allows, otherwise Opus. Briefed like pstack's `blast-radius` | Diff and spec only, never the pull request description. Each finding needs a failing test or a reproduction | Every pull request |
| Standards | Sonnet, Matt's `code-review` standards pass | Diff and the project's standards files | Every pull request |
| Behavior | Sonnet + verification skill | The running app | Any runtime surface |
| Architecture | Opus | `objectives.md`, architecture decision records (ADRs), spec, diff | Standard and high zones, or a new module |

- **Agent review starts only after checks are green.** Findings stay separate for each lane.
- **One verdict per patch.**
  - The verdict stores the base commit's ID and the `git patch-id`, a fingerprint of the change itself.
  - When a stack rebase leaves the patch unchanged, the verdict stands, and only CI and mergeability run again. Without this, one merge would void every verdict above it.
- **The Breaker runs on a different model family from the builder.** Builders are Claude, so the Breaker is Codex (OpenAI) whenever Codex has budget. This follows pstack: "Run a unit's verifier on a different model family from its worker." Models from different makers tend to miss different things, so a second family catches mistakes the first one would wave through. Fable is no longer used.
- **Codex has a much smaller budget than Claude.** In the week measured, the owner's Codex plan used about 115 million tokens and reached 66% of its weekly limit. Claude used 12.5 billion. So Codex goes where it adds the most, decided by a script:
  1. Below 70% of the weekly Codex limit: the Breaker runs on Codex for every pull request.
  2. From 70% to 90%: Codex only for standard and high zone. The low zone uses Opus.
  3. Above 90%, or when the 5-hour limit is near: the Breaker runs on Opus everywhere.

  The script reads the limit from Codex's own session logs, which record the percentage used. The verdict file records which model ran each lane, and the gate refuses a "Codex" verdict that didn't come from Codex.

## 10. Merge gate

`factory gate <pr>` prints `MERGE`, `HOLD <reason>` or `SHADOW <would-merge|would-hold>`.
It fails closed: if any fact is missing, the answer is `HOLD`.

**What the gate checks** (all on the head commit):

1. Check receipts and CI are green.
2. **Fresh against trunk:** `git merge-tree` is clean. Nothing that landed on trunk since the merge base touches this pull request's paths or the CI config.
3. The zone is worked out from the diff.
4. The base is allowed, and the pull request is at the bottom of its stack (or its parent has merged).
5. Spec compliance passes, and the approval hash matches.
6. There is live evidence for any runtime surface.
   In a project whose merges deploy, a slice that adds behavior also names its flag. The flag defaults to off, and the Behavior lane showed that with the flag off the app behaves as trunk does.
7. The review verdict is `READY` for this patch, with no confirmed must-fix.
8. It is within the size limit, it is not a draft, and it has no unresolved threads.
9. Merging is switched on for this zone in this project.

**The trust ladder.** Every pull request gets a shadow call in that project's
ledger.

- **What counts as a disagreement:** a revert, or the owner marking a merge "shouldn't have merged". An owner's "asked for changes" is not a disagreement; it goes to `findings.md`.
- **Switching a zone on:** at least 30 "would merge" calls over at least 2 weeks with no disagreements.
- **Switching a zone off:** any disagreement. The zone comes back on once a new check exists and is shown to fail on the pull request that was reverted. That check is a change to the factory itself, so the owner reviews it.
- **Never switched on, in any project:** the factory's own files, `.github/` and `openspec/`. Each project adds its own list (see "Projects").

Every write the gate, watch and revert make is idempotent. Running a revert twice leaves the same state as running it once.

## 11. After merge

- **Every pull request names its watch signal.** That can be an analytics event, an error-tracker tag, a log line, a backend query or an end-to-end test name.
- **The watch must look at something real users touch.**
  - In a project with a promotion step, such as `dev` to `main`, the watch runs at promotion. Merging into `dev` only gets CI and the end-to-end tests on `dev`.
  - In a project whose merges deploy, the watch runs after the deploy.
- **When the watch goes red**, the script opens a revert pull request, the gate merges it, and the zone switches off. The case goes at the top of the morning report.
- **Failure classes come from pstack's shipping playbook.** For example, `BLOCKED` while checks are pending is not a failure.

## 12. Projects

**Project A** (mobile app, health data, base `dev`):

- **Merging into `dev` doesn't reach users.** A person promotes `dev` to `test`, then to `main`.
- **It needs a zone script.** Today a person writes the door line in each pull request by hand, and nothing checks it against the diff.
- **First agent merges:** the low zone into `dev`.
- **Never switched on:** health data, schema, auth, contracts, and the `test` and `main` bases.
- **Feature branches:** an agent may merge into one only if that branch has a tracked pull request into `dev`.

**Project B** (web app, SMS, base `main`):

- **Merging into `main` keeps deploying the production backend.** The owner decided (2026-10-25) that validation plus feature flags is enough for now. A release train is deferred.
- **New behavior ships dark.** Project B already keeps feature flags in its database, so a flag can change without a deploy.
  - Every slice that adds behavior declares its flag. The flag must default to off.
  - The Behavior lane runs the app with the flag off and checks that it behaves exactly as trunk does. That proves the deploy changes nothing users see.
  - Turning a flag on is the owner's decision.
- **The first response to a problem is the flag, then a revert.** When the watch goes red on a flagged change, the script turns the flag off first, which takes seconds. Then it opens the revert.
- **What flags don't cover:** schema changes, data backfills, and timing between the backend deploy and the web deploy. Those stay in the high zone, behind the existing deploy hold.
- **The zone script already exists.** It works out the zone from the diff, and the core copies its approach.
- **First agent merges:** the low zone, with flags.
- **Never switched on:** the high zone, including any schema change.
- **The release train comes back** if either of these happens:
  - a change the flags couldn't contain reaches users;
  - the standard zone is about to be switched on.
- **The long-lived `dev` branch should be retired later.** It and `main` have drifted apart: 323 commits on `main` aren't on `dev`, and 369 commits on `dev` aren't on `main`.

## 13. Gates, escalation and re-entry

Questions that come up mid-work follow the decision desk (the `add-decision-desk` change). The builder never decides alone, and work doesn't stop:

1. **Already answered** by a ruling, a rule or the spec: the answer is applied and cited.
2. **Can't be undone** (schema, sign-in, health data, turning a feature on, a new dependency): parked for the owner, and the builder takes another slice.
3. **Can be checked** with a test or command: the answer is proved, and the proof saved.
4. **Otherwise, two blind opinions.** The builder and a second model of another family pick independently. Agreement decides. On disagreement the coordinator picks, the decision is marked contested, and only the merge waits for the owner.

Every decision becomes a card with tradeoffs, a worked example, how to reverse it, and screenshots when users would see the difference. The morning digest shows the cards, contested ones first. The owner answers each with `keep` (it becomes a ruling), `switch` (a follow-up slice) or `rule` (it becomes a project rule). Three unanswered disagreements in one change pause it, and the owner gets one question about the spec.
- **A `HOLD` ends that pull request's run.** The owner restarts it by adding the `factory:go` label or by approving the review. A new run picks it up.
- **A global stop line:** `factory stop` tells every agent to make zero writes.
- **The standing orders are pasted word for word** into every spawn and relay, because instructions decay across resumes.

## 14. Handoffs and state

**Files** (one writer each):

- **Shared machine state.** Lives under `$(git rev-parse --git-common-dir)/factory/`, so every worktree of the project sees it and it is never committed. pstack's `orch.ts` store is the model:
  - `units.tsv` (written by `plan`)
  - `checks/<pr>.json` (written by `check`)
  - `verdicts/<pr>-<patch>.json` (written by `pr-review`)
  - `gates.md` (written by the coordinator)
  - `ledger/<pr>.json` (written by `gate`)
  - `watch/<pr>.json` (written by `watch`)

  Readers combine these files when they read.
- **`run-log.md`:** committed in the change folder. Append-only, one line per decision with why and an evidence pointer. Each claim is dated and cites a commit. It follows pstack's `show-me-your-work`.
- **`STATUS`:** the status file from the orchestrate design.
  - Its "Done", "In flight" and "Next" sections are generated from state, never written by hand.
  - An agent writes only "Decisions", "Tried and failed", "Landmines", "Open" and "Suggested skills".
  - It must stay under 60 lines.

**When a run hands off:**

- **At boundaries.** A pull request merged or held, a phase ended, or a fix round started. Fix rounds always use a fresh builder.
- **Mid-phase, past the context cap.** That is about 60k tokens for a coordinator and about 150k for a builder. The run sends the rest of the work to a subagent instead of relaying.
- **Before going idle.** The cache lasts an hour, so waking a big context means paying to write it all again.
- **The cost.** Relays and auto-compacts are counted and their cost measured before either is treated as a failure. On Opus, a relay pays for itself after about 5 more turns.

**In the desktop app that runs the agent threads**, a coordinator relays by doing these in order:

1. Write `STATUS`.
2. Start the next thread in the same worktree.
3. That thread registers the pull request watches and links again.

Whether watches carry over between threads still has to be checked.

- **Scheduled tasks start a fresh thread each time.**
- **An hourly liveness check** judges builders by their side effects (commits and pushes) and replaces any that are stuck.

## 15. Architecture quality

1. **`objectives.md` per project:** direction, what to optimize for, non-goals, and 5–10 rules.
2. **Decisions that can't be undone are named in `design.md` and approved there.**
   - An ADR is written only for a decision that is hard to reverse, surprising, and a real trade-off.
   - New dependencies go into a dependency log.
3. **Script checks:**
   - import boundaries (Matt's `setup-ts-deep-modules`, which proves the rule fails on a bad import)
   - a size limit on god files
   - lint, mutation and size ratchets
   - a daily ratchet that removes one entry from the exception list
4. **Lessons become checks.**
   - A finding seen twice becomes one pull request that adds a lint rule, type, check or skill edit. Each rule is paired with what enforces it, as pstack's `correct` does.
   - The owner's corrections are mined from transcripts and from ledger "asked for changes" entries.
   - A retro runs on 1 merged pull request in 10.
5. **The weekly drift report** uses Matt's `improve-codebase-architecture`. Its output is one ticket, not a pull request.
6. **Perf-sensitive slices** measure the trunk baseline first, then compare trunk with the head.
7. **The factory's fixes to itself always get owner review,** and fixes never chain.

## 16. Accounts and cost

| Account | Used for |
|---|---|
| Personal | Spec and prototype threads with the owner |
| Agent | Factory runs for Project A and for cstack itself |
| Work (the owner's company) | Factory runs for Project B, which the company owns |
| Codex (OpenAI) | The Breaker lane, within its smaller budget (see "Review lanes") |

Each project's runs are charged to the account of whoever owns the repository.

**Built for subscription limits.** Subscriptions don't bill per token. They lock an account when its 5-hour or weekly limit runs out. So the factory budgets in percent of each limit, not in dollars:

- `factory budget` reads each Claude account's last known usage (each account's settings file keeps a copy) and Codex's (its session logs record it). It prints the percent used, the reset time and the pace: percent used divided by the share of the week that has passed.
- **Pace above 1.25** (the account would run out early) puts that account in lean mode. New builders start only for slices already in flight. Reviews of the low zone use the cheapest lane that is allowed. Nothing optional runs.
- **At 90% of either limit**, the orchestrator starts nothing new on that account and finishes what is running. Work never moves to another account, because that would just move the shortage.
- **A reading older than 12 hours counts as missing.** Missing data means lean mode, never normal.
- Dollars at API rates are still reported, because they show where the usage goes. The decision always uses percent of the limit.

If this works inside these limits, it works anywhere with more room. That makes it portable to other setups without changes.

**Targets:**

- About 40% fewer tokens per merged pull request.
- Opus share of tokens down from 81% to about 55%.
- Project B's cost per merged pull request moving toward Project A's.

`factory tokens` reports these figures weekly, by project, in tokens and in API-rate dollars.

## 17. Reuse

| Piece | Already exists | Extended or created |
|---|---|---|
| Per-project settings | `.claude/verify.json` (`integrationBranch`, `highRisk`) | Extended with a `factory` block |
| Live proof, spec compliance, verdicts, evidence | `verify` scripts. Verdicts already live in the shared git folder and already carry over when the patch-id matches | Extended: receipts in place of test re-runs, findings kept per lane |
| Pull request review | `verify:pr-review` + `claims-auditor` | Extended with Breaker, Standards and Behavior lanes |
| Verification skill per project | `verify-setup`, `verify-upkeep` | Extended with a feature map and a watch signal per feature |
| Guard | `core` guard | Reused as is |
| Context meter, status file, packet files, pace | Orchestrate design (not built) | Built here |
| Slicing input | Matt's `to-tickets` (local mode) | Reused; `factory plan` adds base, files, model, budget, scenario and watch |
| From prototype to spec | Project B's prototype harvest. It freezes the prototype and walks it with screenshots. It maps each value to real data, and lists where the prototype and real data differ. Each interaction becomes a scenario. | Harvested into cstack as its own change, with a throwaway prototype space for each project |
| Examples and dated diagrams | `plain`'s `to-diagram` and its checker | Extended by the `add-spec-visuals` change: worked examples, stamps, and a freshness check |
| Test-first inner loop | Matt's `tdd` | Reused |
| Pull request body | Matt's `pr` (evidence, merge danger) | Reused; the zone still comes from the diff |
| Inbox triage | Matt's `triage` | Reused, with de-duplication: comment on the open ticket instead of filing a new one |
| Store layout, shipping order, freshness check, liveness | pstack `poteto-mode` playbooks | Design copied, code written fresh (theirs needs bun and Cursor) |
| Decision trail | pstack `show-me-your-work` | Reused for `run-log.md` |
| Orchestrator, gate, watch, report, tokens, coordinator and builder briefs | Nothing | Created as the new `factory` plugin |

## 18. Order of work

Each step adds one new trigger and is its own OpenSpec change in cstack.

| Step | Adds | Owner still merges |
|---|---|---|
| 0a | `add-spec-visuals`: worked examples on every scenario, a dated diagram in every change, and a freshness check | Everything |
| 0 | `factory` plugin skeleton, `factory tokens`, settings for both projects, `gate` in shadow (ledger only), patch-id verdicts, checks before review | Everything |
| 1 | Morning report (trigger: schedule). Pilot: Project B's 30 open pull requests run through the gate in shadow | Everything |
| 1b | `add-prototype-harvest`: Project B's prototype-to-spec harvest, made generic for every project | Everything |
| 2 | `factory next` and a spec coordinator for one spec in Project A (trigger: pull request events). Liveness check | Everything |
| 2b | `add-decision-desk`: questions mid-work answered without stopping, with blind second opinions and a digest of cards | Everything |
| 3 | Project A low zone switches on, if it has earned it. Watch at promotion, automatic revert | Standard and high |
| 4 | Project B low zone, with flags off by default and turning off the flag as the first response | Standard and high |
| 5+ | Area coordinators (trigger: webhooks), lessons loop, drift report. Then the next project | High only in A; standard and high in B |

## 19. Non-goals

- **Agents merging changes that can't be undone,** in any project, at any step.
- **Many verifiers fuzzing every pull request,** like pstack's full autopilot. It costs too many tokens at our limits. The Behavior lane is the single live verifier.
- **A chat-based orchestrator that relays messages between chats.** Rejected: its context grows with every child.
- **Copying pstack's `orch.ts` or Cursor-specific playbooks.** Only their design is borrowed.
- **Client work, for now.** The design is built for the owner's own subscriptions first. Running it for an employer or a client is a later decision.

## 20. Cross-review

The table records how the cross-reviews changed the earlier draft, and where we kept ours.

| Source | What it said | What we did |
|---|---|---|
| Lauren Tan, in her podcast with Matt Pocock (52:30, 55:00) | Review after landing, sample instead of block, and treat reverts as normal | Changed the trust ladder: only reverts count, a zone comes back once a check is proven, and "asked for changes" goes to findings |
| pstack `shipping` | Keep verdicts across rebases by patch-id | Added |
| pstack `autopilot-full` | Check freshness against trunk at merge, check liveness, have a stop line | Added |
| pstack `autopilot-full` | Live verification is the minimum | Behavior lane is required for any runtime surface |
| pstack `orchestrate` | Verifier from a different model family | Adopted: the Breaker runs on Codex whenever its budget allows. Fable dropped |
| pstack `orchestrate` | Every file has one writer; status is generated | Adopted |
| pstack `correct` | A lesson becomes a rule after 2 sightings | Adopted, down from 3 |
| pstack `orchestrate` | Park questions as gates with defaults | Adopted; builders no longer stop to ask |
| podcast 52:00 | Coordinators per area | Added standing area coordinators |
| Matt `software-factory` | Add one trigger at a time; state survives on the git host; name where a person re-enters | Staggered the order of work, added GitHub mirroring and the `factory:go` label |
| Matt `code-review` | A standards axis kept separate | Added the Standards lane on Sonnet |
| Matt `to-tickets`, `to-spec`, `tdd` | Prefactor first, agree seams, size slices to one context | Adopted |
| Matt `handoff` | Point to artifacts rather than repeating them | `STATUS` sections are generated from state |
| Matt `PHASE-BOUNDARIES` | Mid-phase, send work to subagents instead of relaying | Adopted |
| Matt `ADR-FORMAT` | ADRs only for hard-to-reverse decisions | Adopted, plus a dependency log |
| Matt `implement-spec` | One integration branch per spec | **Kept ours** (one pull request per slice), because the gate needs one outcome per merge. The integration branch is only the fallback |
| Matt (general) | A human merges | **Kept ours.** Agents merge, but only changes that can be undone, and only after shadow mode |

## 21. Decisions

- 2026-10-25: Scripts decide and agents judge; at most 2 levels of delegation.
- 2026-10-25: One pull request is one observable outcome, about 300 lines, merged bottom-up.
- 2026-10-25: The default review is Claims on Opus, Breaker on Codex (Opus when the Codex budget is low), and Standards on Sonnet. Fable is no longer used.
- 2026-10-25: Project B keeps merging into `main` with deploys. New behavior ships behind database flags that are off by default. The release train is deferred until a named trigger.
- 2026-10-25: This design replaces the orchestrate design and reuses its parts.
- 2026-10-25: Accounts: Personal for specs, Agent for Project A and cstack, Work for Project B, Codex for the Breaker. Budgets are in percent of each subscription limit. Client work is out of scope for now.

## 22. Open questions

1. **Should the Codex plan grow?** At its current size, it covers about one review lane, and only part of the week. A bigger plan would let Codex run more of the work, including builders for mechanical slices.
2. **Which Project A spec is the first pilot** for the spec coordinator in step 2?
