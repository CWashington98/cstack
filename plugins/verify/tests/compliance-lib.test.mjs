// Unit tests for the pieces behind the spec compliance check. The acceptance
// tests in spec-compliance.test.mjs cover the whole command; these cover the parts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkScenarios } from "../scripts/lib/plan.mjs";
import { proseLines } from "../scripts/lib/markdown.mjs";

const SPEC = [
  "## ADDED Requirements", "",
  "### Requirement: first-rule", "",
  "The thing SHALL work.", "",
  "#### Scenario: first-works", "",
  "- **GIVEN** a thing",
  "- **WHEN** it is used",
  "- **THEN** it works",
  "- **AND** it says so", "",
  "### Requirement: second-rule", "",
  "#### Scenario: second-works", "",
  "- **WHEN** it is used again",
  "- **THEN** it still works", "",
].join("\n");

test("checkScenarios returns each scenario's ID, requirement and step lines", () => {
  const { scenarios, count } = checkScenarios(proseLines(SPEC));
  assert.equal(count, 2);
  assert.deepEqual(scenarios.map((s) => [s.id, s.requirement]), [["first-works", "first-rule"], ["second-works", "second-rule"]]);
  assert.deepEqual(scenarios[0].steps.map((s) => [s.kind, s.text]), [
    ["GIVEN", "a thing"], ["WHEN", "it is used"], ["THEN", "it works"], ["AND", "it says so"],
  ]);
  assert.equal(scenarios[0].steps[2].line, 11);
  assert.equal(scenarios[1].line, 16);
});

test("checkScenarios still holds a scenario with no Proved by line", () => {
  const { findings } = checkScenarios(proseLines(SPEC));
  assert.equal(findings.length, 2);
  assert.match(findings[0].message, /first-works/);
});
