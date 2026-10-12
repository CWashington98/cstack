## Purpose

The guard refuses commands and tool calls that only the owner should run, in any project. It enforces a small set of rules every project needs, plus rules each project supplies for its own tools, so cstack names no specific tool.

## ADDED Requirements

### Requirement: core-rules-for-every-project

The guard SHALL refuse these core cases for every project, whatever its settings say. It SHALL refuse pushes to protected branches, force pushes and tag pushes. It SHALL refuse changes to GitHub settings, secrets and repository access, and merges that override the repository's rules. It SHALL refuse recursive deletes outside the repository and temporary folders, and package publishes and releases. It SHALL refuse a tool command whose subcommand is `deploy`, unless the command names a target from `agentsMayDeployTo`. It SHALL refuse any command or tool call that uses an entry from `agentsNeverTouch`.

#### Scenario: core-rule-applies-without-settings

- **GIVEN** a project with no settings file
- **WHEN** an agent runs `git push origin main`
- **THEN** the guard refuses it

#### Scenario: project-rule-cannot-allow-a-core-refusal

- **GIVEN** a project whose rules allow every command matching `git push.*`
- **WHEN** an agent runs `git push --force origin main`
- **THEN** the guard refuses it
- **AND** the reason names the core rule, not the project rule

### Requirement: project-rules-match-commands-and-tool-calls

A project can list rules in `.claude/verify.json` under `guardRules`. Each rule SHALL have a `match` pattern, an `action` of `refuse` or `allow`, and a `reason`. A rule with `tool` matches tool calls whose name matches `tool`, testing `match` against the call's input. A rule without `tool` matches shell commands. Rules SHALL be checked in order, and the first rule that matches decides. A command or tool call that no rule matches is decided by the core rules alone.

#### Scenario: refuse-rule-refuses-a-command

- **GIVEN** a project rule that refuses commands matching `deploytool .*--prod` with the reason "production deploys are the owner's"
- **WHEN** an agent runs `npx deploytool push --prod`
- **THEN** the guard refuses it
- **AND** the reason includes "production deploys are the owner's"

#### Scenario: earlier-allow-rule-wins

- **GIVEN** project rules that first allow commands matching `deploytool (read|logs) .*--prod`, then refuse commands matching `deploytool .*--prod`
- **WHEN** an agent runs `deploytool logs --prod`
- **THEN** the guard allows it
- **AND** `deploytool write --prod` is refused

#### Scenario: tool-call-rule-matches-name-and-input

- **GIVEN** a project rule with `tool` set to `mcp__.*hosting.*` that refuses input matching `"target":"production"`
- **WHEN** an agent calls the tool `mcp__hosting__deploy` with input `{"target":"production"}`
- **THEN** the guard refuses it
- **AND** the same call with `{"target":"preview"}` is allowed

#### Scenario: no-rules-means-core-only

- **GIVEN** a project with a settings file and no `guardRules`
- **WHEN** an agent runs `deploytool write --prod`
- **THEN** the guard allows it
- **AND** `git push origin main` is still refused

### Requirement: rules-see-decoded-text

Before checking project rules and the never list, the guard SHALL decode base64 text of 16 characters or more found in a command or tool input. That includes text after a `:` prefix, URL-safe base64, and base64 without padding. Rules and the never list SHALL be checked against both the original text and the decoded text.

#### Scenario: never-entry-hidden-in-encoded-text

- **GIVEN** a never-list entry `prod-backend-9`
- **WHEN** an agent calls a tool whose input holds `prod:` followed by the base64 of `{"deployment":"prod-backend-9"}`
- **THEN** the guard refuses it

#### Scenario: rule-matches-decoded-text

- **GIVEN** a project rule that refuses tool input matching `"kind":"prod"`
- **WHEN** an agent calls a tool whose input holds base64 text that decodes to `{"deployment":{"kind":"prod"}}`
- **THEN** the guard refuses it

### Requirement: bad-rules-fail-closed

A rule set is broken when `guardRules` is not a list, or a rule has a missing field, an unknown action or a pattern that doesn't compile. Then the guard SHALL refuse every shell command and tool call until it is fixed, and SHALL say which rule is wrong and why. File edits stay allowed, so the file can be fixed.

#### Scenario: broken-pattern-refuses-everything

- **GIVEN** a project rule whose `match` is `(unclosed`
- **WHEN** an agent runs `ls`
- **THEN** the guard refuses it
- **AND** the reason names the rule and says its pattern doesn't compile

### Requirement: guard-names-no-tools

The guard's code SHALL name no third-party tool other than git and GitHub. The portability test SHALL fail when it finds one in `plugins/core/scripts/guard.mjs` or `plugins/core/scripts/lib/shell.mjs`.

#### Scenario: tool-name-in-guard-code-fails-the-test

- **GIVEN** the guard's code containing the word `convex`
- **WHEN** the portability test runs
- **THEN** it fails and names the word and the file

### Requirement: examples-for-common-tools

cstack SHALL ship copy-paste rule examples for common tools in `docs/guard-rules/`, one file per tool, each holding a `guardRules` snippet and sample commands with the result each should get. A test SHALL load every example and check each sample command gets the documented result.

#### Scenario: examples-behave-as-documented

- **GIVEN** the example file for a database tool, with a sample read command marked allowed and a sample write command marked refused
- **WHEN** the examples test runs
- **THEN** the read is allowed and the write is refused under that example's rules
