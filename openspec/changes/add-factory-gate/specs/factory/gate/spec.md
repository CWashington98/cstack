## ADDED Requirements

### Requirement: gate-makes-a-shadow-call-and-never-merges

`factory gate <pr>` SHALL decide whether a pull request would be merged, and SHALL never merge it in this version.

**Output.** It SHALL print one of:

- `SHADOW would-merge`, then exit 0;
- `SHADOW would-hold`, followed by every reason, one per line, then exit 1.

Wrong use SHALL exit 2.

**Fails closed.** A fact the gate can't read counts as a reason to hold, and the reason names the missing fact.

**Settings.** The gate SHALL read its settings from the `factory` block of `.claude/verify.json`. If a zone's `merge` value is anything other than `off` or `shadow`, the gate SHALL refuse to run and say that merging can't be switched on in this version.

#### Scenario: all-facts-pass-would-merge

- **GIVEN** a pull request into an allowed base, at the bottom of its stack, fresh against trunk, in the low zone, within the size limit, not a draft, with no unresolved threads
- **AND** its checks are green, both review verdicts are `READY` for its current patch, and it touches no runtime surface
- **WHEN** `factory gate` runs on it with `merge.low` set to `shadow`
- **THEN** it prints `SHADOW would-merge` and exits 0
- **AND** the pull request is not merged

#### Scenario: missing-fact-holds

- **GIVEN** a pull request that passes every rule except that no review verdict exists for its current patch
- **WHEN** `factory gate` runs on it
- **THEN** it prints `SHADOW would-hold` with the reason "no review verdict for this change" and exits 1

#### Scenario: merge-on-is-refused

- **GIVEN** settings where `merge.low` is `on`
- **WHEN** `factory gate` runs
- **THEN** it exits 2 without checking any pull request
- **AND** it says merging can't be switched on in this version

#### Scenario: checks-pending-holds-without-failing

- **GIVEN** a pull request whose checks are still running
- **WHEN** `factory gate` runs on it
- **THEN** it holds with the reason "checks still running"
- **AND** the record marks the reason as waiting, not as a failure

### Requirement: zone-comes-from-the-diff

The gate SHALL work out the zone from the files the pull request changes, never from anything the pull request says about itself.

- **With a configured `zone.command`,** the gate SHALL run it from the trunk commit's copy of the project, never from the pull request's copy. The command gets the changed paths as a JSON list in a file named by its last argument, and prints a JSON object with a `zone`.
- **Without one,** each changed path takes the first zone whose patterns match, in the order high, standard, low. A path matching none is standard.
- **The highest zone among all changed paths wins.**
- **Any path matching `neverMerge` makes the pull request hold,** whatever its zone.
- **A pull request SHALL hold** unless its zone's `merge` value is `shadow`.

#### Scenario: body-claim-ignored

- **GIVEN** a pull request whose description says it is low risk and can be undone
- **AND** it changes a path matching the `high` patterns
- **WHEN** `factory gate` runs on it
- **THEN** the zone is high and it holds with the reason "high zone"

#### Scenario: never-merge-path-holds

- **GIVEN** a low-zone pull request that also changes a path matching `neverMerge`
- **WHEN** `factory gate` runs on it
- **THEN** it holds and names that path

#### Scenario: zone-command-runs-from-trunk

- **GIVEN** settings with a `zone.command`
- **AND** a pull request that changes the zone command's own script, so that it would print `low`
- **WHEN** `factory gate` runs on it
- **THEN** the trunk copy of the script decides the zone, not the pull request's copy

### Requirement: base-stack-and-freshness

The gate SHALL hold a pull request in any of these cases:

1. Its base is not in `allowedBases`. When the base is another open pull request's branch, the reason SHALL be "not the bottom of its stack".
2. `git merge-tree` reports a conflict with the current trunk.
3. A commit on trunk since the merge base changes a path the pull request changes.
4. A commit on trunk since the merge base changes the CI configuration.

#### Scenario: not-bottom-of-stack-holds

- **GIVEN** a pull request whose base is the branch of another open pull request
- **WHEN** `factory gate` runs on it
- **THEN** it holds with the reason "not the bottom of its stack"

#### Scenario: trunk-moved-under-change-holds

- **GIVEN** a pull request that changes `src/a.ts`
- **AND** trunk has gained a commit changing `src/a.ts` since the pull request's merge base
- **WHEN** `factory gate` runs on it
- **THEN** it holds with the reason that trunk changed a file this pull request changes

### Requirement: reviews-and-proof-match-this-change

**Reviews.** The gate SHALL require both review verdicts to be `READY` with no confirmed must-fix, using the `verify` plugin's verdict check for the pull request's base and head. A verdict carried over by an unchanged patch-id counts. A verdict whose reviewer is `codex` SHALL hold if its recorded model is not an OpenAI model.

**Live proof.** When a changed path matches `runtimeSurface`, the gate SHALL require an evidence run for the head commit with the status "verified live" that passes the `verify` plugin's evidence check. The gate searches every worktree of the project for that run.

**Spec compliance.** When the description names an OpenSpec change on a `Change:` line, the gate SHALL require that change's newest compliance report for the head commit to pass.

**Flags.** When `flagsRequired` is true and a runtime-surface path changed, the gate SHALL require a `Flag:` line in the description.

#### Scenario: codex-verdict-from-claude-holds

- **GIVEN** a pull request whose second verdict is marked reviewer `codex` but records a Claude model
- **WHEN** `factory gate` runs on it
- **THEN** it holds with the reason that the Codex verdict didn't come from Codex

#### Scenario: runtime-change-without-live-proof-holds

- **GIVEN** a pull request that changes a path matching `runtimeSurface`
- **AND** no evidence run for its head commit is "verified live"
- **WHEN** `factory gate` runs on it
- **THEN** it holds with the reason "no live proof for this commit"

#### Scenario: flag-required-but-missing-holds

- **GIVEN** settings with `flagsRequired` true
- **AND** a pull request that changes a runtime-surface path and has no `Flag:` line
- **WHEN** `factory gate` runs on it
- **THEN** it holds with the reason "new behavior must name its flag"

### Requirement: size-counts-only-the-code

The gate SHALL count added and deleted lines in changed files that don't match `notCounted`. If the count is over `sizeLimit`, the pull request SHALL hold. A `Mechanical:` line in the description does not lift the limit in this version, and the reason SHALL say so.

#### Scenario: tests-dont-count-toward-size

- **GIVEN** `sizeLimit` 400, and a pull request with 300 changed code lines and 900 changed lines in files matching `notCounted`
- **WHEN** `factory gate` runs on it
- **THEN** size is not a reason to hold

#### Scenario: over-size-holds

- **GIVEN** `sizeLimit` 400, and a pull request with 520 changed code lines
- **WHEN** `factory gate` runs on it
- **THEN** it holds with the reason "520 changed code lines, over the 400 limit"

### Requirement: each-call-is-recorded-once-per-change

The gate SHALL write each call to `<git common dir>/factory/ledger/<pr>-<first 12 characters of the head commit>.json`. The record holds:

- the pull request and its head commit;
- the patch-id and the zone;
- the call and every reason;
- the settings file's fingerprint;
- the time.

Running the gate again on the same head SHALL replace that record, not add a second one. The gate SHALL write nothing else.

#### Scenario: rerun-replaces-record

- **GIVEN** `factory gate` already ran on a pull request at a given head commit
- **WHEN** it runs again on the same head
- **THEN** exactly one record exists for that pull request and head, holding the newer call
