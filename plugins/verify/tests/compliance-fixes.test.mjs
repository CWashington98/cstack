// Regression tests for problems the reviews of the spec compliance check found.
// Each builds a small repository in a temporary folder and runs the check on it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { makeRepo, git } from "../../../tests/helpers.mjs";
import { runCompliance, withBaseTree, runCommand, readRun, whyNotRun, checkScope, summarize } from "../scripts/lib/compliance.mjs";

const CH = "add-export";
const SPEC = `openspec/changes/${CH}/specs/export/spec.md`;
const write = (d, files) => { for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), c); } };
const commit = (d, m, files = {}) => { write(d, files); git(d, "add", "-A"); git(d, "commit", "-q", "--allow-empty", "-m", m); return git(d, "rev-parse", "HEAD").trim(); };
const approval = (t) => JSON.stringify({ approvedBy: "o", approvedOn: "2026-10-11", covers: "specs/**/*.md", fingerprint: `sha256:${createHash("sha256").update(t).digest("hex")}` });
const spec = (steps) => ["## ADDED Requirements", "", "### Requirement: sample-export", "", "The export SHALL work.", "", "#### Scenario: export-csv-downloads", "", ...steps, ""].join("\n");
const tasks = (touch) => ["# Tasks", "", "- [x] 1.1 Tests. Covers: all. Touches: test/acceptance/**, steps/**", `- [x] 2.1 Build. Covers: export-csv-downloads. Touches: ${touch}`, ""].join("\n");
const SETTINGS = { integrationBranch: "main", tests: { all: 'node --test "test/**/*.test.mjs"', byName: 'node --test --test-name-pattern "\\{name}" "test/**/*.test.mjs"', acceptance: ["test/acceptance/**", "steps/**"] } };
const OLD = "export const exportCsv = () => undefined;\n";
const NEW = 'export const exportCsv = () => ({ header: "name,total" });\n';
const THEN = ["- **GIVEN** two orders", "- **WHEN** they are exported", "- **THEN** the file has the expected header"];

// A change whose one scenario has one test, built over an old src/export.mjs.
function exportRepo({ settings = SETTINGS, steps = THEN, test, extra = {}, earlier = {} }) {
  const d = makeRepo();
  const base = commit(d, "start", { ".gitignore": ".verify/\nout/\n", "package.json": '{"type":"module"}\n', ".claude/verify.json": JSON.stringify(settings), "src/export.mjs": OLD, ...earlier });
  const s = spec(steps);
  commit(d, "spec", { [SPEC]: s, [`openspec/changes/${CH}/tasks.md`]: tasks("src/export.mjs"), [`openspec/changes/${CH}/approval.json`]: approval(s) });
  commit(d, "tests", test);
  commit(d, "build", { "src/export.mjs": NEW, ...extra });
  return { d, base, settings };
}
const check = ({ d, base, settings }, lane = "normal") => runCompliance({ root: d, change: CH, base, lane, settings });
const head = ['import { test } from "node:test";', 'import assert from "node:assert/strict";', 'import { writeFileSync, mkdirSync } from "node:fs";', 'import { exportCsv } from "../../src/export.mjs";'];

// ---- 1. Nothing of the user's folders is linked into the temporary copies ----

test("a test that writes into an ignored folder leaves the user's folder alone, in both lanes", () => {
  const r = exportRepo({ test: { "test/acceptance/export.test.mjs": [...head, 'test("[export-csv-downloads] writes a stamp", () => {', '  if (process.cwd().includes("compliance-base-")) {', '    mkdirSync("out", { recursive: true });', '    writeFileSync("out/stamp", "from a test");', "  }", '  assert.equal(exportCsv().header, "name,total");', "});", ""].join("\n") } });
  mkdirSync(join(r.d, "out"));
  writeFileSync(join(r.d, "out/stamp"), "original");
  for (const lane of ["normal", "high-risk"]) {
    check(r, lane);
    assert.equal(readFileSync(join(r.d, "out/stamp"), "utf8"), "original", `after the ${lane} run`);
  }
});

test("withBaseTree links only the folders named in sharedFolders", () => {
  const dir = makeRepo({ ".gitignore": "deps/\nout/\n", "a.txt": "x\n" });
  git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "start");
  mkdirSync(join(dir, "deps")); writeFileSync(join(dir, "deps/lib.txt"), "dependency\n");
  mkdirSync(join(dir, "out")); writeFileSync(join(dir, "out/file.txt"), "built\n");
  const seen = withBaseTree(dir, "HEAD", [], (tree) => [existsSync(join(tree, "deps/lib.txt")), existsSync(join(tree, "out"))], { shared: ["deps"] });
  assert.deepEqual(seen, [true, false]);
});

