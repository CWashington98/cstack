// Acceptance tests for the spec compliance check: one per scenario in
// openspec/changes/add-spec-compliance/specs/runner/spec-compliance/spec.md,
// each named with its [scenario-id]. They were written before the check and
// are locked: change them only in a commit with a "Spec-Change:" line.
//
// Each test builds a throwaway repository with a change in it, runs the
// command the design describes, and reads what it reports:
//   node scripts/spec-compliance.mjs <change> [--lane normal|high-risk] [--base <commit>]
// exit 0 when proven, 1 when held, 2 for a settings problem; a compliance.json
// report; and a plain summary at the end of the output.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeRepo, git } from "../../../tests/helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, "..");
const script = join(plugin, "scripts", "spec-compliance.mjs");
const fixtures = join(here, "fixtures", "compliance");
const prReview = join(plugin, "skills", "pr-review");

const CHANGE = "add-export";
const SPEC = `openspec/changes/${CHANGE}/specs/export/spec.md`;
const REQUIREMENTS = [
  "every-scenario-is-traced", "scenario-tests-really-ran", "tests-fail-first-then-pass",
  "locked-acceptance-tests-stay-locked", "nothing-built-outside-the-spec", "spec-matches-what-was-approved",
  "tests-exercise-their-code", "spec-match-review", "executable-specs-when-turned-on", "each-run-is-measured",
  "works-in-any-project",
];

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

// ---- Building a sample change ----

const STUB = "export const works = () => false;\n";
const BUILT = "export const works = () => true;\n";

// One scenario of the sample change: its ID, its step lines, the file whose
// stub gives the wrong answer at the start, and the test that proves it.
function scenario(id, more = {}) {
  const s = {
    id, file: `src/${id}.mjs`, stub: STUB, built: BUILT,
    given: `a sample for ${id}`, when: `${id} is used`, then: `${id} works`,
    ...more,
  };
  s.testFile ??= `test/acceptance/${id}.test.mjs`;
  s.test ??= [
    'import { test } from "node:test";',
    'import assert from "node:assert/strict";',
    `import { works } from "../../${s.file}";`,
    "",
    `test("[${id}] ${s.then}", () => {`,
    "  assert.equal(works(), true);",
    "});",
    "",
  ].join("\n");
  return s;
}

const specText = (scenarios) => [
  "## ADDED Requirements", "",
  "### Requirement: sample-export", "",
  "The export SHALL do what each scenario says.", "",
  ...scenarios.flatMap((s) => [
    `#### Scenario: ${s.id}`, "",
    `- **GIVEN** ${s.given}`, `- **WHEN** ${s.when}`, `- **THEN** ${s.then}`, "",
  ]),
].join("\n");

const taskLine = (n, s) => `- [x] 2.${n} Make ${s.id} work. Verify with its scenario test. Covers: ${s.id}. Touches: ${s.file}`;

const tasksText = (scenarios, extra = []) => [
  "# Tasks", "",
  "## 1. Acceptance tests", "",
  "- [x] 1.1 Write one test per scenario. Verify each fails first by an assertion. Covers: all. Touches: test/acceptance/**", "",
  "## 2. Build", "",
  ...scenarios.map((s, i) => taskLine(i + 1, s)),
  ...extra, "",
].join("\n");

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const approval = (spec) => JSON.stringify({ approvedBy: "owner", approvedOn: "2026-10-11", covers: "specs/**/*.md", fingerprint: `sha256:${sha256(spec)}` }, null, 2) + "\n";

// An earlier, unrelated part of the project: its own spec, code and test.
const ACCOUNTS_TEST = [
  'import { test } from "node:test";',
  'import assert from "node:assert/strict";',
  'import { signIn } from "../src/accounts.mjs";',
  "",
  'test("[sign-in-works] a named user signs in", () => {',
  '  const user = signIn("ada");',
  "  assert.equal(user.signedIn, true);",
  '  assert.equal(user.name, "ada");',
  "});",
  "",
].join("\n");
const PROJECT = {
  ".gitignore": ".verify/\n",
  "package.json": JSON.stringify({ name: "sample", private: true, type: "module" }, null, 2) + "\n",
  "openspec/specs/accounts/spec.md": [
    "## Requirements", "", "### Requirement: sign-in", "", "A named user SHALL be able to sign in.", "",
    "#### Scenario: sign-in-works", "", "- **GIVEN** a user named ada", "- **WHEN** they sign in", "- **THEN** they are signed in", "",
  ].join("\n"),
  "src/accounts.mjs": "export const signIn = (name) => (name ? { name, signedIn: true } : null);\n",
  "test/accounts.test.mjs": ACCOUNTS_TEST,
};

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

