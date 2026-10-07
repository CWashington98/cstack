import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeRepo } from "../../../tests/helpers.mjs";
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
