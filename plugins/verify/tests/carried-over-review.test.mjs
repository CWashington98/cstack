// Review fixes for guard scenarios: a crash is not a catch, carried-over compares every bullet in full, and `$&` in code stays literal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { brokeByAssertion, readRun, readScenarios } from "../scripts/lib/compliance.mjs";
import { breakGuard } from "../scripts/lib/breaks.mjs";

const entry = { id: "guard-a", tests: [], tokens: ["[guard-a]"] };

test("a crash at load time is not a caught guard break", () => {
  const out = "✖ [guard-a] the guard answers\n  Error: LIMIT changed\n    at file.mjs:1\n";
  const r = { tests: readRun(out).filter((t) => t.id === "guard-a"), failed: 1, exits: [1], out };
  assert.equal(brokeByAssertion(entry, r), false);
});

test("a failed assertion in the test's own block is a caught guard break", () => {
  const out = "✔ [guard-b] other\n✖ [guard-a] the guard answers\n  AssertionError [ERR_ASSERTION]: expected true\n";
  const r = { tests: readRun(out).filter((t) => t.id === "guard-a"), failed: 1, exits: [1], out };
  assert.equal(brokeByAssertion(entry, r), true);
});

test("an assertion word in another test's block does not count", () => {
  const out = "✖ [guard-a] the guard answers\n  Error: boom\n✖ [guard-b] other\n  AssertionError: no\n";
  const r = { tests: readRun(out).filter((t) => t.id === "guard-a"), failed: 1, exits: [1], out };
  assert.equal(brokeByAssertion(entry, r), false);
});

function project(change, living) {
  const root = mkdtempSync(join(tmpdir(), "carried-"));
  for (const [p, c] of Object.entries({ "openspec/specs/x/spec.md": living, "openspec/changes/c/specs/x/spec.md": change })) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  return root;
}
const spec = (body) => `## MODIFIED Requirements\n### Requirement: R\nText.\n#### Scenario: s-1 name\n${body}\n- Proved by: t.mjs; evidence: out; pass when ok.\n`;
const carried = (change, living) => readScenarios(project(change, living), "c")[0].carried;
const base = "- **GIVEN** a thing\n- **WHEN** it runs\n- **THEN** it works\n  and more words";

test("the same bullets, wrapped differently in whitespace, stay carried over", () => {
  assert.equal(carried(spec(base), spec(base.replace("\n  and", "\n      and"))), true);
});

test("rewording a wrapped second line makes the scenario new", () => {
  assert.equal(carried(spec(base.replace("more words", "other words")), spec(base)), false);
});

test("an added bold bullet makes the scenario new", () => {
  assert.equal(carried(spec(`${base}\n- **BUT** not for admins`), spec(base)), false);
});

test("scenarios with no steps are never carried over", () => {
  assert.equal(carried(spec("- Notes only"), spec("- Notes only")), false);
});

test("breakGuard keeps `$&` in code literal", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/a.mjs"), 'export const c = (n) => n >= 18 && "$&";\n');
  let seen;
  breakGuard({ tree: dir, files: ["src/a.mjs"], run: () => { seen = readFileSync(join(dir, "src/a.mjs"), "utf8"); return true; } });
  assert.equal(seen.split("export const c").length, 2);
  assert.match(seen, /"\$&"/);
});
