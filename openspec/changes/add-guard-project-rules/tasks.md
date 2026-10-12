# Tasks

## 1. Acceptance tests, written first and failing

- [ ] 1.1 Write one test per scenario in a new locked file `plugins/core/tests/guard-project-rules.test.mjs`, each named with its `[scenario-id]`, calling the guard's public seam (`decide()` and the hook with piped JSON). Verify each fails by an assertion on the current code, then commit them as locked. Covers: all. Touches: plugins/core/tests/guard-project-rules.test.mjs

## 2. Project rules and decoding

- [ ] 2.1 Read and validate `guardRules`, refusing everything when a rule is broken. Covers: broken-pattern-refuses-everything. Touches: plugins/core/scripts/guard.mjs
- [ ] 2.2 Check rules in order for shell commands and tool calls, after the core rules and the never list. Covers: refuse-rule-refuses-a-command, earlier-allow-rule-wins, tool-call-rule-matches-name-and-input, no-rules-means-core-only, project-rule-cannot-allow-a-core-refusal, core-rule-applies-without-settings. Touches: plugins/core/scripts/guard.mjs
- [ ] 2.3 Decode base64 text before checking rules and the never list. Covers: never-entry-hidden-in-encoded-text, rule-matches-decoded-text. Touches: plugins/core/scripts/guard.mjs

## 3. Remove tool knowledge

- [ ] 3.1 Remove every tool-specific rule and the `agentsMayReadProduction` setting from the guard. Move or delete the tests that depended on them: keep each behavior worth keeping as a test of its example rules. Verify the full suite is green. Covers: tool-name-in-guard-code-fails-the-test. Touches: plugins/core/scripts/guard.mjs, plugins/core/scripts/lib/shell.mjs, plugins/core/tests/guard.test.mjs
- [ ] 3.2 Add the portability test that fails on a third-party tool name in the guard's code. Covers: tool-name-in-guard-code-fails-the-test. Touches: plugins/core/tests/guard-portability.test.mjs

## 4. Examples and docs

- [ ] 4.1 Write `docs/guard-rules/` examples and a test that loads each one and checks its sample commands. Covers: examples-behave-as-documented. Touches: docs/guard-rules/**, plugins/core/tests/guard-examples.test.mjs
- [ ] 4.2 Document `guardRules` in `docs/project-settings.md`, remove `agentsMayReadProduction`, and update the README guard paragraph and the core plugin's version and description. Verify with the plain-English check. Setup: documentation. Touches: docs/project-settings.md, README.md, plugins/core/.claude-plugin/plugin.json, .claude-plugin/marketplace.json
