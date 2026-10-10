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

test("the core plugin ships only our own skills; borrowed ones are pointers", () => {
  const skills = readdirSync(join(root, "plugins", "core", "skills")).sort();
  assert.deepEqual(skills, ["bootstrap-agents", "deslop", "upkeep", "write-a-skill"]);
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

test("the good-css pointer picks only its one skill, from the skills folder", () => {
  const p = market.plugins.find((p) => p.name === "good-css-picks");
  assert.ok(p, "good-css-picks is missing");
  assert.equal(p.source.url, "https://github.com/vojtaholik/good-css.git");
  assert.equal(p.source.path, "skills");
  assert.deepEqual(p.skills, ["./good-css"]);
});

function pointer(name) {
  const p = market.plugins.find((p) => p.name === name);
  assert.ok(p, `${name} is missing`);
  return p;
}

test("the ponytail pointer picks all six of its skills, without its always-on hooks", () => {
  const p = pointer("ponytail-picks");
  assert.equal(p.source.url, "https://github.com/DietrichGebert/ponytail.git");
  assert.equal(p.source.path, "skills");
  assert.deepEqual([...p.skills].sort(), ["./ponytail", "./ponytail-audit", "./ponytail-debt", "./ponytail-gain", "./ponytail-help", "./ponytail-review"]);
});

test("the Expo pointer picks Expo's own skills from its expo plugin folder", () => {
  const p = pointer("expo-picks");
  assert.equal(p.source.url, "https://github.com/expo/skills.git");
  assert.equal(p.source.path, "plugins/expo/skills");
  for (const s of ["./expo-router", "./expo-ui", "./expo-upgrade", "./eas-workflows"]) assert.ok(p.skills.includes(s), s);
});

test("the Vercel React pointer picks the React and web interface skills, and the old whole-repository entry is gone", () => {
  const p = pointer("vercel-react-picks");
  assert.equal(p.source.url, "https://github.com/vercel-labs/agent-skills.git");
  assert.deepEqual([...p.skills].sort(), ["./composition-patterns", "./react-best-practices", "./react-view-transitions", "./web-design-guidelines"]);
  assert.ok(!market.plugins.some((p) => p.name === "vercel-agent-skills"));
});

test("the caveman pointer picks caveman and the two modes it hands off to", () => {
  const p = pointer("caveman-picks");
  assert.equal(p.source.url, "https://github.com/JuliusBrussee/caveman.git");
  assert.deepEqual([...p.skills].sort(), ["./caveman", "./megacave", "./ultracave"]);
});

test("the Expo pointer leaves out the feedback skill, whose command breaks when picked by folder", () => {
  assert.ok(!pointer("expo-picks").skills.includes("./expo-skill-feedback"));
});

test("Vercel's deploy skills have their own pointer", () => {
  const p = pointer("vercel-deploy-picks");
  assert.equal(p.source.url, "https://github.com/vercel-labs/agent-skills.git");
  assert.deepEqual([...p.skills].sort(), ["./deploy-to-vercel", "./vercel-cli-with-tokens", "./vercel-optimize"]);
});

test("the pstack pointer includes TypeScript best practices and the simplicity principles", () => {
  const p = pointer("pstack-picks");
  for (const s of ["./typescript-best-practices", "./principle-laziness-protocol", "./principle-subtract-before-you-add", "./principle-type-system-discipline", "./principle-test-behavior-not-implementation"]) {
    assert.ok(p.skills.includes(s), s);
  }
});
