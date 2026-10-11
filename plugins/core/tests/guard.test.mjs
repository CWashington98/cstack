import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeRepo, git } from "../../../tests/helpers.mjs";
import { decide, mask, unwrap, programName } from "../scripts/guard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "guard.mjs");
const SETTINGS = {
  integrationBranch: "staging",
  agentsNeverTouch: ["prod-backend-9", "app.example.com"],
  agentsMayDeployTo: ["staging-backend-1", "sandbox-dev"],
};
const project = (extra = {}, settings = SETTINGS) => makeRepo({
  ...(settings ? { ".claude/verify.json": JSON.stringify(settings) } : {}),
  "package.json": JSON.stringify({ scripts: { "backend:deploy": "cd packages/api && bun run deploy", build: "tsc", "ship:web": "vercel --prod" } }),
  "packages/api/package.json": JSON.stringify({ scripts: { deploy: "convex deploy", dev: "convex dev" } }),
  ...extra,
});
const run = (dir, command) => decide({ tool_name: "Bash", tool_input: { command }, cwd: dir });
const refused = (dir, command, pattern) => {
  const r = run(dir, command);
  assert.equal(r.allow, false, `expected the guard to refuse: ${command}`);
  if (pattern) assert.match(r.refusals.map((x) => x.reason).join("\n"), pattern, command);
  return r;
};
const allowed = (dir, command) => {
  const r = run(dir, command);
  assert.equal(r.allow, true, `expected the guard to allow: ${command}\n${r.refusals.map((x) => x.reason).join("\n")}`);
};

test("everyday commands are allowed, with or without a settings file", () => {
  for (const dir of [project(), project({}, null)]) {
    for (const c of ["ls -la", "git status", "bun run build", "bun test", "npx convex dev", "git commit -m 'Add the page'", "vercel deploy", "terraform plan"]) allowed(dir, c);
  }
});

test("every spelling of a backend deploy is refused when it names no allowed target", () => {
  const dir = project();
  for (const c of [
    "bunx convex deploy",
    "npx convex@latest deploy --yes",
    "CONVEX_DEPLOY_KEY=abc npx convex deploy",
    "dotenvx run -f .env -- bunx convex deploy",
    "pnpm dlx convex deploy",
    "./node_modules/.bin/convex deploy",
    'bash -c "npx convex deploy"',
    "echo \"$(npx convex deploy)\"",
    "echo `bunx convex deploy`",
    "true && (cd packages/api && npx convex deploy)",
  ]) refused(dir, c, /changes a live system/);
});

test("a deploy hidden behind package scripts is found by reading package.json", () => {
  const dir = project();
  refused(dir, "bun run backend:deploy", /convex deploy/);
  refused(dir, "npm run ship:web", /Vercel production deploy/);
  refused(join(dir, "packages", "api"), "bun run deploy", /convex deploy/);
  allowed(dir, "bun run build");
  refused(dir, "npm run release:mobile", /package script `release:mobile`/);
});

test("a deploy inside a shell script the agent runs is found by reading the script", () => {
  const dir = project({ "scripts/ship.sh": "#!/bin/sh\nset -e\nbunx convex deploy\n", "scripts/fine.sh": "#!/bin/sh\necho hello\n" });
  refused(dir, "./scripts/ship.sh");
  refused(dir, "bash scripts/ship.sh");
  allowed(dir, "./scripts/fine.sh");
  refused(dir, "bash <<'EOF'\nnpx convex deploy\nEOF");
});

test("a deploy that names an allowed target goes ahead, even when the target is named elsewhere in the line", () => {
  const dir = project();
  allowed(dir, 'K=$(bunx convex deployment token create t1 --deployment staging-backend-1) && CONVEX_DEPLOY_KEY="$K" bun run backend:deploy');
  allowed(dir, "cdk deploy --profile sandbox-dev");
  refused(dir, "cdk deploy --profile production", /`cdk deploy`/);
});

test("a deploy is refused when it names a never target, even if it also names an allowed one", () => {
  refused(project(), "bunx convex deploy --deployment staging-backend-1 && bunx convex deploy --deployment prod-backend-9", /agentsNeverTouch/);
});

test("without a settings file every deploy is refused", () => {
  const dir = project({}, null);
  refused(dir, "bunx convex deploy", /\.claude\/verify\.json/);
  refused(dir, "cdk deploy --profile sandbox-dev");
});

test("--prod on any Convex command is refused", () => {
  refused(project(), "npx convex run users:list --prod", /--prod/);
  refused(project(), "npx convex env set KEY v --prod", /--prod/);
});

test("commands that use a never entry are refused; commands that only mention it are not", () => {
  const dir = project();
  refused(dir, "npx convex export --deployment-name prod-backend-9 --path out.zip", /prod-backend-9/);
  refused(dir, "curl https://APP.example.com/api/health", /app\.example\.com/);
  refused(dir, "aws s3 ls --profile x && npx convex data users --deployment-name Prod-Backend-9");
  allowed(dir, 'git commit -m "Document that prod-backend-9 is production"');
  allowed(dir, "git commit -F - <<'EOF'\nprod-backend-9 is production\nEOF");
  allowed(dir, "grep -rn prod-backend-9 docs");
  allowed(dir, "gh pr comment 4 --body-file note.md");
  refused(dir, "git clone https://app.example.com/repo.git");
});

