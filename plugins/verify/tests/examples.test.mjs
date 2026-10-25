// Acceptance tests for worked examples: one per scenario in the
// every-scenario-has-a-worked-example requirement of
// openspec/changes/add-spec-visuals/specs/rules/spec-format/spec.md, each named with its
// [scenario-id]. They were written before the feature and are locked: change them only
// in a commit with a "Spec-Change:" line.
//
// Each test builds a throwaway repository holding a small spec.md, runs
//   node plugins/verify/scripts/verify-plan.mjs spec.md [--since main]
// and reads the exit code (0 passes, 1 held) and the printed lines, which look like
//   line <n>  <hold|advice>  <message>
// The example rule's message names the scenario and says it "has no worked example".
// Every scenario here has a full "Proved by" line, so the only rule under test is the
// example rule. Its **EXAMPLE:** bullet, when there is one, is the scenario's last bullet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { realpathSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeRepo } from "../../../tests/helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "verify-plan.mjs");

const identity = {
  GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com",
};
const git = (dir, ...args) => execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, ...identity } });

// A scenario with GIVEN, WHEN, THEN and a full "Proved by" line, ending with an
// **EXAMPLE:** bullet only when one is given.
const scenario = (name, example) => [
  `#### Scenario: ${name}`,
  "",
  "- **GIVEN** a pull request that changes 180 lines",
  "- **WHEN** the gate runs on it",
  "- **THEN** it records one result",
  "- Proved by: plugins/factory/tests/gate.test.mjs;",
  "  evidence: the test result;",
  "  pass when the test passes.",
  ...(example ? [`- **EXAMPLE:** ${example}`] : []),
  "",
].join("\n");

const spec = (...scenarios) => ["## ADDED Requirements", "", "### Requirement: gate-records-results", "", "The gate records one result per run.", "", ...scenarios].join("\n");

const OLD_EXAMPLE = "#401 goes into `dev` at 8:00. The folder holds one file named `401.json`.";
const RERUN_EXAMPLE = "The gate runs on #412 at 9:00 and again at 9:30. The folder holds one file.";

// A repository whose `main` branch holds spec.md as `base`, then a `feature` branch.
function repoWith(base) {
  const dir = realpathSync(makeRepo());
  git(dir, "symbolic-ref", "HEAD", "refs/heads/main");
  writeFileSync(join(dir, "spec.md"), base);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "spec written in September");
  git(dir, "checkout", "-qb", "feature");
  return dir;
}

function commit(dir, text, message) {
  writeFileSync(join(dir, "spec.md"), text);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", message);
}

function verifyPlan(dir, ...args) {
  const r = spawnSync(process.execPath, [script, join(dir, "spec.md"), ...args], { cwd: dir, encoding: "utf8" });
  const out = `${r.stdout}${r.stderr}`;
  const findings = out.split("\n").flatMap((l) => {
    const m = l.match(/^line \d+\s+(hold|advice)\s+(.*)$/);
    return m ? [{ level: m[1], message: m[2] }] : [];
  });
  const examples = findings.filter((f) => /has no worked example/.test(f.message));
  return { status: r.status, out, findings, examples };
}

test("[new-scenario-without-example-holds] a scenario added since --since with no example holds and is named", () => {
  const dir = repoWith(spec(scenario("small-change-passes", OLD_EXAMPLE)));
  commit(dir, spec(scenario("small-change-passes", OLD_EXAMPLE), scenario("over-size-holds")), "add over-size-holds");

  const r = verifyPlan(dir, "--since", "main");
  assert.equal(r.examples.length, 1, `expected one example finding, for over-size-holds; got:\n${r.out}`);
  assert.equal(r.examples[0].level, "hold", r.out);
  assert.match(r.examples[0].message, /Scenario "over-size-holds" has no worked example/, r.out);
  assert.match(r.examples[0].message, /\*\*EXAMPLE:\*\*/, "the message says how to fix it: add an **EXAMPLE:** bullet");
  assert.notEqual(r.status, 0, `a hold exits non-zero:\n${r.out}`);
});

test("[old-scenario-without-example-is-advice] 12 scenarios unchanged since --since with no examples give 12 advice lines and exit 0", () => {
  const names = Array.from({ length: 12 }, (_, i) => `september-rule-${i + 1}`);
  const dir = repoWith(spec(...names.map((n) => scenario(n))));

  const r = verifyPlan(dir, "--since", "main");
  assert.equal(r.examples.length, 12, `expected 12 example findings; got:\n${r.out}`);
  assert.deepEqual(r.examples.map((f) => f.level), Array(12).fill("advice"), r.out);
  for (const n of names) assert.ok(r.examples.some((f) => f.message.includes(`"${n}"`)), `no advice names ${n}:\n${r.out}`);
  assert.deepEqual(r.findings.filter((f) => f.level === "hold"), [], `nothing holds:\n${r.out}`);
  assert.equal(r.status, 0, `advice alone exits 0:\n${r.out}`);
});

test("[scenario-with-example-passes] a new scenario whose last bullet is an **EXAMPLE:** raises nothing from the example rule", () => {
  // With a scenario that lacks one beside it, the rule is shown to be running,
  // and it names only that scenario.
  const both = repoWith(spec(scenario("small-change-passes", OLD_EXAMPLE)));
  commit(both, spec(scenario("small-change-passes", OLD_EXAMPLE), scenario("rerun-replaces-record", RERUN_EXAMPLE), scenario("no-example-here")), "add two scenarios");
  const mixed = verifyPlan(both, "--since", "main");
  assert.equal(mixed.examples.length, 1, `expected one example finding, for no-example-here; got:\n${mixed.out}`);
  assert.match(mixed.examples[0].message, /"no-example-here"/, mixed.out);
  assert.ok(!mixed.out.includes("rerun-replaces-record"), `rerun-replaces-record has an example, so nothing names it:\n${mixed.out}`);

  // On its own, no example line appears in the output, with or without --since.
  const alone = repoWith(spec(scenario("small-change-passes", OLD_EXAMPLE)));
  commit(alone, spec(scenario("small-change-passes", OLD_EXAMPLE), scenario("rerun-replaces-record", RERUN_EXAMPLE)), "add rerun-replaces-record");
  for (const args of [["--since", "main"], []]) {
    const r = verifyPlan(alone, ...args);
    assert.ok(!/worked example|EXAMPLE/i.test(r.out), `no example line expected (${args.join(" ") || "no --since"}):\n${r.out}`);
    assert.equal(r.status, 0, r.out);
  }
});
