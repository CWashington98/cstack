// Small unit tests for how guard scenarios are read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { proseLines } from "../scripts/lib/markdown.mjs";
import { checkScenarios } from "../scripts/lib/plan.mjs";
import { judgeGuardRuns } from "../scripts/lib/compliance.mjs";

const spec = (first) => [
  "### Requirement: r", "",
  "#### Scenario: some-rule", "",
  first,
  "- **WHEN** it runs", "- **THEN** it works", "",
  "#### Scenario: other-rule", "",
  "- **WHEN** it runs",
  "- **GUARDS** not first, so not a guard",
  "- **THEN** it works", "",
].join("\n");

test("a GUARDS first bullet marks the scenario and carries what must stay the same", () => {
  const { scenarios } = checkScenarios(proseLines(spec("- **GUARDS** an adult is 18 or older")));
  assert.equal(scenarios[0].guards, "an adult is 18 or older");
});

test("a GUARDS bullet that is not first marks nothing, and a scenario with no marker is not a guard", () => {
  const { scenarios } = checkScenarios(proseLines(spec("- **GIVEN** a state")));
  assert.equal(scenarios[0].guards, null);
  assert.equal(scenarios[1].guards, null);
});

test("a guard whose test passes on both commits raises no hold, and one that fails on either raises one", () => {
  const ok = { failed: 0, passed: 1, exits: [0], tests: [], out: "" };
  const bad = { failed: 1, passed: 0, exits: [1], tests: [{ status: "failed", name: "[some-rule] x" }], out: "" };
  const run = (before, now) => { const holds = []; const e = { id: "some-rule", testFiles: ["t.mjs"], passesNow: now === ok }; judgeGuardRuns(e, before, now, holds); return { e, holds }; };
  assert.equal(run(ok, ok).holds.length, 0);
  assert.equal(run(ok, ok).e.status, "proven");
  assert.match(run(bad, ok).holds[0].why, /must pass before/);
  assert.match(run(ok, bad).holds[0].why, /altered behavior/);
  assert.equal(run(bad, bad).holds.length, 2);
});
