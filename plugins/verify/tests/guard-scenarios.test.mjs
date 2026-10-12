// Acceptance tests for guard scenarios: one per scenario in the ADDED requirement of
// openspec/changes/add-guard-scenarios/specs/runner/spec-compliance/spec.md, each named
// with its [scenario-id]. They were written before the feature and are locked: change
// them only in a commit with a "Spec-Change:" line.
//
// A guard scenario starts with a "- **GUARDS** <what stays the same>" bullet. Each test
// builds a throwaway repository with a change that holds one guard, runs the command
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

// ---- Building a sample change that holds one guard ----

// The guarded code: an adult is 18 or older. A test that checks 18 and 17 notices when
// the condition or the limit is broken.
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

// One guard scenario, a task that covers it and touches the guarded file, and the commits:
// starting point, approved spec, locked tests, then a build that adds an unrelated file
// (and rewrites the guarded file only when `built` differs from `starting`).
function guardSample({ id, starting = GOOD, built = GOOD, test = testText(id, STRICT) }) {
  const spec = [
    "## ADDED Requirements", "",
    "### Requirement: age-rule-is-kept", "",
    "The age rule SHALL stay the same.", "",
    `#### Scenario: ${id}`, "",
    "- **GUARDS** an adult is still someone aged 18 or older",
    "- **WHEN** the age rule is asked about 18 and 17",
    "- **THEN** 18 counts as an adult and 17 does not", "",
  ].join("\n");
  const tasks = [
    "# Tasks", "",
    "## 1. Acceptance tests", "",
    "- [x] 1.1 Write one test per scenario. Verify each as it should. Covers: all. Touches: test/acceptance/**", "",
    "## 2. Build", "",
    `- [x] 2.1 Add the note without changing the age rule. Verify with the guard test. Covers: ${id}. Touches: src/guarded.mjs`, "",
  ].join("\n");
  const approval = JSON.stringify({ approvedBy: "owner", approvedOn: "2026-10-11", covers: "specs/**/*.md", fingerprint: `sha256:${sha256(spec)}` }, null, 2) + "\n";
  const dir = makeRepo();
  const base = commit(dir, "Starting point", {
    ".gitignore": ".verify/\n",
    "package.json": JSON.stringify({ name: "sample", private: true, type: "module" }, null, 2) + "\n",
    ".claude/verify.json": JSON.stringify(SETTINGS, null, 2) + "\n",
    "src/guarded.mjs": starting,
  });
  commit(dir, "Spec: add the note", {
    [SPEC]: spec, [`openspec/changes/${CHANGE}/tasks.md`]: tasks, [`openspec/changes/${CHANGE}/approval.json`]: approval,
  });
  commit(dir, "test(acceptance): lock the guard test", { [`test/acceptance/${id}.test.mjs`]: test });
  commit(dir, "Build the note", { "src/note.mjs": 'export const note = "adult";\n', "src/guarded.mjs": built });
  return { dir, base, change: CHANGE, id };
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

// ---- guard-scenarios-are-proven-by-breaking-what-they-protect ----

test("[guard-passes-before-and-after] a guard that passes on both commits and catches a break is proven as a guard", () => {
  const s = guardSample({ id: "age-rule-kept" });
  const r = check(s);
  const report = reported(r);
  assert.equal(r.status, 0, `the change is proven: ${text(report.holds)}`);
  assert.equal(report.held, false, text(report.holds));
  const entry = scenarioIn(report, s.id);
  assert.equal(entry.status, "proven");
  assert.match(text(entry), /guard/i, "the report marks the scenario as proven as a guard");
  assert.match(everything(r), /flipped|moved the number/i, "the report names the break the test caught");
});

test("[guard-fails-on-old-code] a guard whose test fails on the starting commit holds the change", () => {
  const s = guardSample({ id: "age-rule-kept", starting: WRONG, built: GOOD });
  const r = check(s);
  const report = reported(r);
  assert.equal(r.status, 1);
  assert.equal(report.held, true);
  assert.notEqual(scenarioIn(report, s.id).status, "proven");
  assert.match(saidAbout(report, s.id), /must pass before/i, "the report says a guard's test must pass before the change too");
});

test("[guard-fails-on-new-code] a guard whose test fails on the latest commit holds the change and names the test", () => {
  const s = guardSample({ id: "age-rule-kept", starting: GOOD, built: WRONG });
  const r = check(s);
  const report = reported(r);
  assert.equal(r.status, 1);
  assert.equal(report.held, true);
  assert.equal(scenarioIn(report, s.id).passesNow, false);
  const said = saidAbout(report, s.id);
  assert.match(said, /altered behavior/i, "the report says the change altered behavior the guard protects");
  assert.match(said, /\[age-rule-kept\] the age rule stays the same|age-rule-kept\.test\.mjs/, "the report names the test");
});

test("[guard-catches-no-break] a guard whose test notices no break holds the change and counts the breaks tried", () => {
  const s = guardSample({ id: "age-rule-kept", test: testText("age-rule-kept", LOOSE) });
  const r = check(s);
  const report = reported(r);
  assert.equal(r.status, 1);
  assert.equal(report.held, true);
  assert.notEqual(scenarioIn(report, s.id).status, "proven");
  const said = saidAbout(report, s.id);
  assert.match(said, /doesn't protect|does not protect/i, "the report says the guard's test doesn't protect the code its task names");
  const tried = said.match(/\b(\d+) breaks?\b/i);
  assert.ok(tried, `the report says how many breaks were tried: ${said}`);
  assert.ok(Number(tried[1]) >= 1, "at least one break was tried");
});

test("[guard-breaks-respect-the-cap] a guarded file with more than 30 conditions gets at most 30 breaks and says the cap was reached", () => {
  const many = Array.from({ length: 40 }, (_, i) => `export const c${i} = (n) => n >= ${i + 1};`).join("\n") + "\n";
  const body = ['assert.equal(typeof c0(1), "boolean");'];
  const s = guardSample({ id: "age-rule-kept", starting: many, built: many, test: testText("age-rule-kept", body, "c0") });
  const r = check(s);
  const report = reported(r);
  assert.equal(r.status, 1);
  assert.equal(report.held, true);
  const said = saidAbout(report, s.id);
  const tried = said.match(/\b(\d+) breaks?\b/i);
  assert.ok(tried, `the report says how many breaks were tried: ${said}`);
  assert.ok(Number(tried[1]) >= 1 && Number(tried[1]) <= 30, `at most 30 breaks were tried, the report says ${tried[1]}`);
  assert.match(said, /cap/i, "the report says the cap was reached");
});
