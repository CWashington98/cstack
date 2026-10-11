// Unit tests for the pieces behind the spec compliance check. The acceptance
// tests in spec-compliance.test.mjs cover the whole command; these cover the parts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkScenarios } from "../scripts/lib/plan.mjs";
import { proseLines } from "../scripts/lib/markdown.mjs";
import { testsInText, globToRegExp, matchesAny, isTestFile, parseTasks, readRun, withBaseTree, judgeFirstRun, checkLocks, checkScope } from "../scripts/lib/compliance.mjs";
import { complianceSettings, checkRepoSettings } from "../scripts/lib/app-skill.mjs";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeRepo, git } from "../../../tests/helpers.mjs";

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

// ---- The settings the check reads ----

const withSettings = (s) => makeRepo({ ".claude/verify.json": typeof s === "string" ? s : JSON.stringify({ integrationBranch: "main", ...s }) });

test("complianceSettings refuses to run without tests.byName and says which field to add", () => {
  const { problems } = complianceSettings(withSettings({ tests: { all: "run-all" } }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /"tests\.byName"/);
  assert.match(problems[0], /\{name\}/);
  assert.match(complianceSettings(withSettings({})).problems[0], /"tests\.byName"/);
  assert.match(complianceSettings(makeRepo()).problems[0], /verify\.json/);
  assert.match(complianceSettings(withSettings("{ nope")).problems[0], /not valid JSON/);
});

test("complianceSettings accepts the full set of fields and hands them back", () => {
  const settings = {
    tests: { all: "run-all", byName: 'run-one "{name}"', acceptance: ["test/acceptance/**"], alwaysAllowed: ["docs/**"] },
    executableSpecs: { tool: "steps", command: 'steps "{name}"' },
  };
  const r = complianceSettings(withSettings(settings));
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.settings.tests, settings.tests);
  assert.equal(r.settings.integrationBranch, "main");
});

test("the settings check names each wrong tests field, and ignores a project that sets none", () => {
  const msg = (s) => checkRepoSettings(withSettings(s)).map((f) => f.message).join("\n");
  assert.equal(msg({}), "");
  assert.match(msg({ tests: "run" }), /"tests" must be an object/);
  assert.match(msg({ tests: { all: 3 } }), /"tests\.all" must be a command/);
  assert.match(msg({ tests: { byName: "run-one" } }), /"tests\.byName" must contain \{name\}/);
  assert.match(msg({ tests: { acceptance: "test/**" } }), /"tests\.acceptance" must be a list of path patterns/);
  assert.match(msg({ tests: { alwaysAllowed: [1] } }), /"tests\.alwaysAllowed" must be a list of path patterns/);
  assert.match(msg({ executableSpecs: { tool: "steps" } }), /"executableSpecs\.command" must contain \{name\}/);
  assert.match(msg({ executableSpecs: { command: "x {name}" } }), /"executableSpecs\.tool"/);
  assert.equal(msg({ tests: { byName: 'run-one "{name}"' } }), "");
});

// ---- Reading what a test run printed ----

test("readRun reads TAP output: passed, failed and skipped tests, each named once", () => {
  const out = [
    "TAP version 13", "# Subtest: [one-a] passes", "ok 1 - [one-a] passes", "  duration_ms: 0.2",
    "not ok 2 - [two-b] fails", "  error: |-", "    Expected values to be strictly equal:",
    "ok 3 - [three-c] skipped # SKIP", "ok 4 - an unrelated test",
  ].join("\n");
  assert.deepEqual(readRun(out).map((t) => [t.id, t.status]), [["one-a", "passed"], ["two-b", "failed"], ["three-c", "skipped"]]);
});

test("readRun reads the spec reporter, where a failing test is printed twice", () => {
  const out = ["▶ suite", "  ✔ [one-a] passes (0.4ms)", "  ✖ [two-b] fails (0.9ms)", "  ﹣ [three-c] skipped (0.1ms) # SKIP", "", "✖ failing tests:", "✖ [two-b] fails (0.9ms)"].join("\n");
  const tests = readRun(out);
  assert.deepEqual(tests.map((t) => [t.id, t.status]), [["one-a", "passed"], ["two-b", "failed"], ["three-c", "skipped"]]);
  assert.equal(tests[1].name, "[two-b] fails");
});

