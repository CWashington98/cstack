// Unit tests for the pieces behind the spec compliance check. The acceptance
// tests in spec-compliance.test.mjs cover the whole command; these cover the parts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkScenarios } from "../scripts/lib/plan.mjs";
import { proseLines } from "../scripts/lib/markdown.mjs";
import { testsInText, globToRegExp, matchesAny, isTestFile, parseTasks } from "../scripts/lib/compliance.mjs";
import { makeRepo } from "../../../tests/helpers.mjs";

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

// ---- Reading tasks and tests ----

test("testsInText finds plain and qualified scenario IDs inside quoted test names", () => {
  const text = [
    'test("[seat-added] a team gets the seat", () => {});',
    "test('[accounts/seats:seat-limit/seat-refused] refused', () => {});",
    '  """[export-empty-refused] an export with no orders is refused"""',
    "const x = items[index];",
    '// [not-a-test] a comment with no quote',
    'const y = "keep [0] alone";',
  ].join("\n");
  const found = testsInText(text);
  assert.deepEqual(found.map((t) => t.id), ["seat-added", "seat-refused", "export-empty-refused"]);
  assert.equal(found[0].name, "[seat-added] a team gets the seat");
  assert.equal(found[1].token, "[accounts/seats:seat-limit/seat-refused]");
});

test("parseTasks reads Covers, Touches and Setup", () => {
  const dir = makeRepo({
    "openspec/changes/c/tasks.md": [
      "# Tasks", "",
      "- [x] 1.1 Write the tests. Covers: all. Touches: test/acceptance/**",
      "- [ ] 2.1 Build it. Verify with tests. Covers: one-thing, other-thing. Touches: src/a.ts, `src/b.ts`.",
      "- [ ] 2.2 Add a setting. Setup: no scenario. Touches: src/config.ts", "",
    ].join("\n"),
  });
  const [a, b, c] = parseTasks(dir, "c");
  assert.deepEqual([a.number, a.covers, a.touches], ["1.1", ["all"], ["test/acceptance/**"]]);
  assert.deepEqual([b.number, b.covers, b.touches], ["2.1", ["one-thing", "other-thing"], ["src/a.ts", "src/b.ts"]]);
  assert.deepEqual([c.covers, c.setup, c.touches], [[], true, ["src/config.ts"]]);
});

test("patterns: ** crosses folders, * does not, a bare pattern matches a file name anywhere", () => {
  assert.ok(globToRegExp("test/acceptance/**").test("test/acceptance/a/b.ts"));
  assert.ok(!globToRegExp("src/*.ts").test("src/a/b.ts"));
  assert.ok(matchesAny("docs/deep/readme.md", ["*.md"]));
  assert.ok(matchesAny("docs/deep/x.txt", ["docs/"]));
  assert.ok(!matchesAny("src/x.ts", ["docs/**"]));
});

test("isTestFile knows test folders, test names and acceptance patterns", () => {
  for (const f of ["test/a.mjs", "src/a.test.ts", "tests/test_a.py", "pkg/test_a.py", "spec/a.rb", "x/y/a_spec.rb"]) assert.ok(isTestFile(f), f);
  for (const f of ["src/a.ts", "openspec/specs/a/spec.md", "README.md"]) assert.ok(!isTestFile(f), f);
  assert.ok(isTestFile("checks/one.ts", ["checks/**"]));
});
