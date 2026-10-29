// Acceptance tests for add-ready-check, group verify/gate. One test per scenario, named with its [scenario-id].
// Each one runs the real `verify gate` against a temporary git repository, a stand-in `gh` on PATH, and verdict files
// written where `verdict.mjs check` reads them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const gate = join(here, "..", "scripts", "gate.mjs");

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function write(cwd, path, content) {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), content);
}

// A repository with a trunk, and a branch editing `files` (path -> content). Settings go in the named block.
function setup({ files, block = "gate", gate: gateSettings = {}, project = {} }) {
  const cwd = mkdtempSync(join(tmpdir(), "gate-reasons-"));
  git(cwd, "init", "-q", "-b", "main");
  git(cwd, "config", "user.email", "t@example.com");
  git(cwd, "config", "user.name", "T");
  write(cwd, ".claude/verify.json", JSON.stringify({ integrationBranch: "main", ...project, [block]: { allowedBases: ["main"], ...gateSettings } }));
  write(cwd, "README.md", "hi\n");
  git(cwd, "add", "."); git(cwd, "commit", "-qm", "base");
  git(cwd, "switch", "-qc", "feature");
  for (const [path, content] of Object.entries(files)) write(cwd, path, content);
  git(cwd, "add", "."); git(cwd, "commit", "-qm", "change");
  const head = git(cwd, "rev-parse", "HEAD");
  git(cwd, "switch", "-q", "main");
  return { cwd, head };
}

// A review verdict as `verdict.mjs write` stores it.
function verdict({ cwd, head }, reviewer, { said = "ready", findings = [], model, date = "2026-10-29T10:00:00.000Z" } = {}) {
  const dir = join(cwd, ".git", "verify", "verdicts");
  mkdirSync(dir, { recursive: true });
  const models = { "claims-auditor": "claude-opus-4-1", codex: "gpt-5.1-codex", "claude-fallback": "claude-sonnet-5-5" };
  writeFileSync(join(dir, `${head}.${reviewer}.json`), JSON.stringify({
    reviewer, model: model ?? models[reviewer], note: reviewer === "claude-fallback" ? "Codex hit its usage limit" : null,
    head, base: "main", mergeBase: head, patchId: "x", said, verdict: said, summary: "s", findings, date,
  }));
}
const both = (change, options) => { verdict(change, "claims-auditor", options); verdict(change, "codex"); };

const finding = (overrides) => ({ id: "f1", claim: "A claim.", severity: "decide", reproduced: true, reproduction: "ran it", ...overrides });
const passed = [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS", name: "ci" }];
const threads = { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } } };

// The stand-in gh answers `pr view`, the review-thread query and `pr list`, and logs every call.
function run(change, { args = [], view = {}, noRollup = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "gate-reasons-gh-"));
  const log = join(dir, "calls.log");
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "gh"), `#!/usr/bin/env node
const a = process.argv.slice(2), e = process.env;
require("node:fs").appendFileSync(e.GH_LOG, a.join(" ") + "\\n");
if (a[0] === "pr" && a[1] === "view") process.stdout.write(e.GH_VIEW);
else if (a[0] === "api" && a[1] === "graphql") process.stdout.write(e.GH_GQL);
else if (a[0] === "pr" && a[1] === "list") process.stdout.write("[]");
else process.exit(1);
`);
  chmodSync(join(dir, "bin", "gh"), 0o755);
  const files = git(change.cwd, "diff", "--name-only", "main", change.head).split("\n").map((path) => ({ path, additions: 1, deletions: 0 }));
  const payload = { number: 88, baseRefName: "main", headRefOid: change.head, isDraft: true, body: "", files, ...(noRollup ? {} : { statusCheckRollup: passed }), ...view };
  const { CSTACK_VERIFY, ...inherited } = process.env;
  const env = { ...inherited, HOME: dir, PATH: `${join(dir, "bin")}:${process.env.PATH}`, GH_LOG: log, GH_VIEW: JSON.stringify(payload), GH_GQL: JSON.stringify(threads) };
  const result = spawnSync("node", [gate, "88", ...args], { cwd: change.cwd, env, encoding: "utf8" });
  return { ...result, calls: existsSync(log) ? readFileSync(log, "utf8") : "" };
}
function runJson(change, options) {
  const result = run(change, { ...options, args: ["--json"] });
  let json;
  try { json = JSON.parse(result.stdout); } catch { assert.fail(`--json must print JSON. status ${result.status}, stdout: ${result.stdout}, stderr: ${result.stderr}`); }
  return { ...result, json };
}

