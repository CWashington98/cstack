# Pilot evidence: the loop run in Project A, 25 to 27 October 2026

Status: evidence for the owner's review, 2026-10-27. This is an input to the
[factory design](2026-10-25-factory-design.md) and to the changes
`add-factory-gate` and `add-decision-desk`. It decides nothing. Requirement
candidates drawn from it are listed in those changes' `design.md` files, marked
as candidates.

Project A is the mobile app repository (`mobileapp-v2`). It holds health data, so
this page carries no patient data and no secrets, only repo-internal names and
pull request numbers.

## 1. What was run

For three days, one orchestrator chat ran a loop in Project A. A written group
plan came first. After that, each slice was one pull request, built by a
fresh agent, then judged by two reviewers, with a limit of two review rounds.
Simulator proof was attached to screen changes.

About 25 fresh agents ran, and roughly 25 pull requests were opened or
prepared. The retro inputs list 18 as merged. Figures below are
agent-reported estimates, not measurements. The per-pull-request log is in the
owner's private notes (`loop-pilot.md`).

Value delivered, for scale:

- Spec items closed: four per-user items (2.1, 2.2a, 2.2b, 2.2c), three engine items (2.5d, 3.11a, 3.11b) and three local-data-layer items (1.1, 1.2, 1.4).
- Defects the adversarial reviews caught before merge: stranded folders, sign-in queue poisoning, cross-user upload gaps (#1473), an edit that dropped unmentioned fields (#1490, found by Codex), and holes in the test-only auto-merge rule (section 6).

## 2. Where the tokens went, biggest first

| # | Leak | Size | Notes |
|---|---|---|---|
| 1 | Review rounds | about half of each slice | Each reviewer re-read much of the repository every round, roughly 150k to 250k tokens each. Most slices took 2 or 3 rounds, plus delta votes. |
| 2 | Setup in every fresh agent | roughly 100k to 200k each | Reading `AGENTS.md`, standards, guardrails, spec and plan, plus install and tool output. About 25 fresh agents in a day. |
| 3 | Orchestrator chat size | not sized | Early large reads, inline verify runs, every notification answered. Each turn re-reads the whole chat. |
| 4 | Loops that never converged | about 3M to 5M | Four rounds on an install secret, four on the auto-merge rule (still open), three on a per-user plan (about 800k), and the local-data-layer plan. |
| 5 | The top model used for building | slices cost 0.75M to 1.8M | Slices built on a cheaper model passed in 1 to 2 rounds at 0.1M to 0.5M. |
| 6 | Merge conflicts on a shared tracker file | forced re-merge and re-vote | Section 5. |
| 7 | A second Claude model as a voter | not sized | Replaced by Codex, with a cheaper Claude model as the fallback when Codex runs out. |

What the rows say about the factory design: the measured 97% cache-read share
in the design's section 1 matches leaks 1 to 3. The cost sits in context that is
read again, and not in new output.

## 3. The two-round rule

The loop capped review at two rounds, then stopped and reported a split.

- Four slices hit the cap or a blocked gate with no pull request at that point: per-user 2.3, per-user 2.4, local-data-layer 1.1 and local-data-layer 2.1. Of these, 2.3 and 1.1 shipped later after extra delta rounds (#1493 with follow-up #1495, and #1490, which took four rounds in all). 2.1 was parked.
- A prose plan went three rounds, every round finding a new code-level crash window. The lesson recorded was that reviews of a prose plan do not converge, because the findings belong in the slice's tests.
- Local-data-layer 2.1 used a third, final round on a changed design and was parked. Its two reviewers still found different problems.
- Where the cap held, the stop was a decision for the owner. Where it was waived (the per-user plan, #1467), the whole plan cost about 420k tokens over three rounds.

The pattern in the three non-converging loops (install secret, auto-merge rule,
per-user plan): each round found a new hole in the same design, and the loop
ended only when the design changed. Patching never ended it.

## 4. What each review lens found

Two reviewers voted on each slice. Findings below are the ones the log
attributes to a lens by name.

| Lens | Found | Examples |
|---|---|---|
| Claude QA (`qa`) | Gaps between claims and tests: code with no test pinning it | An untested staged clean-up (#1475), surviving mutants where the code could be broken without a test failing (#1481), an untested serial queue and a sticky-failure queue mutant (2.3) |
| Codex (another model family) | Runtime and race behaviour that the Claude lens read past | A check-to-send race and a second request in the Amplify list call (#1473), an edit that dropped unmentioned fields (#1490), an offline cache miss that remounts the same user (2.1b) |
| A second Claude model (Fable) | Overstatement in the pull request text | A body claim that went further than the code (#1465) |
| Spec-match (`verify:pr-review`) | Missing coverage against the spec's scenarios | A recordings test gap in 2.3, which turned out to be test-only, with no code bug |
| Claims auditor (`verify:pr-review`) | Usually agreed with the first pass | "Ready" on #1464, #1465, #1473, #1475, with notes |

Two observations, both from small samples:

- The two reviewers often split in the same round (one reviewer asking for fixes first, the other calling the change safe, or the reverse). On 2.3 and local-data-layer 1.1 the split ended the loop.
- The most repeated finding of the week was one shape: "tests pass even if the code is broken". `verify` 0.5.0's `breakGuard` automates exactly this check. It breaks each condition in a guard's files and checks that a test notices.

## 5. Merge conflicts on shared tracker files, and the fix

Slices on the same change each edited `openspec/changes/<change>/tasks.md` to
tick their task. Two slices landing close together conflicted. A conflict forced a
merge of the base, which invalidated the votes on that head and meant a re-vote.

The fix (#1492) gave each task its own status file,
`openspec/changes/<change>/status/<task-id>.md`, written by only that task's
slice. `tasks.md` stays the plan. This matches the factory principle that every
file has exactly one writer (design principle 6). A related retro item adds a
warning when a non-docs pull request edits a `tasks.md`.

## 6. The docs gate

Project A's pre-push gate required review votes on every push, including
documentation-only pushes. Waiving was owner-only, and the auto mode blocked
agents from waiving. So four docs pull requests (#1467, #1482, #1497, #1492) each
cost either two votes or a visit from the owner. The owner's words on
2026-10-27: "qa stamp shouldn't be required on docs".

The fix proposed in the retro: exempt a diff when every path is under `docs/`,
is a Markdown file under `openspec/`, or is a Markdown file outside `.claude/`.
Keep `.claude/**` and `AGENTS.md` gated, because those files change how agents
behave.

## 7. The test-only auto-merge rule, parked

The loop tried a rule that a pull request touching only tests could merge
without the owner. It was a text filter: it decided "test-only" from the
changed paths and file names.

- It took four rounds and never converged. Each round found another way a diff that looked test-only was not. The log records "holes in the test-only auto-merge rule" and the rule is still open (about 3M to 5M tokens across the non-converging loops, shared with the install-secret loop).
- The likely reason (an inference, not measured): a path or name cannot tell whether a changed test file still guards what it guarded. Test helpers and fixtures live under test paths, and a test edit can weaken an assertion.

The lesson for a merge gate is to measure instead of guessing from paths:

1. Run the changed tests on the base commit and on the head commit.
2. Compare the results. A test that passed on base must still pass on head. A new test must pass on head. A removed or skipped test is a hold.
3. For guard code, break each condition (as `breakGuard` does) and require that a test fails.

A measured check cannot be tricked by a file name. It also costs a test run
where the filter cost a review loop. The factory gate's existing `evidence`
and `verdict` checks are of the same kind (they read results). Its
path-based zone and `notCounted` rules are the guessing part.

## 8. Rules the loop converged on

The standard slice brief that came out of the pilot, in one list:

- One pull request per slice. No stacks. Docs plan first, then code.
- Exactly two votes: one Claude `qa` lens and one Codex lens. If Codex is out of quota, a cheaper Claude model runs the Codex prompt. Maximum two rounds. A split means stop and report.
- Reviewers get the diff, the slice's spec block and the touched guardrail rows, not a repository re-read.
- Tool output is kept out of context: a summary line plus failures.
- A cheaper model builds. The top model plans, judges, and writes only the sync core.
- The next slice in the same area goes to the agent that finished the neighbouring one, since it already holds the context.
- The orchestrator keeps state in files, replies only on change, and ends at a checkpoint.
- Each agent writes its status to its own file and its pull request body to a file named for its slice. One incident (#1467 opened with the wrong body) came from two agents sharing one scratch file.

## 9. Other environment findings that touch the factory

- A hard-coded list of base branches in the stamp script sent three slices (#1476, #1477, #1484) to a wrong-base round. The factory gate's `allowedBases` setting is the same idea and needs the same care for feature branches.
- Continuous integration ran on the merge result of a pull request. When the pull request merged during the run, the checkout failed and showed a false red (#1483, and once on 22 October).
- Pushes to a long-lived feature branch ran no CI, so the union of merged slices was untested.
- Usage figures came from agent reports. No tool counted subagent tokens or per-voter cost, which is the gap `factory tokens` is meant to close.

## 10. What this evidence does not show

- The numbers are estimates from the agents' own reports.
- One project, one orchestrator, three days. It supports candidates, not conclusions.
- The cheaper-builder claim rests on four Sonnet slices against several Opus slices of unequal size.
- Whether the measured test check in section 7 works on this project's test suite is untested. It is a design lesson, not a result.
