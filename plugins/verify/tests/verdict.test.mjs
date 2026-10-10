import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeRepo, git } from "../../../tests/helpers.mjs";
import { writeVerdict, checkVerdicts, effectiveVerdict, mergeValidation, validateReport } from "../scripts/lib/verdict.mjs";
import { prepare } from "../scripts/review-prep.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "verdict.mjs");
const sha = (root, ref = "HEAD") => git(root, "rev-parse", ref).trim();

function branchRepo() {
  const root = makeRepo({ "a.txt": "one\n", "b.txt": "x\n" });
  git(root, "checkout", "-qb", "main");
  git(root, "add", "."); git(root, "commit", "-qm", "base");
  git(root, "checkout", "-qb", "feat");
  writeFileSync(join(root, "a.txt"), "one\ntwo\n");
  git(root, "commit", "-qam", "my reasoning about why two is right");
  return root;
}
const READY = { verdict: "ready", summary: "The change does what it says.", findings: [] };
const finding = (over = {}) => ({ id: "codex-1", claim: "two is wrong", file: "a.txt", line: 2, severity: "blocking", trigger: "read a.txt", how_to_reproduce: "cat a.txt", reproduced: true, reproduction: "cat a.txt shows two", ...over });
const both = (root, codex = READY) => {
  writeVerdict(root, { reviewer: "karen", report: READY, head: sha(root), base: "main" });
  writeVerdict(root, { reviewer: "codex", report: codex, head: sha(root), base: "main" });
};

test("both reviewers ready for the head commit passes", () => {
  const root = branchRepo();
  both(root);
  const r = checkVerdicts(root, { base: "main", head: "HEAD" });
  assert.equal(r.ok, true, r.problems.join("\n"));
});

test("a missing reviewer fails", () => {
  const root = branchRepo();
  writeVerdict(root, { reviewer: "karen", report: READY, head: sha(root), base: "main" });
  assert.match(checkVerdicts(root, { base: "main" }).problems.join(), /No verdict from Codex/);
});

test("a new commit clears the verdicts", () => {
  const root = branchRepo();
  both(root);
  writeFileSync(join(root, "b.txt"), "y\n");
  git(root, "commit", "-qam", "more");
  assert.match(checkVerdicts(root, { base: "main" }).problems.join(), /No verdict from Karen/);
});

test("a rebase that keeps the change identical keeps the verdict", () => {
  const root = branchRepo();
  both(root);
  git(root, "checkout", "-q", "main");
  writeFileSync(join(root, "c.txt"), "new\n");
  git(root, "add", "."); git(root, "commit", "-qm", "other work");
  git(root, "checkout", "-q", "feat");
  git(root, "rebase", "-q", "main");
  const r = checkVerdicts(root, { base: "main" });
  assert.equal(r.ok, true, r.problems.join("\n"));
  assert.ok(r.karen.carriedFrom);
});

test("a rebase that changes the change clears the verdict", () => {
  const root = branchRepo();
  both(root);
  git(root, "checkout", "-q", "main");
  writeFileSync(join(root, "c.txt"), "new\n");
  git(root, "add", "."); git(root, "commit", "-qm", "other work");
  git(root, "checkout", "-q", "feat");
  git(root, "rebase", "-q", "main");
  writeFileSync(join(root, "a.txt"), "one\ntwo\nthree\n");
  git(root, "commit", "-q", "--amend", "-a", "--no-edit");
  assert.equal(checkVerdicts(root, { base: "main" }).ok, false);
});

test("merging the base branch into the branch keeps the verdict", () => {
  const root = branchRepo();
  both(root);
  git(root, "checkout", "-q", "main");
  writeFileSync(join(root, "c.txt"), "new\n");
  git(root, "add", "."); git(root, "commit", "-qm", "other work");
  git(root, "checkout", "-q", "feat");
  git(root, "merge", "-q", "--no-ff", "-m", "merge main", "main");
  assert.equal(checkVerdicts(root, { base: "main" }).ok, true);
});

test("every finding needs a reproduction result before the verdict is recorded", () => {
  const root = branchRepo();
  const { reproduced, ...unchecked } = finding();
  assert.throws(() => writeVerdict(root, { reviewer: "codex", report: { verdict: "not ready", summary: "s", findings: [unchecked] }, head: sha(root), base: "main" }), /no reproduction result/);
});

test("only reproduced blocking findings decide the verdict", () => {
  assert.equal(effectiveVerdict({ verdict: "not ready", findings: [finding({ reproduced: false, reproduction: "" })] }).verdict, "ready");
  assert.equal(effectiveVerdict({ verdict: "ready", findings: [finding()] }).verdict, "not ready");
  assert.equal(effectiveVerdict({ verdict: "not ready", findings: [finding({ severity: "note" })] }).verdict, "ready");
});

