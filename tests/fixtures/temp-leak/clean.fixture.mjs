// Run by temp-check.test.mjs, never by npm test. Makes temp folders the way every test should.
import { test } from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../helpers.mjs";

test("makes temp folders through tempDir", () => {
  writeFileSync(join(tempDir("kept-clean"), "file.txt"), "x");
  tempDir("kept-clean");
});
