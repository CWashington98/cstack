import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeRepo, git } from "../../../tests/helpers.mjs";
import { decide } from "../scripts/plain-hold.mjs";
import { writeStamp, plainDir } from "../scripts/plain-stamp.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "plain-hold.mjs");
const GOOD = "This adds the map page. It loads and passes its tests.\n";
const repo = (extra = {}) => makeRepo({
  ".claude/plain.json": JSON.stringify({ neverPublish: { BLUF: "Put the summary first." } }),
  "good.md": GOOD,
  "bad.md": "BLUF: it works.\n",
  ...extra,
});
const bash = (dir, command) => decide({ tool_name: "Bash", tool_input: { command }, cwd: dir });
const text = (r) => r.messages.join("\n");

test("repositories without plain settings are never held", () => {
  const dir = makeRepo({ "bad.md": "BLUF" });
  assert.equal(bash(dir, "gh pr create --body-file bad.md").allow, true);
});

test("inline pull request bodies are held with an instruction to use a file", () => {
  const r = bash(repo(), 'gh pr create --title "Add the map page" --body "It works"');
  assert.equal(r.allow, false);
  assert.match(text(r), /Save it to a file/);
});

test("a body pulled in with $(cat file) or from standard input still counts as inline", () => {
  const dir = repo();
  assert.equal(bash(dir, 'gh pr create --body "$(cat good.md)"').allow, false);
  assert.equal(bash(dir, "gh pr create --body-file -").allow, false);
});

test("a body file that fails the checker is held, and the problems are listed", () => {
  const r = bash(repo(), 'gh pr create --title "Add the map page" --body-file bad.md');
  assert.equal(r.allow, false);
  assert.match(text(r), /BLUF/);
});

test("a clean body file needs a stamp, then goes ahead", () => {
  const dir = repo();
  const before = bash(dir, 'gh pr create --title "Add the map page" --body-file good.md');
  assert.equal(before.allow, false);
  assert.match(text(before), /Run \/plain/);
  writeStamp(dir, GOOD, { pass: true });
  assert.equal(bash(dir, 'gh pr create --title "Add the map page" --body-file good.md').allow, true);
});

test("titles with planning codes are held", () => {
  const dir = repo();
  writeStamp(dir, GOOD, { pass: true });
  const r = bash(dir, 'gh pr create --title "A1 skeleton" --body-file good.md');
  assert.equal(r.allow, false);
  assert.match(text(r), /A1/);
});

test("issues and comments are checked the same way", () => {
  const dir = repo();
  assert.equal(bash(dir, "gh issue create --title Map --body-file bad.md").allow, false);
  assert.equal(bash(dir, 'gh pr comment 12 --body "looks good"').allow, false);
});

test("gh api: file bodies, inline bodies and JSON input are checked; reads are not", () => {
  const dir = repo({ "pr.json": JSON.stringify({ body: "BLUF: x" }) });
  assert.equal(bash(dir, "gh api repos/o/r/issues/5/comments -F body=@bad.md").allow, false);
  assert.match(text(bash(dir, 'gh api repos/o/r/pulls -f title="Add map" -f body="inline"')), /Save it to a file/);
  assert.equal(bash(dir, "gh api repos/o/r/pulls/7 --method PATCH --input pr.json").allow, false);
  assert.equal(bash(dir, "gh api repos/o/r/pulls").allow, true);
});

test("Claude's usual heredoc commit message is read; codes in its first line are held", () => {
  const dir = repo();
  const commit = (first) => `git commit -m "$(cat <<'EOF'\n${first}\n\nBody text.\nEOF\n)"`;
  assert.equal(bash(dir, commit("feat: add the A1 skeleton")).allow, false);
  assert.equal(bash(dir, commit("feat: add the map skeleton")).allow, true);
});

test("a spec file in a commit must pass and be stamped", () => {
  const spec = "This plan adds a map page. It has tests.\n";
  const dir = repo({ "docs/superpowers/specs/map.md": spec });
  git(dir, "add", "docs");
  assert.equal(bash(dir, 'git commit -m "Add the map spec"').allow, false);
  writeStamp(dir, spec, { pass: true });
  assert.equal(bash(dir, 'git commit -m "Add the map spec"').allow, true);
});

test("page publishes are checked; asset uploads are not", () => {
  const dir = repo({ "page.html": "<style>:root{--BG:#FFF}</style><p>BLUF works</p>" });
  assert.equal(decide({ tool_name: "Artifact", tool_input: { file_path: join(dir, "page.html") }, cwd: dir }).allow, false);
  assert.equal(decide({ tool_name: "Artifact", tool_input: { file_path: join(dir, "page.html"), asset: true }, cwd: dir }).allow, true);
});

test("an override with a reason goes ahead and is logged; without a reason it is held", () => {
  const dir = repo();
  assert.equal(bash(dir, 'PLAIN_OVERRIDE="quoting a customer" gh pr create --body-file bad.md').allow, true);
  assert.match(readFileSync(join(plainDir(dir), "overrides.log"), "utf8"), /quoting a customer/);
  assert.equal(bash(dir, "PLAIN_OVERRIDE= gh pr create --body-file bad.md").allow, false);
});

test("the hook holds with exit 2 and explains why on standard error", () => {
  const dir = repo();
  const input = JSON.stringify({ tool_name: "Bash", tool_input: { command: 'gh pr create --body "x"' }, cwd: dir });
  const r = spawnSync(process.execPath, [script], { input, encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /plain held/);
});

test("unreadable hook input allows the action", () => {
  assert.equal(spawnSync(process.execPath, [script], { input: "not json", encoding: "utf8" }).status, 0);
});
