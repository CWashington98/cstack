// Small unit tests for breaking what a guard protects.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { breakGuard } from "../scripts/lib/breaks.mjs";

function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), "guard-"));
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), c); }
  return dir;
}

test("breakGuard stops at the first caught break and puts the file back byte for byte", () => {
  const text = "export const a = (n) => n >= 18;\r\nexport const b = (n) => n < 5;\n";
  const dir = tree({ "src/a.mjs": text });
  const r = breakGuard({ tree: dir, files: ["src/a.mjs"], run: () => true });
  assert.equal(r.tried, 1);
  assert.match(r.caught.break, /flipped|moved/);
  assert.equal(r.caught.line, 1);
  assert.equal(readFileSync(join(dir, "src/a.mjs"), "utf8"), text);
});

test("breakGuard tries at most the cap and says so when more were left", () => {
  const text = Array.from({ length: 20 }, (_, i) => `export const c${i} = (n) => n >= ${i + 1};`).join("\n") + "\n";
  const dir = tree({ "src/a.mjs": text });
  const r = breakGuard({ tree: dir, files: ["src/a.mjs"], run: () => false, cap: 7 });
  assert.equal(r.tried, 7);
  assert.equal(r.capped, true);
  assert.equal(r.caught, null);
  assert.equal(readFileSync(join(dir, "src/a.mjs"), "utf8"), text);
});

test("breakGuard on a file with nothing to break tries none and is not capped", () => {
  const dir = tree({ "src/a.mjs": "export const x = 'hello';\n" });
  const r = breakGuard({ tree: dir, files: ["src/a.mjs"], run: () => false });
  assert.deepEqual([r.tried, r.capped, r.caught], [0, false, null]);
});
