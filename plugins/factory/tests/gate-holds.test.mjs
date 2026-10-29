// Pins the gate's hold rules and fail-closed paths (review round 1, claims-auditor-2 and the fixes for 1, 3, 4, 6, codex-1..3).
// gate.test.mjs is locked, so these live in their own file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { decideGate } from "../scripts/lib/gate.mjs";
import { collectFacts, countLines, summarizeChecks } from "../scripts/lib/facts.mjs";
import { classifyZone, zoneFor } from "../scripts/lib/zone.mjs";
import { writeRecord } from "../scripts/lib/ledger.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const factory = join(here, "..", "scripts", "factory.mjs");

const SETTINGS = {
  allowedBases: ["main"],
  zone: { command: null, high: ["src/auth/**"], standard: ["src/**"], low: ["docs/**", "src/components/**"] },
  neverMerge: [".github/**", "openspec/**", ".claude/verify.json"],
  runtimeSurface: ["app/**"],
  flagsRequired: false,
  sizeLimit: 400,
  notCounted: ["**/*.test.*", "**/__tests__/**", "**/*.lock"],
  merge: { low: "shadow", standard: "shadow", high: "off" },
};

function passing(overrides = {}) {
  return {
    pr: 412, head: "a".repeat(40), base: "main", baseAllowed: true,
    bottomOfStack: true, fresh: true, conflict: false, ciChanged: false,
    draft: false, unresolvedThreads: false, checks: "green", zone: "low",
    changedFiles: ["docs/a.md"], codeLines: 180, missing: [],
    verdicts: [
      { reviewer: "claims-auditor", verdict: "READY", model: "claude-opus-4-1" },
      { reviewer: "codex", verdict: "READY", model: "gpt-5.1-codex" },
    ],
    runtimeChanged: false, liveProof: null, description: "",
    ...overrides,
  };
}
const text = (result) => result.reasons.map((r) => r.message).join("\n");
const holds = (overrides, pattern, settings = SETTINGS) => {
  const result = decideGate(passing(overrides), settings);
  assert.equal(result.call, "would-hold");
  assert.equal(result.exitCode, 1);
  assert.match(text(result), pattern);
};

