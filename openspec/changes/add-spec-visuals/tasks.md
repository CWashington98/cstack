# Tasks

## 1. Acceptance tests, written first and failing

- [x] 1.1 Add one acceptance test per scenario, 13 in all, each named with its `[scenario-id]`, in two locked files.
  - `plugins/verify/tests/examples.test.mjs` uses small spec files.
  - `plugins/plain/tests/diagram-age.test.mjs` uses a temporary git repository with dated commits and fixture diagrams. It includes one diagram that fails the palette.

  Verify that all 13 fail by an assertion on the current code, then commit them as locked. Covers: all. Touches: plugins/verify/tests/examples.test.mjs, plugins/plain/tests/diagram-age.test.mjs

## 2. Examples

- [ ] 2.1 In `checkScenarios`, note whether a scenario's last bullet starts `**EXAMPLE:**`. Hold new scenarios that lack one. Scenarios unchanged since `--since` get advice. Verify with the example tests and the existing `plan.test.mjs`. Covers: new-scenario-without-example-holds, old-scenario-without-example-is-advice, scenario-with-example-passes. Touches: plugins/verify/scripts/lib/plan.mjs

## 3. Stamps and freshness

- [ ] 3.1 Add `diagram-age.mjs`. It finds every `diagrams/` folder, reads `diagrams.json`, matches entries to `.svg` files, and compares the visible date with the stamp. Verify with the stamp tests. Covers: unlisted-diagram-is-unstamped, visible-date-disagrees. Touches: plugins/plain/scripts/diagram-age.mjs, plugins/plain/scripts/lib/diagram-age.mjs
- [ ] 3.2 Add the four states and the two settings, using `git log --since` for lagging. Verify with the state tests. Covers: depicted-file-changed-is-lagging, unchecked-ninety-days-is-stale, unchecked-half-year-proposes-removal, current-diagram-is-quiet. Touches: plugins/plain/scripts/lib/diagram-age.mjs
- [ ] 3.3 Add `--validate`. It runs `diagram-check` first, then updates `lastValidated` and the picture's date line. It never touches `made`. Verify with the validate tests. Covers: validate-updates-stamp-and-picture, validate-refuses-a-failing-diagram. Touches: plugins/plain/scripts/lib/diagram-age.mjs, plugins/plain/scripts/diagram-age.mjs
- [ ] 3.4 Add `--changes`. It holds any change folder with no stamped diagram, and any diagram that `design.md` doesn't show. Verify with the change tests. Covers: change-without-diagram-holds, diagram-not-in-design-holds. Touches: plugins/plain/scripts/lib/diagram-age.mjs

## 4. Rules and docs

- [ ] 4.1 Add the two rules to `openspec/config.yaml`. Add the stamp step and the visible date line to the `to-diagram` skill and its templates. Document the two settings in `docs/project-settings.md`. Run `diagram-age` on cstack itself and record the output in `evidence/`. Verify that the docs pass the plain-English check and that cstack's own changes report no unstamped diagrams. Setup: rules and docs. Touches: openspec/config.yaml, plugins/plain/skills/to-diagram/**, docs/project-settings.md, openspec/changes/add-spec-visuals/evidence/**