test("readRun reads a description line that ends in the result, and a qualified name", () => {
  const out = ["test_x (tests.a.B.test_x)", "[export-has-header-row] the first line ... FAIL", "[a/b:c/qualified-one] works ... ok", "[skip-me] later ... skipped 'why'"].join("\n");
  assert.deepEqual(readRun(out).map((t) => [t.id, t.status]), [["export-has-header-row", "failed"], ["qualified-one", "passed"], ["skip-me", "skipped"]]);
});

// ---- The starting commit ----

test("withBaseTree checks out the starting commit with the latest acceptance tests, then removes it", () => {
  const dir = makeRepo({ ".gitignore": "deps/\n", "src/a.txt": "old\n", "test/acceptance/a.txt": "first\n" });
  git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "start");
  const base = git(dir, "rev-parse", "HEAD").trim();
  writeFileSync(join(dir, "src/a.txt"), "new\n");
  writeFileSync(join(dir, "test/acceptance/a.txt"), "locked\n");
  writeFileSync(join(dir, "test/acceptance/b.txt"), "added\n");
  git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "change");
  mkdirSync(join(dir, "deps")); writeFileSync(join(dir, "deps/lib.txt"), "dependency\n");
  writeFileSync(join(dir, "src/dirty.txt"), "uncommitted\n");

  let seen;
  withBaseTree(dir, base, ["test/acceptance/**"], (tree) => {
    seen = {
      tree,
      src: readFileSync(join(tree, "src/a.txt"), "utf8"),
      tests: [readFileSync(join(tree, "test/acceptance/a.txt"), "utf8"), readFileSync(join(tree, "test/acceptance/b.txt"), "utf8")],
      dep: readFileSync(join(tree, "deps/lib.txt"), "utf8"),
      dirty: existsSync(join(tree, "src/dirty.txt")),
    };
  });
  assert.equal(seen.src, "old\n");
  assert.deepEqual(seen.tests, ["locked\n", "added\n"]);
  assert.equal(seen.dep, "dependency\n");
  assert.equal(seen.dirty, false);
  assert.ok(!existsSync(seen.tree), "the temporary checkout is gone");
  assert.doesNotMatch(git(dir, "worktree", "list"), /compliance-base/);
  assert.equal(readFileSync(join(dir, "src/a.txt"), "utf8"), "new\n");
  assert.equal(readFileSync(join(dir, "src/dirty.txt"), "utf8"), "uncommitted\n");
});

test("withBaseTree removes the checkout even when the run throws", () => {
  const dir = makeRepo({ "a.txt": "x\n" });
  git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "start");
  const base = git(dir, "rev-parse", "HEAD").trim();
  let tree;
  assert.throws(() => withBaseTree(dir, base, [], (t) => { tree = t; throw new Error("boom"); }), /boom/);
  assert.ok(!existsSync(tree));
});

test("judgeFirstRun counts only a test that ran and failed an assertion", () => {
  const entry = { id: "x-works" };
  const run = (o) => ({ passed: 0, failed: 0, skipped: 0, exits: [0], out: "", ...o });
  assert.equal(judgeFirstRun(entry, run({ failed: 1, exits: [1], out: "AssertionError: 1 !== 2" })).failsFirst, true);
  const same = judgeFirstRun(entry, run({ passed: 1 }));
  assert.equal(same.failsFirst, false);
  assert.match(same.why, /doesn't depend on the change/);
  const crash = judgeFirstRun(entry, run({ exits: [1], out: "Error: Cannot find module './x.mjs'" }));
  assert.equal(crash.failsFirst, false);
  assert.match(crash.why, /assertion/);
  assert.equal(judgeFirstRun(entry, run({ failed: 1, exits: [1], out: "TypeError: x is not a function" })).failsFirst, false);
  assert.equal(judgeFirstRun(entry, run({ exits: [0] })).failsFirst, false);
});

// ---- Locked tests ----

function lockRepo(later) {
  const dir = makeRepo({
    "test/acceptance/a.test.mjs": 'test("[one-a] works", () => { assert.ok(1); });\n',
    "test/old.test.mjs": 'test("[old-b] works", () => {\n  assert.ok(1);\n  assert.ok(2);\n});\ntest("[old-c] too", () => {\n  assert.ok(3);\n});\n',
    "src/x.mjs": "x\n",
  });
  git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "start");
  const base = git(dir, "rev-parse", "HEAD").trim();
  for (const [message, files] of later) {
    for (const [f, c] of Object.entries(files)) writeFileSync(join(dir, f), c);
    git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", message);
  }
  return { dir, base };
}
const SETTINGS = { tests: { acceptance: ["test/acceptance/**"] } };