test("store submissions and production app builds are refused; preview builds are not", () => {
  const dir = project();
  refused(dir, "eas submit -p ios", /app stores/);
  refused(dir, "npx eas-cli build --platform ios", /no profile/);
  refused(dir, "eas build --profile production", /production/);
  refused(dir, "eas build -e production-ios");
  allowed(dir, "eas build --profile preview --platform android");
  refused(dir, "eas update --message fix", /eas update/);
  refused(dir, "eas update --branch production");
  allowed(dir, "eas update --branch preview --message fix");
});

test("Vercel production deploys, publishes and GitHub releases are refused", () => {
  const dir = project();
  refused(dir, "vercel --prod");
  refused(dir, "npx vercel@latest deploy --prod");
  refused(dir, "vercel promote https://x.vercel.app");
  refused(dir, "npm publish", /publishes a package/);
  refused(dir, "bun publish");
  refused(dir, "gh release create v1.0.0", /release/);
});

test("pushes to protected branches and force pushes are refused; feature branches are not", () => {
  const dir = project();
  allowed(dir, "git push -u origin feat/thing");
  allowed(dir, "git push origin --delete feat/old");
  refused(dir, "git push origin main", /protected branch "main"/);
  refused(dir, "git push origin HEAD:main", /protected branch "main"/);
  refused(dir, "git push origin feat/x:refs/heads/master", /"master"/);
  refused(dir, "git push origin staging", /"staging"/);
  refused(dir, "git push --force origin feat/x", /force-push/);
  refused(dir, "git push -uf origin feat/x", /force-push/);
  refused(dir, "git push --force-with-lease origin feat/x", /force-push/);
  refused(dir, "git push origin +feat/x", /force-push/);
  refused(dir, "git push origin --delete main", /deletes the protected branch "main"/);
  refused(dir, "git push origin :main", /deletes/);
  refused(dir, "git push --all origin", /every branch/);
  refused(mkdtempSync(join(tmpdir(), "guard-elsewhere-")), `git -C ${dir} push origin staging`, /"staging"/);
});

test("a bare git push is judged by the branch that is checked out", () => {
  const dir = project();
  git(dir, "checkout", "-q", "-b", "main");
  refused(dir, "git push", /"main"/);
  refused(dir, "git push origin HEAD", /"main"/);
  git(dir, "checkout", "-q", "-b", "feat/x");
  allowed(dir, "git push");
});

test("a project's own protected branches replace main and master, and the integration branch is always protected", () => {
  const dir = project({}, { integrationBranch: "develop", protectedBranches: ["release"] });
  refused(dir, "git push origin release");
  refused(dir, "git push origin develop");
  allowed(dir, "git push origin main");
});

test("merges are allowed: agents merge when the owner says so", () => {
  const dir = project();
  allowed(dir, "gh pr merge 12 --merge --delete-branch");
  allowed(dir, "gh api -X PUT repos/o/r/pulls/12/merge");
});

test("changes to GitHub secrets, rulesets and repository settings are refused; reading them is not", () => {
  const dir = project();
  refused(dir, "gh secret set TOKEN < token.txt", /GitHub settings or secrets/);
  refused(dir, "gh variable delete X");
  refused(dir, "gh repo edit --visibility public");
  refused(dir, "gh repo delete o/r --yes");
  refused(dir, "gh api repos/o/r/rulesets -X POST --input rules.json", /rulesets/);
  refused(dir, "gh api repos/o/r/rulesets --input rules.json", /sends POST/);
  refused(dir, "gh api repos/o/r/actions/secrets/X -f encrypted_value=abc", /sends POST/);
  refused(dir, "gh api -X PUT repos/o/r/branches/main/protection -f x=y");
  refused(dir, "gh api -X PATCH repos/o/r -f private=false");
  refused(dir, "gh api -X DELETE repos/o/r/git/refs/heads/staging", /protected branch "staging"/);
  refused(dir, "gh api graphql -f query='mutation { deleteBranchProtectionRule(input: {}) { clientMutationId } }'");
  allowed(dir, "gh api repos/o/r/rulesets");
  allowed(dir, "gh secret list");
  allowed(dir, "gh api repos/o/r/issues/3/comments -f body=hi");
  allowed(dir, "gh api -X DELETE repos/o/r/git/refs/heads/feat/old");
});