// A repository with the change in flight, one commit per step: the starting
// point, the approved spec, the locked acceptance tests, then the build. Each
// of starting, spec, tests and build is laid over the defaults (null deletes a
// file). later adds commits after the build: [{ message, files }].
function sample({
  scenarios = [scenario("export-csv-downloads")],
  settings = SETTINGS,
  tasks = tasksText(scenarios),
  starting = {}, spec = {}, tests = {}, build = {}, later = [],
} = {}) {
  const dir = makeRepo();
  const text = specText(scenarios);
  const files = (pick) => Object.fromEntries(scenarios.map((s) => pick(s)));
  const base = commit(dir, "Starting point", {
    ...PROJECT, ".claude/verify.json": JSON.stringify(settings, null, 2) + "\n",
    ...files((s) => [s.file, s.stub]), ...starting,
  });
  commit(dir, "Spec: add the export", {
    [SPEC]: text, [`openspec/changes/${CHANGE}/tasks.md`]: tasks, [`openspec/changes/${CHANGE}/approval.json`]: approval(text), ...spec,
  });
  commit(dir, "test(acceptance): lock the scenario tests", { ...files((s) => [s.testFile, s.test]), ...tests });
  commit(dir, "Build the export", { ...files((s) => [s.file, s.built]), ...build });
  const commits = later.map((c) => commit(dir, c.message, c.files));
  return { dir, base, head: git(dir, "rev-parse", "HEAD").trim(), commits, change: CHANGE };
}

