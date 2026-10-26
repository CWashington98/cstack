## ADDED Requirements

### Requirement: tokens-shows-where-usage-went

`factory tokens` SHALL read Claude transcript files changed in the last `--days` days, which defaults to 7. They are read from `--projects-dir`, which defaults to `~/.claude-shared/projects`.

**Counting.**

- Each assistant message counts once, by its message ID, even when a transcript repeats it.
- Input, cache-write, cache-read and output tokens are kept apart.
- Each total is split four ways: by project folder, by model, by main chat versus subagent, and by harness. A file inside a `subagents` folder is a subagent.
- The harness is the `entrypoint` the transcript records, such as `cli` for plain Claude Code or `sdk-ts` for an app built on the agent SDK. A subagent file takes its main chat's harness. A transcript with no `entrypoint` is listed as `unknown`.
- For each harness it also prints the average cache-write and cache-read tokens per assistant message, so the same kind of work can be compared across harnesses.

**Pricing.**

- Dollars come from the price table shipped with the plugin.
- A model missing from the table is listed as unpriced, never counted as zero dollars.

**Codex.** It SHALL also total the Codex session logs under `--codex-dir` for the same period.

**Per pull request.** With one or more `--repo <path>`, it SHALL also count the pull requests merged into each repository in the period, using `gh`. It SHALL print the dollars per merged pull request for the transcript project folders that belong to that repository and its worktrees.

#### Scenario: repeated-message-counted-once

- **GIVEN** a transcript that holds the same assistant message ID three times, with 1,000 output tokens
- **WHEN** `factory tokens` runs
- **THEN** the total shows 1,000 output tokens for it, not 3,000
- **EXAMPLE:** A transcript lists message `msg_01` three times, each with 1,000 output tokens. The report shows 1,000 output tokens for it.

#### Scenario: subagent-files-labelled

- **GIVEN** a main transcript and a transcript in its `subagents` folder
- **WHEN** `factory tokens` runs
- **THEN** their tokens appear under main and subagent respectively
- **EXAMPLE:** `chat-1.jsonl` used 50,000 tokens and `chat-1/subagents/review.jsonl` used 20,000. The report shows main 50,000 and subagent 20,000.

#### Scenario: harness-split-by-entrypoint

- **GIVEN** one transcript whose `entrypoint` is `cli` and one whose `entrypoint` is `sdk-ts`
- **WHEN** `factory tokens` runs
- **THEN** their tokens appear under separate harness rows, each with its average cache tokens per message
- **EXAMPLE:** `a.jsonl` (`cli`) has 10 messages that wrote 50,000 cache tokens. `b.jsonl` (`sdk-ts`) has 10 messages that wrote 70,000. The report shows `cli: 5,000 cache-write per message` and `sdk-ts: 7,000 cache-write per message`.

#### Scenario: unknown-model-unpriced

- **GIVEN** a transcript message from a model missing from the price table
- **WHEN** `factory tokens` runs
- **THEN** its tokens are counted and listed as unpriced, and no dollar figure is invented for them
- **EXAMPLE:** A message from `some-new-model` used 5,000 tokens. The report lists `some-new-model: 5,000 tokens, unpriced` and leaves it out of the dollar total.

#### Scenario: dollars-per-merged-pr

- **GIVEN** transcripts for a repository's folder and one of its worktree folders, priced at $120 together
- **AND** `gh` reports 4 pull requests merged into that repository in the period
- **WHEN** `factory tokens --repo <that repository>` runs
- **THEN** it reports $30 per merged pull request for it
- **EXAMPLE:** The repository's folder and one worktree folder used $90 and $30 of tokens this week, and 4 pull requests merged. The report shows `$120 / 4 = $30 per merged pull request`.