// Pure decision.
test("the all-passing fixture merges (control for the hold tests)", () => {
  assert.equal(decideGate(passing(), SETTINGS).call, "would-merge");
});
test("a missing fact holds even when nothing else is wrong", () => {
  holds({ missing: [{ fact: "trunk", why: "gone" }] }, /can't read trunk: gone/);
  holds({ checks: undefined }, /can't read checks/);
  holds({ codeLines: undefined }, /can't read codeLines/);
});
test("each plain hold rule holds", () => {
  holds({ draft: true }, /draft/);
  holds({ conflict: true, fresh: false }, /conflicts with the current trunk/);
  holds({ ciChanged: true, fresh: false }, /CI configuration/);
  holds({ unresolvedThreads: true }, /unresolved review threads/);
  holds({ checks: "red" }, /checks failing/);
  holds({ checks: "none" }, /no check results/);
  holds({ base: "feat/x", baseAllowed: false }, /base feat\/x is not an allowed base/);
  holds({ fresh: false }, /not fresh/);
  holds({ verdicts: passing().verdicts.map((v) => ({ ...v, verdict: "NOT READY" })) }, /claims-auditor verdict is NOT READY/);
  holds({ zone: "high" }, /high zone/);
  holds({ complianceChange: "x", compliance: null }, /no spec compliance report for x/);
  holds({ complianceChange: "x", compliance: { ok: false } }, /spec compliance report for x holds/);
});
test("pending checks are waiting, not failing", () => {
  const result = decideGate(passing({ checks: "pending" }), SETTINGS);
  assert.equal(result.reasons[0].kind, "waiting");
});
test("size 400 passes and 401 holds", () => {
  assert.equal(decideGate(passing({ codeLines: 400 }), SETTINGS).call, "would-merge");
  holds({ codeLines: 401 }, /401 changed code lines, over the 400 limit/);
});
test("an empty Flag: line does not satisfy the flag requirement", () => {
  const settings = { ...SETTINGS, flagsRequired: true };
  const base = { runtimeChanged: true, liveProof: "verified live", changedFiles: ["app/x.tsx"] };
  holds({ ...base, description: "Flag:\nSome prose without a flag" }, /must name its flag/, settings);
  holds({ ...base, description: "Flag:   \r\nnext" }, /must name its flag/, settings);
  assert.equal(decideGate(passing({ ...base, description: "Flag: new_button" }), settings).call, "would-merge");
});

// Pure helpers.
test("empty status checks are 'none'", () => {
  assert.equal(summarizeChecks([]), "none");
  assert.equal(summarizeChecks(undefined), "none");
  assert.equal(summarizeChecks([{ status: "COMPLETED", conclusion: "SUCCESS" }]), "green");
});
test("notCounted files are skipped when counting lines", () => {
  const result = countLines([
    { path: "src/a.ts", additions: 10, deletions: 5 },
    { path: "src/a.test.ts", additions: 100, deletions: 100 },
    { path: "yarn.lock", additions: 7, deletions: 0 },
  ], SETTINGS);
  assert.deepEqual(result, { codeLines: 15, ignoredLines: 207 });
});

// Git fixtures.
function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function write(cwd, path, content) {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), content);
}
function repo() {
  const cwd = mkdtempSync(join(tmpdir(), "factory-holds-"));
  git(cwd, "init", "-q", "-b", "main");
  git(cwd, "config", "user.email", "t@example.com");
  git(cwd, "config", "user.name", "T");
  write(cwd, ".claude/verify.json", JSON.stringify({ integrationBranch: "main", factory: SETTINGS }));
  write(cwd, "docs/readme.md", "hi\n");
  git(cwd, "add", "."); git(cwd, "commit", "-qm", "base");
  return cwd;
}
const commit = (cwd, message = "c") => { git(cwd, "add", "."); git(cwd, "commit", "-qm", message); return git(cwd, "rev-parse", "HEAD"); };

// A stub gh and a stub verify plugin.
function tools() {
  const dir = mkdtempSync(join(tmpdir(), "factory-tools-"));
  mkdirSync(join(dir, "bin")); mkdirSync(join(dir, "verify"));
  writeFileSync(join(dir, "bin", "gh"), `#!/usr/bin/env node
const a = process.argv.slice(2), e = process.env;
if (a[0] === "pr" && a[1] === "view") process.stdout.write(e.GH_VIEW);
else if (a[0] === "api" && a[1] === "graphql") {
  const pages = JSON.parse(e.GH_GQL);
  const after = a.find((x) => x.startsWith("after="));
  const index = after ? Number(after.slice(7).replace("c", "")) : 0;
  if (index >= pages.length) process.exit(1);
  process.stdout.write(JSON.stringify(pages[index]));
} else if (a[0] === "pr" && a[1] === "list") process.stdout.write(e.GH_LIST || "[]");
else process.exit(1);
`);
  chmodSync(join(dir, "bin", "gh"), 0o755);
  writeFileSync(join(dir, "verify", "evidence.mjs"), "process.exit(0)\n");
  writeFileSync(join(dir, "verify", "verdict.mjs"),
    'console.log(JSON.stringify({ ok: true, patchId: "stub", claimsAuditor: { reviewer: "claims-auditor", verdict: "ready" }, other: { reviewer: "codex", verdict: "ready", model: "gpt-5.1-codex" } }));\n');
  return dir;
}
const thread = (nodes, hasNextPage = false, endCursor = null) => ({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage, endCursor }, nodes } } } } });
const green = [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS", name: "ci" }];

function gather(cwd, { head, files, view = {}, pages = [thread([])], settings = SETTINGS, pr = 7 }) {
  const dir = tools();
  const env = {
    ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}`, CSTACK_VERIFY: join(dir, "verify"),
    GH_VIEW: JSON.stringify({ number: pr, baseRefName: "main", headRefOid: head, isDraft: false, body: "", files, statusCheckRollup: green, ...view }),
    GH_GQL: JSON.stringify(pages),
  };
  const facts = collectFacts({ cwd, pr, settings, env });
  return { facts, result: decideGate(facts, settings), env };
}
const branch = (cwd, name, edit) => { git(cwd, "switch", "-qc", name); edit(); const head = commit(cwd, name); git(cwd, "switch", "-q", "main"); return head; };
const file = (path, additions = 1, deletions = 0) => ({ path, additions, deletions });

test("control: a clean docs change merges end to end", () => {
  const cwd = repo(); const head = branch(cwd, "f", () => write(cwd, "docs/x.md", "x\n"));
  const { facts, result } = gather(cwd, { head, files: [file("docs/x.md")] });
  assert.deepEqual(facts.missing, []);
  assert.equal(result.call, "would-merge", text(result));
});

test("[claims-auditor-1] paths and sizes come from git, not from gh's file list", () => {
  const cwd = repo();
  const head = branch(cwd, "f", () => { write(cwd, "docs/x.md", "x\n"); write(cwd, ".github/workflows/ci.yml", "on: push\n"); write(cwd, "src/auth/s.ts", "x\n"); });
  const { facts, result } = gather(cwd, { head, files: [file("docs/x.md")] });
  assert.deepEqual([...facts.changedFiles].sort(), [".github/workflows/ci.yml", "docs/x.md", "src/auth/s.ts"]);
  assert.equal(facts.zone, "high");
  assert.equal(result.call, "would-hold");
  assert.match(text(result), /\.github\/workflows\/ci\.yml is a never-merge path/);
  assert.match(text(result), /high zone/);
});

test("[claims-auditor-1] runtime surface is read from the real diff", () => {
  const cwd = repo(); const head = branch(cwd, "f", () => write(cwd, "app/page.tsx", "x\n"));
  const { facts } = gather(cwd, { head, files: [file("docs/x.md")] });
  assert.equal(facts.runtimeChanged, true);
});

test("[claims-auditor-1] a path gh lists that git does not show holds as unreadable", () => {
  const cwd = repo(); const head = branch(cwd, "f", () => write(cwd, "docs/x.md", "x\n"));
  const { facts, result } = gather(cwd, { head, files: [file("docs/x.md"), file("docs/ghost.md")] });
  assert.ok(facts.missing.some((m) => m.fact === "changed files"));
  assert.match(text(result), /can't read changed files/);
});

test("[claims-auditor-4] line counts come from git when gh gives none", () => {
  const cwd = repo(); const head = branch(cwd, "f", () => write(cwd, "src/big.ts", "x\n".repeat(900)));
  const { facts, result } = gather(cwd, { head, files: [{ path: "src/big.ts" }] });
  assert.equal(facts.codeLines, 900);
  assert.match(text(result), /900 changed code lines, over the 400 limit/);
});

test("[claims-auditor-4] test files from git are not counted", () => {
  const cwd = repo(); const head = branch(cwd, "f", () => { write(cwd, "src/a.test.ts", "x\n".repeat(900)); write(cwd, "src/a.ts", "x\n".repeat(5)); });
  const { facts } = gather(cwd, { head, files: [file("src/a.ts")] });
  assert.equal(facts.codeLines, 5);
  assert.equal(facts.ignoredLines, 900);
});

test("[claims-auditor-3] a trunk rename of a file the PR edits holds", () => {
  const cwd = repo(); write(cwd, "src/a.ts", "export const a = 0;\n"); commit(cwd, "a");
  const head = branch(cwd, "f", () => write(cwd, "src/a.ts", "export const a = 1;\n"));
  git(cwd, "mv", "src/a.ts", "src/b.ts"); commit(cwd, "rename");
  const { facts, result } = gather(cwd, { head, files: [file("src/a.ts", 1, 1)] });
  assert.ok(facts.trunkTouched.includes("src/a.ts"), JSON.stringify(facts.trunkTouched));
  assert.match(text(result), /trunk changed src\/a\.ts since this pull request branched/);
});

test("[codex-1] a trunk edit to a non-ASCII path is still seen", () => {
  const cwd = repo(); write(cwd, "src/é.ts", "1\n2\n3\n4\n5\n"); commit(cwd, "é");
  const head = branch(cwd, "f", () => write(cwd, "src/é.ts", "one\n2\n3\n4\n5\n"));
  write(cwd, "src/é.ts", "1\n2\n3\n4\nfive\n"); commit(cwd, "trunk edit");
  const { facts, result } = gather(cwd, { head, files: [file("src/é.ts", 1, 1)] });
  assert.deepEqual(facts.trunkTouched, ["src/é.ts"]);
  assert.match(text(result), /trunk changed src\/é\.ts/);
});

test("[codex-2] 100 resolved threads and a second page of resolved threads do not hold", () => {
  const cwd = repo(); const head = branch(cwd, "f", () => write(cwd, "docs/x.md", "x\n"));
  const resolved = Array.from({ length: 100 }, () => ({ isResolved: true }));
  const { facts, result } = gather(cwd, { head, files: [file("docs/x.md")], pages: [thread(resolved, true, "c1"), thread([{ isResolved: true }])] });
  assert.equal(facts.unresolvedThreads, false);
  assert.equal(result.call, "would-merge", text(result));
});

test("[codex-2] an unresolved thread on a later page holds", () => {
  const cwd = repo(); const head = branch(cwd, "f", () => write(cwd, "docs/x.md", "x\n"));
  const resolved = Array.from({ length: 100 }, () => ({ isResolved: true }));
  const { result } = gather(cwd, { head, files: [file("docs/x.md")], pages: [thread(resolved, true, "c1"), thread([{ isResolved: false }])] });
  assert.match(text(result), /unresolved review threads/);
});

test("[codex-2] a page that cannot be read holds as unreadable, not as unresolved", () => {
  const cwd = repo(); const head = branch(cwd, "f", () => write(cwd, "docs/x.md", "x\n"));
  const resolved = Array.from({ length: 100 }, () => ({ isResolved: true }));
  const { result } = gather(cwd, { head, files: [file("docs/x.md")], pages: [thread(resolved, true, "c1")] });
  assert.equal(result.call, "would-hold");
  assert.match(text(result), /can't read review threads/);
  assert.doesNotMatch(text(result), /unresolved review threads/);
});

test("empty status checks hold end to end", () => {
  const cwd = repo(); const head = branch(cwd, "f", () => write(cwd, "docs/x.md", "x\n"));
  const { facts, result } = gather(cwd, { head, files: [file("docs/x.md")], view: { statusCheckRollup: [] } });
  assert.equal(facts.checks, "none");
  assert.match(text(result), /no check results/);
});

test("a head commit that is not in the checkout holds", () => {
  const cwd = repo();
  const { result } = gather(cwd, { head: "b".repeat(40), files: [file("docs/x.md")] });
  assert.equal(result.call, "would-hold");
  assert.match(text(result), /can't read head commit/);
});

// Zone command.
function zoneRepo(marker) {
  const cwd = repo();
  write(cwd, "scripts/zone.mjs", `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "ran"); console.log(JSON.stringify({ zone: "high" }));\n`);
  commit(cwd, "zone command");
  const head = branch(cwd, "f", () => { write(cwd, "scripts/zone.mjs", 'console.log(JSON.stringify({ zone: "low" }));\n'); write(cwd, "docs/x.md", "x\n"); });
  const settings = { ...SETTINGS, zone: { command: "node scripts/zone.mjs", high: [], standard: [], low: ["**"] } };
  return { cwd, head, settings, files: [file("scripts/zone.mjs", 1, 1), file("docs/x.md")] };
}
const markerPath = () => join(mkdtempSync(join(tmpdir(), "factory-marker-")), "ran");

test("the zone command beats the patterns, and a PR copy of the script is ignored", () => {
  const marker = markerPath(); const z = zoneRepo(marker);
  assert.equal(classifyZone(["docs/x.md"], z.settings).zone, "low");
  const { facts } = gather(z.cwd, z);
  assert.equal(existsSync(marker), true);
  assert.equal(facts.zone, "high");
});

test("a checkout that is not on the trunk commit skips the zone command and holds", () => {
  const marker = markerPath(); const z = zoneRepo(marker);
  git(z.cwd, "switch", "-q", "f");
  const { facts, result } = gather(z.cwd, z);
  assert.equal(existsSync(marker), false);
  assert.ok(facts.missing.some((m) => m.fact === "zone"));
  assert.equal(result.call, "would-hold");
});

test("a dirty tracked file skips the zone command and holds", () => {
  const marker = markerPath(); const z = zoneRepo(marker);
  write(z.cwd, "docs/readme.md", "dirty\n");
  const { facts, result } = gather(z.cwd, z);
  assert.equal(existsSync(marker), false);
  assert.ok(facts.missing.some((m) => m.fact === "zone"));
  assert.equal(result.call, "would-hold");
});

test("zoneFor without a command uses the patterns", () => {
  assert.equal(zoneFor(["src/auth/x.ts"], SETTINGS, {}).zone, "high");
});

// Ledger.
test("the ledger record is named <pr>-<12 hex>.json and carries settings, time, zone and call", () => {
  const cwd = repo(); const head = "0123456789abcdef".repeat(2) + "01234567";
  const path = writeRecord(cwd, { pr: 412, head, zone: "low", call: "would-hold", reasons: [{ kind: "hold", message: "x" }], now: new Date("2026-01-02T03:04:05.000Z") });
  assert.match(path, /\/ledger\/412-0123456789ab\.json$/);
  const record = JSON.parse(readFileSync(path, "utf8"));
  assert.match(record.settings, /^[0-9a-f]{64}$/);
  assert.equal(record.time, "2026-01-02T03:04:05.000Z");
  assert.equal(record.zone, "low");
  assert.equal(record.call, "would-hold");
  assert.equal(record.head, head);
  assert.equal(readdirSync(join(cwd, ".git", "factory", "ledger")).length, 1);
});
test("a head that is not a commit id gets no record", () => {
  assert.throws(() => writeRecord(repo(), { pr: 1, head: "main", call: "would-hold", reasons: [] }), /no head commit/);
});

test("[claims-auditor-6] a ledger write failure prints would-hold and exits 1, never would-merge", () => {
  const cwd = repo(); const head = branch(cwd, "f", () => write(cwd, "docs/x.md", "x\n"));
  writeFileSync(join(cwd, ".git", "factory"), "");
  const { env } = gather(cwd, { head, files: [file("docs/x.md")] });
  const run = spawnSync("node", [factory, "gate", "7"], { cwd, env, encoding: "utf8" });
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stdout, /^SHADOW would-hold/m);
  assert.doesNotMatch(run.stdout, /would-merge/);
  assert.match(run.stdout, /could not record the call/);
});

test("the ledger is written before the call is printed", () => {
  const cwd = repo(); const head = branch(cwd, "f", () => write(cwd, "docs/x.md", "x\n"));
  const { env } = gather(cwd, { head, files: [file("docs/x.md")] });
  const run = spawnSync("node", [factory, "gate", "7"], { cwd, env, encoding: "utf8" });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /^SHADOW would-merge/m);
  const dir = join(cwd, ".git", "factory", "ledger");
  const record = JSON.parse(readFileSync(join(dir, readdirSync(dir)[0]), "utf8"));
  assert.equal(record.call, "would-merge");
});

test("a trunk that is not in the checkout is reported as unreadable", () => {
  const cwd = repo(); const head = branch(cwd, "f", () => write(cwd, "docs/x.md", "x\n"));
  const { facts, result } = gather(cwd, { head, files: [file("docs/x.md")], view: { baseRefName: "feat/gone" }, settings: { ...SETTINGS, allowedBases: ["nowhere"] } });
  assert.ok(facts.missing.some((m) => m.fact === "trunk"), JSON.stringify(facts.missing));
  assert.match(text(result), /can't read trunk/);
});

// Review round 3.

test("[codex-1] a trunk edit that a later trunk commit restored is still seen", () => {
  const cwd = repo(); write(cwd, "src/a.ts", "export const a = 0;\n"); commit(cwd, "a");
  const head = branch(cwd, "f", () => write(cwd, "src/a.ts", "export const a = 1;\n"));
  write(cwd, "src/a.ts", "export const a = 2;\n"); commit(cwd, "trunk edit");
  write(cwd, "src/a.ts", "export const a = 0;\n"); commit(cwd, "trunk restore");
  const { facts, result } = gather(cwd, { head, files: [file("src/a.ts", 1, 1)] });
  assert.deepEqual(facts.trunkTouched, ["src/a.ts"]);
  assert.match(text(result), /trunk changed src\/a\.ts since this pull request branched/);
});

test("[codex-1] a CI config change that a later trunk commit reverted is still seen", () => {
  const cwd = repo(); const head = branch(cwd, "f", () => write(cwd, "docs/x.md", "x\n"));
  write(cwd, ".github/workflows/ci.yml", "on: push\n"); commit(cwd, "add ci");
  git(cwd, "rm", "-q", ".github/workflows/ci.yml"); commit(cwd, "remove ci");
  const { facts, result } = gather(cwd, { head, files: [file("docs/x.md")] });
  assert.equal(facts.ciChanged, true);
  assert.match(text(result), /CI configuration/);
});