// ---- 2. A crash is not a failed assertion, whatever the test is called ----

test("a TypeError on the old code in a test named '... the expected header' is held", () => {
  const r = exportRepo({ test: { "test/acceptance/export.test.mjs": [...head, 'test("[export-csv-downloads] the file has the expected header", () => {', '  assert.equal(exportCsv().header, "name,total");', "});", ""].join("\n") } });
  const report = check(r);
  const s = report.scenarios[0];
  assert.equal(s.status, "held");
  assert.equal(s.failsFirst, false);
  assert.match(report.holds.find((h) => h.scenario === s.id).why, /did not fail by an assertion/);
});

test("a real assertion failure on the old code is still proven", () => {
  const r = exportRepo({ test: { "test/acceptance/export.test.mjs": [...head, 'test("[export-csv-downloads] the file has the expected header", () => {', '  assert.equal(String(exportCsv()), "name,total");', "});", ""].join("\n") }, extra: { "src/export.mjs": 'export const exportCsv = () => "name,total";\n' } });
  assert.equal(check(r).scenarios[0].status, "proven");
});

// ---- 3. The reviewer's count is filled in by the review step, never invented ----

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const RECORD = fileURLToPath(new URL("../scripts/record-review.mjs", import.meta.url));

test("a new record leaves the reviewer's mismatches empty, with a note on who fills it in", () => {
  const report = check(exportRepo({ test: { "test/acceptance/export.test.mjs": [...head, 'test("[export-csv-downloads] checks it", () => {', '  assert.equal(String(exportCsv()), "name,total");', "});", ""].join("\n") }, extra: { "src/export.mjs": 'export const exportCsv = () => "name,total";\n' } }));
  assert.equal(report.reviewer.mismatches, null);
  assert.equal(report.reviewer.timeMs, null);
  assert.match(report.reviewer.note, /filled in by pr-review/);
});

test("record-review writes the count of partly and missing verdicts and the reviewer's time into the record", () => {
  const dir = mkdtempSync(join(tmpdir(), "record-review-"));
  const reportFile = join(dir, "compliance.json");
  writeFileSync(reportFile, JSON.stringify({ change: "x", reviewer: { mismatches: null, timeMs: null, note: "later" }, timeMs: { trace: 1 } }));
  const reviewFile = join(dir, "spec-match.json");
  writeFileSync(reviewFile, JSON.stringify({ scenarios: [{ id: "a-b", verdict: "matches" }, { id: "c-d", verdict: "partly" }, { id: "e-f", verdict: "matches" }] }));
  const run = (...extra) => spawnSync("node", [RECORD, "--spec-match", reviewFile, "--report", reportFile, ...extra], { encoding: "utf8" });
  assert.equal(run("--time-ms", "4200").status, 0);
  let saved = JSON.parse(readFileSync(reportFile, "utf8"));
  assert.equal(saved.reviewer.mismatches, 1);
  assert.equal(saved.reviewer.timeMs, 4200);
  assert.deepEqual(saved.timeMs, { trace: 1 }, "the rest of the record is untouched");
  writeFileSync(reviewFile, JSON.stringify({ scenarios: [{ id: "a-b", verdict: "missing" }, { id: "c-d", verdict: "partly" }] }));
  run("--time-ms", "10");
  saved = JSON.parse(readFileSync(reportFile, "utf8"));
  assert.equal(saved.reviewer.mismatches, 2);
});

