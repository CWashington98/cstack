import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// The how-to-use-cstack guide is what an agent reads when someone asks how to use
// cstack. These tests keep it honest: everything it calls available must exist,
// and nothing it calls coming may be suggested as if it already works.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const guideFile = join(root, "plugins", "core", "skills", "how-to-use-cstack", "SKILL.md");
const read = () => readFileSync(guideFile, "utf8");
const section = (text, heading) => {
  const parts = text.split(/^## /m);
  const found = parts.find((p) => p.startsWith(heading));
  assert.ok(found, `the guide needs a "## ${heading}" section`);
  return found;
};
// Each plugin's name, as its skills and agents are called: cstack:deslop, verify:pr-review.
const PLUGINS = { cstack: "core", plain: "plain", verify: "verify" };
const names = (text) => [...text.matchAll(/`\/?(cstack|plain|verify):([a-z0-9-]+)`/g)].map((m) => ({ plugin: m[1], name: m[2], raw: m[0] }));
const exists = ({ plugin, name }) => {
  const dir = join(root, "plugins", PLUGINS[plugin]);
  return existsSync(join(dir, "skills", name, "SKILL.md")) || existsSync(join(dir, "agents", `${name}.md`)) || existsSync(join(dir, "commands", `${name}.md`));
};

test("the guide exists, and its description says when an agent should read it", () => {
  const text = read();
  const description = text.match(/^description:\s*(.+)$/m)?.[1] ?? "";
  assert.match(text, /^name: how-to-use-cstack$/m);
  assert.match(description, /how .*use cstack|what cstack/i);
  assert.match(description, /suggest/i);
});

test("every skill, agent or command the guide lists as available now really exists", () => {
  const listed = names(section(read(), "Available now"));
  assert.ok(listed.length >= 10, `expected the guide to list cstack's skills, found ${listed.length}`);
  for (const item of listed) assert.ok(exists(item), `${item.raw} is listed as available but no skill, agent or command has that name`);
});

test("every skill, agent and command cstack ships is in the guide", () => {
  const text = read();
  for (const [plugin, folder] of Object.entries(PLUGINS)) {
    for (const kind of ["skills", "agents", "commands"]) {
      const dir = join(root, "plugins", folder, kind);
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir).filter((n) => !n.startsWith("."))) {
        const name = entry.replace(/\.md$/, "");
        if (name === "how-to-use-cstack") continue;
        assert.ok(text.includes(`${plugin}:${name}`), `${plugin}:${name} ships with cstack but the guide doesn't mention it`);
      }
    }
  }
});

test("commands listed as coming are not built yet, and the guide tells agents not to offer them as working", () => {
  const coming = section(read(), "Coming");
  const listed = names(coming);
  assert.ok(listed.length >= 2, "the coming section names the planned commands");
  for (const item of listed) assert.ok(!exists(item), `${item.raw} exists now, so move it from "Coming" to "Available now"`);
  assert.match(coming, /not built yet/i);
});

test("the guide tells agents to suggest, never to start a flow on their own", () => {
  const rules = section(read(), "How to answer");
  assert.match(rules, /suggest/i);
  assert.match(rules, /never start/i);
  assert.match(rules, /other tools/i);
});

test("the README points readers to the guide", () => {
  assert.match(readFileSync(join(root, "README.md"), "utf8"), /how-to-use-cstack/);
});
