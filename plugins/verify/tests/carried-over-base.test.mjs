import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { makeRepo, git } from "../../../tests/helpers.mjs";
import { readScenarios } from "../scripts/lib/compliance.mjs";

// A scenario only counts as carried over when the project's specs held it before the
// change started. A change that writes the scenario into openspec/specs itself must not
// make its own new scenario look carried over and skip the fail-first rule.
const SCENARIO = [
  "#### Scenario: export-has-a-header",
  "",
  "- **GIVEN** a list of orders",
  "- **WHEN** it is exported",
  "- **THEN** the first line names the columns",
  "",
].join("\n");
const living = `# export Specification\n\n## Purpose\n\nExports orders as a file people can open.\n\n## Requirements\n\n### Requirement: export-format\n\nThe export SHALL start with a header line.\n\n${SCENARIO}`;
const delta = `## MODIFIED Requirements\n\n### Requirement: export-format\n\nThe export SHALL start with a header line.\n\n${SCENARIO}`;

const write = (root, path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};

test("a scenario written into the project's specs by the change itself is not carried over", () => {
  const root = makeRepo({ "README.md": "x\n" });
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  const base = git(root, "rev-parse", "HEAD").trim();
  write(root, "openspec/specs/export/spec.md", living);
  write(root, "openspec/changes/add-export/specs/export/spec.md", delta);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "change writes the living spec and the delta together");
  const [s] = readScenarios(root, "add-export", base);
  assert.equal(s.id, "export-has-a-header");
  assert.equal(s.carried, false);
});

test("a scenario the project's specs held before the change is carried over", () => {
  const root = makeRepo({ "openspec/specs/export/spec.md": living });
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base with the living spec");
  const base = git(root, "rev-parse", "HEAD").trim();
  write(root, "openspec/changes/add-export/specs/export/spec.md", delta);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "change");
  const [s] = readScenarios(root, "add-export", base);
  assert.equal(s.carried, true);
});
