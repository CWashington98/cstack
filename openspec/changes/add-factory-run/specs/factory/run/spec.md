## ADDED Requirements

### Requirement: run-starts-only-from-an-approved-change

`factory plan <change>` and `factory next <change>` SHALL refuse a change whose `approval.json` is missing, or whose fingerprint no longer matches the files it covers. The refusal SHALL name the file and say that the owner approves specs.

#### Scenario: unapproved-change-is-refused

- **GIVEN** a change folder `add-reminders` with no `approval.json`
- **WHEN** the owner runs `/implement-spec add-reminders`
- **THEN** `factory next` exits non-zero, and no state or branch is created
- **EXAMPLE:** The output reads `refused: openspec/changes/add-reminders has no approval.json. The owner approves specs before building.` The `factory/add-reminders/` state folder does not exist afterwards.

#### Scenario: edited-spec-needs-approval-again

- **GIVEN** an approved change whose `specs/**/spec.md` was edited after approval
- **WHEN** `factory next` runs
- **THEN** it refuses with the fingerprint mismatch, and the action is `wait` with the reason `spec-changed-since-approval`
- **EXAMPLE:** A builder added a scenario to fix an ambiguity. The fingerprint was `sha256:0c6a…` and is now `sha256:91be…`. Work stops until the owner re-approves. Slices already merged stay merged.

### Requirement: slice-plan-is-complete-before-building

The slice plan is `openspec/changes/<change>/slices.json`. A model writes it. `factory plan <change>` SHALL check it and record it in state.

Each slice SHALL have:

- `id`;
- `outcome`, the observable result or internal contract;
- `scenarios`, the scenario IDs it proves;
- `tasks`, the task numbers from `tasks.md`;
- `dependsOn`;
- `touches`, path globs;
- `verify`, exact commands;
- `integration`, what is checked once it lands with the slices before it;
- `release`, what must be true before it ships, or `none`.

`factory plan` SHALL refuse the plan, naming every problem, when:

- a field is missing or empty (`dependsOn` and `release: "none"` may be empty);
- a task in `tasks.md` is in no slice, or in more than one;
- a scenario in the change's specs is in no slice;
- a slice names an unknown task, scenario or slice;
- `dependsOn` forms a cycle.

When the project setting `factory.run.slicePlanApproval` is `"owner"` (the default), `factory next` SHALL wait until `slices.approval.json` exists and its fingerprint matches `slices.json`.

#### Scenario: slice-missing-a-field-is-refused

- **GIVEN** a slice plan whose slice `2` has no `verify` commands
- **WHEN** `factory plan add-reminders` runs
- **THEN** it exits non-zero and names the slice and the field
- **EXAMPLE:** `slice 2: "verify" is empty. Name the exact commands that prove it, for example "pnpm vitest run reminders".`

#### Scenario: dropped-task-is-refused

- **GIVEN** `tasks.md` with tasks 1.1, 2.1, 2.2 and 3.1, and a slice plan that never lists 2.2
- **WHEN** `factory plan` runs
- **THEN** it refuses, naming task 2.2
- **AND** a scenario that no slice proves is refused the same way
- **EXAMPLE:** `task 2.2 is in no slice. scenario reminder-snoozes is proved by no slice.` The plan is not recorded, so `factory next` still says `wait: no-slice-plan`.

#### Scenario: dependency-cycle-is-refused

- **GIVEN** slice `2` depends on `3`, and `3` depends on `2`
- **WHEN** `factory plan` runs
- **THEN** it refuses and prints the cycle
- **EXAMPLE:** `dependency cycle: 2 -> 3 -> 2`.

#### Scenario: slice-plan-waits-for-owner

- **GIVEN** a valid slice plan with no `slices.approval.json`, in a project with the default setting
- **WHEN** `factory next` runs
- **THEN** the action is `wait` with reason `slice-plan-needs-owner`, and no builder starts
- **EXAMPLE:** `{"action":"wait","reason":"slice-plan-needs-owner","read":"openspec/changes/add-reminders/slices.json"}`. The owner reads 4 slices, approves, and the next call returns `build` for slice 1.

### Requirement: next-prints-one-action-in-a-fixed-order

`factory next <change>` SHALL print one JSON object, and SHALL write nothing except the lock. The action SHALL be one of:

- `build`
- `check`
- `review`
- `fix`
- `integrate`
- `wait` (with a reason)
- `done`

For one slice, the order SHALL be: `build` → `check` → `review` → `fix` (if needed) → `check` → `review` → merge-ready.

