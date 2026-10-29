import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeSettings, readSettings } from "../scripts/lib/gate/settings.mjs";

test("gate settings default the allowed base to the integration branch", () => {
  const settings = normalizeSettings({}, { integrationBranch: "dev" });
  assert.deepEqual(settings.allowedBases, ["dev"]);
  assert.equal(settings.reviews, "always");
  assert.deepEqual(settings.highRisk, []);
});

test("gate settings preserve explicit project values while filling defaults", () => {
  const settings = normalizeSettings({
    allowedBases: ["release"],
    zone: { high: ["src/auth/**"] },
    runtimeSurface: ["app/**"],
    flagsRequired: true,
    sizeLimit: 250,
    reviews: "highRisk",
  }, { integrationBranch: "dev", highRisk: ["src/auth/**"] });
  assert.deepEqual(settings.allowedBases, ["release"]);
  assert.deepEqual(settings.zone, { command: null, high: ["src/auth/**"], standard: [], low: [] });
  assert.equal(settings.flagsRequired, true);
  assert.equal(settings.sizeLimit, 250);
  assert.equal(settings.reviews, "highRisk");
  assert.deepEqual(settings.highRisk, ["src/auth/**"]);
});

test("gate settings reject a reviews value other than always or highRisk", () => {
  assert.throws(() => normalizeSettings({ reviews: "never" }, {}), /gate\.reviews must be "always" or "highRisk"/);
});

test("gate settings ignore the dropped merge and neverMerge fields", () => {
  const settings = normalizeSettings({ merge: { low: "on" }, neverMerge: ["infra/**"] }, {});
  assert.equal(settings.merge, undefined);
  assert.equal(settings.neverMerge, undefined);
});

function project(block) {
  const cwd = mkdtempSync(join(tmpdir(), "gate-settings-"));
  mkdirSync(join(cwd, ".claude"));
  writeFileSync(join(cwd, ".claude", "verify.json"), JSON.stringify({ integrationBranch: "dev", ...block }));
  return cwd;
}

test("readSettings reads the gate block from the project settings file", () => {
  const settings = readSettings(project({ gate: { sizeLimit: 300 } }));
  assert.deepEqual(settings.allowedBases, ["dev"]);
  assert.equal(settings.sizeLimit, 300);
});

test("readSettings prefers the gate block over the old factory block", () => {
  assert.equal(readSettings(project({ gate: { sizeLimit: 300 }, factory: { sizeLimit: 100 } })).sizeLimit, 300);
});
