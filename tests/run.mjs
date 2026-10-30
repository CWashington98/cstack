// Runs the test suite in its own empty temp folder and fails if the suite leaves anything in it.
// `npm test` goes through here. Name test files after `--` to run only those.
//
// The tests think their temp folder is the machine's ($TMPDIR on macOS and Linux), so a leak shows up
// as something left behind in the private folder. Starting empty means the count needs no "before" number,
// and other programs using the real temp folder at the same time cannot cause a false alarm.
import { mkdtempSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { removeTree } from "./helpers.mjs";

const DEFAULT_TESTS = ["tests/*.test.mjs", "plugins/*/tests/*.test.mjs"];
const SHOWN = 20;

const given = process.argv.slice(2).filter((arg) => arg !== "--");
const tests = given.length ? given : DEFAULT_TESTS;

const scratch = mkdtempSync(join(realpathSync(tmpdir()), "cstack-test-run-"));
const child = spawn(process.execPath, ["--test", ...tests], { stdio: "inherit", env: { ...process.env, TMPDIR: scratch } });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));

child.on("exit", (status, signal) => {
  const left = readdirSync(scratch).sort();
  try { removeTree(scratch); } catch (error) { console.error(`Could not delete ${scratch}: ${error.message}`); }
  if (left.length) {
    const names = left.slice(0, SHOWN).join(", ") + (left.length > SHOWN ? `, and ${left.length - SHOWN} more` : "");
    console.error(`\nTemp folder check FAILED: the tests left ${left.length} entr${left.length === 1 ? "y" : "ies"} behind: ${names}`);
    console.error("Create temp folders in tests with tempDir() from tests/helpers.mjs, which deletes them when the test file ends.");
  } else {
    console.log("\nTemp folder check passed: the tests left nothing behind.");
  }
  process.exit(left.length ? 1 : status ?? (signal ? 1 : 0));
});