- A `review` action SHALL be given only when the latest checks passed on the slice's current head.
- A slice is merge-ready only when every verdict the project requires is `READY` for its current base and head, as `verify`'s `verdict.mjs check` reports. A verdict carried over by an unchanged patch-id counts.
- A head that changed after a review SHALL get a new `check` and then a new `review`.

#### Scenario: checks-come-before-review

- **GIVEN** slice 1 whose build was recorded at head `a1b2c3d`, with no check result yet
- **WHEN** `factory next` runs
- **THEN** the action is `check` for that head, not `review`
- **EXAMPLE:** `{"action":"check","slice":"1","head":"a1b2c3d","run":["pnpm lint","pnpm typecheck","pnpm vitest run reminders"]}`. Only after `factory record add-reminders 1 check pass --head a1b2c3d` does the next call return `review`.

#### Scenario: stale-review-is-redone

- **GIVEN** slice 1 with two `READY` verdicts for head `a1b2c3d`
- **AND** the branch now at `e4f5a6b` with a different patch-id
- **WHEN** `factory next` runs
- **THEN** the action is `check` for `e4f5a6b`, and the slice is not merge-ready
- **EXAMPLE:** The builder pushed a typo fix after review. The old verdicts stay in the record, marked `stale: head moved`. Checks and both reviews run again on `e4f5a6b`.

#### Scenario: review-uses-a-prepared-packet

- **GIVEN** a `review` action for slice 1 at head `e4f5a6b`
- **WHEN** the action is printed
- **THEN** it names one packet folder, made once by `verify`'s `review-prep.mjs` for that base and head, and the reviewer brief from `factory brief`
- **EXAMPLE:** `{"action":"review","slice":"1","head":"e4f5a6b","packet":".verify/packets/add-reminders-1-e4f5a6b","brief":"factory/add-reminders/briefs/1-review.md","lanes":["claims-auditor","codex"]}`. Both lanes read the same packet. Neither gets the builder's reasoning.

### Requirement: fix-rounds-are-limited

A slice SHALL get at most `factory.run.maxFixRounds` fix rounds (default 2). The slice SHALL be blocked, with its evidence, when:

- the limit is reached and a required verdict is still not `READY`;
- the same check fails with the same failure signature twice in a row;
- the two required reviewers disagree after the last round.

A blocked slice's action SHALL name the reason and the evidence paths. Slices that depend on it SHALL wait. Other slices SHALL go on.

#### Scenario: same-failure-twice-stops

- **GIVEN** slice 2 whose check `pnpm vitest run reminders` failed in round 1 with signature `reminders.test.ts > snoozes > expected 10 got 0`
- **AND** the same signature again after fix round 1
- **WHEN** `factory next` runs
- **THEN** slice 2 is blocked with reason `same-failure-twice`, and no third build starts
- **EXAMPLE:** `{"action":"wait","slice":"2","reason":"same-failure-twice","evidence":["factory/add-reminders/checks/2-r0.log","factory/add-reminders/checks/2-r1.log"]}`. `STATUS.md` lists it under "Waiting on you".

#### Scenario: round-limit-stops-with-split-verdict

- **GIVEN** slice 3 after 2 fix rounds, where Codex says `NOT READY` and the claims auditor says `READY`
- **WHEN** `factory next` runs
- **THEN** slice 3 is blocked with reason `reviewers-disagree`, naming both verdict files
- **EXAMPLE:** The pilot's per-user plan ran a third round anyway and cost about 420k tokens. Here the action is `wait: reviewers-disagree`, and the owner decides whether the design changes.

#### Scenario: blocked-slice-does-not-stop-independent-work

- **GIVEN** slices 2 and 3 that depend only on slice 1, which is merge-ready
- **AND** slice 2 blocked
- **WHEN** `factory next` runs
- **THEN** the action is `build` for slice 3
- **AND** slice 4, which depends on slice 2, waits
- **EXAMPLE:** `{"action":"build","slice":"3",...}`. `STATUS.md` shows `2 blocked (same-failure-twice)`, `4 waiting on 2`.

### Requirement: whole-spec-by-default-one-slice-on-request

Without `--slice`, `factory next` SHALL move on to the next ready slice, in plan order, after one becomes merge-ready. It SHALL return `done` only when every slice is merge-ready or merged, and the change-level integration check has passed.

With `--slice <id>`, it SHALL return actions for that slice only, and `done` when that slice is merge-ready.

