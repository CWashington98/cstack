// Run by temp-check.test.mjs, never by npm test. Leaves a folder that cannot be deleted without chmod.
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("leaves a read-only folder behind", () => {
  const dir = mkdtempSync(join(tmpdir(), "read-only-leak-"));
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "file.txt"), "x");
  chmodSync(join(dir, "sub"), 0o500);
});