// A sample repository from fixtures/compliance/<flavour>, built the same way.
const STEP_MESSAGES = { "1-spec": "Spec: approved", "2-acceptance": "test(acceptance): lock the scenario tests", "3-build": "Build the change" };
function fromFixture(flavour) {
  const root = join(fixtures, flavour);
  const dir = makeRepo();
  cpSync(join(root, "starting"), dir, { recursive: true });
  const base = commit(dir, "Starting point");
  const steps = readdirSync(join(root, "change")).sort();
  for (const step of steps) {
    cpSync(join(root, "change", step), dir, { recursive: true });
    commit(dir, STEP_MESSAGES[step]);
  }
  const change = readdirSync(join(dir, "openspec", "changes"))[0];
  const specDir = join(dir, "openspec", "changes", change, "specs");
  const specFile = join(specDir, readdirSync(specDir)[0], "spec.md");
  const ids = [...readFileSync(specFile, "utf8").matchAll(/^#### Scenario: (\S+)/gm)].map((m) => m[1]);
  return { dir, base, head: git(dir, "rev-parse", "HEAD").trim(), change, ids };
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
const holdsOf = (report, check) => (report.holds ?? []).filter((h) => h.check === check);
const warningsOf = (report, check) => (report.warnings ?? []).filter((w) => w.check === check);
const scenarioIn = (report, id) => {
  const s = (report.scenarios ?? []).find((x) => x.id === id);
  assert.ok(s, `the report has no entry for scenario ${id}`);
  return s;
};

// Every object inside the report, leaving out the report itself and its holds,
// for facts the design doesn't give a fixed place.
function entries(report) {
  const out = [];
  const walk = (node) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      out.push(node);
      Object.values(node).forEach(walk);
    }
  };
  for (const [k, v] of Object.entries(report)) if (k !== "holds") walk(v);
  return out;
}

const read = (file) => readFileSync(file, "utf8");

// ---- every-scenario-is-traced ----

test("[scenario-without-a-task] a scenario no task covers holds the change and is named", () => {
  const traced = scenario("export-csv-has-header");
  const untraced = scenario("export-csv-downloads");
  const r = check(sample({ scenarios: [untraced, traced], tasks: tasksText([traced]) }));
  const report = reported(r);
  assert.equal(r.status, 1);
  assert.equal(report.held, true);
  const holds = holdsOf(report, "every-scenario-is-traced");
  const h = holds.find((x) => text(x).includes("export-csv-downloads"));
  assert.ok(h, `a hold names export-csv-downloads: ${text(report.holds)}`);
  assert.match(text(h), /task/i, "the hold says the missing link is a task");
  assert.ok(!holds.some((x) => text(x).includes("export-csv-has-header")), "the traced scenario is not held");
  assert.match(r.out, /export-csv-downloads/, "the summary names the scenario");
});

test("[task-cites-an-unknown-scenario] a task citing an ID no scenario has holds the change", () => {
  const s = scenario("export-csv-downloads");
  const tasks = tasksText([s], ["- [x] 2.9 Add a PDF export. Verify with its scenario test. Covers: export-pdf. Touches: src/export-pdf.mjs"]);
  const r = check(sample({ scenarios: [s], tasks }));
  const report = reported(r);
  assert.equal(r.status, 1);
  assert.equal(report.held, true);
  const h = holdsOf(report, "every-scenario-is-traced").find((x) => text(x).includes("export-pdf"));
  assert.ok(h, `a hold names the unknown ID export-pdf: ${text(report.holds)}`);
  assert.match(text(h), /2\.9/, "the hold names the task");
});

test("[setup-task-needs-no-scenario] a Setup task with no Covers line is not reported", () => {
  const s = scenario("export-csv-downloads");
  const tasks = tasksText([s], ["- [x] 1.2 Add the export settings field. Setup: no scenario. Touches: src/config.mjs"]);
  const r = check(sample({ scenarios: [s], tasks, build: { "src/config.mjs": 'export const format = "csv";\n' } }));
  const report = reported(r);
  const mentions = [...(report.holds ?? []), ...(report.warnings ?? [])].filter((x) => /\b1\.2\b/.test(text(x)));
  assert.deepEqual(mentions, [], "nothing reports the Setup task");
  assert.equal(report.held, false, `an otherwise complete change is not held: ${text(report.holds)}`);
  assert.equal(r.status, 0);
});

test("[scenario-without-a-test] a scenario no test names holds the change and is named", () => {
  const tested = scenario("export-csv-has-header");
  const untested = scenario("export-csv-downloads");
  const r = check(sample({ scenarios: [untested, tested], tests: { [untested.testFile]: null } }));
  const report = reported(r);
  assert.equal(r.status, 1);
  assert.equal(report.held, true);
  const h = holdsOf(report, "every-scenario-is-traced").find((x) => text(x).includes("export-csv-downloads"));
  assert.ok(h, `a hold names export-csv-downloads: ${text(report.holds)}`);
  assert.match(text(h), /test/i, "the hold says the missing link is a test");
  assert.deepEqual(scenarioIn(report, "export-csv-downloads").tests, []);
  assert.ok(scenarioIn(report, "export-csv-has-header").tests.length > 0, "the tested scenario lists its test");
});

test("[test-cites-an-unknown-scenario] a test naming an ID no spec has holds the change", () => {
  const s = scenario("export-csv-downloads");
  const xlsx = [
    'import { test } from "node:test";',
    'import assert from "node:assert/strict";',
    `import { works } from "../../${s.file}";`,
    "",
    'test("[export-xlsx] downloads a spreadsheet", () => {',
    "  assert.equal(works(), true);",
    "});",
    "",
  ].join("\n");
  const r = check(sample({ scenarios: [s], tests: { "test/acceptance/export-xlsx.test.mjs": xlsx } }));
  const report = reported(r);
  assert.equal(r.status, 1);
  assert.equal(report.held, true);
  const holds = holdsOf(report, "every-scenario-is-traced");
  const h = holds.find((x) => text(x).includes("export-xlsx"));
  assert.ok(h, `a hold names the unknown ID export-xlsx: ${text(report.holds)}`);
  assert.match(text(h), /downloads a spreadsheet|export-xlsx\.test\.mjs/, "the hold names the test");
  assert.ok(!holds.some((x) => text(x).includes("sign-in-works")), "a test citing a scenario in the project's specs is not held");
});

// ---- scenario-tests-really-ran ----

test("[all-scenario-tests-ran] four scenarios with one test each report 4 of 4 ran", () => {
  const scenarios = ["export-csv-downloads", "export-csv-has-header", "export-empty-refused", "export-names-the-file"].map((id) => scenario(id));
  const r = check(sample({ scenarios }));
  const report = reported(r);
  assert.deepEqual({ expected: report.counts?.expected, ran: report.counts?.ran }, { expected: 4, ran: 4 });
  for (const s of scenarios) assert.equal(scenarioIn(report, s.id).ran, true, s.id);
  assert.match(r.out, /4 of 4/);
  assert.equal(report.held, false, text(report.holds));
  assert.equal(r.status, 0);
});

test("[a-scenario-test-did-not-run] a skipped scenario test holds the change at 3 of 4", () => {
  const scenarios = ["export-csv-downloads", "export-csv-has-header", "export-empty-refused", "export-names-the-file"].map((id) => scenario(id));
  const skipped = scenarios[2];
  const r = check(sample({ scenarios, tests: { [skipped.testFile]: skipped.test.replace("test(\"[", "test.skip(\"[") } }));
  const report = reported(r);
  assert.equal(r.status, 1);
  assert.equal(report.held, true);
  assert.deepEqual({ expected: report.counts?.expected, ran: report.counts?.ran }, { expected: 4, ran: 3 });
  assert.equal(scenarioIn(report, skipped.id).ran, false);
  const h = holdsOf(report, "scenario-tests-really-ran").find((x) => text(x).includes(skipped.id));
  assert.ok(h, `a hold names ${skipped.id}: ${text(report.holds)}`);
  assert.match(r.out, /3 of 4/);
});

// ---- tests-fail-first-then-pass ----

test("[fails-on-old-passes-on-new] a test that fails by assertion on the old code and passes now is proven", () => {
  const r = check(sample());
  const report = reported(r);
  const s = scenarioIn(report, "export-csv-downloads");
  assert.equal(s.failsFirst, true);
  assert.equal(s.passesNow, true);
  assert.equal(s.status, "proven");
  assert.equal(r.status, 0);
});

test("[passes-on-old-code-too] a test that already passes on the old code holds the change", () => {
  const s = scenario("export-csv-downloads", { stub: BUILT });
  const r = check(sample({ scenarios: [s] }));
  const report = reported(r);
  assert.equal(r.status, 1);
  assert.equal(scenarioIn(report, s.id).failsFirst, false);
  assert.notEqual(scenarioIn(report, s.id).status, "proven");
  const h = holdsOf(report, "tests-fail-first-then-pass").find((x) => text(x).includes(s.id));
  assert.ok(h, `a hold names ${s.id}: ${text(report.holds)}`);
  assert.match(text(h), /depend/i, "the hold says the test doesn't depend on the change");
});

test("[crash-is-not-a-real-failure] a test that only crashes on the old code does not count as failing first", () => {
  const s = scenario("export-csv-downloads");
  const r = check(sample({ scenarios: [s], starting: { [s.file]: null } }));
  const report = reported(r);
  assert.equal(r.status, 1);
  assert.equal(scenarioIn(report, s.id).failsFirst, false);
  assert.notEqual(scenarioIn(report, s.id).status, "proven");
  const h = holdsOf(report, "tests-fail-first-then-pass").find((x) => text(x).includes(s.id));
  assert.ok(h, `a hold names ${s.id}: ${text(report.holds)}`);
  assert.match(text(h), /assertion/i, "the hold asks for a test that reaches an assertion on the old code");
});

test("[fails-on-new-code] a test that fails on the latest commit holds the change and is named", () => {
  const s = scenario("export-csv-downloads", { built: STUB });
  const r = check(sample({ scenarios: [s] }));
  const report = reported(r);
  assert.equal(r.status, 1);
  assert.equal(report.held, true);
  assert.equal(scenarioIn(report, s.id).passesNow, false);
  const h = holdsOf(report, "tests-fail-first-then-pass").find((x) => text(x).includes(s.id));
  assert.ok(h, `a hold names ${s.id}: ${text(report.holds)}`);
  assert.match(text(h), /\[export-csv-downloads\] export-csv-downloads works|export-csv-downloads\.test\.mjs/, "the hold names the failing test");
});

// ---- locked-acceptance-tests-stay-locked ----

test("[builder-edits-a-locked-test] an edit to a locked test with no Spec-Change line holds the change", () => {
  const s = scenario("export-csv-downloads");
  const edited = s.test.replace("assert.equal(works(), true);", "assert.notEqual(works(), undefined);");
  const repo = sample({ scenarios: [s], later: [{ message: "Make the export test pass", files: { [s.testFile]: edited } }] });
  const r = check(repo);
  const report = reported(r);
  assert.equal(r.status, 1);
  assert.equal(report.held, true);
  const h = holdsOf(report, "locked-acceptance-tests-stay-locked").find((x) => text(x).includes(s.testFile));
  assert.ok(h, `a hold names ${s.testFile}: ${text(report.holds)}`);
  assert.ok(text(h).includes(repo.commits[0].slice(0, 7)), "the hold names the commit");
});

test("[spec-change-allows-the-edit] an edit to a locked test with a Spec-Change line is allowed and listed", () => {
  const s = scenario("export-csv-downloads");
  const edited = s.test.replace("assert.equal(works(), true);", 'assert.equal(works(), true, "the export works");');
  const repo = sample({
    scenarios: [s],
    later: [{ message: "Say what the export test checks\n\nSpec-Change: clarify-export-messages", files: { [s.testFile]: edited } }],
  });
  const r = check(repo);
  const report = reported(r);
  const sha = repo.commits[0].slice(0, 7);
  assert.ok(!holdsOf(report, "locked-acceptance-tests-stay-locked").some((x) => text(x).includes(s.testFile)), `the edit is not held: ${text(report.holds)}`);
  const listed = entries(report).find((e) => text(e).includes(s.testFile) && text(e).includes(sha));
  assert.ok(listed, "the report lists the edit, with its commit and file, as allowed");
  assert.equal(report.held, false, text(report.holds));
});

test("[a-test-is-weakened-or-skipped] skipping, deleting or weakening an existing test holds the change", () => {
  const ways = {
    skipped: ACCOUNTS_TEST.replace('test("[sign-in-works]', 'test.skip("[sign-in-works]'),
    deleted: null,
    "assertion removed": ACCOUNTS_TEST.replace('  assert.equal(user.name, "ada");\n', ""),
  };
  for (const [way, content] of Object.entries(ways)) {
    const r = check(sample({ later: [{ message: "Tidy the account tests", files: { "test/accounts.test.mjs": content } }] }));
    const report = reported(r);
    assert.equal(r.status, 1, way);
    assert.equal(report.held, true, way);
    const h = holdsOf(report, "locked-acceptance-tests-stay-locked").find((x) => /sign-in-works|test\/accounts\.test\.mjs/.test(text(x)));
    assert.ok(h, `${way}: a hold names the test: ${text(report.holds)}`);
  }
});

// ---- nothing-built-outside-the-spec ----

test("[unexplained-file-is-listed] a changed file no task declares is a warning, not a hold", () => {
  const r = check(sample({ starting: { "src/billing.ts": 'export const plan = "basic";\n' }, build: { "src/billing.ts": 'export const plan = "pro";\n' } }));
  const report = reported(r);
  assert.ok(warningsOf(report, "nothing-built-outside-the-spec").some((w) => w.file === "src/billing.ts"), `src/billing.ts is listed: ${text(report.warnings)}`);
  assert.ok(!(report.holds ?? []).some((h) => text(h).includes("src/billing.ts")), "it is not a hold");
  assert.equal(report.held, false, text(report.holds));
  assert.equal(r.status, 0);
});

test("[declared-file-is-not-listed] a changed file a task declares is not listed", () => {
  const s = scenario("export-csv-downloads", { file: "src/export.ts" });
  const r = check(sample({ scenarios: [s] }));
  const report = reported(r);
  assert.ok(Array.isArray(report.warnings), "the report has a warnings list");
  assert.ok(!warningsOf(report, "nothing-built-outside-the-spec").some((w) => text(w).includes("src/export.ts")), text(report.warnings));
});

// ---- spec-matches-what-was-approved ----

test("[spec-edited-after-approval] a THEN line edited after approval holds the change and shows the edit", () => {
  const s = scenario("export-csv-downloads");
  const edited = specText([s]).replace("- **THEN** export-csv-downloads works", "- **THEN** export-csv-downloads works for every row");
  const r = check(sample({ scenarios: [s], later: [{ message: "Tighten the spec", files: { [SPEC]: edited } }] }));
  const report = reported(r);
  assert.equal(r.status, 1);
  assert.equal(report.held, true);
  const h = holdsOf(report, "spec-matches-what-was-approved")[0];
  assert.ok(h, `a hold says the spec changed: ${text(report.holds)}`);
  assert.match(text(h), /approv/i, "it says the spec needs approval again");
  assert.match(text(h), /for every row/, "it shows the edited line");
});

// ---- tests-exercise-their-code ----

// Line 2 holds the condition a break flips; both sides of it are tested.
const SEATS_CAUGHT = scenario("seat-refused-at-limit", {
  file: "src/seats.ts",
  stub: "export function addSeat(team) {\n  return team;\n}\n",
  built: [
    "export function addSeat(team) {",
    "  if (team.used >= team.limit) return { ...team, refused: true };",
    "  return { ...team, used: team.used + 1 };",
    "}",
    "",
  ].join("\n"),
  test: [
    'import { test } from "node:test";',
    'import assert from "node:assert/strict";',
    'import { addSeat } from "../../src/seats.ts";',
    "",
    'test("[seat-refused-at-limit] a full team is refused another seat", () => {',
    "  assert.equal(addSeat({ used: 3, limit: 3 }).refused, true);",
    "  assert.equal(addSeat({ used: 2, limit: 3 }).used, 3);",
    "});",
    "",
  ].join("\n"),
});

// Line 1 holds a limit no test reaches: moving it by one changes nothing a test sees.
const SEATS_UNNOTICED = scenario("seat-added-under-limit", {
  file: "src/seats.ts",
  stub: "export function canAddSeat(used) {\n  return false;\n}\n",
  built: [
    "const MAX_SEATS = 10;",
    "export function canAddSeat(used) {",
    "  return used < MAX_SEATS;",
    "}",
    "",
  ].join("\n"),
  test: [
    'import { test } from "node:test";',
    'import assert from "node:assert/strict";',
    'import { canAddSeat } from "../../src/seats.ts";',
    "",
    'test("[seat-added-under-limit] a team under the limit can add a seat", () => {',
    "  assert.equal(canAddSeat(3), true);",
    "});",
    "",
  ].join("\n"),
});

test("[break-is-caught] on the high-risk lane, a flipped condition a test notices marks the line covered", () => {
  const repo = sample({ scenarios: [SEATS_CAUGHT] });
  const r = check(repo, "--lane", "high-risk");
  const report = reported(r);
  assert.equal(report.lane, "high-risk");
  assert.deepEqual(holdsOf(report, "tests-exercise-their-code"), []);
  const line = entries(report).find((e) => e.file === "src/seats.ts" && e.line === 2);
  assert.ok(line, "the report has an entry for src/seats.ts line 2");
  assert.match(text(line), /covered/i, "it marks the line as covered");
  assert.equal(read(join(repo.dir, "src/seats.ts")), SEATS_CAUGHT.built, "the file is put back exactly");
});

test("[break-goes-unnoticed] on the high-risk lane, a limit moved by one that no test notices holds the change", () => {
  const repo = sample({ scenarios: [SEATS_UNNOTICED] });
  const r = check(repo, "--lane", "high-risk");
  const report = reported(r);
  assert.equal(r.status, 1);
  assert.equal(report.held, true);
  const h = holdsOf(report, "tests-exercise-their-code").find((x) => x.file === "src/seats.ts" && x.line === 1);
  assert.ok(h, `a hold names src/seats.ts line 1: ${text(report.holds)}`);
  assert.match(text(h), /\b(9|11)\b/, "it names the break: the limit moved to 9 or 11");
  assert.equal(read(join(repo.dir, "src/seats.ts")), SEATS_UNNOTICED.built, "the file is put back exactly");
});

test("[normal-lane-skips-the-breaks] on the normal lane no line is broken and the report says so", () => {
  const repo = sample({ scenarios: [SEATS_UNNOTICED] });
  const r = check(repo, "--lane", "normal");
  const report = reported(r);
  assert.equal(report.lane, "normal");
  assert.deepEqual(holdsOf(report, "tests-exercise-their-code"), [], "a break that would go unnoticed is never tried");
  assert.equal(report.timeMs?.breaks, 0);
  assert.match(`${text(report)}\n${r.out}`, /skipped/i, "the report says the check was skipped for the lane");
  assert.equal(report.held, false, text(report.holds));
  assert.equal(r.status, 0);
});

// ---- spec-match-review ----
// The reviewer is a model, so code checks its brief and how pr-review routes its
// answer. Its live judgement is checked by the live run in task 7.1.

const brief = join(prReview, "spec-match-brief.md");

test("[test-checks-something-else] the spec-match brief asks for a per-scenario verdict and the unchecked part of the THEN line", () => {
  assert.ok(existsSync(brief), "pr-review has a spec-match-brief.md");
  const t = read(brief);
  for (const verdict of ["matches", "partly", "missing"]) assert.match(t, new RegExp(`\\b${verdict}\\b`), `the brief offers "${verdict}"`);
  assert.match(t, /THEN line/, "the brief talks about THEN lines");
  assert.match(t, /unchecked|not checked/i, "a finding says which part is unchecked");
  for (const part of [/what breaks/i, /for whom/i, /how likely/i, /cost to fix/i]) assert.match(t, part, `each finding states ${part.source}`);
});

test("[reviewer-never-sees-the-description] the spec-match reviewer gets the specs, tasks, change, tests and report, never the description", () => {
  assert.ok(existsSync(brief), "pr-review has a spec-match-brief.md");
  const t = read(brief);
  for (const input of [/spec/i, /tasks?\.md|task list/i, /change\.patch|the change/i, /tests?/i, /compliance\.json|compliance report/i]) {
    assert.match(t, input, `the brief gives the reviewer ${input.source}`);
  }
  assert.doesNotMatch(t, /pr\.md/, "the brief never points at the pull request description file");
  for (const line of t.split("\n").filter((l) => /description/i.test(l))) {
    assert.match(line, /\b(never|not|no)\b/i, `a line about the description only says it is withheld: "${line.trim()}"`);
  }
  const skill = read(join(prReview, "SKILL.md"));
  assert.match(skill, /spec-match-brief\.md/, "pr-review starts the spec-match reviewer");
  assert.match(skill, /high-risk/i, "pr-review says which lanes run it");
});

test("[spec-looks-wrong] a finding that the spec looks wrong sends the change back to approval, not to the build", () => {
  assert.ok(existsSync(brief), "pr-review has a spec-match-brief.md");
  assert.match(read(brief), /spec (itself )?(looks|is|seems) wrong/i, "the reviewer can report that the spec looks wrong");
  const skill = read(join(prReview, "SKILL.md"));
  const routing = skill.split("\n").filter((l) => /spec (itself )?(looks|is|seems) wrong/i.test(l));
  assert.ok(routing.length, "pr-review says what happens to a spec-looks-wrong finding");
  assert.ok(routing.some((l) => /approval/i.test(l)), `such a finding goes back to the spec approval step: ${routing.join(" | ")}`);
});

// ---- executable-specs-when-turned-on ----
// The design names only the tool and the command. These samples bind steps the way
// most step-binding tools do: the step's exact text in quotes, inside a step file.

const STEPS_SCENARIO = scenario("seat-refused-at-limit", {
  ...SEATS_CAUGHT,
  given: "a team using 3 of its 3 seats", when: "the team adds a seat", then: "the seat is refused",
});
const REGISTRY = [
  "// Step bindings: each step line's text and the code that runs it.",
  "export const steps = new Map();",
  "export const Given = (text, run) => steps.set(text, run);",
  "export const When = Given;",
  "export const Then = Given;",
  "",
].join("\n");
const RUNNER = [
  "// Runs the scenarios named in the first argument, one bound step at a time.",
  'import { readFileSync } from "node:fs";',
  'import { steps } from "./registry.mjs";',
  'import "./seats.steps.mjs";',
  "",
  'const name = process.argv[2] ?? "";',
  `const spec = readFileSync(${JSON.stringify(SPEC)}, "utf8");`,
  "let failed = 0;",
  'for (const block of spec.split(/^#### Scenario: /m).slice(1)) {',
  '  const id = block.split("\\n")[0].trim();',
  "  if (name && !name.includes(`[${id}]`)) continue;",
  "  const world = {};",
  "  try {",
  "    for (const m of block.matchAll(/^- \\*\\*(?:GIVEN|WHEN|THEN|AND)\\*\\* (.+)$/gm)) {",
  "      const step = steps.get(m[1].trim());",
  "      if (!step) throw new Error(`no binding for: ${m[1]}`);",
  "      step(world);",
  "    }",
  "    console.log(`ok [${id}]`);",
  "  } catch (e) {",
  "    failed++;",
  "    console.log(`not ok [${id}] ${e.message}`);",
  "  }",
  "}",
  "process.exit(failed ? 1 : 0);",
  "",
].join("\n");
const STEPS_ON = { ...SETTINGS, tests: { ...SETTINGS.tests, acceptance: ["test/acceptance/**", "steps/**"] }, executableSpecs: { tool: "sample-steps", command: 'node steps/run.mjs "{name}"' } };

function stepsSample(thenBinding) {
  const bindings = [
    'import assert from "node:assert/strict";',
    'import { Given, When, Then } from "./registry.mjs";',
    'import { addSeat } from "../src/seats.ts";',
    "",
    'Given("a team using 3 of its 3 seats", (w) => { w.team = { used: 3, limit: 3 }; });',
    'When("the team adds a seat", (w) => { w.after = addSeat(w.team); });',
    ...(thenBinding ? [thenBinding] : []),
    "",
  ].join("\n");
  return sample({
    scenarios: [STEPS_SCENARIO],
    settings: STEPS_ON,
    tests: { [STEPS_SCENARIO.testFile]: null, "steps/registry.mjs": REGISTRY, "steps/run.mjs": RUNNER, "steps/seats.steps.mjs": bindings },
  });
}

test("[unbound-then-line] with executable specs on, a THEN line with no binding holds the change and is named", () => {
  const r = check(stepsSample(null));
  const report = reported(r);
  assert.equal(r.status, 1);
  assert.equal(report.held, true);
  const h = holdsOf(report, "executable-specs-when-turned-on").find((x) => text(x).includes("the seat is refused"));
  assert.ok(h, `a hold names the unbound THEN line: ${text(report.holds)}`);
});

test("[binding-without-an-assertion] with executable specs on, a THEN binding that asserts nothing holds the change", () => {
  const r = check(stepsSample('Then("the seat is refused", (w) => { w.after; });'));
  const report = reported(r);
  assert.equal(r.status, 1);
  assert.equal(report.held, true);
  const h = holdsOf(report, "executable-specs-when-turned-on").find((x) => text(x).includes("steps/seats.steps.mjs"));
  assert.ok(h, `a hold names the binding and its file: ${text(report.holds)}`);
  assert.match(text(h), /the seat is refused/, "it names the step the binding is for");
});

test("[setting-off-changes-nothing] with executable specs off, the check uses named tests and never asks for bindings", () => {
  const r = check(sample());
  const report = reported(r);
  assert.ok(scenarioIn(report, "export-csv-downloads").tests.some((t) => t.includes("[export-csv-downloads]")), "the scenario's tests are the ones named with its ID");
  assert.doesNotMatch(`${text(report)}\n${r.out}`, /binding/i, "nothing asks for bindings");
  assert.equal(report.held, false, text(report.holds));
});

// ---- each-run-is-measured ----

test("[record-has-the-numbers] the run's record shows scenarios checked, holds by check, reviewer mismatches and time per part", () => {
  const tested = scenario("export-csv-has-header");
  const untested = scenario("export-csv-downloads");
  const r = check(sample({ scenarios: [untested, tested], tests: { [untested.testFile]: null } }));
  const report = reported(r);
  assert.equal(report.counts?.expected, 2, "scenarios checked");
  assert.ok(report.holds.length > 0, "this run has a hold to count");
  for (const h of report.holds) assert.ok(REQUIREMENTS.includes(h.check), `each hold names the check that made it: ${text(h)}`);
  const keys = [...Object.keys(report), ...entries(report).flatMap((e) => Object.keys(e))];
  assert.ok(keys.some((k) => /mismatch/i.test(k)), "the record has a place for the reviewer's mismatches");
  for (const part of ["trace", "run", "breaks"]) assert.ok(Number.isFinite(report.timeMs?.[part]), `time spent on ${part}`);
});

// ---- works-in-any-project ----

function assertComplete(r, repo, count) {
  const report = reported(r);
  assert.equal(report.change, repo.change);
  assert.ok(report.commit && repo.head.startsWith(report.commit), "the report names the latest commit");
  assert.ok(report.base && repo.base.startsWith(report.base), "the report names the starting commit");
  assert.equal(report.lane, "normal");
  assert.equal(report.scenarios.length, count);
  for (const s of report.scenarios) {
    assert.ok(repo.ids.includes(s.id), `${s.id} is a scenario in the sample`);
    assert.ok(s.tasks.length > 0 && s.tests.length > 0, `${s.id} is traced to a task and a test`);
    assert.deepEqual([s.ran, s.failsFirst, s.passesNow, s.status], [true, true, true, "proven"], s.id);
  }
  assert.deepEqual({ expected: report.counts?.expected, ran: report.counts?.ran }, { expected: count, ran: count });
  assert.deepEqual(report.holds, []);
  assert.ok(Array.isArray(report.warnings));
  for (const part of ["trace", "run", "breaks"]) assert.ok(Number.isFinite(report.timeMs?.[part]), `time spent on ${part}`);
  assert.equal(report.held, false);
  assert.equal(r.status, 0);
  assert.match(r.out, /\S/, "it prints a summary");
}

test("[typescript-sample] the check gives a complete report on the TypeScript sample", () => {
  const repo = fromFixture("typescript");
  assertComplete(check(repo, "--lane", "normal"), repo, 3);
});

test("[python-sample] the check gives a complete report on the Python sample", () => {
  const repo = fromFixture("python");
  assertComplete(check(repo, "--lane", "normal"), repo, 2);
});

test("[no-framework-names-in-the-code] the check's source names no project, test framework or language", () => {
  assert.ok(existsSync(script), "the check exists at scripts/spec-compliance.mjs");
  const sources = [script, ...["compliance.mjs", "breaks.mjs"].map((f) => join(plugin, "scripts", "lib", f)).filter(existsSync)];
  const NAMES = /\b(precordia|onehearthealth|smsmarketing|investfest|rebellion|labeling-app|patient-mobile|vitest|jest|mocha|pytest|unittest|cucumber|playwright|maestro|bun|typescript|python|ruby|golang|java)\b/i;
  for (const file of sources) {
    const hit = read(file).match(NAMES);
    assert.equal(hit, null, `${file} names "${hit?.[0]}". Names belong in a project's settings, not the check.`);
  }
});
