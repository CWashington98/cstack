import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeRepo, git } from "../../../tests/helpers.mjs";
import { startRun, addStep, finishRun, checkRun } from "../scripts/lib/evidence.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "evidence.mjs");

function repo() {
  const root = makeRepo({ "app.txt": "v1\n" });
  git(root, "add", "."); git(root, "commit", "-qm", "v1");
  return root;
}
const touch = (dir, ...names) => names.forEach((n) => writeFileSync(join(dir, n), "x"));

function goodRun(root) {
  const dir = startRun(root, "web");
  touch(dir, "health.txt", "before.png", "after.png", "readback.txt", "server.log");
  addStep(dir, { kind: "start", ok: true, artifacts: ["server.log"] });
  addStep(dir, { kind: "health", ok: true, artifacts: ["health.txt"] });
  addStep(dir, { kind: "drive", feature: "recordings/play", trigger: "before.png", end: "after.png", ok: true });
  addStep(dir, { kind: "readback", feature: "recordings/play", artifacts: ["readback.txt"], ok: true });
  addStep(dir, { kind: "cleanup", ok: true });
  return dir;
}

test("a full run passes and can be finished as verified live", () => {
  const root = repo();
  const dir = goodRun(root);
  assert.deepEqual(checkRun(dir).problems, []);
  finishRun(dir, "verified live");
  const head = git(root, "rev-parse", "HEAD").trim();
  assert.deepEqual(checkRun(dir, { fullRun: true, head }).problems, []);
});

test("a drive with no health check first is held", () => {
  const dir = startRun(repo(), "web");
  touch(dir, "a.png", "b.png");
  addStep(dir, { kind: "drive", feature: "search", trigger: "a.png", end: "b.png", sideEffects: "none: read only", ok: true });
  assert.match(checkRun(dir).problems.join("\n"), /without a passing health check first/);
});

test("a drive after a failed step needs a new health check", () => {
  const dir = startRun(repo(), "web");
  touch(dir, "a.png", "b.png");
  addStep(dir, { kind: "health", ok: true });
  addStep(dir, { kind: "drive", feature: "search", ok: false, note: "button missing" });
  addStep(dir, { kind: "drive", feature: "search", trigger: "a.png", end: "b.png", sideEffects: "none: read only", ok: true });
  assert.match(checkRun(dir).problems.join("\n"), /after a failed step without a new passing health check/);
});

test("a successful drive needs trigger and end-state evidence", () => {
  const dir = startRun(repo(), "web");
  touch(dir, "after.png");
  addStep(dir, { kind: "health", ok: true });
  addStep(dir, { kind: "drive", feature: "search", end: "after.png", sideEffects: "none: read only", ok: true });
  assert.match(checkRun(dir).problems.join("\n"), /has no trigger evidence/);
});

test("a drive that changes data needs a read-back, unless it says why not", () => {
  const dir = startRun(repo(), "web");
  touch(dir, "a.png", "b.png");
  addStep(dir, { kind: "health", ok: true });
  addStep(dir, { kind: "drive", feature: "save", trigger: "a.png", end: "b.png", ok: true });
  assert.match(checkRun(dir).problems.join("\n"), /nothing read back its side effects/);
  const dir2 = startRun(repo(), "web");
  touch(dir2, "a.png", "b.png");
  addStep(dir2, { kind: "health", ok: true });
  addStep(dir2, { kind: "drive", feature: "view", trigger: "a.png", end: "b.png", sideEffects: "none: it only shows data", ok: true });
  assert.deepEqual(checkRun(dir2).problems, []);
});

test("a clean-up that deletes the evidence never passes", () => {
  const root = repo();
  const dir = goodRun(root);
  rmSync(join(dir, "after.png"));
  assert.match(checkRun(dir).problems.join("\n"), /missing evidence: after\.png/);
  rmSync(dir, { recursive: true });
  assert.match(checkRun(dir).problems.join("\n"), /holds no run\.json/);
});

test("evidence from uncommitted changes or another commit is stale", () => {
  const root = repo();
  writeFileSync(join(root, "app.txt"), "v2 not committed\n");
  const dir = goodRun(root);
  finishRun(dir, "verified live");
  const head = git(root, "rev-parse", "HEAD").trim();
  assert.match(checkRun(dir, { head }).problems.join("\n"), /uncommitted changes/);
  git(root, "commit", "-qam", "v2");
  const newHead = git(root, "rev-parse", "HEAD").trim();
  assert.match(checkRun(dir, { head: newHead }).problems.join("\n"), /stale: this evidence is from commit/);
});

test("verified live is refused when the rules fail; blocked is always allowed", () => {
  const dir = startRun(repo(), "web");
  addStep(dir, { kind: "health", ok: false, note: "port taken by another checkout" });
  assert.throws(() => finishRun(dir, "verified live"), /cannot mark it "verified live"/);
  assert.equal(finishRun(dir, "blocked").status, "blocked");
  assert.throws(() => finishRun(startRun(repo(), "web"), "looks good"), /status must be one of/);
});

test("coverage counts every feature in the map, driven or reported unreachable", () => {
  const root = repo();
  const features = join(root, "features");
  mkdirSync(features);
  touch(features, "README.md", "search.md", "export.md", "admin.md");
  const dir = goodRun(root);
  addStep(dir, { kind: "unreachable", feature: "admin", ok: false, note: "needs an admin account; tried /admin, got the sign-in page" });
  const r = checkRun(dir, { cover: features });
  assert.deepEqual(r.coverage, { covered: 1, total: 3 });
  assert.match(r.problems.join("\n"), /feature search was not driven/);
  assert.match(r.problems.join("\n"), /feature export was not driven/);
});

test("the command records a run end to end", () => {
  const root = repo();
  const ev = (...a) => spawnSync("node", [script, ...a], { cwd: root, encoding: "utf8" });
  const dir = ev("start", "--app", "web").stdout.trim();
  touch(dir, "h.txt", "a.png", "b.png");
  assert.equal(ev("add", dir, "--kind", "start", "--ok").status, 0);
  assert.equal(ev("add", dir, "--kind", "health", "--artifact", "h.txt", "--ok").status, 0);
  assert.equal(ev("add", dir, "--kind", "drive", "--feature", "view", "--trigger", "a.png", "--end", "b.png", "--side-effects", "none: read only", "--ok").status, 0);
  assert.equal(ev("add", dir, "--kind", "drive", "--feature", "view", "--trigger", "missing.png", "--ok").status, 2);
  assert.equal(ev("add", dir, "--kind", "cleanup", "--ok").status, 0);
  assert.equal(ev("finish", dir, "--status", "verified live").status, 0);
  assert.equal(ev("check", dir, "--full-run", "--head", "HEAD").status, 0);
  rmSync(join(dir, "b.png"));
  assert.equal(ev("check", dir).status, 1);
});
