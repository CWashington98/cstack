// Run by temp-check.test.mjs, never by npm test. Makes a temp folder and forgets it.
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("makes a temp folder and does not delete it", () => {
  mkdtempSync(join(tmpdir(), "planted-leak-"));
});