test("the validator's results are merged into the report by finding id", () => {
  const { reproduced, reproduction, ...raw } = finding();
  const merged = mergeValidation({ verdict: "not ready", summary: "s", findings: [raw] }, [{ id: "codex-1", reproduced: false, reproduction: "a.txt is fine" }]);
  assert.equal(merged.findings[0].reproduced, false);
});

test("when the reviewers disagree, the owner decides", () => {
  const root = branchRepo();
  both(root, { verdict: "not ready", summary: "s", findings: [finding()] });
  assert.match(checkVerdicts(root, { base: "main" }).problems.join(), /disagree.*The owner decides/);
});

test("a fallback reviewer must say why Codex could not review", () => {
  const root = branchRepo();
  assert.throws(() => writeVerdict(root, { reviewer: "claude-fallback", report: READY, head: sha(root), base: "main" }), /must say why/);
  writeVerdict(root, { reviewer: "karen", report: READY, head: sha(root), base: "main" });
  writeVerdict(root, { reviewer: "claude-fallback", report: READY, head: sha(root), base: "main", note: "Codex usage limit reached", model: "sonnet" });
  assert.equal(checkVerdicts(root, { base: "main" }).ok, true);
});

test("a decision for the owner never blocks, and the report's plain fields reach the verdict", () => {
  assert.equal(effectiveVerdict({ verdict: "ready", findings: [finding({ severity: "decide" })] }).verdict, "ready");
  assert.deepEqual(validateReport({ ...READY, findings: [finding({ severity: "urgent" })] }), ['finding codex-1: severity must be "blocking", "decide" or "note".']);
  assert.match(validateReport({ ...READY, merge_risk: { level: "tiny" } }).join(), /merge_risk\.level/);
  const root = branchRepo();
  const extra = { what_it_does: "Adds a line.", merge_risk: { level: "low", why: "one file" }, checked: ["read a.txt"], not_checked: [] };
  const { record } = writeVerdict(root, { reviewer: "karen", report: { ...READY, ...extra }, head: sha(root), base: "main" });
  for (const [k, v] of Object.entries(extra)) assert.deepEqual(record[k], v);
});

const NOT_READY = { verdict: "not ready", summary: "One reproduced problem.", findings: [finding()] };
const rebaseOntoNewMain = (root) => {
  git(root, "checkout", "-q", "main");
  writeFileSync(join(root, "c.txt"), "new\n");
  git(root, "add", "."); git(root, "commit", "-qm", "other work");
  git(root, "checkout", "-q", "feat");
  git(root, "rebase", "-q", "main");
};

test("a verdict must name the reviewed commit by its full commit ID", () => {
  const root = branchRepo();
  assert.throws(() => writeVerdict(root, { reviewer: "karen", report: READY, base: "main" }), /full commit ID/);
  assert.throws(() => writeVerdict(root, { reviewer: "karen", report: READY, head: "HEAD", base: "main" }), /full commit ID/);
});

test("a verdict written after a new commit still lands on the reviewed commit", () => {
  const root = branchRepo();
  const meta = prepare({ repo: root, base: "main", copies: [], out: join(mkdtempSync(join(tmpdir(), "review-")), "r") });
  writeFileSync(join(root, "b.txt"), "changed after the review\n");
  git(root, "commit", "-qam", "commit B, made after the review started");
  writeVerdict(root, { reviewer: "karen", report: READY, head: meta.head, base: "main", meta });
  writeVerdict(root, { reviewer: "codex", report: READY, head: meta.head, base: "main", meta });
  assert.equal(checkVerdicts(root, { base: "main" }).ok, false);
  assert.equal(checkVerdicts(root, { base: "main", head: meta.head }).ok, true);
  assert.throws(() => writeVerdict(root, { reviewer: "karen", report: READY, head: sha(root), base: "main", meta }), /does not match the reviewed commit/);
});

test("the write command takes the reviewed commit from meta.json and refuses a mismatch", () => {
  const root = branchRepo();
  const out = join(mkdtempSync(join(tmpdir(), "review-")), "r");
  prepare({ repo: root, base: "main", copies: [], out });
  writeFileSync(join(root, "report.json"), JSON.stringify(READY));
  const run = (...a) => spawnSync("node", [script, "write", "--reviewer", "karen", "--report", "report.json", ...a], { cwd: root, encoding: "utf8" });
  assert.equal(run("--base", "main").status, 2, "refuses without --meta");
  const reviewed = sha(root);
  writeFileSync(join(root, "b.txt"), "later\n");
  git(root, "commit", "-qam", "later");
  assert.equal(run("--meta", join(out, "meta.json"), "--head", sha(root)).status, 2, "refuses a head that is not the reviewed one");
  const ok = run("--meta", join(out, "meta.json"));
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, new RegExp(`${reviewed}\\.karen\\.json`));
});

