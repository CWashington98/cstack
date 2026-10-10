import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { makeRepo, git } from "../../../tests/helpers.mjs";
import { prepare } from "../scripts/review-prep.mjs";

function branchRepo() {
  const root = makeRepo({ "a.txt": "one\n", "gone.txt": "bye\n", "spec.md": "# Spec\n" });
  git(root, "checkout", "-qb", "main");
  git(root, "add", "."); git(root, "commit", "-qm", "base");
  git(root, "checkout", "-qb", "feat");
  writeFileSync(join(root, "a.txt"), "one\ntwo\n");
  writeFileSync(join(root, "new.txt"), "hello\n");
  rmSync(join(root, "gone.txt"));
  git(root, "add", "-A"); git(root, "commit", "-qm", "SECRET author reasoning");
  return root;
}

test("prepare writes the change, the spec, the description and one copy per reviewer", () => {
  const root = branchRepo();
  const out = join(mkdtempSync(join(tmpdir(), "review-")), "r");
  writeFileSync(join(root, "pr.md"), "## What changed and why\nAdds two.\n");
  const meta = prepare({ repo: root, base: "main", head: "HEAD", specs: [join(root, "spec.md")], prBody: join(root, "pr.md"), copies: ["claims-auditor", "codex"], out });
  assert.match(readFileSync(join(out, "change.patch"), "utf8"), /\+two/);
  assert.match(readFileSync(join(out, "files.txt"), "utf8"), /D\tgone\.txt/);
  assert.ok(existsSync(join(out, "spec", "spec.md")));
  assert.ok(existsSync(join(out, "pr.md")));
  assert.equal(meta.head, git(root, "rev-parse", "HEAD").trim());
  assert.deepEqual(Object.keys(meta.copies), ["claims-auditor", "codex"]);
});

test("each copy holds the head code with the base as its only history, and no author messages", () => {
  const root = branchRepo();
  const out = join(mkdtempSync(join(tmpdir(), "review-")), "r");
  const meta = prepare({ repo: root, base: "main", head: "HEAD", copies: ["claims-auditor"], out });
  const copy = meta.copies["claims-auditor"];
  assert.deepEqual(git(copy, "log", "--format=%s").trim().split("\n"), ["change under review", "base"]);
  assert.ok(!git(copy, "log", "--all", "--format=%B").includes("SECRET"));
  assert.ok(existsSync(join(copy, "new.txt")));
  assert.ok(!existsSync(join(copy, "gone.txt")));
  assert.match(git(copy, "diff", "HEAD~1", "--stat"), /a\.txt/);
});

test("prepare refuses to write into a folder that already has files", () => {
  const root = branchRepo();
  const out = mkdtempSync(join(tmpdir(), "review-"));
  writeFileSync(join(out, "keep.txt"), "x");
  assert.throws(() => prepare({ repo: root, base: "main", out }), /already has files/);
});

test("by default prepare makes copies for the claims auditor, Codex and the validator", () => {
  const root = branchRepo();
  const out = join(mkdtempSync(join(tmpdir(), "review-")), "r");
  const meta = prepare({ repo: root, base: "main", out });
  assert.deepEqual(Object.keys(meta.copies), ["claims-auditor", "codex", "validator"]);
});
