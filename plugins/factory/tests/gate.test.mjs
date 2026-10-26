// Locked acceptance tests for add-factory-gate. Change only with a Spec-Change commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const factory = join(here, "..", "scripts", "factory.mjs");

async function optional(relative) {
  try { return await import(pathToFileURL(join(here, "..", "scripts", "lib", relative))); }
  catch (error) { if (error?.code === "ERR_MODULE_NOT_FOUND") return {}; throw error; }
}

const gateModule = await optional("gate.mjs");
const settingsModule = await optional("settings.mjs");
const zoneModule = await optional("zone.mjs");

function need(module, name) {
  assert.equal(typeof module[name], "function", `factory must export ${name}`);
  return module[name];
}

const SETTINGS = {
  allowedBases: ["dev"],
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
    pr: 412, head: "a".repeat(40), base: "dev", baseAllowed: true,
    bottomOfStack: true, fresh: true, conflict: false, ciChanged: false,
    draft: false, unresolvedThreads: false, checks: "green", zone: "low",
    changedFiles: ["src/components/Badge.tsx"], codeLines: 180,
    verdicts: [
      { reviewer: "claims-auditor", verdict: "READY", model: "claude-opus-4-1" },
      { reviewer: "codex", verdict: "READY", model: "gpt-5.1-codex" },
    ],
    runtimeChanged: false, liveProof: null, description: "",
    ...overrides,
  };
}

const messages = (result) => (result.reasons ?? []).map((r) => typeof r === "string" ? r : r.message).join("\n");

test("[all-facts-pass-would-merge] all required facts produce a shadow merge call", () => {
  const decideGate = need(gateModule, "decideGate");
  const result = decideGate(passing(), SETTINGS);
  assert.equal(result.call, "would-merge");
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /^SHADOW would-merge/m);
  assert.equal(result.merged, false);
});

test("[missing-fact-holds] a missing current review verdict fails closed", () => {
  const decideGate = need(gateModule, "decideGate");
  const result = decideGate(passing({ verdicts: [] }), SETTINGS);
  assert.equal(result.call, "would-hold");
  assert.equal(result.exitCode, 1);
  assert.match(messages(result), /no review verdict for this change/i);
});

test("[merge-on-is-refused] settings cannot enable merging", () => {
  const normalizeSettings = need(settingsModule, "normalizeSettings");
  assert.throws(
    () => normalizeSettings({ ...SETTINGS, merge: { ...SETTINGS.merge, low: "on" } }),
    /merging can't be switched on in this version/i,
  );
});

test("[checks-pending-holds-without-failing] pending checks are recorded as waiting", () => {
  const decideGate = need(gateModule, "decideGate");
  const result = decideGate(passing({ checks: "pending" }), SETTINGS);
  const reason = (result.reasons ?? []).find((r) => (r.message ?? r) === "checks still running");
  assert.ok(reason, messages(result));
  assert.equal(reason.kind, "waiting");
});

test("[body-claim-ignored] the diff, not the pull request body, selects the high zone", () => {
  const classifyZone = need(zoneModule, "classifyZone");
  const result = classifyZone(["src/auth/session.ts"], SETTINGS, { body: "Low risk, easy to undo." });
  assert.equal(result.zone, "high");
  const decideGate = need(gateModule, "decideGate");
  assert.match(messages(decideGate(passing({ zone: result.zone }), SETTINGS)), /high zone/i);
});

test("[never-merge-path-holds] a never-merge path is named", () => {
  const decideGate = need(gateModule, "decideGate");
  const result = decideGate(passing({ changedFiles: ["src/components/Badge.tsx", ".github/workflows/ci.yml"] }), SETTINGS);
  assert.match(messages(result), /\.github\/workflows\/ci\.yml/);
});

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function repo() {
  const cwd = mkdtempSync(join(tmpdir(), "factory-gate-"));
  git(cwd, "init", "-q", "-b", "main");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "user.name", "Test");
  writeFileSync(join(cwd, "package.json"), "{\"type\":\"module\"}\n");
  mkdirSync(join(cwd, ".claude"), { recursive: true });
  writeFileSync(join(cwd, ".claude", "verify.json"), JSON.stringify({ integrationBranch: "main", factory: SETTINGS }, null, 2));
  git(cwd, "add", "."); git(cwd, "commit", "-qm", "base");
  return cwd;
}

function fakeGh(cwd, payload) {
  const bin = join(cwd, "fake-bin"); mkdirSync(bin, { recursive: true });
  const script = join(bin, "gh");
  writeFileSync(script, `#!/bin/sh\nprintf '%s' "$FACTORY_FAKE_GH"\n`);
  chmodSync(script, 0o755);
  return { ...process.env, PATH: `${bin}:${process.env.PATH}`, FACTORY_FAKE_GH: JSON.stringify(payload) };
}

function runGate(cwd, payload, env = fakeGh(cwd, payload)) {
  return spawnSync("node", [factory, "gate", "417"], { cwd, env, encoding: "utf8" });
}

