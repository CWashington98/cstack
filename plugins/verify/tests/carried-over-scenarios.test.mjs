// Acceptance tests for carried-over scenarios: one per scenario in the ADDED requirement of
// openspec/changes/add-guard-scenarios/specs/runner/spec-compliance/spec.md, each named
// with its [scenario-id]. They were written before the feature and are locked: change
// them only in a commit with a "Spec-Change:" line.
//
// A carried-over scenario sits in a MODIFIED requirement and also exists, with the same
// wording, in the project's living spec under openspec/specs/. Each test builds a throwaway
// repository whose starting commit holds a living spec, runs the command
//   node scripts/spec-compliance.mjs <change> --base <commit>
// and reads the exit code (0 proven, 1 held), the compliance.json report and the summary.
// Nothing here reads the check's code: every expected value comes from the spec.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeRepo, git } from "../../../tests/helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "spec-compliance.mjs");

const CHANGE = "add-adult-note";
const SPEC = `openspec/changes/${CHANGE}/specs/age/spec.md`;

// The sample projects run their tests with Node's own runner. It reads a test name
// as a pattern, so the settings escape the opening bracket to match it literally.
const SETTINGS = {
  integrationBranch: "main",
  tests: {
    all: 'node --test "test/**/*.test.mjs"',
    byName: 'node --test --test-name-pattern "\\{name}" "test/**/*.test.mjs"',
    acceptance: ["test/acceptance/**"],
  },
};

// ---- Building a sample change with carried-over scenarios ----

// The age rule: an adult is 18 or older. A test that checks 18 and 17 notices a broken rule.
const GOOD = "export const isAdult = (age) => age >= 18;\n";
const WRONG = "export const isAdult = (age) => age >= 21;\n";

const testText = (id, body, imports = "isAdult") => [
  'import { test } from "node:test";',
  'import assert from "node:assert/strict";',
  `import { ${imports} } from "../../src/guarded.mjs";`,
  "",
  `test("[${id}] the age rule stays the same", () => {`,
  ...body.map((l) => `  ${l}`),
  "});",
  "",
].join("\n");

// Pins the rule at both sides of the limit, so any broken condition or limit fails it.
const STRICT = ["assert.equal(isAdult(18), true);", "assert.equal(isAdult(17), false);"];
// Only checks that an answer comes back, so it notices no broken condition or limit.
const LOOSE = ['assert.equal(typeof isAdult(30), "boolean");'];

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

function write(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    const file = join(dir, path);
    if (content === null) { rmSync(file, { force: true }); continue; }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

function commit(dir, message, files = {}) {
  write(dir, files);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "--allow-empty", "-m", message);
  return git(dir, "rev-parse", "HEAD").trim();
}

// A scenario's text as one requirement block. `lines` are the GIVEN, WHEN and THEN bullets.
const scenarioText = (id, lines) => [`#### Scenario: ${id}`, "", ...lines.map((l) => `- ${l}`), ""].join("\n");

const RULE = ["**WHEN** the age rule is asked about 18 and 17", "**THEN** 18 counts as an adult and 17 does not"];
const RULE_REWORDED = ["**WHEN** the age rule is asked about 18 and 17", "**THEN** only 18 and above count as adults"];

const requirement = (kind, scenarios) => [
  `## ${kind} Requirements`, "",
  "### Requirement: age-rule-is-kept", "",
  "The age rule SHALL stay the same.", "",
  ...scenarios,
].join("\n");

// `carried` and `fresh` are [id, bullets] pairs. The living spec holds `living` at the
// starting commit; the change copies `carried` into a MODIFIED requirement. A task covers
// each scenario listed in `covered`; the carried ones normally have none.
function carriedSample({ living, carried, covered = [], starting = GOOD, built = GOOD, tests = null }) {
  const livingSpec = ["# age Specification", "", "## Purpose", "", "The age rule.", "", requirement("", living.map(([id, b]) => scenarioText(id, b)))
    .replace("##  Requirements", "## Requirements")].join("\n");
  const spec = requirement("MODIFIED", carried.map(([id, b]) => scenarioText(id, b)));
  const tasks = [
    "# Tasks", "",
    "## 1. Acceptance tests", "",
    "- [x] 1.1 Write one test per scenario. Verify each as it should. Covers: all. Touches: test/acceptance/**", "",
    "## 2. Build", "",
    ...covered.map((id, i) => `- [x] 2.${i + 1} Keep the age rule. Verify with the test. Covers: ${id}. Touches: src/guarded.mjs`),
    "",
  ].join("\n");
  const approval = JSON.stringify({ approvedBy: "owner", approvedOn: "2026-10-12", covers: "specs/**/*.md", fingerprint: `sha256:${sha256(spec)}` }, null, 2) + "\n";
  const dir = makeRepo();
  const base = commit(dir, "Starting point", {
    ".gitignore": ".verify/\n",
    "package.json": JSON.stringify({ name: "sample", private: true, type: "module" }, null, 2) + "\n",
    ".claude/verify.json": JSON.stringify(SETTINGS, null, 2) + "\n",
    "src/guarded.mjs": starting,
    "openspec/specs/age/spec.md": livingSpec,
  });
  commit(dir, "Spec: change the rule", {
    [SPEC]: spec, [`openspec/changes/${CHANGE}/tasks.md`]: tasks, [`openspec/changes/${CHANGE}/approval.json`]: approval,
  });
  const files = {};
  for (const [id] of carried) files[`test/acceptance/${id}.test.mjs`] = (tests ?? {})[id] ?? testText(id, STRICT);
  commit(dir, "test(acceptance): lock the tests", files);
  commit(dir, "Build the change", { "src/note.mjs": 'export const note = "adult";\n', "src/guarded.mjs": built });
  return { dir, base, change: CHANGE };
}

