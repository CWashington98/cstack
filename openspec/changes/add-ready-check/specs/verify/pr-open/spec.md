## ADDED Requirements

### Requirement: pull-request-state-follows-the-ready-check

`pr-open.mjs apply <pr>` SHALL run the ready check on the pull request's head and set the pull request's state from the result:

| Result | Pull request becomes | Description's first line |
|---|---|---|
| ready | ready for review | `**What you need to do:** review and merge.` |
| only `owner` reasons | draft | `**What you need to do:** answer this: <question>` (one question; more than one are numbered) |
| any `fix` or `wait` reason | draft | unchanged |

It SHALL print what it did and the reasons, and exit 0 for ready, 1 for draft, 2 when it can't run. It SHALL only change the pull request's draft state and the description's first line; it SHALL never merge, close, or push.

#### Scenario: check-passes-marks-ready

- **GIVEN** a draft pull request for which the ready check prints `ready`
- **WHEN** `pr-open.mjs apply` runs on it
- **THEN** the pull request is marked ready for review
- **AND** its description's first line asks the owner to review and merge

#### Scenario: owner-reasons-become-one-question

- **GIVEN** a draft pull request whose only reason is an `owner` reason with the question "Keep or delete drafts older than 30 days?"
- **WHEN** `pr-open.mjs apply` runs on it
- **THEN** it stays a draft
- **AND** its description's first line is `**What you need to do:** answer this: Keep or delete drafts older than 30 days?`

#### Scenario: fix-reasons-keep-draft

- **GIVEN** a draft pull request with one `fix` reason and one `owner` reason
- **WHEN** `pr-open.mjs apply` runs on it
- **THEN** it stays a draft, its description is unchanged, and it exits 1 listing both reasons
- **EXAMPLE:** The agent fixes the failing test first. The owner is asked only when the `owner` reason is the last one left.

#### Scenario: new-commit-returns-to-draft

- **GIVEN** a pull request marked ready, whose verdicts were for its previous head
- **AND** a new commit was pushed
- **WHEN** `pr-open.mjs apply` runs on it
- **THEN** it is turned back into a draft

### Requirement: fix-loop-has-a-limit

The `pr-open` skill SHALL count fix rounds per pull request: each time `pr-open.mjs apply` exits 1 with a `fix` reason and the agent pushes a new commit. After three rounds that end not ready, the skill SHALL stop fixing and turn the remaining reasons into one owner question, written by `pr-open.mjs apply --stuck`.

#### Scenario: three-rounds-then-owner

- **GIVEN** a pull request that has been not ready after three fix rounds, with a failing test the agent couldn't fix
- **WHEN** `pr-open.mjs apply --stuck` runs on it
- **THEN** it stays a draft
- **AND** its first line asks the owner one question that names the failing test and says three fix attempts didn't clear it
