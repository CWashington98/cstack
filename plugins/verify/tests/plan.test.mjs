import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { makeRepo, git } from "../../../tests/helpers.mjs";
import { proseLines } from "../scripts/lib/markdown.mjs";
import { checkFile } from "../scripts/lib/plan.mjs";
import { parseArgs } from "../scripts/lib/args.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "verify-plan.mjs");
const check = (raw, root = makeRepo()) => checkFile(raw, { file: join(root, "doc.md"), root });
const messages = (r) => r.findings.map((f) => f.message).join("\n");

const GOOD_SCENARIO = [
  "#### Scenario: a rater plays a recording",
  "- GIVEN a rater opens a patient",
  "- WHEN they press play",
  "- THEN they hear the real sound",
  "- Proved by: live in the app (feature `recordings`, sub-feature `play`);",
  "  evidence: a recording of the press, plus a read-back of the audio bytes;",
  "  pass when the bytes match the stored file.",
  "",
].join("\n");

test("a scenario with a full Proved by line passes", () => {
  const r = check(GOOD_SCENARIO);
  assert.equal(r.held, false, messages(r));
  assert.equal(r.scenarios, 1);
});

test("flags a scenario with no Proved by line", () => {
  const r = check("#### Scenario: export works\n- GIVEN x\n- THEN y\n");
  assert.match(messages(r), /Scenario "export works" has no "Proved by" line/);
});

test("flags a Proved by line with no evidence or no pass condition", () => {
  const r = check("#### Scenario: s\n- Proved by: unit test in export.test.ts\n");
  assert.match(messages(r), /names no evidence/);
  assert.match(messages(r), /says no pass condition/);
});

test("a Proved by line under the next scenario does not count for this one", () => {
  const r = check("#### Scenario: first\n- THEN y\n\n" + GOOD_SCENARIO);
  assert.match(messages(r), /Scenario "first" has no "Proved by" line/);
});

test("lines inside fenced code are ignored, including four-backtick fences around three-backtick ones", () => {
  const raw = ["````markdown", "```js", "#### Scenario: inside a fence", "```", "````", "", GOOD_SCENARIO].join("\n");
  const lines = proseLines(raw);
  assert.ok(!lines.some((l) => l.text.includes("inside a fence")));
  assert.equal(check(raw).scenarios, 1);
});

test("Windows line endings are read the same way", () => {
  assert.equal(check(GOOD_SCENARIO.replace(/\n/g, "\r\n")).held, false);
});

test("a file with nothing to check is held rather than passed", () => {
  const r = check("# Notes\n\nJust prose.\n");
  assert.equal(r.held, true);
  assert.match(messages(r), /nothing to check/);
});

test("parseArgs collects list options up to the next option, and repeated ones", () => {
  const a = parseArgs(["run", "--source", "a.wav", "b.wav", "--body", "x.bin", "--source", "c.wav", "--json"], { flags: ["json"], lists: ["source", "body"] });
  assert.deepEqual(a, { _: ["run"], source: ["a.wav", "b.wav", "c.wav"], body: ["x.bin"], json: true });
  assert.throws(() => parseArgs(["--since"]), /needs a value/);
});

test("the command exits 0 on a pass, 1 on a hold and 2 on a missing file", () => {
  const dir = makeRepo({ "good.md": GOOD_SCENARIO, "bad.md": "#### Scenario: s\n" });
  const run = (f) => spawnSync("node", [script, join(dir, f)], { encoding: "utf8" });
  assert.equal(run("good.md").status, 0);
  assert.equal(run("bad.md").status, 1);
  assert.equal(run("missing.md").status, 2);
});

const item = (ticked, evidence) => `- [${ticked ? "x" : " "}] **Step 1: do it.** Evidence: ${evidence}\n`;
const DONE = "**Done when:** all 1 tasks merged.\n- [ ] **Verify unit:** tests. Evidence: commit\n- [ ] **Verify live:** none: no user-facing behavior. Evidence: commit\n";
const plan = (body) => `# Plan\n\n${DONE}\n${body}`;

test("flags a plan item that names no evidence", () => {
  const r = check(plan("- [ ] **Step 1: write the code.**\n"));
  assert.match(messages(r), /names no evidence/);
});

test("an unticked item may name evidence that does not exist yet", () => {
  const r = check(plan(item(false, 'test tests/a.test.mjs "adds"; file docs/x.md; commit')));
  assert.equal(r.held, false, messages(r));
});

test("a ticked plan item whose evidence file doesn't exist is held", () => {
  const r = check(plan(item(true, "file docs/missing.md")));
  assert.match(messages(r), /docs\/missing\.md does not exist/);
});