// ---- Running the check and reading its report ----

function findReports(dir) {
  return readdirSync(dir).flatMap((f) => {
    if (f === ".git" || f === "node_modules") return [];
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return findReports(p);
    return f === "compliance.json" ? [p] : [];
  });
}

function check({ dir, base, change }, ...args) {
  const r = spawnSync("node", [script, change, "--base", base, ...args], { cwd: dir, encoding: "utf8" });
  const newest = findReports(dir).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, report: newest ? JSON.parse(readFileSync(newest, "utf8")) : null };
}

// Every assertion about a run starts here, so a missing report fails as an assertion.
function reported(r) {
  assert.ok(r.report, `the check wrote no compliance.json (exit ${r.status}). Its output:\n${r.out.slice(0, 800)}`);
  return r.report;
}

const text = (x) => JSON.stringify(x);
const scenarioIn = (report, id) => {
  const s = (report.scenarios ?? []).find((x) => x.id === id);
  assert.ok(s, `the report has no entry for scenario ${id}`);
  return s;
};
// What the check says about a scenario: its holds and its own entry, as one string.
const saidAbout = (report, id) => [...(report.holds ?? []).filter((h) => text(h).includes(id)), scenarioIn(report, id)].map(text).join("\n");
// Everything the run printed or reported, for facts the spec gives no fixed place.
const everything = (r) => `${r.out}\n${text(r.report)}`;

// ---- carried-over-scenarios-must-still-pass ----

test("[carried-over-passes-before-and-after] an unchanged scenario copied into a MODIFIED requirement is proven with no task", () => {
  const s = carriedSample({ living: [["age-rule-kept", RULE]], carried: [["age-rule-kept", RULE]] });
  const r = check(s);
  const report = reported(r);
  assert.equal(r.status, 0, `the change is proven: ${text(report.holds)}`);
  assert.equal(report.held, false, text(report.holds));
  const entry = scenarioIn(report, "age-rule-kept");
  assert.equal(entry.status, "proven");
  assert.deepEqual(entry.tasks, [], "no task covers it");
  assert.match(everything(r), /carried over/i, "the report marks the scenario as proven as carried over");
});

test("[carried-over-fails-on-new-code] a carried-over scenario whose test fails on the latest commit holds the change", () => {
  const s = carriedSample({ living: [["age-rule-kept", RULE]], carried: [["age-rule-kept", RULE]], starting: GOOD, built: WRONG });
  const r = check(s);
  const report = reported(r);
  assert.equal(r.status, 1);
  assert.equal(report.held, true);
  assert.equal(scenarioIn(report, "age-rule-kept").passesNow, false);
  const said = saidAbout(report, "age-rule-kept");
  assert.match(said, /carried over/i, "the report says the change broke a scenario it carried over");
  assert.match(said, /\[age-rule-kept\] the age rule stays the same|age-rule-kept\.test\.mjs/, "the report names the test");
});

test("[carried-over-wording-changed] a scenario with changed wording is new, so it is judged by the fail-first rule", () => {
  // One scenario is copied unchanged and one is reworded. Both tests pass on both commits.
  const s = carriedSample({
    living: [["age-rule-kept", RULE], ["age-rule-limit", RULE]],
    carried: [["age-rule-kept", RULE], ["age-rule-limit", RULE_REWORDED]],
    covered: ["age-rule-limit"],
  });
  const r = check(s);
  const report = reported(r);
  assert.equal(r.status, 1);
  assert.equal(report.held, true);
  assert.equal(scenarioIn(report, "age-rule-kept").status, "proven", "the unchanged scenario is carried over and proven");
  assert.notEqual(scenarioIn(report, "age-rule-limit").status, "proven", "the reworded scenario is new and is not proven");
  assert.match(saidAbout(report, "age-rule-limit"), /doesn't depend on the change/i);
  assert.doesNotMatch((report.holds ?? []).map(text).filter((h) => h.includes("age-rule-kept")).join("\n"), /./, "nothing holds the unchanged scenario");
});