test("[zone-command-runs-from-trunk] the clean trunk copy of the zone command wins", () => {
  const cwd = repo(); mkdirSync(join(cwd, "scripts")); mkdirSync(join(cwd, "src", "auth"), { recursive: true });
  writeFileSync(join(cwd, "scripts", "zone.mjs"), 'console.log(JSON.stringify({zone:"high"}));\n');
  writeFileSync(join(cwd, "src", "auth", "session.ts"), "export const session = true;\n");
  const settings = JSON.parse(readFileSync(join(cwd, ".claude", "verify.json"), "utf8"));
  settings.factory.zone.command = "node scripts/zone.mjs";
  writeFileSync(join(cwd, ".claude", "verify.json"), JSON.stringify(settings, null, 2));
  git(cwd, "add", "."); git(cwd, "commit", "-qm", "trunk zone");
  const head = git(cwd, "rev-parse", "HEAD");
  const result = runGate(cwd, { number: 417, baseRefName: "main", headRefOid: head, files: [{ path: "src/auth/session.ts", additions: 1, deletions: 0 }] });
  assert.match(`${result.stdout}${result.stderr}`, /high zone/i);
});

test("[not-bottom-of-stack-holds] a pull request based on another open pull request holds", () => {
  const decideGate = need(gateModule, "decideGate");
  assert.match(messages(decideGate(passing({ base: "feat/reminders-1", baseAllowed: false, bottomOfStack: false }), SETTINGS)), /not the bottom of its stack/i);
});

test("[trunk-moved-under-change-holds] a trunk commit touching the same file holds", () => {
  const cwd = repo(); mkdirSync(join(cwd, "src")); writeFileSync(join(cwd, "src", "a.ts"), "export const a = 0;\n");
  git(cwd, "add", "."); git(cwd, "commit", "-qm", "shared base");
  git(cwd, "switch", "-qc", "feature"); writeFileSync(join(cwd, "src", "a.ts"), "export const a = 1;\n"); git(cwd, "commit", "-qam", "feature");
  const feature = git(cwd, "rev-parse", "HEAD");
  git(cwd, "switch", "-q", "main"); writeFileSync(join(cwd, "src", "a.ts"), "export const a = 2;\n"); git(cwd, "commit", "-qam", "trunk moved");
  const result = runGate(cwd, { number: 420, baseRefName: "main", headRefOid: feature, files: [{ path: "src/a.ts", additions: 1, deletions: 1 }] });
  assert.match(`${result.stdout}${result.stderr}`, /trunk changed src\/a\.ts since this pull request branched/i);
});

test("[codex-verdict-from-claude-holds] a Codex verdict must name an OpenAI model", () => {
  const decideGate = need(gateModule, "decideGate");
  const verdicts = passing().verdicts.map((v) => v.reviewer === "codex" ? { ...v, model: "claude-sonnet-5-5" } : v);
  assert.match(messages(decideGate(passing({ verdicts }), SETTINGS)), /Codex verdict didn't come from Codex/i);
});

test("[codex-verdict-without-model-holds] a Codex verdict must record its model", () => {
  const decideGate = need(gateModule, "decideGate");
  const verdicts = passing().verdicts.map((v) => v.reviewer === "codex" ? { ...v, model: null } : v);
  assert.match(messages(decideGate(passing({ verdicts }), SETTINGS)), /Codex verdict doesn't say which model ran it/i);
});

test("[runtime-change-without-live-proof-holds] visible runtime work requires live proof for the head", () => {
  const decideGate = need(gateModule, "decideGate");
  assert.match(messages(decideGate(passing({ runtimeChanged: true, changedFiles: ["app/settings/page.tsx"] }), SETTINGS)), /no live proof for this commit/i);
});

test("[flag-required-but-missing-holds] flagged projects require a Flag line for runtime work", () => {
  const decideGate = need(gateModule, "decideGate");
  const settings = { ...SETTINGS, flagsRequired: true };
  assert.match(messages(decideGate(passing({ runtimeChanged: true, liveProof: "verified live", changedFiles: ["app/home/page.tsx"] }), settings)), /new behavior must name its flag/i);
});

test("[tests-dont-count-toward-size] ignored test lines do not consume the code limit", () => {
  const decideGate = need(gateModule, "decideGate");
  const result = decideGate(passing({ codeLines: 300, ignoredLines: 900 }), SETTINGS);
  assert.doesNotMatch(messages(result), /over the .* limit/i);
});

test("[over-size-holds] changed code over the configured limit holds", () => {
  const decideGate = need(gateModule, "decideGate");
  assert.match(messages(decideGate(passing({ codeLines: 520 }), SETTINGS)), /520 changed code lines, over the 400 limit/i);
});

test("[rerun-replaces-record] rerunning one pull request head replaces its ledger record", () => {
  const cwd = repo();
  const payload = { number: 412, baseRefName: "main", headRefOid: git(cwd, "rev-parse", "HEAD"), files: [{ path: "docs/readme.md", additions: 1, deletions: 0 }] };
  const first = runGate(cwd, payload); assert.notEqual(first.status, null);
  const second = runGate(cwd, payload); assert.notEqual(second.status, null);
  const ledger = join(cwd, ".git", "factory", "ledger");
  assert.ok(existsSync(ledger), "factory gate must write the ledger folder");
  assert.equal(readdirSync(ledger).length, 1);
  const record = JSON.parse(readFileSync(join(ledger, readdirSync(ledger)[0]), "utf8"));
  assert.equal(record.pr, 412);
  assert.equal(record.head, payload.headRefOid);
});