test("a ticked test item needs the file to contain the test name", () => {
  const root = makeRepo({ "tests/a.test.mjs": 'test("adds two numbers", () => {});\n' });
  assert.equal(check(plan(item(true, 'test tests/a.test.mjs "adds two numbers"')), root).held, false);
  assert.match(messages(check(plan(item(true, 'test tests/a.test.mjs "subtracts"')), root)), /does not contain "subtracts"/);
});

test("a ticked commit item needs a commit ID that exists", () => {
  const root = makeRepo({ "a.txt": "a" });
  git(root, "add", "."); git(root, "commit", "-qm", "a");
  const sha = git(root, "rev-parse", "HEAD").trim();
  assert.equal(check(plan(item(true, `commit ${sha.slice(0, 10)}`)), root).held, false);
  assert.match(messages(check(plan(item(true, "commit")), root)), /names no commit ID/);
  assert.match(messages(check(plan(item(true, "commit 0123456789")), root)), /is not a commit/);
});

test("ticked screenshot, log, run and link items are checked", () => {
  const root = makeRepo({ "shots/after.png": "x", "out.log": "# fail 0\n", "shots/notes.txt": "x" });
  mkdirSync(join(root, "runs", "r1"), { recursive: true });
  writeFileSync(join(root, "runs", "r1", "run.json"), JSON.stringify({ status: "verified live" }));
  const ok = [ "screenshot shots/after.png", 'log out.log "# fail 0"', "run runs", "link https://github.com/o/r/pull/1" ];
  for (const e of ok) assert.equal(check(plan(item(true, e)), root).held, false, e);
  assert.match(messages(check(plan(item(true, "screenshot shots/notes.txt")), root)), /not an image or video/);
  assert.match(messages(check(plan(item(true, 'log out.log "# fail 1"')), root)), /does not contain/);
  assert.match(messages(check(plan(item(true, "link github.com/x")), root)), /full https:\/\/ address/);
});

test("evidence paths resolve from the repository root, and ~/ means the home folder", () => {
  const root = makeRepo({ "docs/plans/p.md": "", "src/a.js": "x" });
  const r = checkFile(plan(item(true, "file src/a.js")), { file: join(root, "docs/plans/p.md"), root });
  assert.equal(r.held, false, messages(r));
  assert.equal(check(plan(item(true, "file ~/")), root).held, false);
});

test("an unknown evidence kind is held", () => {
  assert.match(messages(check(plan(item(false, "vibes it works")))), /unknown evidence kind "vibes"/);
});

test("checkbox examples inside fenced code are not plan items", () => {
  const r = check(plan("````markdown\n- [ ] **Step 1: example.**\n````\n" + item(false, "commit")));
  assert.equal(r.items, 3); // the two proof boxes and the one real item
});

test("a plan with no proof boxes is held", () => {
  const r = check("**Done when:** all 2 tasks merged.\n" + item(false, "commit"));
  assert.match(messages(r), /no "Verify unit" box/);
  assert.match(messages(r), /no "Verify live" box/);
});

test("each pull request section needs its own proof boxes", () => {
  const raw = [
    "**Done when:** all 2 pull requests merged.", "",
    "## Pull request 1: backend", DONE.split("\n").slice(1).join("\n"), item(false, "commit"),
    "## Pull request 2: screens", item(false, "commit"),
  ].join("\n");
  assert.match(messages(check(raw)), /Pull request section "Pull request 2: screens" has no "Verify unit" box/);
});

test("Verify live: none needs a reason", () => {
  const raw = "**Done when:** all 1 tasks merged.\n- [ ] **Verify unit:** tests. Evidence: commit\n- [ ] **Verify live:** none. Evidence: commit\n";
  assert.match(messages(check(raw)), /says none without a reason/);
});

test("a plan without a countable done condition is held", () => {
  const body = DONE.split("\n").slice(1).join("\n") + item(false, "commit");
  assert.match(messages(check(body)), /has no "Done when:" line/);
  assert.match(messages(check("**Done when:** everything works.\n" + body)), /has no count/);
});

test("a done condition relaxed after work started is held", () => {
  const root = makeRepo({ "plan.md": plan(item(false, "commit")) });
  git(root, "add", "."); git(root, "commit", "-qm", "plan");
  const relaxed = plan(item(false, "commit")).replace("all 1 tasks merged", "most of the 1 tasks merged");
  const r = checkFile(relaxed, { file: join(root, "plan.md"), root, since: "HEAD" });
  assert.match(messages(r), /done condition changed since HEAD/);
  assert.equal(checkFile(plan(item(false, "commit")), { file: join(root, "plan.md"), root, since: "HEAD" }).held, false);
});

test("a spec with only scenarios needs no proof boxes or done line", () => {
  assert.equal(check(GOOD_SCENARIO).held, false);
});
