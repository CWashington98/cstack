// The test run fails when a test leaves a temp folder behind, and tempDir() prevents that.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tempDir } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// NODE_TEST_CONTEXT makes a nested `node --test` act as one of this run's own workers instead of a fresh run.
const env = () => ({ ...process.env, NODE_TEST_CONTEXT: undefined, TMPDIR: tempDir("temp-check") });
const run = (fixture) => spawnSync(process.execPath, [join(here, "run.mjs"), join(here, "fixtures", "temp-leak", fixture)], { encoding: "utf8", env: env() });

test("a run fails and names the folder when a test leaves one behind", () => {
  const result = run("leaks.fixture.mjs");
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /Temp folder check FAILED: the tests left 1 entry behind: planted-leak-/);
});

test("a run passes when every test folder was made with tempDir", () => {
  const result = run("clean.fixture.mjs");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Temp folder check passed/);
});

test("tempDir makes a folder with the prefix and removes it when the process ends", () => {
  const script = `import { tempDir } from ${JSON.stringify(join(here, "helpers.mjs"))}; console.log(tempDir("prefix-test"));`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", env: env() });
  const made = result.stdout.trim();
  assert.match(made, /prefix-test-[A-Za-z0-9]{6}$/);
  assert.equal(existsSync(made), false);
});