test("recursive deletes are allowed inside the repository and temporary folders, and refused everywhere else", () => {
  const dir = project();
  const tmp = mkdtempSync(join(tmpdir(), "guard-rm-"));
  allowed(dir, "rm -rf node_modules dist");
  allowed(dir, "rm -rf packages/api/.cache/*");
  allowed(dir, `rm -rf ${tmp}/out`);
  allowed(dir, "rm notes.txt ../outside.txt");
  refused(dir, "rm -rf ~/Documents", /outside this repository/);
  refused(dir, "rm -rf /", /holds one/);
  refused(dir, "rm -rf ./*", /whole repository/);
  refused(dir, "rm -rf .", /whole repository/);
  refused(dir, `rm -rf ${dirname(dir)}`, /holds one/);
  refused(dir, `rm -fr ${homedir()}/guard-test-not-there`, /outside/);
  refused(dir, "rm -r -f -- /opt/guard-test");
  refused(dir, "rm --recursive /etc/thing");
  refused(dir, "rm -rf $GUARD_TEST_UNSET_VARIABLE/x", /can't tell where/);
  refused(dir, "sudo rm -rf /usr/local/thing");
});

test("an unreadable or wrong settings file refuses every shell command until it is fixed", () => {
  refused(project({ ".claude/verify.json": "{not json" }, null), "ls", /can't be read/);
  refused(project({}, { agentsNeverTouch: "prod-backend-9" }), "ls", /must be a list/);
});

test("a worktree without its own settings file uses the main checkout's", () => {
  const dir = project({}, null);
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".gitignore"), ".claude/verify.json\n");
  writeFileSync(join(dir, ".claude", "verify.json"), JSON.stringify(SETTINGS));
  git(dir, "add", ".gitignore", "package.json");
  git(dir, "commit", "-q", "-m", "init");
  const wt = join(mkdtempSync(join(tmpdir(), "guard-wt-")), "wt");
  git(dir, "worktree", "add", "-q", wt);
  assert.equal(existsSync(join(wt, ".claude", "verify.json")), false);
  refused(wt, "npx convex data users --deployment-name prod-backend-9", /agentsNeverTouch/);
});

test("a command that moves into another project uses that project's settings too", () => {
  const other = project({}, { integrationBranch: "main", agentsNeverTouch: ["other-prod-2"] });
  refused(project({}, null), `cd ${other} && npx convex data x --deployment-name other-prod-2`, /other-prod-2/);
});

test("other tools are never checked", () => {
  assert.equal(decide({ tool_name: "Write", tool_input: { content: "bunx convex deploy" }, cwd: project() }).allow, true);
});

test("wrappers and program names are read the way the shell runs them", () => {
  assert.deepEqual(unwrap(["FOO=1", "sudo", "-u", "me", "npx", "-y", "convex", "deploy"]), ["convex", "deploy"]);
  assert.deepEqual(unwrap(["timeout", "-s", "KILL", "30", "env", "-u", "X", "A=b", "bunx", "convex", "deploy"]), ["convex", "deploy"]);
  assert.deepEqual(unwrap(["doppler", "run", "--project", "p", "--", "eas", "submit"]), ["eas", "submit"]);
  assert.equal(programName("convex@1.2.3"), "convex");
  assert.equal(programName("/x/node_modules/.bin/eas-cli"), "eas");
  assert.equal(programName("tofu"), "terraform");
});

test("secrets are hidden before a command is logged", () => {
  const out = mask('CONVEX_DEPLOY_KEY="prod:x|abcdefghijklmnopqrstu" GH_TOKEN=ghp_123 bunx convex deploy --key prod:y|abcdefghijklmnopqrstuvwx');
  assert.doesNotMatch(out, /abcdefghijklmnop|ghp_123/);
  assert.match(out, /CONVEX_DEPLOY_KEY=<hidden>/);
});

test("the hook refuses with exit 2 and a reason, allows with exit 0, and logs each refusal", () => {
  const dir = project();
  const logFile = join(mkdtempSync(join(tmpdir(), "guard-log-")), "log.jsonl");
  const hook = (command) => spawnSync("node", [script], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd: dir }), encoding: "utf8", env: { ...process.env, CSTACK_GUARD_LOG: logFile } });
  const no = hook("GH_TOKEN=ghp_secret123 bunx convex deploy");
  assert.equal(no.status, 2);
  assert.match(no.stderr, /cstack guard refused/);
  assert.match(no.stderr, /with ! in front/);
  const yes = hook("git status");
  assert.equal(yes.status, 0);
  assert.equal(yes.stderr, "");
  const lines = readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].decision, "refused");
  assert.deepEqual(lines[0].rules, ["deploy"]);
  assert.doesNotMatch(lines[0].command, /ghp_secret123/);
  assert.equal(spawnSync("node", [script], { input: "not json", encoding: "utf8", env: { ...process.env, CSTACK_GUARD_LOG: logFile } }).status, 0);
});

test("the core plugin runs the guard before every shell command", () => {
  const hooks = JSON.parse(readFileSync(join(here, "..", "hooks", "hooks.json"), "utf8"));
  const entry = hooks.hooks.PreToolUse.find((h) => h.matcher === "Bash");
  assert.ok(entry, "a PreToolUse entry for Bash");
  assert.match(entry.hooks[0].command, /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/guard\.mjs/);
});
