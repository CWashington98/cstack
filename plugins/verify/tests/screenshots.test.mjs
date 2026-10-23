import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeRepo, git } from "../../../tests/helpers.mjs";
import { userVisibleFiles, screenshotProof, screenshotVerdict } from "../scripts/lib/screenshots.mjs";
import { checkRepoSettings } from "../scripts/lib/app-skill.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "screenshots.mjs");
const PATTERNS = ["apps/web/src/**", "*.css", "!**/*.test.*"];

test("user-visible files match a pattern and no ! pattern", () => {
  const changed = ["apps/web/src/Home.tsx", "apps/web/src/Home.test.tsx", "lib/theme/site.css", "server/api.ts", "README.md"];
  assert.deepEqual(userVisibleFiles(changed, PATTERNS), ["apps/web/src/Home.tsx", "lib/theme/site.css"]);
  assert.deepEqual(userVisibleFiles(changed, []), []);
  assert.deepEqual(userVisibleFiles(changed, ["!**/*.test.*"]), [], "only ! patterns match nothing");
});

test("screenshots count as a Markdown image, an <img> tag or a pr-assets link", () => {
  assert.equal(screenshotProof("## Screenshots\n\n![home after](https://github.com/o/r/blob/x/a.png?raw=true)\n"), "images");
  assert.equal(screenshotProof('<img src="https://example.com/a.png" width="300">'), "images");
  assert.equal(screenshotProof("Before and after: https://github.com/o/r/tree/pr-assets/12"), "images");
  assert.equal(screenshotProof("Fixes the header colour."), null);
  assert.equal(screenshotProof(""), null);
  assert.equal(screenshotProof(undefined), null);
});

test("images in comments, code and bot buttons don't count", () => {
  assert.equal(screenshotProof("<!-- Paste screenshots here: ![example](a.png) -->\nDone."), null);
  assert.equal(screenshotProof("<!--\n<img src=a.png>\n-->"), null);
  assert.equal(screenshotProof("```md\n![shot](a.png)\n```\n"), null);
  assert.equal(screenshotProof("~~~\n<img src=a.png>\n~~~\n"), null);
  assert.equal(screenshotProof("Write `![alt](url)` to embed one."), null);
  assert.equal(screenshotProof("The rule names `pr-assets/<n>`."), null);
  const bot = '<a href="https://app.blacksmith.sh/x/pr/1"><picture><img alt="View with [code]smith" src="https://pr-comments-assets.blacksmith.sh/codesmith/view-dark.png" width="162"></picture></a>';
  assert.equal(screenshotProof(`Fixes it.\n\n${bot}`), null);
  assert.equal(screenshotProof("![View with [code]smith](https://pr-comments-assets.blacksmith.sh/a.png)"), null);
  assert.equal(screenshotProof(`![after](https://example.com/a.png)\n${bot}`), "images", "a real image next to the bot's still counts");
  assert.equal(screenshotProof("![after](https://example.com/a.png) ![View with [code]smith](https://x.blacksmith.sh/b.png)"), "images", "removing the bot's image leaves the real one on the same line");
});

test("a not applicable line counts only with a reason", () => {
  assert.equal(screenshotProof("Screenshots: not applicable — only the build script changed"), "not-applicable");
  assert.equal(screenshotProof("- **Screenshots:** Not applicable - copy is behind a flag that is off"), "not-applicable");
  assert.equal(screenshotProof("Screenshot: not applicable: server only"), "not-applicable");
  assert.equal(screenshotProof("Screenshots: not applicable"), null);
  assert.equal(screenshotProof("Screenshots: not applicable —"), null);
  assert.equal(screenshotProof("We said screenshots: not applicable — but inline"), null, "the line has to start with it");
  assert.equal(screenshotProof("<!-- Screenshots: not applicable — <reason> -->"), null);
  assert.equal(screenshotProof("```\nScreenshots: not applicable — example\n```"), null);
});

const visible = ["apps/web/src/Home.tsx"];
const verdict = (body, author, requiredFor = ["owner-bot"]) => screenshotVerdict({ visible, body, author, requiredFor });

test("no user-visible change is skipped, whoever the author", () => {
  assert.equal(screenshotVerdict({ visible: [], body: "", author: "owner-bot", requiredFor: ["owner-bot"] }).status, "skip");
});

