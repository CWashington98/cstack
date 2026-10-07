import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeRepo, git } from "../../../tests/helpers.mjs";
import { writeVerdict, checkVerdicts, renderComment, effectiveVerdict, mergeValidation } from "../scripts/lib/verdict.mjs";

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
  writeVerdict(root, { reviewer: "karen", report: READY, head: "HEAD", base: "main" });
  writeVerdict(root, { reviewer: "codex", report: codex, head: "HEAD", base: "main" });
};

test("both reviewers ready for the head commit passes", () => {
  const root = branchRepo();
  both(root);
  const r = checkVerdicts(root, { base: "main", head: "HEAD" });
  assert.equal(r.ok, true, r.problems.join("\n"));
});

test("a missing reviewer fails", () => {
  const root = branchRepo();
  writeVerdict(root, { reviewer: "karen", report: READY, head: "HEAD", base: "main" });
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
  assert.throws(() => writeVerdict(root, { reviewer: "codex", report: { verdict: "not ready", summary: "s", findings: [unchecked] }, head: "HEAD", base: "main" }), /no reproduction result/);
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
  assert.throws(() => writeVerdict(root, { reviewer: "claude-fallback", report: READY, head: "HEAD", base: "main" }), /must say why/);
  writeVerdict(root, { reviewer: "karen", report: READY, head: "HEAD", base: "main" });
  writeVerdict(root, { reviewer: "claude-fallback", report: READY, head: "HEAD", base: "main", note: "Codex usage limit reached", model: "sonnet" });
  assert.equal(checkVerdicts(root, { base: "main" }).ok, true);
});

test("the comment carries the commit, the change fingerprint and the dropped findings", () => {
  const root = branchRepo();
  const { record } = writeVerdict(root, { reviewer: "codex", report: { verdict: "not ready", summary: "One claim.", findings: [finding({ reproduced: false, reproduction: "could not see it" })] }, head: "HEAD", base: "main" });
  const c = renderComment(record);
  assert.match(c, new RegExp(`head=${record.head}`));
  assert.match(c, /patch-id=[0-9a-f]{40}/);
  assert.match(c, /A new commit clears this verdict/);
  assert.match(c, /Dropped/);
  assert.match(c, /Codex \(OpenAI\): ready/);
});