test("a whitespace-only change to the change clears the verdict", () => {
  const root = branchRepo();
  both(root);
  writeFileSync(join(root, "a.txt"), "one\n  two\n");
  git(root, "commit", "-q", "--amend", "-a", "--no-edit");
  assert.equal(checkVerdicts(root, { base: "main" }).ok, false);
});

test("an exact fallback verdict for this commit wins over a carried Codex verdict", () => {
  const root = branchRepo();
  both(root);
  rebaseOntoNewMain(root);
  writeVerdict(root, { reviewer: "karen", report: READY, head: sha(root), base: "main" });
  writeVerdict(root, { reviewer: "claude-fallback", report: NOT_READY, head: sha(root), base: "main", note: "Codex usage limit reached", model: "sonnet" });
  const r = checkVerdicts(root, { base: "main" });
  assert.equal(r.other.reviewer, "claude-fallback");
  assert.equal(r.ok, false);
});

test("the newest exact verdict for the commit wins", () => {
  const root = branchRepo();
  const t = (s) => new Date(Date.UTC(2026, 0, 1, 0, 0, s));
  writeVerdict(root, { reviewer: "karen", report: READY, head: sha(root), base: "main" });
  writeVerdict(root, { reviewer: "codex", report: READY, head: sha(root), base: "main", now: t(1) });
  writeVerdict(root, { reviewer: "claude-fallback", report: NOT_READY, head: sha(root), base: "main", note: "Codex rerun failed", now: t(2) });
  assert.equal(checkVerdicts(root, { base: "main" }).other.reviewer, "claude-fallback");
  writeVerdict(root, { reviewer: "codex", report: READY, head: sha(root), base: "main", now: t(3) });
  assert.equal(checkVerdicts(root, { base: "main" }).other.reviewer, "codex");
});

test("any not-ready verdict blocks, including two that agree", () => {
  const root = branchRepo();
  writeVerdict(root, { reviewer: "karen", report: { ...NOT_READY, findings: [finding({ id: "karen-1" })] }, head: sha(root), base: "main" });
  writeVerdict(root, { reviewer: "codex", report: NOT_READY, head: sha(root), base: "main" });
  const r = checkVerdicts(root, { base: "main" });
  assert.equal(r.ok, false);
  assert.match(r.problems.join(), /not ready/);
});

test("an exact verdict for this commit beats a newer one carried from an identical change", () => {
  const root = branchRepo();
  const before = sha(root);
  rebaseOntoNewMain(root);
  const t = (s) => new Date(Date.UTC(2026, 0, 1, 0, 0, s));
  writeVerdict(root, { reviewer: "karen", report: { ...NOT_READY, findings: [finding({ id: "karen-1" })] }, head: sha(root), base: "main", now: t(1) });
  writeVerdict(root, { reviewer: "karen", report: READY, head: before, base: "main", now: t(2) });
  writeVerdict(root, { reviewer: "codex", report: READY, head: sha(root), base: "main" });
  const r = checkVerdicts(root, { base: "main" });
  assert.equal(r.karen.head, sha(root));
  assert.equal(r.karen.carriedFrom, undefined);
  assert.equal(r.ok, false);
});

test("write refuses a meta.json whose change is not the one at that commit", () => {
  const root = branchRepo();
  const meta = prepare({ repo: root, base: "main", copies: [], out: join(mkdtempSync(join(tmpdir(), "review-")), "r") });
  assert.throws(() => writeVerdict(root, { reviewer: "karen", report: READY, head: meta.head, base: "main", meta: { ...meta, patchId: "0".repeat(40) } }), /does not match the reviewed change/);
});

test("the write command names a --head or --base that is not the reviewed one", () => {
  const root = branchRepo();
  const out = join(mkdtempSync(join(tmpdir(), "review-")), "r");
  prepare({ repo: root, base: "main", copies: [], out });
  writeFileSync(join(root, "report.json"), JSON.stringify(READY));
  git(root, "branch", "other", "main");
  const run = (...a) => spawnSync("node", [script, "write", "--reviewer", "karen", "--report", "report.json", "--meta", join(out, "meta.json"), ...a], { cwd: root, encoding: "utf8" });
  const head = run("--head", "main");
  assert.equal(head.status, 2);
  assert.match(head.stderr, /--head main is not the reviewed commit/);
  const base = run("--base", "other");
  assert.equal(base.status, 2);
  assert.match(base.stderr, /--base other is not the reviewed base main/);
});

test("a report with a decision finding can be recorded", () => {
  const root = branchRepo();
  const { record } = writeVerdict(root, { reviewer: "karen", report: { ...READY, findings: [finding({ id: "karen-1", severity: "decide" })] }, head: sha(root), base: "main" });
  assert.equal(record.verdict, "ready");
});
