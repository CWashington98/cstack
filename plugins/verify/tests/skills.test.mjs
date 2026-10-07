import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const plugin = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = join(plugin, "skills");
// Project names that must never appear in the general plugin. Projects add facts
// in their own repositories instead.
const PROJECTS = /precordia|onehearthealth|smsmarketing|investfest|rebellion|labeling-app|patient-mobile/i;

const skills = () => (existsSync(skillsDir) ? readdirSync(skillsDir).filter((d) => statSync(join(skillsDir, d)).isDirectory()) : []);

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test("every skill has frontmatter naming its folder", () => {
  for (const name of skills()) {
    const text = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
    assert.match(text, new RegExp(`^---\\nname: ${name}\\ndescription: .+\\n`), name);
  }
});

test("every skill has test prompts in skill-creator's shape", () => {
  for (const name of skills()) {
    const e = JSON.parse(readFileSync(join(skillsDir, name, "evals", "evals.json"), "utf8"));
    assert.equal(e.skill_name, name);
    assert.ok(Array.isArray(e.evals) && e.evals.length >= 3, `${name}: at least three test prompts`);
    const ids = new Set();
    for (const ev of e.evals) {
      assert.ok(Number.isInteger(ev.id) && !ids.has(ev.id), `${name}: ids are unique whole numbers`);
      ids.add(ev.id);
      assert.ok(ev.prompt?.trim(), `${name} ${ev.id}: prompt`);
      assert.ok(ev.expected_output?.trim(), `${name} ${ev.id}: expected_output`);
      assert.ok(Array.isArray(ev.files), `${name} ${ev.id}: files is a list`);
      assert.ok(Array.isArray(ev.expectations) && ev.expectations.length > 0, `${name} ${ev.id}: expectations`);
    }
  }
});

test("nothing in the plugin names a project", () => {
  for (const sub of ["skills", "scripts"]) {
    const dir = join(plugin, sub);
    if (!existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const hit = readFileSync(file, "utf8").match(PROJECTS);
      assert.equal(hit, null, `${file} names a project ("${hit?.[0]}"). Move the fact to that project's app skill.`);
    }
  }
});
