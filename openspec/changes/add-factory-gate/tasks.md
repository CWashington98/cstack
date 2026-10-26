# Tasks

Each numbered group after group 1 is one small pull request, merged bottom-up as a stack.

## 1. Acceptance tests, written first and failing

- [x] 1.1 Add one acceptance test per scenario, 28 in all, each named with its `[scenario-id]`, in three locked files: `plugins/factory/tests/gate.test.mjs`, `budget.test.mjs` and `tokens.test.mjs`. Gate tests feed facts to the decision code, except `zone-command-runs-from-trunk`, `trunk-moved-under-change-holds` and `rerun-replaces-record`. Those build a small git repository in a temporary folder and use a stand-in `gh` on `PATH`. Budget and tokens tests use small fixture files. Verify that all 28 fail by an assertion on the current code (none crash), then commit them as locked. Covers: all. Touches: plugins/factory/tests/**

## 2. Plugin and settings

- [x] 2.1 Add the `factory` plugin: `plugin.json`, a marketplace entry, the `factory.mjs` command with `gate`, `budget` and `tokens`, and `settings.mjs`. `settings.mjs` reads the `factory` block, fills in defaults, always adds the never-merge paths, and refuses any `merge` value other than `off` or `shadow`. Verify with the settings scenario's test and `npm test`. Covers: merge-on-is-refused. Touches: plugins/factory/.claude-plugin/plugin.json, .claude-plugin/marketplace.json, plugins/factory/scripts/factory.mjs, plugins/factory/scripts/lib/settings.mjs

## 3. Where usage went

- [x] 3.1 Add `tokens.mjs` and `data/prices.json`. Count by message ID, split by project, model, main versus subagent, and harness, and price from the table, listing unknown models as unpriced. Add the Codex totals. Verify with the tokens tests. Covers: repeated-message-counted-once, subagent-files-labelled, harness-split-by-entrypoint, unknown-model-unpriced. Touches: plugins/factory/scripts/lib/tokens.mjs, plugins/factory/data/prices.json, plugins/factory/scripts/factory.mjs
- [x] 3.2 Add `--repo`: map a repository and its worktrees to their transcript folders, count merged pull requests with `gh`, and print dollars per merged pull request. Verify with its test. Covers: dollars-per-merged-pr. Touches: plugins/factory/scripts/lib/tokens.mjs

## 4. Subscription budget

- [x] 4.1 Add `budget.mjs` for the Claude readings: find the account folders and skip backups, then work out pace, staleness and mode. Verify with the budget tests. Covers: fast-pace-is-lean, ninety-percent-is-stop, stale-reading-is-lean, backup-folders-skipped. Touches: plugins/factory/scripts/lib/budget.mjs, plugins/factory/scripts/factory.mjs
- [x] 4.2 Add the Codex reading and the Breaker's route for each zone, with a reason for each. Verify with the route tests. Covers: codex-under-seventy-everywhere, codex-seventy-to-ninety-saves-it, codex-missing-uses-opus. Touches: plugins/factory/scripts/lib/budget.mjs

## 5. The shadow gate

- [ ] 5.1 Add `zone.mjs`. The zone command runs only in a clean main checkout on trunk. The pattern fallback follows the order high, standard, low, with standard as the default. The highest zone wins, and never-merge paths always hold. Verify with the zone tests. Covers: body-claim-ignored, never-merge-path-holds, zone-command-runs-from-trunk. Touches: plugins/factory/scripts/lib/zone.mjs
- [ ] 5.2 Add `facts.mjs`: pull request data and threads from `gh`, then base, stack and freshness from git without checking anything out. Verdicts and evidence come through `verify`'s command line. Compliance reports come from every worktree. Code-line counts skip `notCounted` files. Verify with the stack, freshness and proof tests. Covers: not-bottom-of-stack-holds, trunk-moved-under-change-holds, codex-verdict-from-claude-holds, codex-verdict-without-model-holds, runtime-change-without-live-proof-holds. Touches: plugins/factory/scripts/lib/facts.mjs
- [ ] 5.3 Add `gate.mjs` and `ledger.mjs`. Turn facts into a call with every reason. Missing facts hold. Pending checks hold as "waiting". Write one record per pull request and head commit. Verify with the remaining gate tests and `npm test`. Covers: all-facts-pass-would-merge, missing-fact-holds, checks-pending-holds-without-failing, flag-required-but-missing-holds, tests-dont-count-toward-size, over-size-holds, rerun-replaces-record. Touches: plugins/factory/scripts/lib/gate.mjs, plugins/factory/scripts/lib/ledger.mjs, plugins/factory/scripts/factory.mjs

## 6. Docs and a real run

- [ ] 6.0 Make `verify`'s `pr-review` skill save the Codex verdict with `--model` set to the model Codex reports it used, and say so in the skill. Verify on one real review that the saved verdict names an OpenAI model. Setup: the gate needs the model to trust a Codex verdict. Touches: plugins/verify/skills/pr-review/SKILL.md
- [ ] 6.1 Document the `factory` block in `docs/project-settings.md`. Add `skills/factory/SKILL.md`, and move the new commands into "Available now" in `how-to-use-cstack`. Draft both projects' `factory` blocks into this change's `evidence/` folder for the owner's approval: Project A's from its guardrails document, Project B's using its zone command. Verify that all docs pass the plain-English check. Setup: documentation and draft settings. Touches: docs/project-settings.md, plugins/factory/skills/factory/SKILL.md, plugins/core/skills/how-to-use-cstack/SKILL.md, openspec/changes/add-factory-gate/evidence/**
- [ ] 6.2 On local clones only, using the drafted settings and writing the record to a temporary folder:
  - Run `factory gate` on the last 20 merged pull requests in each project, and on every open pull request in Project B.
  - Run `factory budget`, and `factory tokens --repo` for both projects.

  Save the output, plus a table of each call next to what the owner actually did. Verify that every call has its reasons and that nothing was merged, labelled or commented. Setup: real-project proof. Touches: openspec/changes/add-factory-gate/evidence/**
