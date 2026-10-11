// Regression tests for problems the reviews of the spec compliance check found.
// Each builds a small repository in a temporary folder and runs the check on it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { makeRepo, git } from "../../../tests/helpers.mjs";
import { runCompliance, withBaseTree } from "../scripts/lib/compliance.mjs";

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
