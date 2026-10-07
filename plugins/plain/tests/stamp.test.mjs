import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeRepo, git } from "../../../tests/helpers.mjs";
import { writeStamp, hasStamp, plainDir, logOverride, fingerprint } from "../scripts/plain-stamp.mjs";
import { CHECKER_VERSION } from "../scripts/lib/version.mjs";
import { READER_VERSION } from "../skills/cold-reader/scripts/version.mjs";

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
    "fail.json": JSON.stringify({ pass: false, unclear_terms: ["Karen"], missing_context: [], readerVersion: READER_VERSION }),
    "pass.json": JSON.stringify({ pass: true, unclear_terms: [], missing_context: [], readerVersion: READER_VERSION }),
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

test("a stamp made under an older reader version no longer counts", async () => {
  const { writeFileSync, mkdirSync, readFileSync } = await import("node:fs");
  const dir = makeRepo();
  writeStamp(dir, "New text.", { pass: true });
  const stamps = join(plainDir(dir), "stamps");
  assert.equal(JSON.parse(readFileSync(join(stamps, `${fingerprint("New text.")}.json`), "utf8")).readerVersion, READER_VERSION);
  mkdirSync(stamps, { recursive: true });
  writeFileSync(join(stamps, `${fingerprint("Old text.")}.json`), JSON.stringify({ checkerVersion: CHECKER_VERSION, readerVersion: "0" }));
  writeFileSync(join(stamps, `${fingerprint("Older text.")}.json`), JSON.stringify({ checkerVersion: CHECKER_VERSION }));
  assert.equal(hasStamp(dir, "Old text."), false);
  assert.equal(hasStamp(dir, "Older text."), false);
  assert.equal(hasStamp(dir, "New text."), true);
});

test("the stamp command refuses a verdict made by an older reader version", () => {
  const dir = makeRepo({
    ".claude/plain.json": "{}",
    "good.md": "This adds the map page. It loads and passes its tests.\n",
    "old.json": JSON.stringify({ pass: true, unclear_terms: [], missing_context: [], readerVersion: "0" }),
    "none.json": JSON.stringify({ pass: true, unclear_terms: [], missing_context: [] }),
  });
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8" });
  const old = run("write", "good.md", "--verdict", "old.json");
  assert.equal(old.status, 1);
  assert.match(old.stderr, /older version of the cold reader/);
  assert.equal(run("write", "good.md", "--verdict", "none.json").status, 1);
});

test("for a spec or plan in a watched folder, the reader's flags are advice, but the reader must have run", () => {
  const spec = "docs/superpowers/specs/map.md";
  const dir = makeRepo({
    ".claude/plain.json": "{}",
    [spec]: "This spec adds the map page. It loads and passes its tests.\n",
    "post.md": "This adds the map page. It loads and passes its tests.\n",
    "flagged.json": JSON.stringify({ pass: false, unclear_terms: ["Atlas"], missing_context: [], restatement: "x", ask: "y", readerVersion: READER_VERSION }),
    "error.json": JSON.stringify({ pass: false, error: "The reader did not return JSON.", readerVersion: READER_VERSION }),
  });
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8" });
  assert.equal(run("write", "post.md", "--verdict", "flagged.json").status, 1, "a post must pass the reader");
  assert.equal(run("write", spec, "--verdict", "error.json").status, 1, "a reader that failed to run is never a pass");
  const ok = run("write", spec, "--verdict", "flagged.json");
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /advice/);
  assert.equal(run("has", spec).status, 0);
});
