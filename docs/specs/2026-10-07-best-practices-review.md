# How our setup compares with the best AI-native engineering teams

Status: review for the owner, 2026-10-07. Wave 1 items 6 and 7 added 2026-10-08 at the owner's request. Nothing here is built yet.

## 1. The short answer

We're strong where most teams are weakest: proving that work works, and independent review. We're weak where the leaders get most of their speed. Today the owner, or a chat the owner is driving, still starts every step. Lessons mostly live as notes rather than checks. Agent loops have no limits. And we haven't measured which of our own checks actually pay for themselves.

My estimate is that we do about 60% of what the leaders do that applies to us. This is a judgment, not a measurement. Three waves of changes, listed in section 6, would take that to about 80%, then 90%, then 95%.

The goal used for this review: the owner gets high-quality work quickly across every project, and stops being the bottleneck.

## 2. Where this comes from

Three researchers read primary sources from January 2025 to October 2026 and left out anything they couldn't confirm. The sources fall into three groups:

- **Anthropic:** the Claude Code best practices guide, its engineering posts on long-running agents, harness design, evaluating agents and testing skills, and reports of how the Claude Code team works.
- **OpenAI and companies that publish their numbers:** OpenAI's "harness engineering" post, Stripe, Spotify, Ramp, Shopify, Cursor, Cognition, Factory, Every and Airbnb.
- **Leading independent engineers:** Mitchell Hashimoto, Simon Willison, Kent Beck, Geoffrey Huntley, Dex Horthy of HumanLayer, Lauren Tan, Matt Pocock, Jesse Vincent, Kieran Klaassen, Addy Osmani, Peter Steinberger, Armin Ronacher and Thorsten Ball.

## 3. Where we hit the mark

| What we do | Who does the same |
|---|---|
| **The agent proves its work,** with a verification skill per app that drives it like a user, and evidence tied to the commit | Anthropic calls this its top tip, reporting quality 2 to 3 times better. Also Lauren Tan, Simon Willison, Ramp and Cursor. |
| **The builder never grades its own work.** Karen and Codex review every pull request in fresh copies with no history, and their verdicts cover the exact commit. | Anthropic's planner, builder and evaluator setup; Cognition's "writes stay single-threaded"; OpenAI's agent-to-agent review |
| **One writer per working copy;** helper agents only research and review | Cognition, Anthropic, Huntley, Osmani |
| **A short CLAUDE.md** that points to a facts file and to docs | OpenAI uses about 100 lines; HumanLayer says under 300; Anthropic says to prune it like code |
| **Specs come from an interview,** then get built in a fresh session | Anthropic's guide, Matt Pocock's grill-then-spec, HumanLayer |
| **A failing test before each fix** | Kent Beck, Superpowers, onehearthealth's commit-order check |
| **The owner is only at two gates:** spec and finished pull request | Every and HumanLayer: about 80% of human time goes on planning and review, none on typing code |
| **Skills are tested** with and without the skill, through skill-creator | Anthropic's skill guidance; Superpowers tests skills under pressure |
| **Model reviewers report only correctness problems,** each reproduced | OpenAI's reviewer posts only blocking findings; Anthropic warns reviewers always find *something* |

## 4. Where we fall short

| Gap | What the leaders do | What we do today |
|---|---|---|
| **Lessons are notes, not checks** | OpenAI turns repeated review comments into lint rules whose error message tells the agent how to fix the problem. Before that, they spent a fifth of every week cleaning up. Factory, Shopify and Hashimoto do the same: each mistake gets a permanent fix. | About 50 lessons sit in personal memory files that only Claude reads, and only sometimes. Few have become checks. |
| **Lessons stay private** | Every and Shopify write each solved problem into the repository (`docs/solutions/`, a skill or an AGENTS.md change), so every agent and tool can find it | Lessons go to memory files outside the repository |
| **The ship gate shows diffs and test output** | Cursor attaches a recorded video of the agent using the software, and reviewers check it before merging. Willison's tool records the real command and output, so an agent can't write down what it hoped happened. | `verify` records evidence runs, but there's no video, and some proof is still typed by the agent |
| **The proof check happens at commit time** | Anthropic and Spotify run the checks automatically when the agent finishes, through a "stop" hook. Spotify then has a model compare the change with the original request; it rejects about a quarter of sessions for going out of scope. | Git hooks run when the agent commits; nothing compares the change with the approved spec |
| **No limits on agent loops** | Stripe allows two rounds of fixing, then hands over to a person. Spotify caps sessions at 10 turns and 3 retries. Osmani starts a fresh agent after 3 failures on the same error. | An agent can loop until the account's allowance runs out |
| **Risky code gets the same review as everything else** | HumanLayer reversed its "don't read AI code" advice after ripping out systems. Thorsten Ball skips reading code, except storage, security, architecture and dependencies. | Every pull request gets the same two reviews. Clinical and data code isn't treated differently. |
| **Plans are long** | HumanLayer found reviewing a 1,000-line plan was about as much work as reviewing the code. The owner should see a design of about 200 lines plus a prototype, never the plan. | The `verify` plan is 3,650 lines. It's fine for agents, but the owner must never be asked to read one. |

