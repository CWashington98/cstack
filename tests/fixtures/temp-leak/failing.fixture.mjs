// Run by temp-check.test.mjs, never by npm test. A test that fails and leaves nothing behind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tempDir } from "../../helpers.mjs";

test("fails on purpose", () => {
  tempDir("failing-case");
  assert.equal(1, 2);
});
