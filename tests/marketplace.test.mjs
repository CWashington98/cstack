import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const market = JSON.parse(readFileSync(join(root, ".claude-plugin", "marketplace.json"), "utf8"));

test("every local plugin has a manifest with the same name", () => {
  for (const p of market.plugins.filter((p) => typeof p.source === "string")) {
    const manifest = join(root, p.source, ".claude-plugin", "plugin.json");
    assert.ok(existsSync(manifest), `${p.name}: missing ${manifest}`);
    assert.equal(JSON.parse(readFileSync(manifest, "utf8")).name, p.name);
  }
});

test("every outside plugin is pinned to an exact commit", () => {
  for (const p of market.plugins.filter((p) => typeof p.source === "object")) {
    assert.match(p.source.sha ?? "", /^[0-9a-f]{40}$/, `${p.name} is not pinned`);
  }
});

test("pointers into part of someone else's repository list the skills they pick", () => {
  for (const p of market.plugins.filter((p) => p.source?.source === "git-subdir")) {
    assert.equal(p.strict, false, `${p.name} must set strict: false`);
    assert.ok(Array.isArray(p.skills) && p.skills.length > 0, `${p.name} must list its skills`);
    for (const s of p.skills) assert.match(s, /^\.\//, `${p.name}: skill paths start with ./`);
  }
});

test("the plain plugin is listed", () => {
  assert.ok(market.plugins.some((p) => p.name === "plain" && p.source === "./plugins/plain"));
});

test("a version in the marketplace matches the plugin's own manifest, and plain lists one", () => {
  const plain = market.plugins.find((p) => p.name === "plain");
  assert.ok(plain.version, "plain lists its version in the marketplace");
  for (const p of market.plugins.filter((p) => typeof p.source === "string" && p.version)) {
    const manifest = JSON.parse(readFileSync(join(root, p.source, ".claude-plugin", "plugin.json"), "utf8"));
    assert.equal(p.version, manifest.version, `${p.name}: marketplace says ${p.version}, plugin.json says ${manifest.version}`);
  }
});

import { readdirSync } from "node:fs";

test("the core plugin ships only our own skills plus the web design guidelines", () => {
  const skills = readdirSync(join(root, "plugins", "core", "skills")).sort();
  assert.deepEqual(skills, ["bootstrap-agents", "caveman", "deslop", "upkeep", "web-design-guidelines", "write-a-skill"]);
});

test("the plain skill and its reference files exist", () => {
  const skill = readFileSync(join(root, "plugins", "plain", "skills", "plain", "SKILL.md"), "utf8");
  assert.match(skill, /^---\nname: plain\ndescription: .+\n---/);
  for (const f of ["rules.md", "pr-layout.md", "glossary-format.md"]) {
    assert.ok(existsSync(join(root, "plugins", "plain", "skills", "plain", f)), f);
  }
});

test("the verify plugin is listed", () => {
  assert.ok(market.plugins.some((p) => p.name === "verify" && p.source === "./plugins/verify"));
});

test("the to-diagram skill, its palette, its subset notes and its templates exist", () => {
  const dir = join(root, "plugins", "plain", "skills", "to-diagram");
  assert.match(readFileSync(join(dir, "SKILL.md"), "utf8"), /^---\nname: to-diagram\ndescription: .+\n---/);
  for (const f of ["palette.json", "svg-subset.md", "README.md", "templates/flow.svg", "templates/page.html"]) assert.ok(existsSync(join(dir, f)), f);
  assert.ok(existsSync(join(root, "plugins", "plain", "scripts", "diagram-check.mjs")));
});
