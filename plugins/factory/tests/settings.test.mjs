import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeSettings, readSettings } from "../scripts/lib/settings.mjs";

test("factory settings default the allowed base to the integration branch", () => {
  const settings = normalizeSettings({}, { integrationBranch: "dev" });
  assert.deepEqual(settings.allowedBases, ["dev"]);
  assert.deepEqual(settings.merge, { low: "shadow", standard: "shadow", high: "off" });
});

test("factory settings always protect workflow, spec and settings paths", () => {
  const settings = normalizeSettings({ neverMerge: ["infra/**"] }, { integrationBranch: "main" });
  for (const path of ["infra/**", ".github/**", "openspec/**", ".claude/verify.json"]) {
    assert.ok(settings.neverMerge.includes(path), path);
  }
});

test("factory settings preserve explicit project values while filling defaults", () => {
  const settings = normalizeSettings({
    allowedBases: ["release"],
    zone: { high: ["src/auth/**"] },
    runtimeSurface: ["app/**"],
    flagsRequired: true,
    sizeLimit: 250,
    merge: { low: "off" },
  }, { integrationBranch: "dev" });
  assert.deepEqual(settings.allowedBases, ["release"]);
  assert.deepEqual(settings.zone, { command: null, high: ["src/auth/**"], standard: [], low: [] });
  assert.equal(settings.flagsRequired, true);
  assert.equal(settings.sizeLimit, 250);
  assert.deepEqual(settings.merge, { low: "off", standard: "shadow", high: "off" });
});

test("factory settings reject unknown merge modes in every zone", () => {
  for (const zone of ["low", "standard", "high"]) {
    assert.throws(
      () => normalizeSettings({ merge: { [zone]: "on" } }, { integrationBranch: "main" }),
      /merging can't be switched on in this version/i,
    );
  }
});

test("readSettings reads the factory block from the project settings file", () => {
  const cwd = mkdtempSync(join(tmpdir(), "factory-settings-"));
  mkdirSync(join(cwd, ".claude"));
  writeFileSync(join(cwd, ".claude", "verify.json"), JSON.stringify({
    integrationBranch: "dev",
    factory: { sizeLimit: 300 },
  }));
  const settings = readSettings(cwd);
  assert.deepEqual(settings.allowedBases, ["dev"]);
  assert.equal(settings.sizeLimit, 300);
});
