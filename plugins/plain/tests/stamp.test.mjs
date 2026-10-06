import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeRepo, git } from "../../../tests/helpers.mjs";
import { writeStamp, hasStamp, plainDir, logOverride } from "../scripts/plain-stamp.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "plain-stamp.mjs");

test("a stamp matches only the exact same text, and every worktree shares it", () => {
  const dir = makeRepo({ "a.md": "x" });
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "start");
  writeStamp(dir, "Hello there.\n", { pass: true });
  assert.equal(hasStamp(dir, "Hello there."), true);
  assert.equal(hasStamp(dir, "Hello there!"), false);
  const worktree = join(dirname(dir), `${basename(dir)}-wt`);
  git(dir, "worktree", "add", "-q", worktree);
  assert.equal(hasStamp(worktree, "Hello there."), true);
});

test("outside git, stamps go to the cache folder", () => {
  const dir = mkdtempSync(join(tmpdir(), "plain-nogit-"));
  process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), "plain-cache-"));
  writeStamp(dir, "Some text.", { pass: true });
  assert.ok(plainDir(dir).startsWith(process.env.XDG_CACHE_HOME));
  assert.equal(hasStamp(dir, "Some text."), true);
});

test("overrides are logged with their reason", () => {
  const dir = makeRepo();
  logOverride(dir, { reason: "quoting a customer", tool: "Bash", command: "gh pr create" });
  assert.ok(existsSync(join(plainDir(dir), "overrides.log")));
});

test("the stamp command refuses text that fails the checker or the reader", () => {
  const dir = makeRepo({
    ".claude/plain.json": "{}",
    "bad.md": "BLUF works.\n",
    "good.md": "This adds the map page. It loads and passes its tests.\n",
    "fail.json": JSON.stringify({ pass: false, unclear_terms: ["Karen"] }),
    "pass.json": JSON.stringify({ pass: true, unclear_terms: [], missing_context: [] }),
  });
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8" });
  assert.equal(run("write", "bad.md", "--verdict", "pass.json").status, 1);
  assert.equal(run("write", "good.md", "--verdict", "fail.json").status, 1);
  assert.equal(run("has", "good.md").status, 1);
  assert.equal(run("write", "good.md", "--verdict", "pass.json").status, 0);
  assert.equal(run("has", "good.md").status, 0);
});

test("a stamp made by an older checker version no longer counts", async () => {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { fingerprint } = await import("../scripts/plain-stamp.mjs");
  const dir = makeRepo();
  const stamps = join(plainDir(dir), "stamps");
  mkdirSync(stamps, { recursive: true });
  writeFileSync(join(stamps, `${fingerprint("Old text.")}.json`), JSON.stringify({ checkerVersion: "0" }));
  assert.equal(hasStamp(dir, "Old text."), false);
});
