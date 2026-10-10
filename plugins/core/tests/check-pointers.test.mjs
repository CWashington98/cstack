import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { missingSkills, githubTree, isLive, findMarketplace } from "../scripts/check-pointers.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const market = JSON.parse(readFileSync(join(root, ".claude-plugin", "marketplace.json"), "utf8"));

const one = (skills, path = "skills") => ({
  plugins: [{ name: "x-picks", strict: false, skills, source: { source: "git-subdir", url: "https://github.com/a/b.git", path, sha: "1".repeat(40) } }],
});
const tree = (...paths) => async () => new Set(paths);

test("a picked skill whose folder has a SKILL.md at the pinned commit passes", async () => {
  assert.deepEqual(await missingSkills(one(["./good"]), tree("skills/good/SKILL.md")), []);
});

test("a misspelled skill name is reported", async () => {
  const missing = await missingSkills(one(["./godo"]), tree("skills/good/SKILL.md"));
  assert.deepEqual(missing, [{ plugin: "x-picks", skill: "godo", expected: "skills/godo/SKILL.md" }]);
});

test("a missing second pick is reported even when the first exists", async () => {
  const missing = await missingSkills(one(["./good", "./gone"]), tree("skills/good/SKILL.md"));
  assert.deepEqual(missing.map((m) => m.skill), ["gone"]);
});

test("a wrong folder path is reported for every skill", async () => {
  const missing = await missingSkills(one(["./good"], "plugins/skills"), tree("skills/good/SKILL.md"));
  assert.equal(missing.length, 1);
});

test("a commit that can't be read reports every skill as missing, with the reason", async () => {
  const failing = async () => { throw new Error("No commit found for the ref"); };
  const missing = await missingSkills(one(["./a", "./b"]), failing);
  assert.equal(missing.length, 2);
  assert.match(missing[0].reason, /No commit found/);
});

test("local plugins and whole-repository sources are not checked here", async () => {
  const m = { plugins: [{ name: "core", source: "./plugins/core" }, { name: "u", source: { source: "url", url: "x", sha: "2".repeat(40) } }] };
  assert.deepEqual(await missingSkills(m, async () => { throw new Error("should not be called"); }), []);
});

const script = join(root, "plugins", "core", "scripts", "check-pointers.mjs");
const emptyMarket = JSON.stringify({ plugins: [{ name: "core", source: "./plugins/core" }] });

test("in a cstack checkout, the marketplace file is found three folders up", () => {
  assert.equal(findMarketplace(join(root, "plugins", "core", "scripts")), join(root, ".claude-plugin", "marketplace.json"));
});

test("in an installed plugin, the marketplace file is found in the profile's copy of the cstack catalog", () => {
  const profile = mkdtempSync(join(tmpdir(), "cstack-profile-"));
  const scripts = join(profile, "plugins", "cache", "cstack", "cstack", "2.1.0", "scripts");
  const catalog = join(profile, "plugins", "marketplaces", "cstack", ".claude-plugin");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(catalog, { recursive: true });
  writeFileSync(join(catalog, "marketplace.json"), emptyMarket);
  assert.equal(findMarketplace(scripts), join(catalog, "marketplace.json"));
});

test("run from an installed plugin with no argument, the command finds the catalog and exits 0", () => {
  const profile = mkdtempSync(join(tmpdir(), "cstack-profile-"));
  const scripts = join(profile, "plugins", "cache", "cstack", "cstack", "2.1.0", "scripts");
  const catalog = join(profile, "plugins", "marketplaces", "cstack", ".claude-plugin");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(catalog, { recursive: true });
  writeFileSync(join(catalog, "marketplace.json"), emptyMarket);
  copyFileSync(script, join(scripts, "check-pointers.mjs"));
  const out = execFileSync("node", [join(scripts, "check-pointers.mjs")], { encoding: "utf8" });
  assert.match(out, /All 0 picked skills exist/);
});

test("with no marketplace file anywhere, the command says so and exits 2 instead of crashing", () => {
  const lonely = mkdtempSync(join(tmpdir(), "cstack-lonely-"));
  copyFileSync(script, join(lonely, "check-pointers.mjs"));
  let code = 0, err = "";
  try { execFileSync("node", [join(lonely, "check-pointers.mjs")], { encoding: "utf8", stdio: "pipe" }); }
  catch (e) { code = e.status; err = e.stderr; }
  assert.equal(code, 2);
  assert.match(err, /No marketplace file found/);
});

test("an installed plugin whose profile has no copy of the catalog exits 2 with a message", () => {
  const profile = mkdtempSync(join(tmpdir(), "cstack-profile-"));
  const scripts = join(profile, "plugins", "cache", "cstack", "cstack", "2.1.0", "scripts");
  mkdirSync(scripts, { recursive: true });
  copyFileSync(script, join(scripts, "check-pointers.mjs"));
  let code = 0, err = "";
  try { execFileSync("node", [join(scripts, "check-pointers.mjs")], { encoding: "utf8", stdio: "pipe" }); }
  catch (e) { code = e.status; err = e.stderr; }
  assert.equal(code, 2);
  assert.match(err, /No marketplace file found/);
});

test("a marketplace path that doesn't exist exits 2 with a message, not a crash", () => {
  let code = 0, err = "";
  try { execFileSync("node", [script, join(tmpdir(), "no-such-folder", "marketplace.json")], { encoding: "utf8", stdio: "pipe" }); }
  catch (e) { code = e.status; err = e.stderr; }
  assert.equal(code, 2);
  assert.match(err, /No marketplace file at/);
});

test("live: a pick that doesn't exist makes the command exit 1", { skip: !isLive() }, () => {
  const dir = mkdtempSync(join(tmpdir(), "cstack-bad-"));
  const bad = structuredClone(market);
  bad.plugins.find((p) => p.name === "good-css-picks").skills = ["./good-css", "./not-a-real-skill"];
  writeFileSync(join(dir, "marketplace.json"), JSON.stringify(bad));
  let code = 0;
  try { execFileSync("node", [script, join(dir, "marketplace.json")], { stdio: "pipe" }); } catch (e) { code = e.status; }
  assert.equal(code, 1);
});

test("live: every skill the marketplace picks exists at its pinned commit", { skip: !isLive() }, async () => {
  assert.deepEqual(await missingSkills(market, githubTree), []);
});
