import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeRepo } from "../../../tests/helpers.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "plain-check.mjs");
const files = {
  ".claude/plain.json": "{}",
  "bad.md": "BLUF: A1 is READY.\n",
  "good.md": "This adds the map page. It loads and passes its tests.\n",
};

test("the checker holds problem text with exit 1 and passes clean text with exit 0", () => {
  const dir = makeRepo(files);
  const run = (f, ...extra) => spawnSync(process.execPath, [script, f, ...extra], { cwd: dir, encoding: "utf8" });
  const bad = run("bad.md");
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /Held: 3 problem/);
  const good = run("good.md");
  assert.equal(good.status, 0);
  assert.match(good.stdout, /^Passes/m);
  assert.equal(run("missing.md").status, 2);
});

test("--json prints the findings for scripts", () => {
  const dir = makeRepo(files);
  const out = spawnSync(process.execPath, [script, "bad.md", "--json"], { cwd: dir, encoding: "utf8" });
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.held, true);
  assert.deepEqual(parsed.findings.map((f) => f.text), ["BLUF", "A1", "READY"]);
});
