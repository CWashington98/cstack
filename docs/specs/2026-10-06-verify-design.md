# verify: proving that work works

Status: draft for review, second version, 2026-10-06. Adds: general-first rule, shared driving guides with thin per-app skills, Karen and Codex on every pull request, and the `pr-review` skill.

## 1. Why

Our checks prove that code passes tests. They don't prove that the product works.

- **The audio bug.** In precordia's labeling app, every recording request failed, and the player silently showed a made-up waveform instead of the patient's real heart sound. A cardiologist would have marked heart sounds on fake data. It survived 374 backend tests, 15 browser tests, mutation testing across 31 modules and four independent reviews. The unit test checked that the audio address equaled a fixed text string, which stays true whether or not the address works. The browser test opened a patient and never pressed play.
- **Incomplete summaries.** A status page left out 10 blockers and 22 to-dos. Nobody noticed until the owner asked "does this cover everything?"
- **Checks that did nothing.** smsMarketing's repository gates all silently allowed everything until someone noticed that only exit code 2 blocks. precordia's pre-push mutation gate calls a script that isn't in the repository, so it allows every push.
- **A harness that didn't run everything.** An end-to-end runner in smsMarketing reported success after running 2 of 5 scenarios, in 4 of 9 runs.

Lauren Tan (poteto), who builds Cursor's agent tooling, puts it plainly: "Tests alone are not sufficient verification." Her method plans how each piece of work will be proven before it's built, and proves it on the real running app.

## 2. Goals

| Goal | How we know |
|---|---|
| Every piece of work says how it will be proven before it's built | Every spec scenario and every plan item names its evidence; a script checks it |
| Every user-facing change is proven on the running app, not only by tests | Each pull request carries a live check with a screenshot or recording, a trigger and an end state |
| Each active app can be driven by an agent that has never seen it | Each active app has a verification skill that has run end to end at least once |
| A verdict always comes from someone who didn't write the code, for the exact code being merged | Verdicts are tied to a commit and checked before merge |
| The checks themselves are trustworthy | Planted bugs, including a copy of the audio bug, are caught every time |
| Checking stays proportionate | Low-risk changes take minutes; high-risk ones get the full ladder |

## 3. Where the ideas come from

| Idea | Source |
|---|---|
| Plan the proof before the code; every plan item names its evidence; tests alone never verify; per-app verification skills with feature maps; a high bar for proof; verdicts only from non-authors | Lauren Tan's pstack skills and playbooks (MIT license) |
| An agent completes a plain-English step, and a passing run is replayed later without a model | TesterArmy's open-source `e2e` framework (Apache 2.0). We get the same thing with skills on our subscription instead of a paid API key. |
| Only exit code 2 blocks; a harness must prove it ran everything; break the code to prove a test can fail; review records tied to a commit; local gates with cheap continuous integration | smsMarketing's lessons |
| Test properties, not exact values; four testing tiers; a deliberately uneven test fixture | precordia's lessons from the audio bug |
| Every "it works" claim ends in a verdict: verified, not verified, or inconclusive | onehearthealth's `verify-this` setup on its `dev` branch |
| Scope tripwires, fast checks first, failing test first, mutation testing for risky code, independent review where findings must be reproduced | The earlier research on Anthropic, Matt Pocock, superpowers and Trail of Bits |

## 3a. General first

cstack is used in every project, so it ships only general skills, scripts and guides. A project contributes facts, settings and feature maps, never custom logic.

- **Decided from many projects, not one.** Five active projects inform the defaults: precordia, onehearthealth, smsMarketing, and the projects in the `IC/investFest` and `IC/rebellion` folders. A rule that only one project needs stays in that project, until a third project needs it too.
- **Project examples in this document are facts, not features.** Journeys, risk names and app lists show what each project's settings would hold.

## 4. Part one: planning the proof

### 4.1 In specs

Every scenario in a spec gets a "Proved by" line. It names three things: where it's checked, what evidence comes out, and what passing looks like.

