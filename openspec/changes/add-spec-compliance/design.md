# Design: spec compliance

## How it fits the flow

The fixed flow runs it after Build and before Review. It can also be run by hand on any change today:

```
node <verify plugin>/scripts/spec-compliance.mjs <change-name> [--lane normal|high-risk] [--base <commit>]
```

It reads files and runs tests. The only AI in this change is the spec-match reviewer, which runs inside the review step.

## Reuse

| Piece | Exists in | Extended or new |
|---|---|---|
| Finding scenarios and their headings in spec files | `plugins/verify/scripts/lib/plan.mjs` (`checkScenarios`) | Extended to return each scenario's ID, its requirement, and its GIVEN, WHEN, THEN and AND lines |
| The project settings file and its checks | `.claude/verify.json`, `plugins/verify/scripts/lib/app-skill.mjs` (`checkRepoSettings`) | Extended with the new optional fields below |
| A record of each run | `plugins/verify/scripts/lib/evidence.mjs` | Reused: the compliance report is saved next to the evidence runs |
| The review step and its lenses | `plugins/verify/skills/pr-review/` | Extended with a spec-match brief, using the same answer format as the claims auditor's |
| Breaking code on purpose | The claims auditor's brief, step 4 | The idea is reused. A small built-in version breaks only changed lines, for the high-risk lane |

New: `spec-compliance.mjs`, a library behind it, its tests and two sample repositories.

## Settings (new optional fields in `.claude/verify.json`)

| Field | Example | Used for |
|---|---|---|
| `tests.all` | `"bun run test"` | Running every test |
| `tests.byName` | `"bun run test -t \"{name}\""` | Running one scenario's tests. `{name}` is replaced with the bracket text exactly as the test's name writes it: `[scenario-id]` for the short form, `[domain/capability:requirement/scenario-id]` for the long form. The check counts the bracketed names in the runner's output and never trusts its test total, because some runners list a file with no matching test as passing. |
| `tests.acceptance` | `["**/acceptance/**"]` | Which files are the locked acceptance tests |
| `tests.alwaysAllowed` | `["docs/**", "*.md"]` | Files the scope check never lists |
| `executableSpecs` | `{ "tool": "cucumber-js", "command": "npx cucumber-js --name \"{name}\"" }` | Off when missing |

The check refuses to run when `tests.byName` is missing, and says which field to add.

## Task list format (cstack's default OpenSpec rules)

Each task ends with what it covers and what it touches:

`Covers: all` is allowed only for the acceptance-test task, which writes one test per scenario.

```
- [ ] 2.1 Refuse an export with no rows. Verify with the scenario tests. Covers: export-empty-refused. Touches: src/export.ts
- [ ] 1.1 Add the export settings field. Setup: no scenario. Touches: src/config.ts
```

## The report

Saved as `compliance.json` next to the change's evidence runs, and summed up in plain English at the end of the command's output:

```json
{
  "change": "add-export",
  "commit": "<latest>", "base": "<starting commit>", "lane": "normal",
  "held": true,
  "scenarios": [
    { "id": "export-csv-downloads", "tasks": ["2.1"], "tests": ["…[export-csv-downloads]…"],
      "ran": true, "failsFirst": true, "passesNow": true, "status": "proven" }
  ],
  "holds": [ { "check": "tests-fail-first-then-pass", "scenario": "…", "why": "…" } ],
  "warnings": [ { "check": "nothing-built-outside-the-spec", "file": "src/billing.ts" } ],
  "counts": { "expected": 4, "ran": 4 },
  "timeMs": { "trace": 40, "run": 52000, "breaks": 0 }
}
```

## Decisions

- **2026-10-11, owner:** a spec-compliance check that code runs (option A's code half), plus the spec-match reviewer (option A), plus executable specs as an opt-in (option B). Phased in, with the run records deciding whether B widens.
- **2026-10-11, owner:** not everything is worth doing. Findings name what breaks, for whom, how likely, and the cost to fix. Only high findings always get fixed.

- **2026-10-11, owner, at spec approval:**
  - Files no task explains are a **warning** in version 0. They switch to a hold once run records show task lists are reliable.
  - Breaking changed lines runs on the **high-risk lane only** at first.
  - Executable specs are first tried by **whichever project next has a high-risk change**. Its settings name the tool.
