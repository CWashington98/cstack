import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assignFlags, scoreCase, scoreAll, formatTable, loadEvals } from "../skills/cold-reader/scripts/score.mjs";
import { parseVerdict } from "../skills/cold-reader/scripts/cold-read.mjs";

const skillDir = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "cold-reader");
const script = join(skillDir, "scripts", "score.mjs");

const verdict = (unclear_terms = [], missing_context = [], restatement = "It does a thing. It is tested.") =>
  parseVerdict(JSON.stringify({ unclear_terms, missing_context, restatement, ask: "Nothing" }));

const LABELS = [
  { label: "the panel limit", verdict: "noise", match: ["panel limit"] },
  { label: "Karen", verdict: "noise", match: ["karen"] },
  { label: "panel", verdict: "fair", match: ["\\bpanels?\\b"] },
  { label: "the new standard", verdict: "fair", match: ["new standard"] },
];

test("each flag goes to the first label whose pattern matches, ignoring case; the rest are unlabeled", () => {
  const { byLabel, unlabeled } = assignFlags(LABELS, ["Where the panel limit comes from", "review PANEL", "Karen (our reviewer)", "admin console"]);
  assert.deepEqual(byLabel.get("the panel limit"), ["Where the panel limit comes from"]);
  assert.deepEqual(byLabel.get("panel"), ["review PANEL"]);
  assert.deepEqual(byLabel.get("Karen"), ["Karen (our reviewer)"]);
  assert.deepEqual(byLabel.get("the new standard"), []);
  assert.deepEqual(unlabeled, ["admin console"]);
});

test("a case scores fair flags caught, noise flags raised, unlabeled flags, the restatement and the verdict", () => {
  const evalCase = { name: "x", expect_pass: false, labels: LABELS };
  const r = scoreCase(evalCase, verdict(["review panel", "Karen", "admin console"], ["the panel limit"]));
  assert.equal(r.fairCaught, 1);
  assert.equal(r.fairTotal, 2);
  assert.deepEqual(r.fairMissed, ["the new standard"]);
  assert.equal(r.noiseRaised, 2);
  assert.equal(r.noiseTotal, 2);
  assert.deepEqual(r.noiseFlags, ["the panel limit", "Karen"]);
  assert.deepEqual(r.unlabeled, ["admin console"]);
  assert.equal(r.restatement, true);
  assert.equal(r.verdictRight, true);
});

test("a passing verdict on a text that should fail is counted as wrong, and a missing restatement is caught", () => {
  const r = scoreCase({ name: "x", expect_pass: false, labels: LABELS }, verdict([], [], "  "));
  assert.equal(r.verdictRight, false);
  assert.equal(r.restatement, false);
  assert.equal(r.fairCaught, 0);
});

test("a reader that fails to run scores nothing and is reported as an error", () => {
  const r = scoreCase({ name: "x", expect_pass: false, labels: LABELS }, { pass: false, error: "The reader did not return JSON." });
  assert.equal(r.error, "The reader did not return JSON.");
  assert.equal(r.fairCaught, 0);
  assert.equal(r.verdictRight, false);
  assert.equal(r.restatement, false);
});

test("the scorer reads each case's file through the reader and adds up the totals, with no model call", () => {
  const evals = loadEvals(skillDir);
  const seen = [];
  const run = ({ input }) => {
    seen.push(input);
    return { status: 0, stderr: "", stdout: JSON.stringify({ unclear_terms: ["Karen"], missing_context: [], restatement: "A text.", ask: "Nothing" }) };
  };
  const { results, totals } = scoreAll(evals, { run });
  assert.equal(results.length, evals.length);
  assert.equal(seen.length, evals.length);
  assert.ok(seen.some((input) => input.includes("Karen approved the Atlas change")));
  const fairKaren = evals.flatMap((e) => e.labels).filter((l) => l.verdict === "fair" && l.label === "Karen").length;
  assert.ok(totals.fairCaught >= fairKaren);
  assert.equal(totals.cases, evals.length);
  assert.equal(totals.restatements, evals.length);
  assert.equal(totals.fairTotal, evals.flatMap((e) => e.labels).filter((l) => l.verdict === "fair").length);
});