A slice whose dependency is merge-ready but not merged SHALL be built on top of the dependency's branch (a stack). When `factory.run.maxOpenStack` (default 5) unmerged slices are open in one stack, the action SHALL be `wait` with reason `owner-merge`, listing the pull requests.

`factory` SHALL have no command that merges.

#### Scenario: whole-spec-continues-to-the-next-slice

- **GIVEN** a 4-slice plan where slice 1 just became merge-ready
- **WHEN** `factory next add-reminders` runs
- **THEN** the action is `build` for slice 2, based on slice 1's branch if slice 2 depends on slice 1, otherwise on the trunk
- **EXAMPLE:** `{"action":"build","slice":"2","base":"factory/add-reminders/1"}`. Pull request #212 for slice 1 waits for the owner to merge it.

#### Scenario: one-slice-mode-stops-after-that-slice

- **GIVEN** the same plan, run with `--slice 1`
- **WHEN** slice 1 becomes merge-ready
- **THEN** the action is `done` with `scope: slice 1`, and slice 2 is not started
- **EXAMPLE:** `{"action":"done","scope":"slice 1","ready":["#212"]}`.

#### Scenario: whole-spec-ends-with-integration

- **GIVEN** all 4 slices merged into the integration branch
- **WHEN** `factory next` runs
- **THEN** the action is `integrate`, which runs the project's change-level checks and `verify`'s spec compliance for the whole change on the integration branch
- **AND** `done` follows only after the integration result is recorded as passing
- **EXAMPLE:** `{"action":"integrate","on":"dev","run":["pnpm test","node plugins/verify/scripts/spec-compliance.mjs --change add-reminders"]}`. Spec compliance says `Proven` for all 9 scenarios, so the next call returns `done`.

#### Scenario: stack-depth-waits-for-the-owner

- **GIVEN** 5 merge-ready, unmerged slices stacked on each other
- **WHEN** `factory next` runs and the next ready slice depends on the top of that stack
- **THEN** the action is `wait` with reason `owner-merge`, listing the 5 pull requests bottom first
- **EXAMPLE:** `wait: owner-merge. Merge bottom first: #212, #213, #215, #216, #218`.

### Requirement: work-resumes-from-state

State for a change SHALL live under `<git common dir>/factory/<change>/`:

- `plan.json`, written by `plan`;
- `events.jsonl`, appended by `record`;
- `lock`;
- `briefs/`;
- `checks/`;
- `STATUS.md`.

`factory next` SHALL derive every action from these files and the git host, never from a conversation.

**The lock.** It SHALL record the session, host and time. `factory next` from another session SHALL refuse while the lock is fresher than `factory.run.lockMinutes` (default 90). `--take-over` takes a stale lock and records that it did.

**`STATUS.md`.** It SHALL be regenerated after every `record`, and SHALL stay under 60 lines.

- Generated from state: "Done", "In flight", "Waiting on you" and "Next".
- Written by an agent with `factory note`: "Decisions", "Tried and failed", "Landmines" and "Open".

Task progress SHALL NOT be written to `tasks.md`.

#### Scenario: new-session-gets-the-same-next-action

- **GIVEN** a session that recorded `check pass` for slice 2 and then ended
- **WHEN** a new session in another worktree runs `/implement-spec add-reminders` after the lock went stale
- **THEN** `factory next --take-over` returns `review` for slice 2 at the same head
- **AND** no build of slice 2 starts again
- **EXAMPLE:** The laptop slept at 23:10. At 08:05 a new T3 Code chat runs the command. The lock from 23:02 is stale (90 minutes), so it takes over. It reads `STATUS.md` (41 lines) and gets `review` for slice 2. It does not re-read the conversation.

#### Scenario: second-coordinator-is-refused

- **GIVEN** a lock written 10 minutes ago by session `s-7f2`
- **WHEN** another session runs `factory next add-reminders`
- **THEN** it exits non-zero and names the holder and the time
- **EXAMPLE:** `refused: add-reminders is being worked by session s-7f2 on mac-mini since 07:55. Use --take-over after 09:25, or stop that session.`

#### Scenario: progress-never-edits-tasks-md

- **GIVEN** two slices recorded as merge-ready on the same day
- **WHEN** their pull requests are compared with the trunk
- **THEN** neither changes `openspec/changes/add-reminders/tasks.md`
- **EXAMPLE:** Progress shows in `STATUS.md` and `events.jsonl`. The pilot's `tasks.md` conflict (fixed in Project A by #1492) cannot happen.

