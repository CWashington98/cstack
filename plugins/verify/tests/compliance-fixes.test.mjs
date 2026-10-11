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