## 5. What's missing

| Missing | What the leaders do |
|---|---|
| **Work that runs without anyone starting it** | Claude Code routines are saved cloud agents started by a schedule or a pull-request event. They can watch a pull request, answer review comments and fix failing checks; the Max plan allows 15 runs a day. OpenAI runs cleanup agents on a schedule that open small fix pull requests. Boris Cherny, who leads Claude Code, says his job is now writing these loops. |
| **Measuring our own checks** | Anthropic builds 20 to 50 test cases from real failures, measures each check against them, and removes any part that doesn't pay. One line in a system prompt once cut coding quality by 3%. We stack the plain-English checker, the cold reader, Karen, Codex, the plan checker and mutation testing, and have measured only the cold reader. |
| **Work state agents can't quietly edit** | Anthropic keeps long work in a structured data file (JSON) with a pass or fail field per feature, because models are less likely to rewrite it than a Markdown list. A fresh agent resumes from it with no briefing. |
| **Agents reading the running system** | Ramp's agents read logs, telemetry and feature flags, and take screenshots, in a full copy of the system. "Verified" means seen working, not only tests passing. |
| **A readiness score per project** | Factory scores each repository on 60+ pass or fail checks, covering tests, docs, monitoring and security. That would let us compare all five projects. |
| **Catching tests that were deleted or skipped** | Kent Beck stops the agent when it disables or deletes a test |
| **Asking the agent what its brief lacked** | Spotify: the agent "is in a surprisingly good position to tell you what was missing in the prompt" |
| **Labels on claims** | Lauren Tan: every claim says whether it was measured, inferred or a guess |

## 6. The plan to 95%

Ranked by how far each change moves the goal, per unit of effort.

### Wave 1: make every agent finish properly, and make tests independent (about 60% to 80%)

| # | Change | Effort | Done when |
|---|---|---|---|
| 1 | **The ship gate becomes a proof bundle, not a diff.** Every pull request carries a recorded walkthrough (Playwright video for web, Maestro recording for mobile), a check of the change against the approved spec, and a short note on anything touching risky areas. | 2 days, inside `verify` | The owner approves pull requests from the bundle, without opening the diff |
| 2 | **An enforced finish line.** A stop hook runs the project's fast checks and the plan checker before an agent may end its turn. Unattended runs use Claude Code's `/goal` with a measurable end state. | 1 day | No agent reports "done" with a failing check |
| 3 | **Limits on every loop.** Two fix rounds, or three identical failures, then a fresh agent; then a short written note to the owner. Turn limits on unattended runs. | 1 day, in the coordinator | No loop runs past its limit |
| 4 | **Lessons become checks, in the repository.** Turn every mechanical lesson in memory into a lint rule, hook or test, with an error message that says how to fix it. Write the rest into `docs/solutions/` in the project. Every finished task leaves one lesson behind, or says it found none. | 2 days, then ongoing | Half of today's mechanical lessons are checks; memory files shrink |
| 5 | **Risk-sized review.** Changes that touch database schemas, sign-in and permissions, patient data or dependencies get a deeper review and a two-line summary for the owner. Everything else gets the standard review, limited to blocking findings. | half a day, in `pr-review` and the house rules | Each pull request states its risk level, and reviews match it |
| 6 | **An independent test author on high-risk paths.** A separate agent writes the acceptance tests from the approved spec before building starts, and a git hook stops the builder editing them. Moved from optional to required, in house rules section 3.5. | 1 day, in the house rules | Every high-risk change has acceptance tests committed before its first building commit |
| 7 | **Property tests for code that transforms data.** A rule that must hold for every input ("every row in comes out"), checked against hundreds of generated inputs. It would have caught the 347-of-1,084 export. In house rules section 3.5. | half a day, plus a test per change | `pr-review` finds no data-transforming change without one |

