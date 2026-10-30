// The test run fails when a test leaves a temp folder behind, and tempDir() prevents that.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tempDir, removeTree } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// NODE_TEST_CONTEXT makes a nested `node --test` act as one of this run's own workers instead of a fresh run.
const env = (tmp) => ({ ...process.env, NODE_TEST_CONTEXT: undefined, TMPDIR: tmp });
// Runs tests/run.mjs on one fixture. `tmp` is the whole temp folder the run sees, and must be empty again afterwards.
function run(fixture) {
  const tmp = tempDir("temp-check");
  const result = spawnSync(process.execPath, [join(here, "run.mjs"), join(here, "fixtures", "temp-leak", fixture)], { encoding: "utf8", env: env(tmp) });
  assert.deepEqual(readdirSync(tmp), [], "the runner must delete its own private temp folder");
  return result;
}

test("a run fails and names the folder when a test leaves one behind", () => {
  const result = run("leaks.fixture.mjs");
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /Temp folder check FAILED: the tests left 1 entry behind: planted-leak-/);
});

test("a run still fails, with the folder named, when the leftover is read-only", () => {
  const result = run("read-only.fixture.mjs");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Temp folder check FAILED: the tests left 1 entry behind: read-only-leak-/);
});

test("a run passes when every test folder was made with tempDir", () => {
  const result = run("clean.fixture.mjs");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Temp folder check passed/);
});

test("a failing test still fails the run, even when no folder is left behind", () => {
  const result = run("failing.fixture.mjs");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /Temp folder check passed/);
});

test("tempDir makes a folder with the prefix and removes it when the process ends", () => {
  const script = `import { tempDir } from ${JSON.stringify(join(here, "helpers.mjs"))}; console.log(tempDir("prefix-test"));`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", env: env(tempDir("temp-check")) });
  const made = result.stdout.trim();
  assert.match(made, /prefix-test-[A-Za-z0-9]{6}$/);
  assert.equal(existsSync(made), false);
});

test("removeTree deletes a folder that holds a read-only folder", () => {
  const dir = tempDir("remove-tree");
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "file.txt"), "x");
  chmodSync(join(dir, "sub"), 0o500);
  removeTree(dir);
  assert.equal(existsSync(dir), false);
});
