import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { missingSkills, githubTree, isLive } from "../scripts/check-pointers.mjs";

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

test("live: every skill the marketplace picks exists at its pinned commit", { skip: !isLive() }, async () => {
  assert.deepEqual(await missingSkills(market, githubTree), []);
});
