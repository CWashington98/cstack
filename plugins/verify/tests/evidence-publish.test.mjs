// Acceptance tests for openspec/changes/add-ready-check/specs/verify/evidence-publish.
// Each runs the real `evidence.mjs publish` against a temporary repository whose origin is a
// local bare repository, with a stand-in `gh` on PATH that logs every call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, chmodSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeRepo, git } from "../../../tests/helpers.mjs";

const script = resolve(fileURLToPath(import.meta.url), "../../scripts/evidence.mjs");
const START = "<!-- verify-evidence:start -->";
const END = "<!-- verify-evidence:end -->";

function project({ settings } = {}) {
  const origin = mkdtempSync(join(tmpdir(), "evidence-origin-"));
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
function saveRun(root, commit, { name = "20261029T100000Z", status = "verified live", shots = ["home.png", "saved.png"], artifacts } = {}) {
  const dir = join(root, ".verify", "runs", "web", `${name}-${commit.slice(0, 7)}`);
  mkdirSync(dir, { recursive: true });
  for (const s of shots) writeFileSync(join(dir, s), `image ${s} ${name}`);
  const steps = [{ kind: "drive", feature: "f1", trigger: null, end: null, artifacts: artifacts ?? shots, ok: true }];
  writeFileSync(join(dir, "run.json"), JSON.stringify({ version: 1, app: "web", commit, dirty: false, startedAt: `${name}`, steps, status, finishedAt: name }));
  return dir;
}

function publish(p, { body = "## What changed\nA fix.\n" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "evidence-gh-"));
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

test("[publish-adds-proof-to-description] the run's screenshots go to verify-evidence and the description gets one section", () => {
  const p = project();
  saveRun(p.root, p.head);
  const r = publish(p);
  assert.equal(r.status, 0, r.stderr);
  const files = evidenceFiles(p);
  assert.ok(files.includes(`pr-88/${p.head}/home.png`), files.join(", "));
  assert.ok(files.includes(`pr-88/${p.head}/saved.png`), files.join(", "));
  assert.ok(files.every((f) => f.startsWith("pr-88/")), "the branch holds only evidence files");
  const roots = execFileSync("git", ["-C", p.origin, "rev-list", "--max-parents=0", "verify-evidence"], { encoding: "utf8" }).trim();
  assert.notEqual(roots, git(p.root, "rev-list", "--max-parents=0", "HEAD").trim(), "the branch shares no history with the code");
  assert.ok(r.body, "the description was edited");
  assert.equal(sections(r.body), 1);
  const section = r.body.slice(r.body.indexOf(START), r.body.indexOf(END));
  assert.match(section, /verified live/);
  assert.match(section, new RegExp(p.head.slice(0, 7)));
  assert.match(section, /home\.png/);
  assert.match(section, /saved\.png/);
  assert.match(r.body, /## What changed\nA fix\./, "the rest of the description is kept");
});

test("[rerun-replaces-section] publishing again replaces the section with the new run's", () => {
  const p = project();
  saveRun(p.root, p.head, { name: "20261029T100000Z", status: "failed", shots: ["old.png"] });
  const first = publish(p);
  assert.equal(first.status, 0, first.stderr);
  saveRun(p.root, p.head, { name: "20261029T110000Z", status: "verified live", shots: ["new.png"] });
  const second = publish(p, { body: first.body });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(sections(second.body), 1, "exactly one section");
  assert.match(second.body, /new\.png/);
  assert.doesNotMatch(second.body, /old\.png/);
  assert.match(second.body, /verified live/);
});

test("[no-run-for-head-says-so] with runs only for an older commit it exits 1 and pushes and edits nothing", () => {
  const p = project();
  saveRun(p.root, p.old);
  const r = publish(p);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr + r.stdout, /no run matches the head/i);
  assert.deepEqual(evidenceFiles(p), [], "nothing pushed");
  assert.doesNotMatch(r.calls, /pr edit/, "nothing edited");
});

test("[files-outside-run-folder-refused] a run naming a file outside its folder exits 1 naming it, and pushes and edits nothing", () => {
  const p = project();
  writeFileSync(join(p.root, ".env"), "SECRET=1\n");
  saveRun(p.root, p.head, { artifacts: ["home.png", "../../../../.env"] });
  const r = publish(p);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr + r.stdout, /\.\.\/\.\.\/\.\.\/\.\.\/\.env/);
  assert.deepEqual(evidenceFiles(p), [], "nothing pushed");
  assert.doesNotMatch(r.calls, /pr edit/, "nothing edited");
});

test("it refuses when the project protects the verify-evidence branch", () => {
  const p = project({ settings: { protectedBranches: ["main", "verify-evidence"] } });
  saveRun(p.root, p.head);
  const r = publish(p);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr + r.stdout, /protectedBranches/);
  assert.deepEqual(evidenceFiles(p), []);
});
