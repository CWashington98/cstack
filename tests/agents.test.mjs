import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function agentFiles() {
  const files = [];
  for (const plugin of readdirSync(join(root, "plugins"))) {
    const dir = join(root, "plugins", plugin, "agents");
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".md"))) files.push(join(dir, f));
  }
  return files;
}

const frontmatterName = (file) => readFileSync(file, "utf8").match(/^---\n[\s\S]*?^name:\s*(.+?)\s*$/m)?.[1];

test("every agent file's name matches the name in its frontmatter", () => {
  const files = agentFiles();
  assert.ok(files.length > 0, "found no agent files");
  for (const file of files) assert.equal(frontmatterName(file), basename(file, ".md"), file);
});

test("agents are named by their job: no agent is called karen", () => {
  for (const file of agentFiles()) {
    assert.notEqual(basename(file, ".md").toLowerCase(), "karen", file);
    assert.notEqual(frontmatterName(file)?.toLowerCase(), "karen", file);
  }
});

test("the claims auditor ships with the core plugin", () => {
  assert.equal(frontmatterName(join(root, "plugins", "core", "agents", "claims-auditor.md")), "claims-auditor");
});

test("the naming rule is in the readme, the bootstrap-agents skill and its agent template", () => {
  assert.match(readFileSync(join(root, "README.md"), "utf8"), /^## Names say what things do$/m);
  assert.match(readFileSync(join(root, "plugins", "core", "skills", "bootstrap-agents", "SKILL.md"), "utf8"), /Names say what things do/);
  assert.match(readFileSync(join(root, "templates", "agents", "domain-expert.md.template"), "utf8"), /Names say what things do/);
});