```markdown
#### Scenario: a rater plays a recording
- GIVEN a rater opens a patient with three recordings
- WHEN they press play on the first one
- THEN they hear the patient's real heart sound and see its waveform
- Proved by: live in the labeling app (feature `recordings`, sub-feature `play`);
  evidence: recording of the press and the waveform, plus a read-back that the
  audio request returned the stored file's bytes; pass when the bytes match the
  stored file and the waveform is drawn from them.
```

The OpenSpec rules block (a separate design) makes this line required.

### 4.2 In plans

- **Every plan item names its evidence:** a test name, a file, a log line, a screenshot path or a commit. An item is ticked only when that evidence exists. A script, `verify-plan`, checks that every ticked item points to evidence that is really there.
- **Every pull request section has three proof boxes:** verify unit (tests), verify live (on the running app), and verify performance (only when speed or size could change). **Tests alone never verify a pull request.**
- **The done condition is countable and fixed before work starts,** for example "all 12 tasks merged, each verified live or by unit test". It is never relaxed to declare victory.
- **Units are small and end in a checkable state:** one function and its tests, or one bug fix. The failing test is committed before the fix.

### 4.3 Verification status

Each pull request gets one status, tied to its latest commit. A new commit clears it.

| Status | Meaning |
|---|---|
| verified live | Proven on the running app on the matching surface |
| verified by tests | Unit or integration tests prove it; allowed only for changes with no user-facing behavior |
| type check only | Not enough for any behavior change |
| blocked | The check couldn't run. This is never a pass. |
| failed | The check ran and the work didn't hold |

"Inconclusive", or a check run on the wrong surface (a unit test for a screen change), counts as failed.

## 5. Part two: a verification skill for each app

### 5.1 Two layers: shared guides and thin app skills

