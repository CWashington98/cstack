import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";

const identity = {
  GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com",
};

export function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, ...identity } });
}

const made = new Set();
process.on("exit", () => {
  for (const dir of made) {
    try { rmSync(dir, { recursive: true, force: true }); } catch (error) { console.error(`tempDir: could not delete ${dir}: ${error.message}`); }
  }
});

// A new empty temp folder named <prefix>-XXXXXX. It is deleted when the test file's process ends, pass or fail,
// so a test never needs its own cleanup. `npm test` fails if any folder is left behind (see run.mjs).
export function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  made.add(dir);
  return dir;
}

export function makeRepo(files = {}) {
  const dir = tempDir("plain-test");
  git(dir, "init", "-q");
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}
