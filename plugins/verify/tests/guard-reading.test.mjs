// Small unit tests for how guard scenarios are read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { proseLines } from "../scripts/lib/markdown.mjs";
import { checkScenarios } from "../scripts/lib/plan.mjs";

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
