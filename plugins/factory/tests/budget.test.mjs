// Locked acceptance tests for add-factory-gate. Change only with a Spec-Change commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let budget = {};
try { budget = await import(pathToFileURL(join(here, "..", "scripts", "lib", "budget.mjs"))); }
catch (error) { if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error; }

function need(name) {
  assert.equal(typeof budget[name], "function", `factory must export ${name}`);
  return budget[name];
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-27T12:00:00Z");

function reading(overrides = {}) {
  return {
    weeklyPercent: 60,
    fiveHourPercent: 10,
    fetchedAtMs: NOW - 60 * 60 * 1000,
    weeklyResetsAt: NOW + 5.4 * DAY,
    ...overrides,
  };
}

test("[fast-pace-is-lean] fast weekly consumption selects lean mode", () => {
  const evaluateReading = need("evaluateReading");
  const result = evaluateReading(reading(), NOW);
  assert.ok(Math.abs(result.pace - 2.6) < 0.1, `pace was ${result.pace}`);
  assert.equal(result.mode, "lean");
});

test("[ninety-percent-is-stop] either limit at ninety percent selects stop", () => {
  const evaluateReading = need("evaluateReading");
  assert.equal(evaluateReading(reading({ weeklyPercent: 92 }), NOW).mode, "stop");
  assert.equal(evaluateReading(reading({ fiveHourPercent: 90 }), NOW).mode, "stop");
});

test("[stale-reading-is-lean] a reading older than twelve hours is marked stale and lean", () => {
  const evaluateReading = need("evaluateReading");
  const result = evaluateReading(reading({ weeklyPercent: 10, fetchedAtMs: NOW - 20 * 60 * 60 * 1000 }), NOW);
  assert.equal(result.mode, "lean");
  assert.equal(result.stale, true);
});

test("[backup-folders-skipped] automatic discovery ignores backup Claude profiles", () => {
  const discoverClaudeAccounts = need("discoverClaudeAccounts");
  const home = mkdtempSync(join(tmpdir(), "factory-budget-"));
  for (const name of [".claude-work", ".claude-work.bak-2026-08-21"]) {
    const dir = join(home, name); mkdirSync(dir);
    writeFileSync(join(dir, ".claude.json"), JSON.stringify({ cachedUsageUtilization: { fetchedAtMs: NOW } }));
  }
  assert.deepEqual(discoverClaudeAccounts(home).map((entry) => entry.name), [".claude-work"]);
});

test("[codex-under-seventy-everywhere] healthy Codex capacity routes every zone to Codex", () => {
  const routeBreaker = need("routeBreaker");
  const route = routeBreaker(reading({ weeklyPercent: 66, fiveHourPercent: 11 }), NOW);
  assert.deepEqual(route.models, { low: "codex", standard: "codex", high: "codex" });
  assert.ok(route.reason);
});

test("[codex-seventy-to-ninety-saves-it] constrained Codex capacity is reserved for standard and high", () => {
  const routeBreaker = need("routeBreaker");
  const route = routeBreaker(reading({ weeklyPercent: 75 }), NOW);
  assert.deepEqual(route.models, { low: "opus", standard: "codex", high: "codex" });
  assert.match(route.reason, /75%|seventy|capacity/i);
});

test("[codex-missing-uses-opus] no Codex reading routes every zone to Opus with a reason", () => {
  const routeBreaker = need("routeBreaker");
  const route = routeBreaker(null, NOW);
  assert.deepEqual(route.models, { low: "opus", standard: "opus", high: "opus" });
  assert.equal(route.reason, "no Codex reading");
});
