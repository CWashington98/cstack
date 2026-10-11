import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { candidateBreaks, changedLines, dirtyFiles } from "../scripts/lib/breaks.mjs";

const texts = (line) => candidateBreaks(line).map((b) => b.text);

test("a comparison is flipped and a number moved by one", () => {
  assert.deepEqual(texts("  if (a >= b) return;"), ["  if (a < b) return;"]);
  assert.deepEqual(texts("const MAX = 10;"), ["const MAX = 11;", "const MAX = 9;"]);
  assert.deepEqual(texts("ok = a && b;"), ["ok = a || b;"]);
  assert.deepEqual(texts("if a and b:"), ["if a or b:"]);
});

test("arrows, generics, comments and quoted text are left alone", () => {
  assert.deepEqual(texts("const f = (x) => x;"), []);
  assert.deepEqual(texts("const m: Map<string, number> = new Map();"), []);
  assert.deepEqual(texts("// limit is 10 and a >= b"), []);
  assert.deepEqual(texts('const s = "a >= 10";'), []);
  assert.deepEqual(texts("x = y.v2 + 1.5;"), []);
});

test("a line with a written reason is not broken", () => {
  assert.deepEqual(texts("const MAX = 10; // break-ok: display only"), []);
});

test("changed lines are numbered from 1 in the new file; uncommitted work is seen", () => {
  const dir = mkdtempSync(join(tmpdir(), "breaks-"));
  const g = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir, stdio: "pipe" });
  g("init", "-q");
  writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
  g("add", "."); g("commit", "-qm", "base");
  writeFileSync(join(dir, "a.txt"), "one\nTWO\nthree\n");
  g("commit", "-qam", "change");
  const got = changedLines(dir, "HEAD~1");
  assert.deepEqual(got.get("a.txt"), [{ line: 2, text: "TWO" }, { line: 3, text: "three" }]);
  assert.deepEqual(dirtyFiles(dir), []);
  writeFileSync(join(dir, "a.txt"), "x\n");
  assert.equal(dirtyFiles(dir).length, 1);
});
