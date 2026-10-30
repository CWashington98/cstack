// Guards for `evidence.mjs publish` beyond the evidence-publish scenarios: dirty runs, links and cleanup.
// Each runs the real `evidence.mjs publish` against a temporary repository whose origin is a
// local bare repository, with a stand-in `gh` on PATH that logs every call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeRepo, git, tempDir } from "../../../tests/helpers.mjs";

const script = resolve(fileURLToPath(import.meta.url), "../../scripts/evidence.mjs");
const START = "<!-- verify-evidence:start -->";
const END = "<!-- verify-evidence:end -->";

function project({ settings } = {}) {
  const origin = tempDir("evidence-origin");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const root = makeRepo({ "app.txt": "v1\n", ".gitignore": ".verify/\n", ...(settings ? { ".claude/verify.json": JSON.stringify(settings) } : {}) });
  git(root, "checkout", "-qb", "feat");
  git(root, "add", "."); git(root, "commit", "-qm", "base");
  git(root, "remote", "add", "origin", origin);
  const old = git(root, "rev-parse", "HEAD").trim();
  writeFileSync(join(root, "app.txt"), "v2\n");
  git(root, "commit", "-qam", "change");
  return { root, origin, old, head: git(root, "rev-parse", "HEAD").trim() };
}

// A finished run for `commit` with the given screenshots, written the way evidence.mjs lays runs out.
function saveRun(root, commit, { name = "20261029T100000Z", status = "verified live", shots = ["home.png", "saved.png"], artifacts, dirty = false } = {}) {
  const dir = join(root, ".verify", "runs", "web", `${name}-${commit.slice(0, 7)}`);
  mkdirSync(dir, { recursive: true });
  for (const s of shots) writeFileSync(join(dir, s), `image ${s} ${name}`);
  const steps = [{ kind: "drive", feature: "f1", trigger: null, end: null, artifacts: artifacts ?? shots, ok: true }];
  writeFileSync(join(dir, "run.json"), JSON.stringify({ version: 1, app: "web", commit, dirty, startedAt: `${name}`, steps, status, finishedAt: name }));
  return dir;
}

function publish(p, { body = "## What changed\nA fix.\n" } = {}) {
  const dir = tempDir("evidence-gh");
  mkdirSync(join(dir, "bin"));
  const log = join(dir, "calls.log");
  const out = join(dir, "body.md");
  writeFileSync(join(dir, "bin", "gh"), `#!/usr/bin/env node
const a = process.argv.slice(2), e = process.env, fs = require("node:fs");
fs.appendFileSync(e.GH_LOG, a.join(" ") + "\\n");
if (a[0] === "pr" && a[1] === "view") process.stdout.write(JSON.stringify({ number: 88, headRefOid: e.GH_HEAD, body: e.GH_BODY, url: "https://github.com/acme/app/pull/88" }));
else if (a[0] === "pr" && a[1] === "edit") fs.copyFileSync(a[a.indexOf("--body-file") + 1], e.GH_OUT);
else process.exit(1);
`);
  chmodSync(join(dir, "bin", "gh"), 0o755);
  const { CSTACK_VERIFY, ...inherited } = process.env;
  const env = { ...inherited, HOME: dir, PATH: `${join(dir, "bin")}:${process.env.PATH}`, GH_LOG: log, GH_HEAD: p.head, GH_BODY: body, GH_OUT: out };
  const r = spawnSync("node", [script, "publish", "--pr", "88"], { cwd: p.root, env, encoding: "utf8" });
  return { ...r, body: existsSync(out) ? readFileSync(out, "utf8") : null, calls: existsSync(log) ? readFileSync(log, "utf8") : "" };
}

const evidenceFiles = (p) => {
  try { return execFileSync("git", ["-C", p.origin, "ls-tree", "-r", "--name-only", "verify-evidence"], { encoding: "utf8" }).trim().split("\n"); } catch { return []; }
};
const sections = (body) => body.split(START).length - 1;

test("a run recorded on uncommitted changes is never published as proof for the head", () => {
  const p = project();
  saveRun(p.root, p.head, { dirty: true });
  const r = publish(p);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /no run matches the head/i);
  assert.deepEqual(evidenceFiles(p), []);
  assert.doesNotMatch(r.calls, /pr edit/);
});

test("a link in the run folder that points outside it is refused; one pointing inside is copied as the file", () => {
  const p = project();
  writeFileSync(join(p.root, ".env"), "SECRET=1\n");
  const dir = saveRun(p.root, p.head, { shots: ["home.png"], artifacts: ["home.png", "env.png"] });
  symlinkSync(join(p.root, ".env"), join(dir, "env.png"));
  const refused = publish(p);
  assert.equal(refused.status, 1, refused.stderr);
  assert.match(refused.stderr, /env\.png/);
  assert.deepEqual(evidenceFiles(p), []);

  const q = project();
  const inside = saveRun(q.root, q.head, { shots: ["home.png"], artifacts: ["home.png", "copy.png"] });
  symlinkSync(join(inside, "home.png"), join(inside, "copy.png"));
  const ok = publish(q);
  assert.equal(ok.status, 0, ok.stderr);
  const mode = execFileSync("git", ["-C", q.origin, "ls-tree", "verify-evidence", `pr-88/${q.head}/copy.png`], { encoding: "utf8" });
  assert.match(mode, /^100644 /, "copied as a file, not a link");
});

test("publishing leaves no temporary worktree or branch behind", () => {
  const p = project();
  saveRun(p.root, p.head);
  const before = { trees: git(p.root, "worktree", "list"), branches: git(p.root, "branch", "--list") };
  assert.equal(publish(p).status, 0);
  assert.equal(git(p.root, "worktree", "list"), before.trees);
  assert.equal(git(p.root, "branch", "--list"), before.branches);
});
