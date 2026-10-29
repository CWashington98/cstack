## ADDED Requirements

### Requirement: ready-check-sorts-every-reason

`verify gate <pr>` SHALL decide whether a pull request is ready for the owner to merge. It SHALL never merge.

**Output.** Without flags it SHALL print `ready` and exit 0, or `not ready` followed by every reason, one per line, and exit 1. With `--json` it SHALL print `{ "ready": bool, "head": "<sha>", "reasons": [{ "kind", "text", "question"? }] }` with the same exit codes. Wrong use SHALL exit 2.

**Kinds.** Every reason SHALL have exactly one kind:

- `fix`: an agent can clear it by changing the branch or running a step. Examples: failing checks, a review verdict of "not ready", no verdict for this commit, no live proof, a conflict with trunk, over the size limit, a fact it can't read.
- `wait`: checks are still running.
- `owner`: only the owner can clear it. Each `owner` reason SHALL carry a `question` in plain words.

**Fails closed.** A fact the check can't read is a `fix` reason that names the fact.

**Drafts.** Whether the pull request is a draft SHALL NOT be a reason.

#### Scenario: ready-when-every-fact-passes

- **GIVEN** a draft pull request at the bottom of its stack, fresh against trunk, with green checks, both verdicts `READY` for its head, live proof for its head, and no open review findings marked "decide"
- **WHEN** `verify gate` runs on it
- **THEN** it prints `ready` and exits 0
- **AND** the pull request is still a draft and not merged
- **EXAMPLE:** Draft #88 into `main`, both reviewers said `READY` on `4f1e2a9`, CI green. The check prints `ready`.

#### Scenario: failing-checks-are-fix

- **GIVEN** a pull request that passes every rule except one failing check
- **WHEN** `verify gate --json` runs on it
- **THEN** it exits 1 with one reason of kind `fix` whose text names the failing check

#### Scenario: running-checks-wait

- **GIVEN** a pull request whose only problem is a check still running
- **WHEN** `verify gate --json` runs on it
- **THEN** it exits 1 with one reason of kind `wait`

#### Scenario: decide-finding-needs-owner

- **GIVEN** a pull request that passes every rule, and the claims auditor's verdict for its head is `READY` with one finding of severity `decide`
- **WHEN** `verify gate --json` runs on it
- **THEN** it exits 1 with one reason of kind `owner`
- **AND** the reason's `question` is the finding's claim
- **EXAMPLE:** The finding says "The spec doesn't say what happens to drafts older than 30 days. Keep or delete them?" The reason's question is that sentence.

#### Scenario: spec-wrong-needs-owner

- **GIVEN** a pull request whose spec-match review has a finding of kind `spec-wrong`
- **WHEN** `verify gate --json` runs on it
- **THEN** the reasons include one of kind `owner` whose question asks whether the spec should change

#### Scenario: unreadable-fact-is-fix

- **GIVEN** a pull request where `gh` can't read the check results
- **WHEN** `verify gate --json` runs on it
- **THEN** it exits 1 with a `fix` reason that names the check results as unreadable

### Requirement: reviews-required-by-risk

The `gate` block of `.claude/verify.json` SHALL accept `reviews`: `"always"` (the default) or `"highRisk"`. With `"highRisk"`, review verdicts SHALL be required only when the change touches a path matching the project's `highRisk` list. Every other rule SHALL still apply.

#### Scenario: low-risk-change-needs-no-review

- **GIVEN** `reviews` is `"highRisk"`, `highRisk` lists `plugins/core/scripts/**`, and the change only edits `README.md`
- **AND** it has no review verdicts and passes every other rule
- **WHEN** `verify gate` runs on it
- **THEN** it prints `ready`

#### Scenario: high-risk-change-needs-reviews

- **GIVEN** the same settings, and the change edits `plugins/core/scripts/guard.mjs` and has no verdicts
- **WHEN** `verify gate --json` runs on it
- **THEN** it exits 1 with a `fix` reason that names the missing verdicts

#### Scenario: reviews-required-by-default

- **GIVEN** no `reviews` setting, and a change that only edits `README.md` with no verdicts
- **WHEN** `verify gate --json` runs on it
- **THEN** it exits 1 with a `fix` reason that names the missing verdicts

### Requirement: fallback-counts-as-second-review

A `claude-fallback` verdict SHALL fill the second review slot whenever `verdict.mjs check` accepts it there.

#### Scenario: fallback-verdict-accepted

- **GIVEN** a pull request that passes every rule, with a `claims-auditor` verdict and a `claude-fallback` verdict, both `READY` for its head, and no `codex` verdict
- **WHEN** `verify gate` runs on it
- **THEN** it prints `ready`

### Requirement: owner-merges-everything

The ready check SHALL NOT read merge modes or never-merge paths, and SHALL NOT hold because of a path's zone. It SHALL still report the zone in `--json` output as `"zone"`, and SHALL still record each call as `add-factory-gate`'s `each-call-is-recorded-once-per-change` requires, in `<git-common-dir>/verify/gate/`.

#### Scenario: workflow-change-is-not-held-by-path

- **GIVEN** a pull request that passes every rule and edits `.github/workflows/ci.yml`
- **WHEN** `verify gate` runs on it
- **THEN** it prints `ready`
- **AND** the `--json` output shows its zone

#### Scenario: old-factory-block-still-read

- **GIVEN** a project whose `.claude/verify.json` has a `factory` block with `sizeLimit: 200` and no `gate` block
- **WHEN** `verify gate` runs on a change with 250 counted lines
- **THEN** it holds with a `fix` reason about size
- **AND** it prints a warning that the `factory` block is renamed `gate`