### Requirement: briefs-carry-references-not-conversation

`factory brief <change> <slice> --role builder|fixer|reviewer` SHALL write one Markdown file of at most `factory.run.briefMaxLines` lines (default 80). It holds:

- the slice's outcome;
- its scenarios, copied from the spec with their examples;
- links to `proposal.md`, `design.md` and the spec files, rather than copies of them;
- the touched paths and the check commands;
- the pattern records whose `paths` match the slice's `touches`;
- the builder model from settings.

A `fixer` brief SHALL add the findings to fix and their evidence paths. A `reviewer` brief SHALL add the packet folder and SHALL leave out the builder's notes.

#### Scenario: brief-links-matching-patterns

- **GIVEN** a pattern record `org-boundary.md` with `paths: ["packages/convex/**"]`
- **AND** slice 2 with `touches: ["packages/convex/reminders/**"]`
- **WHEN** `factory brief add-reminders 2 --role builder` runs
- **THEN** the brief lists `org-boundary.md` with its canonical files and invariants, and lists no pattern whose paths don't match
- **EXAMPLE:** The brief's "Patterns to follow" section reads `org-boundary: copy packages/convex/lib/orgWrappers.ts L239-357; every passed-in id is checked against the caller's org. Gate: pnpm test security-boundaries.` The UI-states pattern is not listed.

#### Scenario: builder-model-comes-from-settings

- **GIVEN** a project with no `factory.run.builderModel` setting
- **WHEN** a builder brief is written
- **THEN** it names `opus`
- **AND** a project that sets `"builderModel": "sonnet"` gets `sonnet`, and the metrics entry records which one ran
- **EXAMPLE:** Project A leaves it unset during the pilot, so its briefs say `model: opus`.

### Requirement: pattern-records-are-checked

A pattern record is a Markdown file in the project's `.claude/patterns/`. Its frontmatter SHALL hold `name`, `paths` (globs) and `ref` (the branch or commit its file links point at). Its body SHALL have these headings, in order:

1. When to use it
2. Canonical code
3. Canonical tests
4. Invariants
5. Known exceptions
6. Automated checks
7. Needs a reviewer

`factory patterns lint` SHALL fail on:

- a missing heading;
- an empty `paths`;
- a cited file that does not exist at `ref`;
- a cited line range past the end of the file.

#### Scenario: pattern-with-missing-file-is-refused

- **GIVEN** `offline-writes.md` citing `apps/mobile/db/engine/entities/rows.ts` at `ref: dev`, where the file exists only on `feature/local-data-engine`
- **WHEN** `factory patterns lint` runs
- **THEN** it fails, naming the record, the file and the ref
- **EXAMPLE:** `offline-writes.md: apps/mobile/db/engine/entities/rows.ts does not exist at dev. Point ref at the branch that has it, or pick another file.`

### Requirement: every-stage-writes-one-metrics-entry

`factory record` SHALL append one line to `<git common dir>/factory/metrics.jsonl` per stage it records. The line SHALL hold exactly these fields:

- `project`, `change`, `slice`, `pr`, `session`
- `head`, `base`
- `stage`: `plan`, `build`, `check`, `review`, `fix`, `integrate` or `wait`
- `start`, `end`
- `model`, `reviewer`
- `findingsConfirmed`
- `waitReason`
- `status`: `implemented`, `reviewed`, `integrated` or `released`
- `tokens`, from `factory tokens` for the session, or `unknown`

A value that isn't known SHALL be the string `unknown`, never left out. A field outside this list SHALL be refused, and nothing SHALL be written.

#### Scenario: unknown-values-stay-visible

- **GIVEN** a review recorded from a terminal session with no session ID and no token data
- **WHEN** `factory record add-reminders 2 review ready --reviewer codex` runs
- **THEN** the metrics line has `"session":"unknown"` and `"tokens":"unknown"`
- **EXAMPLE:** `{"project":"smsMarketing","change":"add-reminders","slice":"2","pr":"#213","session":"unknown","head":"e4f5a6b","base":"dev","stage":"review","reviewer":"codex","findingsConfirmed":0,"tokens":"unknown",...}`.

#### Scenario: extra-field-is-refused

- **GIVEN** a call that passes `--field prompt="Build the reminders screen…"`
- **WHEN** `factory record` runs
- **THEN** it exits non-zero, writes nothing, and names the field
- **EXAMPLE:** `refused: "prompt" is not a metrics field. Metrics never hold prompts, code, customer data or patient data.`
