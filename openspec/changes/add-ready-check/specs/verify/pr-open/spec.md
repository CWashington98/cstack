## ADDED Requirements

### Requirement: gate-apply-sets-the-pull-request-state

`verify gate <pr> --apply` SHALL run the gate on the pull request's head and set the pull request's state from the result:

| Result | Pull request becomes | Description's first line |
|---|---|---|
| ready | ready for review | `**What you need to do:** review and merge.` |
| only `owner` reasons | draft | `**What you need to do:** answer this: <question>` (more than one question are numbered) |
| any `fix` or `wait` reason | draft | unchanged |

It SHALL print what it did and what the agent should do next, with the same exit codes as the gate. It SHALL only change the draft state and the description's first line; it SHALL never merge, close or push.

**Stuck.** A fix round is a head the gate called not ready with a `fix` reason, counted from the gate's own records for this pull request. On the third such head, `--apply` SHALL treat every remaining reason as one `owner` question that names them and says three fix rounds didn't clear them.

The `pr-open` skill SHALL say only: open every pull request as a draft using the `plain` layout; after each push, publish proof and run `verify gate <pr> --apply`; do what it prints.

#### Scenario: check-passes-marks-ready

- **GIVEN** a draft pull request that passes the gate
- **WHEN** `verify gate --apply` runs on it
- **THEN** the pull request is marked ready for review
- **AND** its description's first line asks the owner to review and merge

#### Scenario: owner-reasons-become-one-question

- **GIVEN** a draft pull request whose only reason is an `owner` reason with the question "Keep or delete drafts older than 30 days?"
- **WHEN** `verify gate --apply` runs on it
- **THEN** it stays a draft
- **AND** its description's first line is `**What you need to do:** answer this: Keep or delete drafts older than 30 days?`

#### Scenario: fix-reasons-keep-draft

- **GIVEN** a draft pull request with one `fix` reason and one `owner` reason, on its first fix round
- **WHEN** `verify gate --apply` runs on it
- **THEN** it stays a draft, its description is unchanged, and it exits 1 listing both reasons
- **EXAMPLE:** The agent fixes the failing test first. The owner is asked only when the `owner` reason is the last one left.

#### Scenario: new-commit-returns-to-draft

- **GIVEN** a pull request marked ready, and a new commit pushed since
- **WHEN** `verify gate --apply` runs on it and the gate finds no verdicts for the new head
- **THEN** it is turned back into a draft

#### Scenario: three-rounds-then-owner

- **GIVEN** a pull request the gate called not ready, with a `fix` reason, on two earlier heads
- **AND** a third head that still fails the same test
- **WHEN** `verify gate --apply` runs on it
- **THEN** it stays a draft
- **AND** its first line asks the owner one question that names the failing test and says three fix rounds didn't clear it