| Layer | Where | What it holds |
|---|---|---|
| **Shared driving guides** | cstack, once | How to drive each kind of surface: web apps (Playwright, or the Chrome tools for exploring), Expo apps (Maestro, or Expo's cloud simulator skill), and backends (scripts that read back stored data). Each guide includes the general health checks: the installed app or site really is this project's, the build matches the current commit, and nothing waits on a fixed pause. It also covers known limits, such as Maestro having no real microphone. |
| **App skill** | each project, per app | Only that app's facts: start command, app ID or address, routes and labels, test data, the feature map and gotchas. Mostly generated from the app's own files (`app.json`, route folders, existing test flows). |

Two bugs found in precordia's patient mobile tests show why the line falls here. The recording test targets the wrong app ID, which only a per-app fact can catch. It also never presses "Start Recording", which the shared guide's rule "trigger and end state in every check" catches in any app.

### 5.1a What an app skill contains

Each app gets a skill at `.claude/skills/verify-<app>/`, committed so teammates and every agent can use it. It's written for an agent that has never seen the app, picking it up in the middle of a task.

| Section | What it holds |
|---|---|
| Start | The exact start command, how to tell it's ready, and how to stop it |
| Health check | One read-only check that this running copy is worth testing: the right build (never a stale one), the right port, signed in |
| Drive | Real routes, screen labels and test handles from the code, never screen coordinates |
| Evidence | Where screenshots, recordings and read-backs go, and what each must show |
| Clean up | Stop only what this run started. Never delete the evidence. |
| Helpers | Small scripts with the exact command to run each one |
| Feature map | One file per user-facing feature, described next |

### 5.2 The feature map

`features/README.md` lists every feature, with the shared preconditions and the rule that a skipped entry point is never reported as verified through another path. Each feature file has four sections:

1. **Sub-features,** with short IDs such as `play` or `move-rater`.
2. **How a user gets to it.**
3. **Driving it,** with preconditions, then each action paired with its exact command and the result you should observe.
4. **Gotchas.**

Implementation details stay out. The map describes what a user does and sees.

### 5.3 Agent steps that become free replays

This is the part we take from TesterArmy's `e2e`, built with skills instead:

1. **First time:** an agent drives the feature from a plain-English goal, such as "move rater 4 to panel B and confirm the matrix updates", using the browser tools or Maestro.
2. **When it passes,** the agent saves the exact steps as a deterministic test: a Playwright test for web apps, or a Maestro flow file for Expo apps. The test is committed next to the feature file.
3. **Next time,** the saved test replays with no model and no cost, in a git hook, a nightly run or by hand.
4. **When a replay fails,** first suspect the test itself: a changed label or a slow screen. If the product really changed, an agent re-drives the goal and updates the saved test.

This follows precordia's promotion rule: something found by exploring becomes a scripted step, and a stable scripted step becomes an automatic check. Nothing gets checked by hand twice on purpose.

### 5.4 Journey maps for flows that cross apps

Some of the worst bugs live between apps. Each repository gets one `journeys.md`. Each journey strings together feature IDs from the apps' maps, with a trigger on one side and an end state on the other:

| Repository | First journeys |
|---|---|
| precordia | A recording made by a patient reaches the labeling app and plays its real audio, then reaches expert review |
| onehearthealth | A recording made offline on the phone syncs, then appears on the dashboard for the same patient |
| smsMarketing | A sign-up on the marketing site appears in the dashboard and in admin |

### 5.5 Which apps, and when

| Now (active in the last 60 days) | When a spec first touches them |
|---|---|
| precordia labeling app and patient mobile app; onehearthealth mobile and dashboard; smsMarketing dashboard, admin and marketing site | The other seven apps |

precordia's patient mobile app is included now (owner decision): it handles clinical recordings, and its recording test silently proves nothing today.

The spec process asks "does this app have a verification skill?" and creates one as part of the first change that touches it.

### 5.6 Creating and maintaining them

- **`/verify-setup <app>`** creates the skill. It's adapted from poteto's `create-verification-skill` for Claude Code, our folder layout and our tools:
  - Playwright or the Chrome tools for web apps
  - Maestro (or Expo's cloud simulator skill) for Expo apps
  - scripts that read back stored data for backends: Convex for precordia and smsMarketing, AWS Amplify for onehearthealth

  It studies the repository first and asks the owner only what the code can't answer.
- **A skill counts only after it has run once,** end to end: start, health check, drive one feature, clean up, and confirm the evidence survived. "A generated skill that was never executed is a draft."
- **`/verify-upkeep`** is adapted from poteto's `maintain-verification-skill` and runs monthly alongside cstack's skills upkeep:
  - It re-drives every feature live, even when the code looks unchanged.
  - It sorts each problem into three kinds: the document drifted (fix it), the tooling broke (fix it), or the product broke (report it).
  - It edits only the verification skill's own folder, never product code.

## 6. Part three: the check ladder, sized to risk

Checks run cheapest and most certain first. The model-based steps come last.

| Step | Check | Run by |
|---|---|---|
| 1. Scope and tripwires | The change stays inside the task. Fails on deleted or skipped tests, tests narrowed to one case, loosened assertions, lowered thresholds, or new lint exceptions. | Script |
| 2. Fast checks | Formatting, lint, type check, tests for the affected code | Script |
| 3. Failing test first | New tests fail on the main branch and pass with the change. A bug-fix test fails when the fix is reverted. | Script |
| 4. Spec coverage | Every scenario has a test or a live check that cites its ID | Script |
| 5. Live proof | The app's verification skill drives the changed features and journeys. It records the trigger and end state, and reads back side effects. | Agent, then a saved replay |
| 6. Mutation testing | Changed files in risky areas only; the score floor only goes up | Script, locally only |
| 7. Independent review | Reviewers on a different model family, checking correctness only. A separate validator must reproduce each finding, or the finding is dropped. | Model |

| Risk | Example | Steps |
|---|---|---|
| Low | Copy, styling, docs, tooling | 1, 2 |
| Standard | Most features and fixes | 1 to 5, and 7 for bigger changes |
| High | Patient data, results, recording, sync, sign-in, billing, consent, security | All seven |

Each repository maps its own risk names: onehearthealth's tiers, smsMarketing's zones, and precordia's clinical paths.

## 7. Part four: what counts as proof

The proof standard, used by every check and shown in each pull request's "Proof it works" section:

1. **Drive the real user path.** Inspect state afterwards if needed, but never fake the action.
2. **Show the trigger and the end state in the same recording or screenshot pair.**
3. **Read back side effects:** the row written, the file stored, the message sent.
4. **Wait for the real end state,** never a fixed pause.
5. **Run the health check first.** Evidence from a stale build isn't evidence.
6. **Test properties, not exact values.** "The audio address equals this text" proves nothing. "Requesting what the page plays returns the stored file's bytes" proves the feature.
7. **Ask what would make the test fail.** If the only answer is "changing this text", or the test would still pass if every function returned nothing, rewrite or delete it.
8. **Break it to prove it.** Before trusting a new test, change the code so the test should fail, and watch it fail.
9. **A runner must prove it ran everything.** It reports how many scenarios it ran against how many exist, and fails when they differ.
10. **Never put patient data in evidence.** Use IDs and counts. This applies to onehearthealth and precordia.

## 8. Part five: verdicts and the `pr-review` skill

**Every pull request gets two verdicts: Karen (Claude) and Codex (OpenAI).** Different models from different providers catch different mistakes, and each checks the other. Both are required. If they disagree, the owner decides. If Codex runs out of quota, a Claude reviewer on a different model fills in and says so in its comment.

The `pr-review` skill runs the review. It encodes what has worked and what has gone wrong across the projects:

| Rule | The lesson behind it |
|---|---|
| Reviewers get only the change since the branch point, the spec with its "Proved by" lines, and the pull request description. Never the author's reasoning. | A reviewer who sees the argument tends to accept it |
| Each reviewer works in its own read-only copy of the repository | A reviewer's checkouts once wiped an implementer's edits |
| Cheap checks first: the scripted `verify` steps, the `plain` check on the description, and whether live evidence exists | Model reviews are slow; scripts are certain |
| Karen runs the gates herself and checks the claimed scope against the actual change | Expert agents report "done" against narrow criteria and miss side effects |
| Karen audits the tests: they must check properties, not exact values, and must fail if the code returned nothing | The audio bug's test checked fixed text and passed while the feature was dead |
| Karen deliberately breaks the code: conditions flipped both ways, and off-by-one changes | Three reviews missed two dead `capped` flags; one such break found them |
| Karen checks the test data can reach the limits being tested | A limit derived from a count was unreachable in a small test fixture |
| Karen audits live evidence: trigger and end state, never a stale build | "Look, it opens" proves nothing |
| Karen checks completeness against a listed inventory | A status page once left out 10 blockers and 22 to-dos |
| Codex reviews adversarially for correctness, from up to three angles depending on size: skeptic, architect and minimalist. It adds a security angle for high-risk changes. | Lauren Tan's adversarial review uses the other model family for exactly this |
| Every finding is reproduced by a separate check, or dropped. Security claims must show the exact line, the trigger, the data flow and proof, after a search for existing defenses. | Anthropic's code review and Trail of Bits' false-positive checks |
| Correctness only: no style comments, nothing that existed before the change, nothing a linter catches | Anthropic warns that reviewers always find something, and chasing it over-engineers the code |
| Verdicts are plain-English comments carrying the commit ID. A new commit clears them. After a rebase they carry over only if the change content is identical (`git patch-id`). | The verdict must be for the exact code being merged |
| Reviews happen before the pull request opens, and again on the final commit before merge | A pull request was once merged in the browser while Karen was still reviewing; she came back not ready |

**Two modes:**

- **Own pull requests:** every rule in the table.
- **Teammates' pull requests:**
  - prove a fix by watching its test fail without the fix and pass with it
  - check that mirror pull requests are byte-identical
  - draft the review in plain English, and post it only after the owner approves
  - never add reviewers the owner didn't ask for

**Learning loop:**

- Findings that keep recurring become automatic checks.
- Bugs a review missed become cases in a test set for the reviewers themselves, starting with the audio bug and the dead `capped` flags.
- Long or unattended runs keep a decision log with Lauren Tan's `show-me-your-work`, reviewed by the other model family.
- When a check fails, first suspect the check, then the product.

## 9. Part six: where it's enforced

Following the owner's decision, enforcement lives in git hooks for everyone, plus one cheap continuous integration ring:

| Where | What runs | Time |
|---|---|---|
| Before each commit (git hook) | Formatting, lint on changed files, secret scan, scope tripwires, the `plain` first-line check | Under 10 seconds |
| Before each push (git hook) | Type check, tests for affected code, `verify-plan` evidence check, failing-test-first check for new tests | Under 3 minutes |
| On GitHub (cheap continuous integration) | Lint, type check, and the verdict-matches-commit check. No full test suite and no mutation testing. | A few minutes |
| Locally before a pull request, and nightly | Full test suites, live proof replays, mutation testing for risky areas | Longer |

Two rules from smsMarketing apply to every hook:
- **Claude Code hooks block only with exit code 2.** Any crash is turned into exit code 2 rather than silently allowing the action.
- **A git hook that can't find its script fails loudly.** precordia's current pre-push hook does the opposite and gets fixed first.

precordia's continuous integration stops running mutation testing, per the owner's decision. It moves to local and nightly runs.

## 10. How we know `verify` itself works

Planted problems that must be caught:

| Planted problem | Caught by |
|---|---|
| A copy of the audio bug: a test that checks the address as fixed text while the real request fails | Live proof (step 5) and proof rule 6 |
| A runner that runs 2 of 5 scenarios and reports success | Proof rule 9 |
| A deleted test, an added `.only`, a loosened assertion | Step 1 |
| A fix committed with no failing test before it | Step 3 |
| A scenario with no test and no live check | Step 4 |
| A ticked plan item whose evidence file doesn't exist | `verify-plan` |
| A verdict left from an earlier commit | The verdict check on GitHub |
| A verification skill that was generated but never run | `/verify-setup` refuses to finish without a full run |
| A git hook whose script is missing | The hook fails loudly |

## 11. Rollout

| Step | What | Done when |
|---|---|---|
| 1. Fix the broken gates | precordia: make the pre-push hook fail loudly, and move mutation testing out of continuous integration. Check every repository's Claude hooks for the exit code rule. | No gate silently allows actions |
| 2. Proof standard and planning | Proof rules in the pull request layout; "Proved by" lines in the OpenSpec rules block; `verify-plan` script | Plans and specs name their evidence |
| 3. First verification skill | `/verify-setup` and `/verify-upkeep` in cstack. Build precordia's labeling app skill, with the audio journey as its first live check. | It runs end to end, and the planted audio bug is caught |
| 4. The other five active apps and three journeys | onehearthealth mobile and dashboard (teammate note first), smsMarketing dashboard, admin and marketing site | Each has run once |
| 5. Ladder and verdicts | Scripted steps 1 to 4 in git hooks; the verdict check on GitHub | All planted problems in section 10 are caught |
| 6. Agent steps to free replays | Saved Playwright tests and Maestro flows from passing live checks, replayed nightly | At least one replay per active app |

## 12. Risks

| Risk | What we do about it |
|---|---|
| Live checks are slow or flaky | Wait for real end states; saved replays make repeats fast; a flaky check is fixed or deleted, never retried until green |
| Too much process for small changes | Risk sizing: low-risk changes run two cheap steps |
| Verification skills go stale | Monthly `/verify-upkeep` re-drives every feature live |
| Teammates in onehearthealth | A note first. Hooks there join the existing husky setup, which already runs pre-commit and pre-push. |
| Patient data in screenshots | Proof rule 10; fixtures with fake patients only |
| Mobile features that need the microphone | Maestro can't use the microphone. Recording features use component tests plus a read-back of the stored file, as onehearthealth's guide already says. |

## 13. Decisions made

- precordia's patient mobile app gets its verification skill now.
- Karen and Codex both give a verdict on every pull request.
- Shared driving guides live in cstack; each app skill holds only that app's facts.