### Wave 2: take the owner out of the loop (about 80% to 90%)

| # | Change | Effort | Done when |
|---|---|---|---|
| 8 | **Routines.** A pull-request watcher fixes failing checks and answers review comments. A weekly job per project runs `verify-upkeep`, prunes stale docs, and opens small fix pull requests. These run in Anthropic's cloud, so precordia's broken GitHub billing doesn't stop them. | 1 to 2 days | A week passes in which the owner starts no maintenance work |
| 9 | **Work state as a structured file.** OpenSpec tasks get a matching JSON list with a pass field per item. Only a passing check may flip it. A fresh agent resumes from it and the progress file. | 1 day | A new session picks up a half-done change with no briefing |
| 10 | **Agents read staging.** `verify` adds reading the backend logs (Convex logs) and app errors for the feature it just drove | 1 day | Evidence runs include a log read-back |
| 11 | **The spec gate stays short.** The owner sees a design of at most 200 lines plus the prototype. Plans are for agents only. | a rule, plus a check in `plain` | No owner review is longer than 200 lines |

### Wave 3: measure, then strip what doesn't pay (about 90% to 95%)

| # | Change | Effort | Done when |
|---|---|---|---|
| 12 | **Test cases for our own checks, taken from real failures.** Examples: two dead flags that Karen only found by changing code. An export that silently returned 347 of 1,084 rows. The audio bug. The wrong mobile app ID. A Claude Code hook that exited with code 1. Score every check against them, and re-run the scores after each new model. | 2 days | Each check has a measured catch rate; any check that catches nothing is removed |
| 13 | **A readiness score** for each project, on Factory's model: tests, docs, monitoring, security and agent tools | 1 day | All five projects scored; the lowest gets a plan |
| 14 | **Small guards:** every agent reply ends with "what was missing from my brief", and claims are labeled measured, inferred or guess. The hook that catches deleted or skipped tests moved into the house rules. | half a day | Both live in every project |
| 15 | **Cheaper execution for small tasks.** Superpowers measured its inline mode as twice as fast and half the cost of a fresh agent per task. Use it below a size limit. | a rule in the coordinator | Usage per merged pull request falls |

## 7. Where the experts disagree, and our call

| Question | The split | Our call |
|---|---|---|
| How many agents at once | Yegge runs 20 to 30. Hashimoto and Huntley run one. The Claude Code team runs 5 to 10. | Several projects in parallel, one writer per working copy. More helpers for research and review only. |
| Should anyone read the code | Klaassen and Steinberger don't. HumanLayer went back to reading it. Ball reads only the risky parts. | Karen and Codex read everything. The owner reads only the risk summary, plus the code itself for clinical data changes. |
| Fresh agent per task, or inline | Superpowers found inline cheaper; HumanLayer and Lauren Tan use fresh agents to keep context clean | Inline for small tasks, fresh agents for large or parallel work |
| How many reviewers | Klaassen runs 14 or more; Jesse Vincent softened reviewers to cut churn | Two, limited to blocking findings. Today's four review rounds on `verify` found about 25 real problems, so two is earning its keep. |

## 8. Decisions for the owner

1. **Approve waves 1 to 3 in this order.** Recommended: yes. Wave 1 first, because every later wave builds on proof bundles and finish lines.
2. **The ship gate stops showing diffs by default.** Recommended: yes, except for changes to clinical data, which keep the diff.
3. **Routines run in Anthropic's cloud,** on the Max plan's allowance. Recommended: yes, starting with the pull-request watcher in precordia.
4. **Lessons move out of personal memory into each project's `docs/solutions/`.** Recommended: yes for project lessons. Personal preferences stay in memory.
5. **Remove any check that catches nothing in wave 3.** Recommended: yes, judged on measured catch rates.
