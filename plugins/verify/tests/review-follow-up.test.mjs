// Acceptance tests for openspec/changes/add-ready-check/specs/verify/review-follow-up.
// Each runs the real review-prep.mjs against a temporary git repository, with verdict files
// written where verdict.mjs keeps them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeRepo, git } from "../../../tests/helpers.mjs";

const script = resolve(fileURLToPath(import.meta.url), "../../scripts/review-prep.mjs");

function commit(root, file, text, message) {
  writeFileSync(join(root, file), text);
  git(root, "add", "-A"); git(root, "commit", "-qm", message);
  return git(root, "rev-parse", "HEAD").trim();
}

function saveVerdict(root, head, reviewer, findings) {
  const dir = join(root, ".git", "verify", "verdicts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${head}.${reviewer}.json`), JSON.stringify({ reviewer, head, verdict: "not ready", findings, date: "2026-10-29T00:00:00.000Z" }));
}

function branch() {
  const root = makeRepo({ "a.txt": "one\n" });
  git(root, "checkout", "-qb", "main");
  git(root, "add", "."); git(root, "commit", "-qm", "base");
  git(root, "checkout", "-qb", "feat");
  const reviewed = commit(root, "a.txt", "one\ntwo\n", "first change");
  return { root, reviewed };
}

const prep = (root, ...args) => spawnSync("node", [script, "--base", "main", ...args], { cwd: root, encoding: "utf8" });

test("[follow-up-packet-has-findings-and-delta] the packet lists the earlier blocking finding first and starts from the diff since that commit", () => {
  const { root, reviewed } = branch();
  saveVerdict(root, reviewed, "claims-auditor", [
    { id: "f1", claim: "two is never checked", severity: "blocking", reproduced: true },
    { id: "f2", claim: "a style nit", severity: "note", reproduced: true },
  ]);
  commit(root, "b.txt", "fix\n", "fix f1");
  const head = commit(root, "c.txt", "more\n", "second fix");
  const out = join(mkdtempSync(join(tmpdir(), "follow-")), "r");

  const r = prep(root, "--since", reviewed, "--head", head, "--copies", "claims-auditor", "--out", out);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(out, "follow-up.md")), "the packet has a follow-up page");

  const packet = readFileSync(join(out, "follow-up.md"), "utf8");
  const firstSection = packet.split(/^## /m)[1] ?? "";
  assert.match(firstSection, /two is never checked/, "the blocking finding comes first");
  assert.doesNotMatch(packet, /a style nit/, "notes are not open findings");
  assert.ok(packet.indexOf("two is never checked") < packet.indexOf("since.patch"), "findings come before the diff");

  assert.equal(readFileSync(join(out, "since.patch"), "utf8"), git(root, "diff", reviewed, head), "the starting diff is reviewed..head");
  const full = readFileSync(join(out, "change.patch"), "utf8");
  assert.match(full, /\+two/, "the full diff from the merge base is still there");
  assert.match(full, /\+fix/);

  const meta = JSON.parse(readFileSync(join(out, "meta.json"), "utf8"));
  assert.equal(meta.head, head, "the new verdict is still written for the exact new head");
  assert.equal(meta.followUp.since, reviewed);
});

test("[rewritten-branch-falls-back-to-full] when the earlier commit is no longer an ancestor, it builds a full packet and says why", () => {
  const { root, reviewed } = branch();
  saveVerdict(root, reviewed, "claims-auditor", [{ id: "f1", claim: "two is never checked", severity: "blocking", reproduced: true }]);
  git(root, "reset", "-q", "--hard", "main");
  commit(root, "a.txt", "one\nTWO\n", "rewritten change");
  const out = join(mkdtempSync(join(tmpdir(), "follow-")), "r");

  const r = prep(root, "--since", reviewed, "--copies", "claims-auditor", "--out", out);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /can't be followed up/, "it says the earlier review can't be followed up");
  assert.match(readFileSync(join(out, "change.patch"), "utf8"), /\+TWO/, "a full packet");
  const meta = JSON.parse(readFileSync(join(out, "meta.json"), "utf8"));
  assert.equal(meta.followUp.since, reviewed);
  assert.match(meta.followUp.fallback, /not an ancestor/);
});