test("[ready-when-every-fact-passes] a draft with every fact passing prints ready and exits 0", () => {
  const change = setup({ files: { "docs/a.md": "a\n" } });
  both(change);
  const result = run(change);
  assert.equal(result.stdout.trim(), "ready", result.stderr);
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.calls, /^pr (merge|ready|edit)/m, "the check must not change the pull request");
  const json = runJson(change).json;
  assert.equal(json.ready, true);
  assert.equal(json.head, change.head);
  assert.deepEqual(json.reasons, []);
});

test("[failing-checks-are-fix] a failing check is one fix reason that names it", () => {
  const change = setup({ files: { "docs/a.md": "a\n" } });
  both(change);
  const rollup = [...passed, { __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE", name: "lint" }];
  const result = runJson(change, { view: { statusCheckRollup: rollup } });
  assert.equal(result.status, 1);
  assert.equal(result.json.reasons.length, 1, JSON.stringify(result.json.reasons));
  assert.equal(result.json.reasons[0].kind, "fix");
  assert.match(result.json.reasons[0].text, /lint/);
});

test("[running-checks-wait] a check still running is one wait reason", () => {
  const change = setup({ files: { "docs/a.md": "a\n" } });
  both(change);
  const rollup = [...passed, { __typename: "CheckRun", status: "IN_PROGRESS", conclusion: "", name: "build" }];
  const result = runJson(change, { view: { statusCheckRollup: rollup } });
  assert.equal(result.status, 1);
  assert.equal(result.json.reasons.length, 1, JSON.stringify(result.json.reasons));
  assert.equal(result.json.reasons[0].kind, "wait");
});

test("[decide-finding-needs-owner] an open decide finding becomes an owner reason asking its claim", () => {
  const change = setup({ files: { "docs/a.md": "a\n" } });
  const claim = "The spec doesn't say what happens to drafts older than 30 days. Keep or delete them?";
  verdict(change, "claims-auditor", { findings: [finding({ claim })] });
  verdict(change, "codex");
  const result = runJson(change);
  assert.equal(result.status, 1);
  assert.equal(result.json.reasons.length, 1, JSON.stringify(result.json.reasons));
  assert.equal(result.json.reasons[0].kind, "owner");
  assert.equal(result.json.reasons[0].question, claim);
});

test("[spec-wrong-needs-owner] a spec-wrong finding becomes an owner reason asking whether to change the spec", () => {
  const change = setup({ files: { "docs/a.md": "a\n" } });
  verdict(change, "claims-auditor", { findings: [finding({ id: "s1", claim: "Scenario 2 expects a refund the proposal rules out.", kind: "spec-wrong" })] });
  verdict(change, "codex");
  const result = runJson(change);
  assert.equal(result.status, 1);
  const owner = result.json.reasons.filter((r) => r.kind === "owner");
  assert.equal(owner.length, 1, JSON.stringify(result.json.reasons));
  assert.match(owner[0].question, /spec/i);
  assert.match(owner[0].question, /Change the spec\?/);
  assert.match(owner[0].question, /refund the proposal rules out/);
});

test("[unreadable-fact-is-fix] check results gh can't give are a fix reason naming them", () => {
  const change = setup({ files: { "docs/a.md": "a\n" } });
  both(change);
  const result = runJson(change, { noRollup: true });
  assert.equal(result.status, 1);
  const fix = result.json.reasons.filter((r) => r.kind === "fix" && /check results/i.test(r.text));
  assert.equal(fix.length, 1, JSON.stringify(result.json.reasons));
  assert.match(fix[0].text, /can't read|unreadable|could not read/i);
});

const risky = { gate: { reviews: "highRisk" }, project: { highRisk: ["plugins/core/scripts/**"] } };

test("[low-risk-change-needs-no-review] with reviews highRisk a README-only change needs no verdicts", () => {
  const change = setup({ files: { "README.md": "changed\n" }, ...risky });
  const result = run(change);
  assert.equal(result.stdout.trim(), "ready", result.stderr);
  assert.equal(result.status, 0);
});

test("[high-risk-change-needs-reviews] with reviews highRisk a high-risk path without verdicts is a fix reason", () => {
  const change = setup({ files: { "plugins/core/scripts/guard.mjs": "export {};\n" }, ...risky });
  const result = runJson(change);
  assert.equal(result.status, 1);
  assert.ok(result.json.reasons.some((r) => r.kind === "fix" && /verdict/i.test(r.text) && /claims-auditor/.test(r.text) && /codex/.test(r.text)), JSON.stringify(result.json.reasons));
});

test("[reviews-required-by-default] with no reviews setting a README-only change without verdicts is a fix reason", () => {
  const change = setup({ files: { "README.md": "changed\n" } });
  const result = runJson(change);
  assert.equal(result.status, 1);
  assert.ok(result.json.reasons.some((r) => r.kind === "fix" && /verdict/i.test(r.text) && /claims-auditor/.test(r.text) && /codex/.test(r.text)), JSON.stringify(result.json.reasons));
});

test("[fallback-verdict-accepted] a claude-fallback verdict fills the second review slot", () => {
  const change = setup({ files: { "docs/a.md": "a\n" } });
  verdict(change, "claims-auditor");
  verdict(change, "claude-fallback");
  const result = run(change);
  assert.equal(result.stdout.trim(), "ready", result.stderr);
  assert.equal(result.status, 0);
});

test("[workflow-change-is-not-held-by-path] a workflow edit is ready and the zone is reported", () => {
  const change = setup({ files: { ".github/workflows/ci.yml": "on: push\n" }, gate: { zone: { high: [".github/**"] } } });
  both(change);
  const plain = run(change);
  assert.equal(plain.stdout.trim(), "ready", plain.stderr);
  assert.equal(plain.status, 0);
  const json = runJson(change).json;
  assert.equal(json.zone, "high", JSON.stringify(json));
});

test("[old-factory-block-still-read] a factory block with no gate block is read, with a rename warning", () => {
  const change = setup({ files: { "src/big.ts": "x\n".repeat(250) }, block: "factory", gate: { sizeLimit: 200 } });
  both(change);
  const result = runJson(change);
  assert.equal(result.status, 1);
  assert.ok(result.json.reasons.some((r) => r.kind === "fix" && /200/.test(r.text) && /lines|size|limit/i.test(r.text)), JSON.stringify(result.json.reasons));
  assert.match(result.stderr, /factory.*renamed.*gate/i);
});

// Holes the slice A review found. Not scenarios of their own; each guards a scenario's promise.

test("[fallback-does-not-hide-codex-not-ready] a newer fallback verdict does not outvote a Codex not-ready verdict", () => {
  const change = setup({ files: { "docs/a.md": "a\n" } });
  verdict(change, "claims-auditor");
  verdict(change, "codex", { said: "not ready", date: "2026-10-29T10:05:00.000Z" });
  verdict(change, "claude-fallback", { date: "2026-10-29T10:10:00.000Z" });
  const result = runJson(change);
  assert.equal(result.status, 1);
  assert.ok(result.json.reasons.some((r) => r.kind === "fix" && /codex/.test(r.text)), JSON.stringify(result.json.reasons));
});

test("[settings-change-needs-reviews] a change to the settings file always needs reviews, even with reviews highRisk", () => {
  const change = setup({ files: { "README.md": "changed\n" }, ...risky });
  git(change.cwd, "switch", "-q", "feature");
  write(change.cwd, ".claude/verify.json", JSON.stringify({ integrationBranch: "main", highRisk: ["plugins/core/scripts/**"], gate: { allowedBases: ["main"], reviews: "highRisk", sizeLimit: 9999 } }));
  git(change.cwd, "commit", "-qam", "loosen the gate");
  const moved = { cwd: change.cwd, head: git(change.cwd, "rev-parse", "HEAD") };
  git(change.cwd, "switch", "-q", "main");
  const result = runJson(moved);
  assert.equal(result.status, 1);
  assert.ok(result.json.reasons.some((r) => r.kind === "fix" && /missing: claims-auditor, codex/.test(r.text)), JSON.stringify(result.json.reasons));
});

test("[empty-risk-list-needs-reviews] reviews highRisk with an empty risk list still needs reviews", () => {
  const change = setup({ files: { "README.md": "changed\n" }, gate: { reviews: "highRisk" }, project: { highRisk: [] } });
  const result = runJson(change);
  assert.equal(result.status, 1);
  assert.ok(result.json.reasons.some((r) => r.kind === "fix" && /missing: claims-auditor, codex/.test(r.text)), JSON.stringify(result.json.reasons));
});

test("a Codex verdict alone is missing the claims auditor", () => {
  const change = setup({ files: { "docs/a.md": "a\n" } });
  verdict(change, "codex");
  const result = runJson(change);
  assert.equal(result.status, 1);
  assert.ok(result.json.reasons.some((r) => r.kind === "fix" && /missing: claims-auditor\)/.test(r.text)), JSON.stringify(result.json.reasons));
});

test("a change mixing a high-risk path with other files needs reviews", () => {
  const change = setup({ files: { "README.md": "changed\n", "plugins/core/scripts/guard.mjs": "export {};\n" }, ...risky });
  const result = runJson(change);
  assert.equal(result.status, 1);
  assert.ok(result.json.reasons.some((r) => r.kind === "fix" && /missing: claims-auditor, codex/.test(r.text)), JSON.stringify(result.json.reasons));
});

test("a decide finding the validator could not reproduce asks the owner nothing", () => {
  const change = setup({ files: { "docs/a.md": "a\n" } });
  both(change, { findings: [finding({ claim: "Keep or delete old drafts?", reproduced: false })] });
  const result = runJson(change);
  assert.equal(result.status, 0, JSON.stringify(result.json));
  assert.ok(!result.json.reasons.some((r) => r.kind === "owner"));
});

test("a runtime change is ready with a verified live run for its head, and not without one", () => {
  const change = setup({ files: { "src/app.ts": "export {};\n" }, gate: { runtimeSurface: ["src/**"] } });
  both(change);
  const without = runJson(change);
  assert.ok(without.json.reasons.some((r) => r.kind === "fix" && /live proof/.test(r.text)), JSON.stringify(without.json.reasons));
  const dir = join(change.cwd, ".verify", "runs", "app", "run1");
  write(dir, "trigger.png", "t"); write(dir, "end.png", "e");
  write(dir, "run.json", JSON.stringify({ version: 1, app: "app", commit: change.head, dirty: false, status: "verified live", steps: [
    { kind: "start", ok: true }, { kind: "health", ok: true },
    { kind: "drive", ok: true, feature: "open", trigger: "trigger.png", end: "end.png", sideEffects: "none: it only reads" },
    { kind: "cleanup", ok: true },
  ] }));
  const result = runJson(change);
  assert.equal(result.status, 0, JSON.stringify(result.json.reasons));
});
