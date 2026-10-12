// Small unit tests for breaking what a guard protects.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { breakGuard, definitionRanges, identifiersIn } from "../scripts/lib/breaks.mjs";

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

test("past the cap, breaks are spread over the whole file, not only its start", () => {
  const text = Array.from({ length: 100 }, (_, i) => `export const c${i} = (n) => n >= ${i + 1};`).join("\n") + "\n";
  const dir = tree({ "src/a.mjs": text });
  const hit = new Set();
  breakGuard({ tree: dir, files: ["src/a.mjs"], cap: 10, run: (d) => { const l = readFileSync(join(d, "src/a.mjs"), "utf8").split("\n"); l.forEach((x, i) => { if (x !== text.split("\n")[i]) hit.add(i); }); return false; } });
  assert.equal(hit.size, 10);
  assert.ok(Math.max(...hit) >= 80, `the late lines are tried too: ${[...hit]}`);
});

test("breaks in the function the test calls are tried first, even when they lie past the evenly spread sample", () => {
  const filler = Array.from({ length: 200 }, (_, i) => `export const c${i} = (n) => n >= ${i + 1};`);
  const target = ["export const guardedThing = (users) => {", "  return users.length > 0 && users[0].ok;", "};"];
  const text = [...filler, ...target].join("\n") + "\n";
  const dir = tree({ "src/a.mjs": text });
  const run = (d) => readFileSync(join(d, "src/a.mjs"), "utf8").includes("users.length <= 0");
  const plain = breakGuard({ tree: dir, files: ["src/a.mjs"], run });
  assert.equal(plain.caught, null, "without names the even sample misses it");
  const r = breakGuard({ tree: dir, files: ["src/a.mjs"], run, names: ["guardedThing"] });
  assert.ok(r.caught, "the named function is broken first");
  assert.equal(r.caught.called, true);
  assert.equal(r.caught.line, 202);
  assert.equal(r.tried, 1);
  assert.equal(r.calledTried, 1);
  assert.equal(readFileSync(join(dir, "src/a.mjs"), "utf8"), text);
});

test("a method defined as name: handler is found, and its range stops at the next top-level definition", () => {
  const lines = ["export const a = {", "  invitePlatformAdmin: mutation({", "    handler: (x) => x > 1,", "  }),", "  other: mutation({", "    handler: (x) => x > 2,", "  }),", "};"];
  const r = definitionRanges(lines, ["invitePlatformAdmin"]);
  assert.deepEqual(r, [[1, 3]]);
  assert.deepEqual(definitionRanges(["def helper(a):", "    return a > 1", "", "def other(b):", "    return b > 2"], ["helper"]), [[0, 1]]);
});

test("when no name matches, the old even spread is used and nothing is called", () => {
  const text = Array.from({ length: 100 }, (_, i) => `export const c${i} = (n) => n >= ${i + 1};`).join("\n") + "\n";
  const dir = tree({ "src/a.mjs": text });
  const hit = new Set();
  const r = breakGuard({ tree: dir, files: ["src/a.mjs"], cap: 10, names: ["nothingLikeThis"], run: (d) => { readFileSync(join(d, "src/a.mjs"), "utf8").split("\n").forEach((x, i) => { if (x !== text.split("\n")[i]) hit.add(i); }); return false; } });
  assert.equal(r.calledTried, 0);
  assert.equal(hit.size, 10);
  assert.ok(Math.max(...hit) >= 80);
});

test("identifiersIn collects the names a test body uses", () => {
  assert.ok(identifiersIn("await t.mutation(api.admin.mutations.invitePlatformAdmin, { a: 1 })").includes("invitePlatformAdmin"));
});