test("the scorer can run only the cases named", () => {
  const evals = loadEvals(skillDir);
  const run = () => ({ status: 0, stderr: "", stdout: JSON.stringify({ unclear_terms: [], missing_context: [], restatement: "A text.", ask: "Nothing" }) });
  const { results } = scoreAll(evals, { run, only: ["karen-explained"] });
  assert.deepEqual(results.map((r) => r.name), ["karen-explained"]);
  assert.equal(results[0].verdictRight, true);
});

test("the table names every case and prints the totals", () => {
  const r = scoreCase({ name: "karen-unexplained", expect_pass: false, labels: LABELS }, verdict(["Karen"]));
  const out = formatTable([r], { cases: 1, fairCaught: 0, fairTotal: 2, noiseRaised: 1, noiseTotal: 2, unlabeled: 0, restatements: 1, verdictsRight: 1, errors: 0 });
  assert.match(out, /karen-unexplained/);
  assert.match(out, /Fair flags caught: 0 of 2/);
  assert.match(out, /Noise flags raised: 1 of 2/);
  assert.match(out, /Verdicts right: 1 of 1/);
});

test("the test set is well formed: skill-creator's fields, files that exist, unique ids, valid patterns", () => {
  const raw = JSON.parse(readFileSync(join(skillDir, "evals", "evals.json"), "utf8"));
  assert.equal(raw.skill_name, "cold-reader");
  const ids = new Set();
  for (const e of raw.evals) {
    for (const field of ["id", "name", "prompt", "expected_output", "files", "assertions", "labels", "kind"]) assert.ok(field in e, `${e.name ?? e.id} has ${field}`);
    assert.equal(typeof e.expect_pass, "boolean", e.name);
    assert.ok(!ids.has(e.id), `id ${e.id} is unique`);
    ids.add(e.id);
    for (const f of e.files) assert.ok(existsSync(join(skillDir, f)), f);
    for (const l of e.labels) {
      assert.ok(["fair", "noise"].includes(l.verdict), `${e.name}: ${l.label}`);
      assert.ok(l.why, `${e.name}: ${l.label} says why`);
      for (const m of l.match) new RegExp(m, "i");
    }
  }
  const names = raw.evals.map((e) => e.name);
  for (const required of ["precordia-199-rewrite", "onehearthealth-868-rewrite", "smsmarketing-1630-rewrite", "precordia-199-original", "onehearthealth-868-original", "smsmarketing-1630-original", "karen-unexplained", "karen-explained", "blank-probe"]) {
    assert.ok(names.includes(required), required);
  }
});

test("the labels match the flags the strict reader raised in first real use, the way the owner judged them", () => {
  const evals = loadEvals(skillDir);
  const expected = {
    "precordia-199-rewrite": { fair: ["pull request 197", "the new standard", "review panel, seat and 'Seat now'"], noise: ["Karen", "Clerk", "code names in the technical detail section", "which deliberate breaks slipped through", "where the 10-person panel limit comes from"] },
    "onehearthealth-868-rewrite": { fair: ["Crishon", "murmur probability versus confidence", "the new standard"], noise: ["Karen", "code names in the technical detail section", "why the export keeps the column, and who uses it", "whether the field will be removed later"] },
    "smsmarketing-1630-rewrite": { fair: ["Codex", "Opus", "owner"], noise: ["Karen and the security reviewer", "code names in the technical detail section", "follow-ups have no owners or tickets", "why 42 tests for 38 scenarios"] },
  };
  for (const [name, want] of Object.entries(expected)) {
    const old = JSON.parse(readFileSync(join(skillDir, "evals", "first-use-verdicts", `${name}.json`), "utf8"));
    const r = scoreCase(evals.find((e) => e.name === name), verdict(old.unclear_terms, old.missing_context, old.restatement));
    for (const label of want.fair) assert.ok(!r.fairMissed.includes(label), `${name}: the strict reader caught ${label}`);
    for (const label of want.noise) assert.ok(r.noiseFlags.includes(label), `${name}: the strict reader raised the noise ${label}`);
  }
});

test("without PLAIN_LIVE=1 the scorer refuses to call the model", () => {
  const env = { ...process.env };
  delete env.PLAIN_LIVE;
  const r = spawnSync(process.execPath, [script], { encoding: "utf8", env });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /PLAIN_LIVE=1/);
});
