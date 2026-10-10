import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync, cpSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeRepo } from "../../../tests/helpers.mjs";
import { checkAppSkill } from "../scripts/lib/app-skill.mjs";

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

test("the example app skill passes check-app-skill", () => {
  const root = makeRepo({ "apps/notes/package.json": "{}" });
  const dest = join(root, ".claude", "skills", "verify-notes");
  mkdirSync(dest, { recursive: true });
  cpSync(join(skillsDir, "verify-setup", "example", "verify-notes"), dest, { recursive: true });
  const r = checkAppSkill(dest, root);
  assert.deepEqual(r.findings, []);
  assert.equal(r.features, 2);
});

test("the Codex answer format is strict", () => {
  // Codex's --output-schema follows OpenAI's strict structured output rules: every object
  // lists all its properties as required and allows no others.
  const schema = JSON.parse(readFileSync(join(skillsDir, "pr-review", "codex-schema.json"), "utf8"));
  const visit = (node, path) => {
    if (node.type === "object" || (Array.isArray(node.type) && node.type.includes("object"))) {
      assert.equal(node.additionalProperties, false, `${path}: additionalProperties must be false`);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), `${path}: every property is required`);
      for (const [k, v] of Object.entries(node.properties)) visit(v, `${path}.${k}`);
    }
    if (node.items) visit(node.items, `${path}[]`);
  };
  visit(schema, "answer");
  assert.deepEqual(schema.properties.verdict.enum, ["ready", "not ready"]);
});

test("the verify plugin ships exactly its six skills", () => {
  assert.deepEqual(skills().sort(), ["drive-expo", "drive-web", "pr-review", "verify", "verify-setup", "verify-upkeep"]);
});

test("pr-review records each verdict against the reviewed commit from meta.json", () => {
  const text = readFileSync(join(skillsDir, "pr-review", "SKILL.md"), "utf8");
  const writes = text.split("\n").filter((l) => /verdict\.mjs write\b/.test(l));
  assert.ok(writes.length >= 2, "the skill shows the write commands");
  for (const l of writes) assert.match(l, /--meta "\$OUT\/meta\.json"/, l);
});

test("drive-web has a table row for each way to drive a browser, with its safety notes", () => {
  const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "drive-web", "SKILL.md"), "utf8");
  for (const driver of ["Playwright, headless", "Playwright, with a window", "Chrome DevTools", "Claude in Chrome"]) {
    assert.ok(text.includes(`| **${driver}**`), `drive-web should have a table row for ${driver}`);
  }
  const row = (name) => text.split("\n").find((l) => l.startsWith(`| **${name}**`)) ?? "";
  const watchOut = (name) => row(name).split("|")[4] ?? "";
  assert.match(watchOut("Claude in Chrome"), /owner's real Chrome, with real accounts/, "the Claude in Chrome row warns it is the owner's real browser");
  assert.match(watchOut("Claude in Chrome"), /Only use the test identity and the backends the app skill allows/, "the Claude in Chrome row limits it to the test identity and allowed backends");
  assert.match(watchOut("Claude in Chrome"), /Never trigger alert, confirm or prompt dialogs/, "the Claude in Chrome row names the dialogs that freeze it");
  assert.match(row("Chrome DevTools"), /stays signed in between sessions/, "the Chrome DevTools row warns that its profile keeps sign-ins");
  assert.match(row("Chrome DevTools"), /--isolated/, "the Chrome DevTools row says how to get a clean profile");
});

test("drive-web's starting script records video and a trace and closes the context so the video is saved; its screenshot examples cover on-screen, full-page and one element", () => {
  const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "drive-web", "SKILL.md"), "utf8");
  assert.ok(text.includes('await import("playwright").catch(() => import("@playwright/test"))'), "the starting script loads whichever Playwright package the project installs");
  assert.ok(text.includes("one .webm per page"), "the video note says one file per page");
  for (const capture of ["recordVideo", "tracing.start", "tracing.stop", "await context.close()", "fullPage: true", 'page.getByRole("dialog").screenshot({ path: join(RUN, "save-dialog.png") })', 'page.screenshot({ path: join(RUN, "save-before.png") })']) {
    assert.ok(text.includes(capture), `drive-web should show ${capture}`);
  }
  assert.ok(text.indexOf("await context.close()") < text.indexOf("await browser.close()"), "the context closes before the browser");
});
