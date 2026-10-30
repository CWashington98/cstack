// Acceptance tests for add-ready-check, group verify/pr-open. One test per scenario, named with its [scenario-id].
// Each runs the real `verify gate --apply` against a temporary git repository and a stand-in `gh` on PATH
// that logs every call and saves any new description.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tempDir } from "../../../tests/helpers.mjs";

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
  const cwd = tempDir("gate-reasons");
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

function apply(change, { view = {} } = {}) {
  const dir = tempDir("gate-apply-gh");
  const log = join(dir, "calls.log");
  const out = join(dir, "body.md");
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "gh"), `#!/usr/bin/env node
const a = process.argv.slice(2), e = process.env, fs = require("node:fs");
fs.appendFileSync(e.GH_LOG, a.join(" ") + "\\n");
if (a[0] === "pr" && a[1] === "view") process.stdout.write(e.GH_VIEW);
else if (a[0] === "api" && a[1] === "graphql") process.stdout.write(e.GH_GQL);
else if (a[0] === "pr" && a[1] === "list") process.stdout.write("[]");
else if (a[0] === "pr" && a[1] === "ready") {}
else if (a[0] === "pr" && a[1] === "edit") fs.copyFileSync(a[a.indexOf("--body-file") + 1], e.GH_OUT);
else process.exit(1);
`);
  chmodSync(join(dir, "bin", "gh"), 0o755);
  const files = git(change.cwd, "diff", "--name-only", "main", change.head).split("\n").map((path) => ({ path, additions: 1, deletions: 0 }));
  const payload = { number: 88, baseRefName: "main", headRefOid: change.head, isDraft: true, body: "## What changed\nA fix.\n", files, statusCheckRollup: passed, ...view };
  const { CSTACK_VERIFY, ...inherited } = process.env;
  const env = { ...inherited, HOME: dir, PATH: `${join(dir, "bin")}:${process.env.PATH}`, GH_LOG: log, GH_OUT: out, GH_VIEW: JSON.stringify(payload), GH_GQL: JSON.stringify(threads) };
  const result = spawnSync("node", [gate, "88", "--apply"], { cwd: change.cwd, env, encoding: "utf8" });
  const calls = existsSync(log) ? readFileSync(log, "utf8") : "";
  return { ...result, calls, body: existsSync(out) ? readFileSync(out, "utf8") : null };
}
const firstLine = (body) => body.split("\n")[0];

// A gate record for an earlier head, as the gate writes it.
function record({ cwd }, head, reasons) {
  const dir = join(cwd, ".git", "verify", "gate");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `88-${head.slice(0, 12)}.json`), JSON.stringify({ pr: "88", head, call: "not-ready", reasons, time: "2026-10-29T09:00:00.000Z" }));
}

test("[check-passes-marks-ready] a draft that passes is marked ready and asks the owner to review and merge", () => {
  const change = setup({ files: { "docs/a.md": "a\n" } });
  both(change);
  const r = apply(change);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.calls, /^pr ready 88$/m, r.calls);
  assert.ok(r.body, "the description was edited");
  assert.equal(firstLine(r.body), "**What you need to do:** review and merge.");
  assert.match(r.body, /## What changed\nA fix\./, "the rest of the description is kept");
  assert.doesNotMatch(r.calls, /^pr (merge|close)/m);
});

test("[owner-reasons-become-one-question] a draft whose only reason is an owner reason stays a draft and asks it", () => {
  const change = setup({ files: { "docs/a.md": "a\n" } });
  verdict(change, "claims-auditor", { findings: [finding({ claim: "Keep or delete drafts older than 30 days?" })] });
  verdict(change, "codex");
  const r = apply(change);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.doesNotMatch(r.calls, /^pr ready 88$/m, "it stays a draft");
  assert.ok(r.body, "the description was edited");
  assert.equal(firstLine(r.body), "**What you need to do:** answer this: Keep or delete drafts older than 30 days?");
});

test("[fix-reasons-keep-draft] a fix reason and an owner reason on the first round keep the draft and the description", () => {
  const change = setup({ files: { "docs/a.md": "a\n" } });
  verdict(change, "claims-auditor", { findings: [finding({ claim: "Keep or delete drafts older than 30 days?" })] });
  verdict(change, "codex");
  const rollup = [...passed, { __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE", name: "unit-tests" }];
  const r = apply(change, { view: { statusCheckRollup: rollup } });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.doesNotMatch(r.calls, /^pr ready/m, "it stays a draft");
  assert.equal(r.body, null, "the description is unchanged");
  assert.match(r.stdout, /unit-tests/);
  assert.match(r.stdout, /Keep or delete drafts/);
});

test("[new-commit-returns-to-draft] a ready pull request with no verdicts for its new head goes back to draft", () => {
  const change = setup({ files: { "docs/a.md": "a\n" } });
  const r = apply(change, { view: { isDraft: false } });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.calls, /^pr ready 88 --undo$/m, r.calls);
});

test("[three-rounds-then-owner] on the third head that still fails, the owner gets one question naming it", () => {
  const change = setup({ files: { "docs/a.md": "a\n" } });
  both(change);
  const failing = { kind: "fix", text: "check unit-tests failed" };
  record(change, "a".repeat(40), [failing]);
  record(change, "b".repeat(40), [failing]);
  const rollup = [...passed, { __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE", name: "unit-tests" }];
  const r = apply(change, { view: { statusCheckRollup: rollup } });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.doesNotMatch(r.calls, /^pr ready 88$/m, "it stays a draft");
  assert.ok(r.body, "the description was edited");
  const line = firstLine(r.body);
  assert.match(line, /^\*\*What you need to do:\*\* answer this: /);
  assert.match(line, /unit-tests/);
  assert.match(line, /[Tt]hree fix rounds/);
});
