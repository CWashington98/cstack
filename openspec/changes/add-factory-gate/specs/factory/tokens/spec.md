## ADDED Requirements

### Requirement: tokens-shows-where-usage-went

`factory tokens` SHALL read Claude transcript files changed in the last `--days` days, which defaults to 7. They are read from `--projects-dir`, which defaults to `~/.claude-shared/projects`.

**Counting.**

- Each assistant message counts once, by its message ID, even when a transcript repeats it.
- Input, cache-write, cache-read and output tokens are kept apart.
- Each total is split three ways: by project folder, by model, and by main chat versus subagent. A file inside a `subagents` folder is a subagent.

**Pricing.**

- Dollars come from the price table shipped with the plugin.
- A model missing from the table is listed as unpriced, never counted as zero dollars.

**Codex.** It SHALL also total the Codex session logs under `--codex-dir` for the same period.

**Per pull request.** With one or more `--repo <path>`, it SHALL also count the pull requests merged into each repository in the period, using `gh`. It SHALL print the dollars per merged pull request for the transcript project folders that belong to that repository and its worktrees.

#### Scenario: repeated-message-counted-once

- **GIVEN** a transcript that holds the same assistant message ID three times, with 1,000 output tokens
- **WHEN** `factory tokens` runs
- **THEN** the total shows 1,000 output tokens for it, not 3,000

#### Scenario: subagent-files-labelled

- **GIVEN** a main transcript and a transcript in its `subagents` folder
- **WHEN** `factory tokens` runs
- **THEN** their tokens appear under main and subagent respectively

#### Scenario: unknown-model-unpriced

- **GIVEN** a transcript message from a model missing from the price table
- **WHEN** `factory tokens` runs
- **THEN** its tokens are counted and listed as unpriced, and no dollar figure is invented for them

#### Scenario: dollars-per-merged-pr

- **GIVEN** transcripts for a repository's folder and one of its worktree folders, priced at $120 together
- **AND** `gh` reports 4 pull requests merged into that repository in the period
- **WHEN** `factory tokens --repo <that repository>` runs
- **THEN** it reports $30 per merged pull request for it