test("checkLocks holds an edit to a test that was locked before the change started", () => {
  const { dir, base } = lockRepo([["Tweak", { "test/acceptance/a.test.mjs": 'test("[one-a] works", () => {});\n' }]]);
  const r = checkLocks(dir, base, SETTINGS);
  assert.equal(r.holds.length, 1);
  assert.equal(r.holds[0].file, "test/acceptance/a.test.mjs");
  assert.deepEqual(r.allowedEdits, []);
});

test("checkLocks allows the edit when the commit has a Spec-Change line, and lists it", () => {
  const { dir, base } = lockRepo([["Clarify\n\nSpec-Change: clarify-it", { "test/acceptance/a.test.mjs": 'test("[one-a] works well", () => { assert.ok(1); });\n' }]]);
  const r = checkLocks(dir, base, SETTINGS);
  assert.deepEqual(r.holds, []);
  assert.deepEqual(r.allowedEdits.map((e) => [e.file, e.specChange]), [["test/acceptance/a.test.mjs", "clarify-it"]]);
});

test("checkLocks locks a new acceptance file from the commit that adds it", () => {
  const { dir, base } = lockRepo([
    ["Add test", { "test/acceptance/b.test.mjs": 'test("[two-b] works", () => { assert.ok(1); });\n' }],
    ["Change it", { "test/acceptance/b.test.mjs": 'test("[two-b] works", () => {});\n' }],
  ]);
  const r = checkLocks(dir, base, SETTINGS);
  assert.deepEqual(r.holds.map((h) => h.file), ["test/acceptance/b.test.mjs"]);
});

test("checkLocks names a deleted test, a removed assertion and a skip in an ordinary test file", () => {
  const skip = lockRepo([["Skip", { "test/old.test.mjs": readFileSync(join(lockRepo([]).dir, "test/old.test.mjs"), "utf8").replace('test("[old-c]', 'test.skip("[old-c]') }]]);
  assert.match(checkLocks(skip.dir, skip.base, SETTINGS).holds[0].why, /skipped.*old-c/);
  const fewer = lockRepo([["Trim", { "test/old.test.mjs": 'test("[old-b] works", () => {\n  assert.ok(1);\n});\ntest("[old-c] too", () => {\n  assert.ok(3);\n});\n' }]]);
  assert.match(checkLocks(fewer.dir, fewer.base, SETTINGS).holds[0].why, /removed an assertion/);
  const dropped = lockRepo([["Drop one", { "test/old.test.mjs": 'test("[old-b] works", () => {\n  assert.ok(1);\n  assert.ok(2);\n});\n' }]]);
  assert.match(checkLocks(dropped.dir, dropped.base, SETTINGS).holds[0].why, /deleted a test/);
});

test("checkLocks leaves source edits and tests that gain assertions alone", () => {
  const { dir, base } = lockRepo([["Build", { "src/x.mjs": "y\n", "test/old.test.mjs": 'test("[old-b] works", () => {\n  assert.ok(1);\n  assert.ok(2);\n  assert.ok(9);\n});\ntest("[old-c] too", () => {\n  assert.ok(3);\n});\n' }]]);
  assert.deepEqual(checkLocks(dir, base, SETTINGS).holds, []);
});

// ---- Scope and approval ----

test("checkScope lists changed files no task declares, and leaves out tests, the change's folder and allowed files", () => {
  const dir = makeRepo({ "src/a.txt": "1\n", "src/b.txt": "1\n", "src/deep/c.txt": "1\n", "docs/x.txt": "1\n", "test/t.txt": "1\n", "openspec/changes/c/tasks.md": "x\n", "src/d.txt": "1\n" });
  git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "start");
  const base = git(dir, "rev-parse", "HEAD").trim();
  for (const f of ["src/a.txt", "src/b.txt", "src/deep/c.txt", "docs/x.txt", "test/t.txt", "openspec/changes/c/tasks.md"]) writeFileSync(join(dir, f), "2\n");
  git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "change");
  const tasks = [{ touches: ["src/a.txt"] }, { touches: ["src/deep"] }];
  const found = checkScope(dir, base, "c", tasks, { tests: { alwaysAllowed: ["docs/**"] } });
  assert.deepEqual(found.map((w) => w.file), ["src/b.txt"]);
  assert.equal(found[0].check, "nothing-built-outside-the-spec");
});