test("record-review refuses an answer with no scenario verdicts", () => {
  const dir = mkdtempSync(join(tmpdir(), "record-review-"));
  writeFileSync(join(dir, "compliance.json"), "{}");
  writeFileSync(join(dir, "spec-match.json"), JSON.stringify({ verdict: "ready" }));
  const r = spawnSync("node", [RECORD, "--spec-match", join(dir, "spec-match.json"), "--report", join(dir, "compliance.json")], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.equal(readFileSync(join(dir, "compliance.json"), "utf8"), "{}");
});

// ---- Executable specs: a step runner that reads the spec files itself ----

import { bindingsIn } from "../scripts/lib/executable.mjs";

const SEATS = "openspec/changes/add-seats/specs/seats/spec.md";
const seatSpec = ["## ADDED Requirements", "", "### Requirement: seat-limit", "", "A full team SHALL be refused.", "", "#### Scenario: seat-refused-at-limit", "", "- **GIVEN** a full team", "- **WHEN** the team adds a seat", "- **THEN** the seat is refused", "- **AND** the team is told why", ""].join("\n");
const RUNNER = ['import { readFileSync } from "node:fs";', 'import { steps } from "./registry.mjs";', 'import "./seats.steps.mjs";', 'const name = process.argv[2] ?? "";', `const spec = readFileSync(${JSON.stringify(SEATS)}, "utf8");`, "let failed = 0;", "for (const block of spec.split(/^#### Scenario: /m).slice(1)) {", '  const id = block.split("\\n")[0].trim();', "  if (name && !name.includes(`[${id}]`)) continue;", "  const w = {};", "  try {", "    for (const m of block.matchAll(/^- \\*\\*(?:GIVEN|WHEN|THEN|AND)\\*\\* (.+)$/gm)) { const st = steps.get(m[1].trim()); if (!st) throw new Error(`no binding for: ${m[1]}`); st(w); }", "    console.log(`ok [${id}]`);", "  } catch (e) { failed++; console.log(`not ok [${id}] assert ${e.message}`); }", "}", "process.exit(failed ? 1 : 0);", ""].join("\n");
const REGISTRY = "export const steps = new Map();\nexport const Given = (t, r) => steps.set(t, r);\nexport const When = Given;\nexport const Then = Given;\n";
const bindingFile = (told) => ['import assert from "node:assert/strict";', 'import { Given, When, Then } from "./registry.mjs";', 'import { addSeat } from "../src/seats.mjs";', 'Given("a full team", (w) => { w.team = { used: 3, limit: 3 }; });', 'When("the team adds a seat", (w) => { w.after = addSeat(w.team); });', 'Then("the seat is refused", (w) => { assert.equal(w.after.refused, true); });', `Then("the team is told why", (w) => { ${told} });`, "", "// A helper other step files use.", "export function assertRefused(t) { return t.refused === true; }", ""].join("\n");

function seatsRepo(told) {
  const settings = { ...SETTINGS, executableSpecs: { tool: "sample-steps", command: 'node steps/run.mjs "{name}"' } };
  const d = makeRepo();
  const base = commit(d, "start", { ".gitignore": ".verify/\n", "package.json": '{"type":"module"}\n', ".claude/verify.json": JSON.stringify(settings), "src/seats.mjs": "export const addSeat = (t) => t;\n" });
  commit(d, "spec", { [SEATS]: seatSpec, "openspec/changes/add-seats/tasks.md": tasks("src/seats.mjs").replace("export-csv-downloads", "seat-refused-at-limit"), "openspec/changes/add-seats/approval.json": approval(seatSpec) });
  commit(d, "tests", { "steps/registry.mjs": REGISTRY, "steps/run.mjs": RUNNER, "steps/seats.steps.mjs": bindingFile(told) });
  commit(d, "build", { "src/seats.mjs": "export const addSeat = (t) => (t.used >= t.limit ? { ...t, refused: true, reason: 'This team is full.' } : { ...t, used: t.used + 1 });\n" });
  return { d, base, settings };
}
const checkSeats = ({ d, base, settings }) => runCompliance({ root: d, change: "add-seats", base, lane: "normal", settings });

// ---- 4. The starting-commit run can read the change's spec files ----

test("with executable specs on, the starting-commit run has the change's spec files, so a fully bound scenario is proven", () => {
  const report = checkSeats(seatsRepo("assert.ok(w.after.refused);"));
  assert.deepEqual(report.holds.map((h) => h.why), []);
  assert.equal(report.scenarios[0].status, "proven");
});

// ---- 5. A binding's body ends at its own closing bracket ----

test("bindingsIn ends a binding's body at its closing bracket, so a later helper cannot lend it an assertion", () => {
  const text = ['Then("a", (w) => { w.x; });', 'export function assertX(t) { return t; }', 'Then("b", function (w) { assert.ok(w.y); });', 'When("c", () => foo("(", ")"));', ""].join("\n");
  const [a, b, c] = bindingsIn(text);
  assert.doesNotMatch(a.body, /assertX/);
  assert.match(b.body, /assert\.ok/);
  assert.doesNotMatch(c.body, /Then|assert/);
});

test("a THEN-line binding that asserts nothing is held even when a helper named assertX follows it", () => {
  const report = checkSeats(seatsRepo("w.after.reason;"));
  assert.ok(report.holds.some((h) => /the team is told why/.test(h.why) && /no assertion/.test(h.why)), report.holds.map((h) => h.why).join(" | "));
});

// ---- 7. Only tests in files the change touched can cite an unknown scenario ----

test("a test in a file the change did not touch, with an ID-looking bracket, is a warning that names tests.exclude", () => {
  const unrelated = 'import { test } from "node:test";\ntest("[gh-1234] closes the old ticket", () => {});\n';
  const r = exportRepo({ earlier: { "test/legacy/old.test.mjs": unrelated, "examples/demo/sample.test.mjs": unrelated.replace("gh-1234", "first-name") }, test: { "test/acceptance/export.test.mjs": [...head, 'test("[export-csv-downloads] checks it", () => {', '  assert.equal(String(exportCsv()), "name,total");', "});", ""].join("\n") }, extra: { "src/export.mjs": 'export const exportCsv = () => "name,total";\n' } });
  const report = check(r);
  assert.deepEqual(report.holds.map((h) => h.why), []);
  const warned = report.warnings.filter((w) => /unknown|no scenario/.test(w.why));
  assert.equal(warned.length, 1);
  assert.match(warned[0].why, /2 tests/);
  assert.match(warned[0].why, /tests\.exclude/);
  assert.equal(warned[0].files.length, 2);
});

test("a test in a file the change touched that cites an unknown scenario still holds", () => {
  const r = exportRepo({ test: { "test/acceptance/export.test.mjs": [...head, 'test("[export-csv-downloads] checks it", () => {', '  assert.equal(String(exportCsv()), "name,total");', "});", 'test("[no-such-scenario] cites a stranger", () => {});', ""].join("\n") }, extra: { "src/export.mjs": 'export const exportCsv = () => "name,total";\n' } });
  const report = check(r);
  assert.ok(report.holds.some((h) => /no-such-scenario/.test(h.why)));
});

// ---- 8. Fixes from the first real dry run ----

test("colour codes in the runner's output do not hide the tests that ran", () => {
  const r = runCommand(process.cwd(), `node -e 'console.log("\\x1b[32m\\u2714\\x1b[39m \\x1b[2m[export-csv-downloads] works\\x1b[22m")' #{name}`.replace("#{name}", "{name}"), "x");
  assert.deepEqual(readRun(r.out).map((t) => [t.id, t.status]), [["export-csv-downloads", "passed"]]);
  assert.deepEqual(readRun("\x1b[32m\u2714\x1b[39m [a-b] ok").map((t) => t.status), ["passed"]);
});

const entry = { id: "export-csv-downloads" };
const run = (out, exits = [0]) => ({ skipped: 0, passed: 0, failed: 0, runs: [{}], exits, out });

test("a command that exits 0 but prints no test names says it must print each test's name", () => {
  const why = whyNotRun(entry, run("Test Files 1 passed (1)\nTests 3 passed (3)\n"));
  assert.match(why, /print each test's name/);
  assert.match(why, /verbose/);
});

test("a command that prints other tests but not this one shows the exit code and the lines naming the scenario, not the last lines", () => {
  const out = ["noise one", "[export-csv-downloads] was filtered", ...Array.from({ length: 8 }, (_, i) => `\u2714 unrelated-${i}`)].join("\n");
  const why = whyNotRun(entry, run(out));
  assert.match(why, /code 0/);
  assert.match(why, /was filtered/);
  assert.doesNotMatch(why, /unrelated-7/);
});

test("when no task declares Touches, one warning says the scope check could not run", () => {
  const dir = makeRepo({ "src/a.txt": "1\n", "src/b.txt": "1\n" });
  git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "start");
  const base = git(dir, "rev-parse", "HEAD").trim();
  for (const f of ["src/a.txt", "src/b.txt"]) writeFileSync(join(dir, f), "2\n");
  git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "change");
  const found = checkScope(dir, base, "c", [{ touches: [] }], { tests: {} });
  assert.equal(found.length, 1);
  assert.match(found[0].why, /no task declares/i);
  assert.match(found[0].why, /Touches/);
  assert.deepEqual(found[0].files, ["src/a.txt", "src/b.txt"]);
});

test("the printed summary groups repeated holds, and the report keeps every hold", () => {
  const holds = Array.from({ length: 18 }, (_, i) => ({ check: "every-scenario-is-traced", scenario: `scenario-${i}`, missing: "task", why: `Scenario scenario-${i} has no task. Add one.` }));
  const text = summarize({ scenarios: [], counts: { ran: 0, expected: 18 }, held: true, change: "c", holds, warnings: [], allowedEdits: [], breaks: { skipped: true, reason: "r" } });
  assert.match(text, /18 scenarios have no task/);
  assert.match(text, /scenario-0/);
  assert.doesNotMatch(text, /scenario-17/);
  assert.match(text, /15 more/);
  assert.equal(holds.length, 18);
});