test("a required author without screenshots is held, and a not taken line doesn't help", () => {
  const held = verdict("Fixes the header.", "owner-bot");
  assert.equal(held.status, "hold");
  assert.match(held.message, /required for pull requests by owner-bot/);
  assert.match(held.message, /apps\/web\/src\/Home\.tsx/);
  const taken = verdict("Screenshots: not taken — no simulator", "Owner-Bot");
  assert.equal(taken.status, "hold", "account names ignore capitals");
  assert.match(taken.message, /"Screenshots: not taken" line doesn't count/);
  assert.equal(verdict("![after](a.png)", "owner-bot").status, "pass");
  assert.equal(verdict("Screenshots: not applicable — server only", "owner-bot").status, "pass");
});

test("anyone else without screenshots gets a note that never holds, and a not taken line passes", () => {
  const note = verdict("Fixes the header.", "teammate");
  assert.equal(note.status, "note");
  assert.match(note.message, /Worth adding\. They are required only for owner-bot\./);
  assert.match(note.message, /Screenshots: not taken — <reason>/);
  assert.equal(verdict("Screenshots: not taken — my laptop can't run the simulator", "teammate").status, "pass");
  assert.equal(verdict("Screenshots: not taken", "teammate").status, "note", "the reason is required");
  assert.match(verdict("Fixes it.", "teammate", []).message, /recommended, not required/);
});

function project(settings) {
  const root = makeRepo({ "apps/web/src/Home.tsx": "v1\n", "server/api.ts": "v1\n", ...(settings ? { ".claude/verify.json": JSON.stringify(settings) } : {}) });
  git(root, "add", "."); git(root, "commit", "-qm", "base"); git(root, "branch", "base");
  return root;
}
function change(root, file) {
  writeFileSync(join(root, file), "v2\n");
  git(root, "commit", "-qam", "change");
}
function run(root, body, author = "owner-bot") {
  const out = join(mkdtempSync(join(tmpdir(), "screenshots-body-")), "pr.md");
  writeFileSync(out, body);
  const r = spawnSync("node", [script, "--base", "base", "--pr-body", out, "--author", author], { cwd: root, encoding: "utf8" });
  return { status: r.status, text: r.stdout + r.stderr };
}
const SETTINGS = { integrationBranch: "main", userVisible: PATTERNS, screenshotsRequiredFor: ["owner-bot"] };

test("the command does nothing without settings, or when no user-visible file changed", () => {
  const bare = project(null);
  change(bare, "apps/web/src/Home.tsx");
  assert.deepEqual(run(bare, "No screenshots."), { status: 0, text: `Skipped: No "userVisible" patterns in .claude/verify.json, so there is nothing to check.\n` });
  const server = project(SETTINGS);
  change(server, "server/api.ts");
  const r = run(server, "No screenshots.");
  assert.equal(r.status, 0);
  assert.match(r.text, /^Skipped: No changed file matches/);
});

test("the command exits 1 for a required author without screenshots, 0 for a note or proof, 2 on wrong use", () => {
  const root = project(SETTINGS);
  change(root, "apps/web/src/Home.tsx");
  const held = run(root, "Fixes the header.");
  assert.equal(held.status, 1);
  assert.match(held.text, /^hold {2}1 changed file\(s\) change what users see \(apps\/web\/src\/Home\.tsx\)/);
  assert.equal(run(root, "![after](https://example.com/a.png)").status, 0);
  const note = run(root, "Fixes the header.", "teammate");
  assert.equal(note.status, 0);
  assert.match(note.text, /^note {2}/);
  assert.equal(spawnSync("node", [script, "--base", "base"], { cwd: root, encoding: "utf8" }).status, 2);
});

test("a deleted user-visible file counts as a change users see", () => {
  const root = project(SETTINGS);
  git(root, "rm", "-q", "apps/web/src/Home.tsx"); git(root, "commit", "-qm", "remove");
  assert.equal(run(root, "Removes the home screen.").status, 1);
});

test("bad screenshot settings are wrong use, and check-app-skill reports them", () => {
  const root = project({ integrationBranch: "main", userVisible: "apps/**", screenshotsRequiredFor: [""] });
  const r = run(root, "x");
  assert.equal(r.status, 2);
  assert.match(r.text, /"userVisible" must be a list of path patterns/);
  const messages = checkRepoSettings(root).map((f) => f.message).join("\n");
  assert.match(messages, /"userVisible" must be a list of path patterns/);
  assert.match(messages, /"screenshotsRequiredFor" must be a list of account names/);
  assert.deepEqual(checkRepoSettings(project(SETTINGS)), []);
});

test("a worktree without its own settings file uses the main checkout's", () => {
  const root = makeRepo({ ".gitignore": ".claude/\n", "apps/web/src/Home.tsx": "v1\n" });
  mkdirSync(join(root, ".claude"));
  writeFileSync(join(root, ".claude", "verify.json"), JSON.stringify(SETTINGS));
  git(root, "add", "."); git(root, "commit", "-qm", "base"); git(root, "branch", "base");
  const wt = join(mkdtempSync(join(tmpdir(), "screenshots-wt-")), "wt");
  git(root, "worktree", "add", "-q", wt, "-b", "feature");
  change(wt, "apps/web/src/Home.tsx");
  assert.equal(run(wt, "Fixes the header.").status, 1);
});
