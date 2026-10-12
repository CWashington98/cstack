import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeRepo, git } from "../../../tests/helpers.mjs";
import { decide, mask, unwrap, programName, refuseOnError } from "../scripts/guard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "guard.mjs");
const SETTINGS = {
  integrationBranch: "staging",
  agentsNeverTouch: ["prod-backend-9", "app.example.com"],
  agentsMayDeployTo: ["staging-backend-1", "sandbox-dev"],
};
const project = (extra = {}, settings = SETTINGS) => makeRepo({
  ...(settings ? { ".claude/verify.json": JSON.stringify(settings) } : {}),
  "package.json": JSON.stringify({
    workspaces: ["packages/*"],
    scripts: {
      "backend:deploy": "cd packages/api && bun run deploy",
      build: "tsc",
      postbuild: "echo built",
      "ship:web": "vercel --prod",
      "ship:all": "run-s ship:web",
      clean: 'rm -rf "$OUT_DIR"',
      "seed:prod": "dotenvx run -f .env.production -- npx convex run seed:all",
    },
  }),
  "packages/api/package.json": JSON.stringify({ name: "@x/api", scripts: { deploy: "convex deploy", go: "convex deploy", dev: "convex dev" } }),
  "packages/web/package.json": JSON.stringify({ name: "@x/web", scripts: { go: "echo fine" } }),
  ".env.production": "CONVEX_DEPLOYMENT=prod:prod-backend-9\n",
  ".env.staging": "CONVEX_DEPLOY_KEY=prod:staging-backend-1|x\n",
  ...extra,
});
const run = (dir, command) => decide({ tool_name: "Bash", tool_input: { command }, cwd: dir });
// A deployment selector exactly as the Convex tool server makes one: the kind,
// a colon, then base64 of {projectDir, deployment}.
const selector = (deployment, projectDir = "/work/app") => `${deployment.kind}:${Buffer.from(JSON.stringify({ projectDir, deployment })).toString("base64")}`;
const reasons = (r) => r.refusals.map((x) => x.reason).join("\n");
const refused = (dir, command, pattern) => {
  const r = run(dir, command);
  assert.equal(r.allow, false, `expected the guard to refuse: ${command}`);
  if (pattern) assert.match(reasons(r), pattern, command);
  return r;
};
const allowed = (dir, command) => {
  const r = run(dir, command);
  assert.equal(r.allow, true, `expected the guard to allow: ${command}\n${reasons(r)}`);
};

test("everyday commands are allowed, with or without a settings file", () => {
  for (const dir of [project(), project({}, null)]) {
    for (const c of [
      "ls -la", "git status", "bun run build", "bun test", "npx convex dev", "git commit -m 'Add the page'", "vercel deploy", "vercel",
      "terraform plan", "vercel build --prod", "git log --grep deploy", "npx convex dashboard --prod --no-open",
      "git push --dry-run origin staging", 'git commit -m "$(cat <<\'EOF\'\nRun `npx convex deploy` and `rm -rf ~` later\nEOF\n)"',
    ]) allowed(dir, c);
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
    "true && (cd packages/api && npx convex deploy)",
    "npx convex --url https://x.convex.cloud deploy",
    "time nohup exec command npx convex deploy",
    "watch -n 5 npx convex deploy",
    "npm exec -- convex deploy",
    "bun x convex deploy",
    "cross-env A=1 convex deploy",
    "env-cmd -f .env.test convex deploy",
  ]) refused(dir, c, /changes a live system/);
});

test("shell blocks and keywords don't hide a command", () => {
  const dir = project();
  for (const c of [
    "if git diff --quiet; then git push origin main; fi",
    "for b in main; do git push origin $b; done",
    "{ git push origin main; }",
    "if true; then eas submit -p ios; else echo no; fi",
    "while true; do npx convex deploy; break; done",
    "until false; do npx convex deploy; done",
    "! npx convex deploy",
    "f() { npx convex deploy; }; f",
    "function ship { npx convex deploy; }",
    "case $x in prod) npx convex deploy;; esac",
  ]) refused(dir, c);
});

test("commands inside $( ), backticks, bash -c, eval and heredocs are checked", () => {
  const dir = project();
  for (const c of [
    'bash -c "npx convex deploy"',
    "bash -ec 'npx convex deploy'",
    "sh -xc 'npx convex deploy'",
    "bash -lc 'npx convex deploy'",
    "zsh -ic 'npx convex deploy'",
    "eval npx convex deploy",
    'echo "$(npx convex deploy)"',
    "echo `bunx convex deploy`",
    "bash <<'EOF'\nnpx convex deploy\nEOF",
  ]) refused(dir, c, /changes a live system/);
});

test("a deploy hidden behind package scripts is found by reading package.json", () => {
  const dir = project();
  refused(dir, "bun run backend:deploy", /convex deploy/);
  refused(dir, "npm run ship:web", /Vercel production deploy/);
  refused(dir, "npm run-script ship:web", /Vercel/);
  refused(dir, "npm --prefix . run ship:web", /Vercel/);
  refused(dir, "bun --cwd=packages/api run deploy", /convex deploy/);
  refused(dir, "bun run --cwd packages/api deploy", /convex deploy/);
  refused(join(dir, "packages", "api"), "bun run deploy", /convex deploy/);
  refused(dir, "npm run release:mobile", /package script `release:mobile`/);
  refused(dir, "yarn convex:deploy", /package script `convex:deploy`/);
  refused(dir, "npm run ship:all", /Vercel/);
  allowed(dir, "bun run build");
});

test("pre and post scripts run with the script, and are checked", () => {
  const dir = project({ "package.json": JSON.stringify({ scripts: { build: "tsc", postbuild: "npx convex deploy", lint: "eslint", prelint: "vercel --prod" } }) });
  refused(dir, "npm run build", /convex deploy/);
  refused(dir, "bun run lint", /Vercel/);
});

test("a tool run through yarn, pnpm or bun without `run` is checked as that tool", () => {
  const dir = project();
  for (const c of ["yarn convex deploy", "bun run convex deploy", "pnpm convex deploy", "yarn eas submit -p ios", "yarn vercel --prod"]) refused(dir, c);
  for (const c of ["pnpm exec convex deploy", "pnpm --filter @x/api exec convex deploy", "bun x convex deploy"]) refused(dir, c, /^`convex deploy` changes/m);
});

test("workspace scripts are read from the workspace they run in", () => {
  const dir = project();
  for (const c of [
    "yarn workspace @x/api go",
    "npm run go -w packages/api",
    "npm run go --workspace=packages/api",
    "pnpm --filter @x/api go",
    "pnpm --filter=@x/api run go",
    "bun --filter api go",
    "pnpm -F ./packages/api go",
  ]) refused(dir, c, /convex deploy/);
  allowed(dir, "yarn workspace @x/web go");
  refused(dir, "pnpm --filter something-unknown go", /convex deploy/);
});

test("a deploy inside a shell script the command runs is found by reading the script", () => {
  const dir = project({ "scripts/ship.sh": "#!/bin/sh\nset -e\nbunx convex deploy\n", "scripts/ship": "#!/usr/bin/env bash\nbunx convex deploy\n", "scripts/fine.sh": "#!/bin/sh\necho hello\n" });
  refused(dir, "./scripts/ship.sh");
  refused(dir, "scripts/ship");
  refused(dir, "bash scripts/ship.sh");
  refused(dir, "bash -o pipefail scripts/ship.sh");
  refused(dir, "source scripts/ship.sh");
  refused(dir, ". ./scripts/ship.sh");
  allowed(dir, "./scripts/fine.sh");
  allowed(dir, "source scripts/fine.sh");
});

test("a script written and run in the same command is read from what was written", () => {
  const dir = project();
  const tmp = mkdtempSync(join(tmpdir(), "guard-write-"));
  refused(dir, `cat > ${tmp}/x.sh <<'EOF'\nnpx convex deploy\nEOF\nbash ${tmp}/x.sh`, /convex deploy/);
  refused(dir, `tee ${tmp}/y.sh <<'EOF'\nvercel --prod\nEOF\nchmod +x ${tmp}/y.sh && ${tmp}/y.sh`, /Vercel/);
  allowed(dir, `cat > ${tmp}/z.sh <<'EOF'\necho hi\nEOF\nbash ${tmp}/z.sh`);
});

test("each deploy needs its own allowed target: in its command, a variable feeding it, an env file, or the command that ran its script", () => {
  const dir = project({ "scripts/deploy.sh": 'if [ "$1" = staging ]; then npx convex deploy --url https://staging-backend-1.convex.cloud; else npx convex deploy; fi\n' });
  allowed(dir, 'K=$(bunx convex deployment token create t1 --deployment staging-backend-1) && CONVEX_DEPLOY_KEY="$K" bun run backend:deploy');
  allowed(dir, "export TARGET=staging-backend-1; npx convex deploy --deployment $TARGET");
  allowed(dir, "dotenvx run -f .env.staging -- npx convex deploy");
  allowed(dir, "cdk deploy --profile sandbox-dev");
  allowed(dir, "bun run backend:deploy --deployment staging-backend-1");
  refused(dir, "cdk deploy --profile production", /`cdk deploy`/);
  refused(dir, "bunx convex deploy --deployment staging-backend-1 && vercel --prod", /Vercel/);
  refused(dir, "cdk deploy --profile sandbox-dev && firebase deploy", /firebase deploy/);
  refused(dir, "echo staging-backend-1 && bunx convex deploy", /convex deploy/);
  refused(dir, "vercel --prod && echo sandbox-dev", /Vercel/);
  refused(dir, "bash scripts/deploy.sh prod", /convex deploy/);
});

test("a deploy is refused when it names a never target, even if it also names an allowed one", () => {
  refused(project(), "bunx convex deploy --deployment staging-backend-1 --url https://prod-backend-9.convex.cloud", /agentsNeverTouch/);
});

test("without a settings file every deploy is refused", () => {
  const dir = project({}, null);
  refused(dir, "bunx convex deploy", /\.claude\/verify\.json/);
  refused(dir, "cdk deploy --profile sandbox-dev");
});

test("infrastructure tools are caught wherever their flags put the subcommand", () => {
  const dir = project();
  for (const c of [
    "terraform -chdir=infra apply -auto-approve", "tofu -chdir=infra destroy", "terraform import a.b id",
    "pulumi --cwd infra up --yes", "pulumi update", "pulumi destroy",
    "npx cdk --profile prod deploy --all", "cdk destroy",
    "firebase -P prod deploy", "firebase --project prod deploy --only hosting",
    "fly -a myapp deploy", "flyctl deploy",
    "npx wrangler --env production deploy", "wrangler publish",
    "railway up", "helm upgrade --install api ./chart", "helm rollback api 3", "heroku container:release web", "sam deploy", "sam sync", "sam delete", "sls deploy", "serverless remove", "amplify publish", "amplify push", "amplify delete",
    "aws cloudformation deploy --stack-name x", "aws cloudformation delete-stack --stack-name x",
    "make deploy", "just release", "turbo run deploy",
    "netlify deploy --prod", "netlify deploy --prod-if-unlocked",
  ]) refused(dir, c, /changes a live system/);
  for (const c of ["helm template ./chart", "heroku logs --tail", "terraform plan", "pulumi preview", "cdk diff", "aws s3 ls", "make build", "netlify deploy", "aws cloudformation describe-stacks"]) allowed(dir, c);
});

// Owner decision 2026-10-12: Convex production reads can be OK. Writes and
// deploys stay refused. "agentsMayReadProduction" in .claude/verify.json turns
// reads off; a missing setting means reads are allowed.
const READ_SHELL = ["data users --prod", "logs --prod", "function-spec --prod", "dashboard --prod --no-open", "insights --prod", "logs --history 50 --prod"];
const WRITE_SHELL = ["run users:list --prod", "env set KEY v --prod", "env remove KEY --prod", "env list --prod", "env get KEY --prod", "deploy --prod", "import data.zip --prod", "export --path out.zip --prod", "codegen --prod", "somethingnew --prod", "--prod"];
const MODES = [["missing", {}], ["true", { agentsMayReadProduction: true }], ["false", { agentsMayReadProduction: false }]];
const projectWith = (extra) => project({}, { ...SETTINGS, ...extra });

test("convex --prod: reads are allowed and writes refused with the setting missing or true; false allows only the dashboard", () => {
  for (const [mode, extra] of MODES) {
    const dir = projectWith(extra);
    for (const c of READ_SHELL) {
      if (mode === "false" && !c.startsWith("dashboard")) refused(dir, `npx convex ${c}`, /"agentsMayReadProduction" is false/);
      else allowed(dir, `npx convex ${c}`);
    }
    for (const c of WRITE_SHELL) refused(dir, `npx convex ${c}`, /--prod/);
    refused(dir, "npx convex run users:list --prod", /is a write.*Only reads are allowed on production.*when the project permits them/);
  }
});

test("convex --prod: a read that names a never entry is still refused", () => {
  for (const [, extra] of MODES) {
    const dir = projectWith(extra);
    refused(dir, "npx convex data users --prod --deployment-name prod-backend-9", /agentsNeverTouch/);
    refused(dir, "npx convex logs --prod --deployment-name PROD-backend-9", /agentsNeverTouch/);
  }
});

test("agentsMayReadProduction must be true or false", () => {
  refused(projectWith({ agentsMayReadProduction: "no" }), "ls", /agentsMayReadProduction/);
});

const TOOL_READS = ["status", "tables", "data", "functionSpec", "logs", "insights", "runOneoffQuery"];
const TOOL_WRITES = ["run", "envGet", "envList", "envSet", "envRemove", "somethingNew"];

test("convex tool server on production: reads allowed, writes refused, with the setting missing, true and false", () => {
  for (const [mode, extra] of MODES) {
    const dir = projectWith(extra);
    for (const kind of [{ kind: "prod" }, { kind: "implicitProd" }, { kind: "deploymentSelector", selector: "acme:app:prod" }]) {
      const call = (tool, prefix = "mcp__plugin_convex_convex__") => decide({ tool_name: prefix + tool, tool_input: { deploymentSelector: selector(kind) }, cwd: dir });
      for (const tool of TOOL_READS) for (const prefix of ["mcp__plugin_convex_convex__", "mcp__convex__"]) {
        const r = call(tool, prefix);
        assert.equal(r.allow, mode !== "false", `${prefix}${tool} ${mode}`);
        if (mode === "false") assert.match(reasons(r), /"agentsMayReadProduction" is false/);
      }
      for (const tool of TOOL_WRITES) for (const prefix of ["mcp__plugin_convex_convex__", "mcp__convex__"]) {
        const r = call(tool, prefix);
        assert.equal(r.allow, false, `${prefix}${tool} ${mode}`);
        if (mode !== "false") assert.match(reasons(r), /is a write.*Reads are allowed when the project permits them/);
      }
    }
  }
});

test("convex tool server: a production read that names a never entry is still refused; non-production calls are untouched", () => {
  for (const [, extra] of MODES) {
    const dir = projectWith(extra);
    const r = decide({ tool_name: "mcp__plugin_convex_convex__data", tool_input: { deploymentSelector: selector({ kind: "prod" }, "/work/prod-backend-9"), tableName: "users" }, cwd: dir });
    assert.equal(r.allow, false);
    assert.match(reasons(r), /agentsNeverTouch/);
    assert.equal(decide({ tool_name: "mcp__plugin_convex_convex__run", tool_input: { deploymentSelector: selector({ kind: "ownDev" }) }, cwd: dir }).allow, true);
  }
});

test("commands that use a never entry are refused; commands that only mention it are not", () => {
  const dir = project();
  refused(dir, "npx convex export --deployment-name prod-backend-9 --path out.zip", /prod-backend-9/);
  refused(dir, "curl https://APP.example.com/api/health", /app\.example\.com/);
  refused(dir, "aws s3 ls --profile x && npx convex data users --deployment-name Prod-Backend-9");
  refused(dir, "if true; then npx convex data --deployment-name prod-backend-9; fi");
  refused(dir, "CONVEX_DEPLOYMENT=prod:prod-backend-9; npx convex run x");
  refused(dir, "for d in staging-backend-1 prod-backend-9; do npx convex data --deployment-name $d; done", /prod-backend-9/);
  allowed(dir, "for f in a.md b.md; do grep prod-backend-9 $f; done");
  allowed(dir, "for f in $(grep -l prod-backend-9 docs); do echo $f; done");
  refused(dir, "find . -name x -exec curl https://app.example.com \\;", /app\.example\.com/);
  allowed(dir, 'git commit -m "Document that prod-backend-9 is production"');
  allowed(dir, "git commit -F - <<'EOF'\nprod-backend-9 is production\nEOF");
  allowed(dir, "grep -rn prod-backend-9 docs");
  allowed(dir, "gh pr comment 4 --body 'prod-backend-9 is the production backend'");
  allowed(dir, "gh issue create --title x --body 'see app.example.com'");
  allowed(dir, "gh api repos/o/r/issues/3/comments -f body='prod-backend-9 is production'");
  refused(dir, "git clone https://app.example.com/repo.git");
});

test("never entries inside env files, and inside heredocs fed to a program, count as used", () => {
  const dir = project();
  refused(dir, "dotenvx run -f .env.production -- npx convex run seed:all", /prod-backend-9/);
  refused(dir, "bun run seed:prod", /prod-backend-9/);
  refused(dir, "node --env-file=.env.production seed.js", /prod-backend-9/);
  refused(dir, "python3 - <<'EOF'\nimport urllib.request\nurllib.request.urlopen('https://app.example.com/admin')\nEOF", /app\.example\.com/);
  allowed(dir, "cat <<'EOF'\napp.example.com\nEOF");
});

test("store submissions and production app builds are refused; preview builds are not", () => {
  const dir = project();
  refused(dir, "eas submit -p ios", /app stores/);
  refused(dir, "eas --non-interactive submit", /app stores/);
  refused(dir, "npx eas-cli build --platform ios", /no profile/);
  refused(dir, "eas build --profile production", /production/);
  refused(dir, "eas build -e production-ios");
  refused(dir, "eas build -eproduction", /profile "production"/);
  allowed(dir, "eas build -epreview");
  refused(dir, "eas build --profile preview --auto-submit", /auto-submit/);
  refused(dir, "eas build --profile preview --auto-submit-with-profile=production", /auto-submit/);
  allowed(dir, "eas build --profile preview --platform android");
  refused(dir, "eas update --message fix", /eas update/);
  refused(dir, "eas update --branch production");
  allowed(dir, "eas update --branch preview --message fix");
});

test("Vercel production deploys, publishes and releases are refused", () => {
  const dir = project();
  for (const c of ["vercel --prod", "npx vercel@latest deploy --prod", "vercel --production", "vercel deploy --target=production", "vercel deploy --target production", "vercel promote https://x.vercel.app", "vercel rollback", "vercel alias set x.vercel.app app.io"]) refused(dir, c, /Vercel/);
  for (const c of ["npm publish", "bun publish", "pnpm publish", "npm --registry https://r.example publish", "yarn npm publish", "npx changeset publish", "npx lerna publish from-package", "npx semantic-release", "npx release-it", "fastlane ios release", "fastlane beta"]) refused(dir, c, /publishes/);
  for (const c of ["gh release create v1.0.0", "gh release upload v1 x.zip", "gh release edit v1", "gh release delete v1", "gh api -X POST repos/o/r/releases -f tag_name=v1"]) refused(dir, c, /release/);
  for (const c of ["npx changeset version", "fastlane test", "gh release list"]) allowed(dir, c);
});

test("pushes to protected branches and force pushes are refused; feature branches are not", () => {
  const dir = project();
  allowed(dir, "git push -u origin feat/thing");
  allowed(dir, "git push -u origin feat/main-menu");
  allowed(dir, "git push origin --delete feat/old");
  allowed(dir, "git push --force-with-lease origin feat/x");
  allowed(dir, "git push --force-with-lease=feat/x:abc origin feat/x");
  allowed(dir, "git push --force-if-includes --force-with-lease origin feat/x");
  refused(dir, "git push origin main", /protected branch "main"/);
  refused(dir, "git push origin HEAD:main", /protected branch "main"/);
  refused(dir, "git push origin main:main", /protected branch "main"/);
  refused(dir, "git push origin feat/x:refs/heads/master", /"master"/);
  refused(dir, "git push origin staging", /"staging"/);
  refused(dir, "git push --no-verify origin staging", /"staging"/);
  refused(dir, "git push --force-with-lease origin staging", /"staging"/);
  refused(dir, "git push --force origin feat/x", /force-push/);
  refused(dir, "git push -f origin feat/x", /force-push/);
  refused(dir, "git push -uf origin feat/x", /force-push/);
  refused(dir, "git push origin +feat/x", /force-push/);
  refused(dir, "git push origin --delete main", /deletes the protected branch "main"/);
  refused(dir, "git push origin -d staging", /deletes the protected branch "staging"/);
  refused(dir, "git push origin :main", /deletes/);
  refused(dir, "git push --all origin", /every branch/);
  refused(dir, "git push --mirror origin", /every branch/);
  refused(dir, "git push --branches origin", /every branch/);
  refused(mkdtempSync(join(tmpdir(), "guard-elsewhere-")), `git -C ${dir} push origin staging`, /"staging"/);
  refused(dir, "for b in feat/a main; do git push origin $b; done", /"main"/);
  refused(dir, "git push origin $GUARD_TEST_UNSET_BRANCH", /can't tell which branch/);
});

test("tag pushes are refused, because tags often start a release", () => {
  const dir = project({ "a.txt": "a" });
  git(dir, "add", "a.txt");
  git(dir, "commit", "-q", "-m", "a");
  git(dir, "tag", "v1.2.0");
  refused(dir, "git push origin v1.2.0", /tag "v1.2.0"/);
  refused(dir, "git push origin refs/tags/v2", /tag "v2"/);
  refused(dir, "git push --tags origin", /tags/);
  refused(dir, "git push --follow-tags origin feat/x", /tags/);
});

test("a bare git push is judged by the branch that is checked out", () => {
  const dir = project();
  git(dir, "checkout", "-q", "-b", "main");
  refused(dir, "git push", /"main"/);
  refused(dir, "git push origin HEAD", /"main"/);
  refused(dir, "git push origin @", /"main"/);
  refused(dir, 'git push -u origin "$(git branch --show-current)"', /"main"/);
  git(dir, "checkout", "-q", "-b", "feat/x");
  allowed(dir, "git push");
  allowed(dir, 'git push -u origin "$(git branch --show-current)"');
});

test("a project's own protected branches replace main and master, and the integration branch is always protected", () => {
  const dir = project({}, { integrationBranch: "develop", protectedBranches: ["release"] });
  refused(dir, "git push origin release");
  refused(dir, "git push origin develop");
  allowed(dir, "git push origin main");
});

test("merges are allowed: agents merge when the owner says so; overriding the merge rules is not", () => {
  const dir = project();
  allowed(dir, "gh pr merge 12 --merge --delete-branch");
  allowed(dir, "gh api -X PUT repos/o/r/pulls/12/merge");
  refused(dir, "gh pr merge 12 --admin", /--admin/);
  refused(dir, "gh api repos/o/r/merges -f base=staging -f head=feat/x", /merges straight into the protected branch "staging"/);
  allowed(dir, "gh api repos/o/r/merges -f base=feat/y -f head=feat/x");
});

test("changes to GitHub secrets, keys, rulesets, access and repository settings are refused; reading them is not", () => {
  const dir = project();
  for (const c of [
    "gh secret set TOKEN < token.txt", "gh secret delete X", "gh secret remove X", "gh -R o/r secret set FOO", "gh --repo o/r secret set FOO",
    "gh variable set X", "gh variable delete X",
    "gh repo edit --visibility public", "gh repo delete o/r --yes", "gh repo rename x", "gh repo archive", "gh repo unarchive", "gh repo deploy-key add k.pub",
  ]) refused(dir, c, /GitHub settings, keys or secrets/);
  for (const c of [
    "gh api repos/o/r/rulesets -X POST --input rules.json",
    "gh api repos/o/r/rulesets --input rules.json",
    "gh api repos/o/r/actions/secrets/X -f encrypted_value=abc",
    "gh api -X PUT repos/o/r/branches/main/protection -f x=y",
    "gh api -XPUT repos/o/r/branches/main/protection",
    "gh api -X PATCH repos/o/r -f private=false",
    "gh api -XDELETE repos/o/r",
    "gh api --method=DELETE repos/o/r",
    "gh api -fprivate=false repos/o/r",
    "gh api -X PUT repos/o/r/actions/permissions -f enabled=false",
    "gh api -X POST repos/o/r/transfer -f new_owner=x",
    "gh api -X PUT repos/o/r/collaborators/someone",
    "gh api -X POST repos/o/r/actions/variables -f name=x",
  ]) refused(dir, c, /changes GitHub settings, secrets or access/);
  refused(dir, "gh api -X DELETE repos/o/r/git/refs/heads/staging", /deletes the protected branch "staging"/);
  refused(dir, "gh api -X PATCH repos/o/r/git/refs/heads/main -F force=true", /moves the protected branch "main"/);
  refused(dir, "gh api graphql -f query='mutation { deleteBranchProtectionRule(input: {}) { clientMutationId } }'", /GraphQL/);
  refused(project({ "q.graphql": "mutation { archiveRepository(input: {}) { clientMutationId } }" }), "gh api graphql -f query=@q.graphql", /GraphQL/);
  for (const c of ["gh api repos/o/r/rulesets", "gh secret list", "gh api repos/o/r/issues/3/comments -f body=hi", "gh api -X DELETE repos/o/r/git/refs/heads/feat/old", "gh api graphql -f query='{ viewer { login } }'"]) allowed(dir, c);
});

test("workflows that deploy or release are refused; other workflows are not", () => {
  const dir = project({
    ".github/workflows/ci.yml": "on: workflow_dispatch\njobs:\n  test:\n    runs-on: ubuntu-latest\n",
    ".github/workflows/ship.yml": "on: workflow_dispatch\njobs:\n  go:\n    environment:\n      name: production\n",
  });
  refused(dir, "gh workflow run deploy-production.yml", /starts a workflow that deploys/);
  refused(dir, "gh workflow run release.yml -f version=1.2.0", /deploys or releases/);
  refused(dir, "gh workflow run ship.yml", /deploys or releases/);
  refused(dir, "gh workflow run ship", /deploys or releases/);
  refused(dir, "gh api -X POST repos/o/r/actions/workflows/ship.yml/dispatches -f ref=main", /starts a workflow/);
  refused(dir, "gh api -X POST repos/o/r/dispatches -f event_type=go", /starts a workflow/);
  allowed(dir, "gh workflow run ci.yml");
  allowed(dir, "gh api -X POST repos/o/r/actions/workflows/ci.yml/dispatches -f ref=main");
});

test("recursive deletes are allowed inside the repository and temporary folders, and refused everywhere else", () => {
  const dir = project();
  const tmp = mkdtempSync(join(tmpdir(), "guard-rm-"));
  allowed(dir, "rm -rf node_modules dist");
  allowed(dir, "rm -rf packages/api/.cache/*");
  allowed(dir, "rm -rf *.tsbuildinfo ./*.egg-info");
  allowed(dir, `rm -rf ${tmp}/out`);
  allowed(dir, "rm -rf /tmp/guard-test-x");
  allowed(dir, "rm notes.txt ../outside.txt");
  allowed(dir, `cd ${tmp} && rm -rf out`);
  refused(dir, "rm -rf ~/Documents", /outside this repository/);
  refused(dir, "rm -rf /", /holds one/);
  refused(dir, "rm -rf ./*", /whole repository/);
  refused(dir, "rm -rf .", /whole repository/);
  refused(dir, "rm -rf .git", /history/);
  refused(dir, `rm -rf ${dirname(dir)}`, /holds one/);
  refused(dir, `rm -fr ${homedir()}/guard-test-not-there`, /outside/);
  refused(dir, "rm -r -f -- /opt/guard-test");
  refused(dir, "rm --recursive /etc/thing");
  refused(dir, "rm -Rf /usr/local/guard-test");
  refused(dir, "sudo rm -rf /usr/local/thing");
  refused(dir, "if [ -d ~/old ]; then rm -rf ~/old; fi", /outside/);
});

test("deletes from a folder that isn't a repository allow only temporary folders", () => {
  const home = mkdtempSync(join(homedir(), ".guard-test-"));
  try {
    refused(home, "rm -rf Documents", /outside/);
    refused("/", "rm -rf usr/local/guard-test", /outside/);
    allowed(home, `rm -rf ${tmpdir()}/guard-x`);
  } finally {
    spawnSync("rmdir", [home]);
  }
});

test("variables in a delete are followed when the command or script sets them", () => {
  const dir = project({ "scripts/build.sh": 'OUT="$(dirname "$0")/../dist"\nrm -rf "$OUT"\n', "scripts/wipe.sh": 'OUT="$(dirname "$0")/../.."\nrm -rf "$OUT"\n' });
  allowed(dir, 'tmp=$(mktemp -d) && cp x "$tmp" && rm -rf "$tmp"');
  allowed(dir, 'D=dist; rm -rf "$D"');
  allowed(dir, 'rm -rf "${GUARD_TEST_UNSET_VARIABLE:-/tmp}/guard-x"');
  allowed(dir, "bash scripts/build.sh");
  allowed(dir, "bun run clean");
  refused(dir, "bash scripts/wipe.sh", /holds one/);
  refused(dir, "D=/opt/x; rm -rf $D", /outside/);
  refused(dir, "rm -rf $GUARD_TEST_UNSET_VARIABLE/x", /can't tell where/);
  allowed(dir, 'for d in dist build; do rm -rf "$d"; done');
  refused(dir, 'for d in dist ~/old; do rm -rf "$d"; done', /outside/);
});

test("find and xargs deletes are judged too", () => {
  const dir = project();
  refused(dir, "find ~ -name '*.log' -delete", /with `find`/);
  refused(dir, "find ~/Library/Caches -exec rm -rf {} +", /with `find`/);
  refused(dir, "ls -d ~/old-* | xargs rm -rf", /xargs rm -r/);
  allowed(dir, "find . -name '*.log' -delete");
  allowed(dir, "find dist -type f -print");
  allowed(dir, "git ls-files -z | xargs -0 rm -f");
  refused(dir, "find . -name x -exec npx convex deploy \\;", /convex deploy/);
});

test("an unreadable or wrong settings file refuses every shell command until it is fixed", () => {
  refused(project({ ".claude/verify.json": "{not json" }, null), "ls", /can't be read/);
  refused(project({}, { agentsNeverTouch: "prod-backend-9" }), "ls", /must be a list/);
  refused(project({}, { agentsMayDeployTo: [1] }), "git status", /must be a list/);
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
  refused(project({}, null), `pushd ${other} && npx convex data x --deployment-name other-prod-2`, /other-prod-2/);
  refused(project({}, null), `cd ${other} && git push origin main`, /"main"/);
});

test("other tools are never checked", () => {
  assert.equal(decide({ tool_name: "Write", tool_input: { content: "bunx convex deploy" }, cwd: project() }).allow, true);
});

test("wrappers and program names are read the way the shell runs them", () => {
  assert.deepEqual(unwrap(["FOO=1", "sudo", "-u", "me", "npx", "-y", "convex", "deploy"]), ["convex", "deploy"]);
  assert.deepEqual(unwrap(["timeout", "-s", "KILL", "30", "env", "-u", "X", "A=b", "bunx", "convex", "deploy"]), ["convex", "deploy"]);
  assert.deepEqual(unwrap(["doppler", "run", "--project", "p", "--", "eas", "submit"]), ["eas", "submit"]);
  assert.deepEqual(unwrap(["xargs", "-I", "{}", "nice", "-n", "5", "stdbuf", "-o", "L", "caffeinate", "-t", "9", "rm", "-rf", "{}"]), ["rm", "-rf", "{}"]);
  assert.deepEqual(unwrap(["if", "!", "pnpx", "convex", "deploy"]), ["convex", "deploy"]);
  assert.equal(programName("convex@1.2.3"), "convex");
  assert.equal(programName("/x/node_modules/.bin/eas-cli"), "eas");
  assert.equal(programName("tofu"), "terraform");
  assert.equal(programName("flyctl"), "fly");
  assert.equal(programName("sls"), "serverless");
  assert.equal(programName("aws-cdk"), "cdk");
});

test("secrets are hidden before a command is logged", () => {
  const secrets = [
    ['CONVEX_DEPLOY_KEY="prod:x|abcdefghijklmnopqrstu" bunx convex deploy', "abcdefghijklmnop"],
    ["GH_TOKEN=ghp_123 bunx convex deploy", "ghp_123"],
    ["gh secret set GH_TOKEN --body ghp_realSecretValue123", "ghp_realSecretValue123"],
    ["gh secret set GH_TOKEN -b hunter2hunter2", "hunter2hunter2"],
    ['curl -H "Authorization: Bearer sk_live_abc123" https://x', "sk_live_abc123"],
    ["npx convex env set STRIPE_KEY sk_live_zzz999 --prod", "sk_live_zzz999"],
    ["export api_key=sk_live_lower1", "sk_live_lower1"],
    ["deploy --key 9f8e7d6c5b4a39281706f5e4d3c2b1a0", "9f8e7d6c5b4a39281706f5e4d3c2b1a0"],
  ];
  for (const [command, secret] of secrets) assert.doesNotMatch(mask(command), new RegExp(secret), command);
  assert.match(mask("CONVEX_DEPLOY_KEY=abc bunx convex deploy"), /CONVEX_DEPLOY_KEY=<hidden> bunx convex deploy/);
  assert.equal(mask("git push origin feat/a-very-long-branch-name-here"), "git push origin feat/a-very-long-branch-name-here");
});

test("when the guard itself fails, it refuses commands that look guarded or name a never entry", () => {
  const dir = project();
  for (const c of ["npx convex deploy", "pulumi up", "railway up", "gh variable set X", "terraform import a b", "vercel deploy --target production", "git push origin x", "rm -rf x", "gh workflow run x", "fastlane beta", "eas build", "vercel alias set a b", "gh pr merge 1"]) assert.equal(refuseOnError(c, dir), true, c);
  assert.equal(refuseOnError("curl https://app.example.com", dir), true);
  assert.equal(refuseOnError("ls -la", dir), false);
  assert.equal(refuseOnError("bun test", dir), false);
});

test("the hook refuses with exit 2 and a reason, allows with exit 0, fails closed, and logs each refusal", () => {
  const dir = project();
  const logFile = join(mkdtempSync(join(tmpdir(), "guard-log-")), "log.jsonl");
  const hook = (input) => spawnSync("node", [script], { input: typeof input === "string" ? input : JSON.stringify(input), encoding: "utf8", env: { ...process.env, CSTACK_GUARD_LOG: logFile } });
  const bash = (command, cwd = dir) => hook({ tool_name: "Bash", tool_input: { command }, cwd });
  const no = bash("GH_TOKEN=ghp_secret123 bunx convex deploy");
  assert.equal(no.status, 2);
  assert.match(no.stderr, /cstack guard refused/);
  assert.match(no.stderr, /with ! in front/);
  const yes = bash("git status");
  assert.equal(yes.status, 0);
  assert.equal(yes.stderr, "");
  // A cwd the guard can't use makes it fail inside; a guarded command is then refused, a plain one allowed.
  const broken = bash("npx convex deploy", 42);
  assert.equal(broken.status, 2);
  assert.match(broken.stderr, /failed while checking it/);
  assert.equal(bash("ls -la", 42).status, 0);
  const lines = readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.decision), ["refused", "refused-on-error", "error"]);
  assert.deepEqual(lines[0].rules, ["deploy"]);
  assert.doesNotMatch(lines[0].command, /ghp_secret123/);
  assert.equal(hook("not json").status, 0);
});

test("round 2: tags made in the same command, and version-like names, are tag pushes", () => {
  const dir = project();
  refused(dir, "git tag v1.2.0 && git push origin v1.2.0", /tag "v1.2.0"/);
  refused(dir, "git tag -a rel-7 -m 'Release 7' && git push origin rel-7", /tag "rel-7"/);
  refused(dir, "npm version patch && git push origin v1.0.1", /tag "v1.0.1"/);
  refused(dir, "git push origin tag v9", /tag "v9"/);
  refused(dir, "gh api -X POST repos/o/r/git/refs -f ref=refs/tags/v1.2.0 -f sha=abc", /creates the tag "v1.2.0"/);
  allowed(dir, "git tag -l && git push origin feat/x");
});

test("round 2: a branch named through a variable is followed to the checked-out branch", () => {
  const dir = project();
  git(dir, "checkout", "-q", "-b", "main");
  refused(dir, 'BRANCH=$(git branch --show-current); git push -u origin "$BRANCH"', /"main"/);
  git(dir, "checkout", "-q", "-b", "feat/y");
  allowed(dir, 'BRANCH=$(git branch --show-current); git push -u origin "$BRANCH"');
  allowed(dir, "BRANCH=$(git rev-parse --abbrev-ref HEAD) && git push origin $BRANCH");
  allowed(dir, 'rm -rf "$(git rev-parse --show-toplevel)/dist"');
  refused(dir, 'cd ~ && rm -rf "$PWD/Documents"', /outside/);
  refused(dir, 'rm -rf "$(git rev-parse --show-toplevel)"', /whole repository/);
});

test("round 2: pnpm and yarn exec or dlx with -- are read as the tool", () => {
  const dir = project();
  for (const c of ["pnpm exec -- convex deploy", "yarn exec -- convex deploy", "yarn dlx -- convex deploy", "pnpm dlx -- convex deploy"]) refused(dir, c, /^`convex deploy` changes/m);
});

test("round 2: gh workflow run finds the workflow name after its flags", () => {
  const dir = project({ ".github/workflows/ship.yml": "jobs:\n  go:\n    environment: production\n" });
  refused(dir, "gh workflow run --ref main deploy.yml", /deploy\.yml/);
  refused(dir, "gh workflow run --repo o/r deploy.yml", /deploy\.yml/);
  refused(dir, "gh workflow run -r main ship.yml", /ship\.yml/);
  allowed(dir, "gh workflow run -r main ci.yml");
});

test("round 2: Expo commands that ship to production are refused", () => {
  const dir = project({ ".eas/workflows/preview.yml": "jobs:\n  build:\n    type: build\n    params:\n      profile: preview\n", ".eas/workflows/ship.yml": "jobs:\n  submit:\n    type: submit\n" });
  for (const c of ["eas deploy --prod", "npx eas-cli deploy --prod", "eas workflow:run create-production-builds.yml", "eas workflow:run .eas/workflows/ship.yml", "eas workflow:run", "eas channel:edit production --branch main", "eas channel:rollout production", "eas update:republish --channel production --group abc", "eas update:roll-back-to-embedded"]) refused(dir, c, /eas/);
  for (const c of ["eas deploy", "eas workflow:run .eas/workflows/preview.yml", "eas channel:edit preview --branch main", "eas update:republish --channel preview --group abc", "eas channel:list"]) allowed(dir, c);
});

test("round 2: scripts run across every workspace are followed into each one", () => {
  const dir = project({ "apps/web/package.json": JSON.stringify({ name: "@x/site", scripts: { ship: "vercel --prod", "deploy:web": "vercel deploy --prod", safe: "echo ok" } }), "package.json": JSON.stringify({ workspaces: ["apps/*", "packages/*"], scripts: {} }) });
  for (const c of ["yarn workspaces foreach -A run ship", "yarn workspaces foreach --all run deploy:web", "pnpm -r run ship", "pnpm --recursive ship", "npm run ship --workspaces", "npm run ship -ws", "turbo run ship", "npx nx run web:ship", "nx run-many -t ship", "lerna run ship"]) refused(dir, c, /Vercel/);
  for (const c of ["pnpm -r run safe", "turbo run safe", "yarn workspaces foreach -A run safe"]) allowed(dir, c);
});

test("round 2: other tools whose command is deploy are refused; files named deploy are not", () => {
  const dir = project();
  for (const c of ["gcloud run deploy api --source .", "gcloud app deploy", "gcloud functions deploy fn", "supabase functions deploy hello", "supabase db push", "npx prisma migrate deploy", "nx deploy api", "npx nx run api:deploy", "npx nx run-many -t deploy", "lerna run deploy", "docker stack deploy -c x.yml app", "netlify deploy -p"]) refused(dir, c, /changes a live system/);
  for (const c of ["mkdir -p deploy", "cp x.yml deploy/", "ls deploy", "cat deploy/notes.md", "supabase db diff", "npx prisma migrate dev", "gcloud run services list", "firebase hosting:channel:deploy preview", "gh workflow view deploy.yml", "code deploy/x.ts"]) allowed(dir, c);
});

test("round 2: bun's own commands aren't read as scripts, and a script can't make the guard loop", () => {
  const entries = Array.from({ length: 8 }, (_, i) => `bun build ./e${i}.ts --outdir dist`).join(" && ");
  const tests = Array.from({ length: 8 }, (_, i) => `bun test src/part${i}`).join(" && ");
  const dir = project({ "package.json": JSON.stringify({ scripts: { build: entries, test: tests, loop: "bun run loop", fan: Array(6).fill("bun run fan").join(" && "), ping: "bun run pong", pong: "bun run ping && vercel --prod" } }) });
  const start = Date.now();
  allowed(dir, "bun run build");
  allowed(dir, "bun run test");
  allowed(dir, "bun test");
  allowed(dir, "bun run loop");
  allowed(dir, "bun run fan");
  refused(dir, "bun run ping", /Vercel/);
  allowed(dir, "pnpm deploy --filter=api /tmp/out");
  assert.ok(Date.now() - start < 3000, `took ${Date.now() - start} ms`);
});

test("round 2: smaller spellings that used to slip past", () => {
  const dir = project();
  refused(dir, "coproc npx convex deploy", /^`convex deploy` changes/m);
  refused(dir, "bash -c -e 'npx convex deploy'", /convex deploy/);
  refused(dir, "vercel --prod=true", /Vercel/);
  refused(dir, "bash -c \"$(cat <<'EOF'\nnpx convex deploy\nEOF\n)\"", /convex deploy/);
  refused(dir, "git push origin 'refs/heads/*:refs/heads/*'", /pattern/);
  refused(dir, "gh api -X DELETE https://api.github.com/repos/o/r", /settings/);
  refused(dir, "gh api -X PUT repos/o/r/contents/a.md -f branch=main -f message=x -f content=eA==", /commits straight to the protected branch "main"/);
  refused(dir, "rm -rf {.,x}", /whole repository/);
  refused(dir, "rm -rf ./{src,.git}", /history/);
  refused(dir, "find . -delete", /whole repository/);
  refused(dir, "wc -w <<< hello\nnpx convex deploy", /convex deploy/);
  refused(dir, "echo $((1<<4))\nnpx convex deploy", /convex deploy/);
  refused(dir, "npx convex deploy -m staging-backend-1-x", /convex deploy/);
  allowed(dir, "gh api repos/o/r/pulls -f title=x -f body='about prod-backend-9' -f head=feat/x -f base=staging");
  allowed(dir, "rm -rf {dist,build}");
  allowed(dir, "rm -rf /tmp/guard-x");
  refused(dir, "rm -rf /tmp", /outside/);
});

test("round 3: workspace scripts that run every workspace are checked once each, so the guard can't hang", () => {
  const n = 8;
  const files = { "package.json": JSON.stringify({ workspaces: ["packages/*"], scripts: { build: "turbo run build", ship: "npm run build --workspaces" } }) };
  for (let i = 0; i < n; i++) files[`packages/q${i}/package.json`] = JSON.stringify({ name: `q${i}`, scripts: { build: i === n - 1 ? "turbo run build --filter=q0 && vercel --prod" : `tsc && npm run build --workspaces --if-present && turbo run build --filter=q${i + 1}` } });
  const dir = project(files);
  const start = Date.now();
  refused(dir, "turbo run build");
  refused(dir, "npm run build --workspaces");
  assert.ok(Date.now() - start < 3000, `took ${Date.now() - start} ms`);
  const flat = { "package.json": JSON.stringify({ workspaces: ["packages/*"], scripts: {} }) };
  for (let i = 0; i < n; i++) flat[`packages/f${i}/package.json`] = JSON.stringify({ name: `f${i}`, scripts: { build: i === 3 ? "vercel --prod" : "turbo run build --filter=f3" } });
  const flatDir = project(flat);
  const selfFilter = { "package.json": JSON.stringify({ workspaces: ["packages/*"], scripts: { build: "turbo run build" } }) };
  for (let i = 0; i < n; i++) selfFilter[`packages/s${i}/package.json`] = JSON.stringify({ name: `s${i}`, scripts: { build: `turbo run build --filter=s${i}` } });
  allowed(project(selfFilter), "turbo run build");
  const spaced = { "package.json": JSON.stringify({ workspaces: ["packages/*"], scripts: { build: "turbo run build" } }) };
  for (let i = 0; i < n; i++) spaced[`packages/s${i}/package.json`] = JSON.stringify({ name: `s${i}`, scripts: { build: i % 2 ? `turbo run build --filter s${i}` : `turbo run build -F s${i}` } });
  allowed(project(spaced), "turbo run build");
  const again = Date.now();
  refused(flatDir, "turbo run build", /Vercel/);
  assert.ok(Date.now() - again < 3000, `took ${Date.now() - again} ms`);
});

test("round 3: a command too tangled to check in time is refused, not let through", () => {
  const deep = Array.from({ length: 12 }, (_, i) => [`s${i}`, `bun run s${i + 1}`]);
  const dir = project({ "package.json": JSON.stringify({ scripts: Object.fromEntries(deep) }) });
  refused(dir, "bun run s0", /nested more than 8 levels/);
});

test("round 3: nx and Angular deploy targets are refused in every spelling", () => {
  const dir = project({ "package.json": JSON.stringify({ workspaces: ["packages/*"], scripts: {} }), "packages/api/package.json": JSON.stringify({ name: "api", scripts: { ship: "convex deploy" } }) });
  for (const c of ["npx nx run api:deploy:production", "npx ng run app:deploy:production", "npx nx affected --target=deploy", "npx nx run-many --target=deploy --all", "nx run-many --targets=deploy --projects=api", "nx deploy api", "ng deploy"]) refused(dir, c, /deploy/);
  for (const c of ["nx affected -t ship", "nx affected --target=ship", "nx ship api", "nx run-many --targets ship,build", "nx run api:ship", "yarn workspaces run ship", "lerna exec -- convex deploy"]) refused(dir, c, /convex deploy/);
  refused(dir, "nx release", /nx release/);
  for (const c of ["nx run api:build", "nx affected -t test", "nx graph", "nx release --dry-run", "ng build", "nx show projects"]) allowed(dir, c);
});

test("round 3: tag pushes inside package scripts are found", () => {
  const dir = project({ "package.json": JSON.stringify({ name: "x", version: "1.0.0", scripts: { postversion: "git push && git push --tags", release: "git push origin v$npm_package_version", tagpush: 'git push origin "refs/tags/$TAG"' } }) });
  refused(dir, "npm version patch", /tags/);
  refused(dir, "npm run release", /tag/);
  refused(dir, "TAG=v1.0.0 npm run tagpush", /tag/);
  refused(dir, "git push origin feat/x tag v9", /tag "v9"/);
  refused(dir, "git tag -am msg nightly && git push origin nightly", /tag "nightly"/);
  allowed(dir, "git checkout -b 3.0 && git push -u origin 3.0");
  allowed(dir, "git switch -c v2.0-beta && git push -u origin v2.0-beta");
  allowed(dir, "git tag --points-at HEAD && git push origin feat/x");
});

test("round 3: test, lint, format and read-only commands that name deploy are allowed", () => {
  const dir = project({ "deploy/notes.md": "x" });
  for (const c of [
    "npx vitest run deploy", "npx vitest run -t deploy", "bunx vitest run deploy", "npx jest deploy", "npx playwright test deploy", "pnpm vitest run deploy",
    "npx eslint deploy", "npx prettier --write deploy", "npx tsc -p deploy", "npx biome check deploy", "ruff check deploy", "black deploy", "yamllint deploy",
    "pytest deploy", "python -m pytest -k deploy", "cargo test deploy", "node --test deploy", "fd deploy", "realpath deploy", "watchexec -w deploy bun test",
    "kubectl get deploy", "kubectl describe deploy web", "docker build --target deploy -t app .",
    "fly deploy --help", "gcloud run deploy --help", "supabase functions deploy --help", "vercel --prod --help", "gcloud help run deploy",
    "mytool one two three deploy",
  ]) allowed(dir, c);
  for (const c of ["gcloud run deploy api", "gcloud --project p run deploy api", "supabase functions deploy hello", "docker stack deploy -c x.yml app", "drizzle-kit push", "drizzle-kit migrate", "supabase migration up --linked", "az webapp deploy --name x"]) refused(dir, c, /changes a live system/);
  allowed(project(), "vercel --prod=false");
  const runners = project({ "package.json": JSON.stringify({ scripts: { ship: "vercel --prod" } }) });
  for (const c of ["bun run ship --help", "npm run ship -- --help", "bun run ship -h", "yarn ship help", "make deploy --help", "supabase functions deploy -h", "gcloud run deploy api -- --help"]) refused(runners, c, /changes a live system/);
});

test("round 3: Expo channel commands find the channel after flags, and eas deploy reads --prod=true", () => {
  const dir = project({ ".eas/workflows/ship.yml": "jobs:\n  submit:\n    type: submit\n" });
  for (const c of ["eas channel:edit --branch main production", "eas channel:edit --branch=main production", "eas channel:rollout --action create production", "eas deploy --prod=true", "eas workflow:run ship.yml"]) refused(dir, c, /eas/);
  allowed(dir, "eas channel:edit --branch main preview");
  allowed(dir, "eas channel:edit --json preview");
});

test("round 3: bun exec runs a shell string, and it is checked", () => {
  const dir = project();
  refused(dir, "bun exec 'npx convex deploy'", /convex deploy/);
  refused(dir, 'bun exec "vercel --prod"', /Vercel/);
  refused(dir, "bun exec 'git push origin main'", /"main"/);
  refused(dir, "bun exec 'rm -rf ~'", /outside/);
  allowed(dir, "bun exec 'echo hi'");
});

test("round 3: each tag and variable rule catches its own case", () => {
  const dir = project({ "package.json": JSON.stringify({ name: "x", version: "1.0.0", scripts: { bare: "git push origin $npm_package_version", named: "git push origin $TAGNAME", raw: 'git push origin "refs/tags/$UNSET_GUARD_TAG"' } }) });
  refused(dir, "npm run bare", /tag "1.0.0"/);
  refused(dir, "TAGNAME=v2.0.0 npm run named", /tag "v2.0.0"/);
  refused(dir, "npm run raw", /refs\/tags/);
  allowed(dir, "TAGNAME=feat/x npm run named");
});

test("round 3: a deploy script run twice is judged each time by its own command", () => {
  refused(project(), "CONVEX_DEPLOY_KEY=staging-backend-1 bun run backend:deploy && bun run backend:deploy", /convex deploy/);
  allowed(project(), "CONVEX_DEPLOY_KEY=staging-backend-1 bun run backend:deploy && CONVEX_DEPLOY_KEY=staging-backend-1 bun run backend:deploy");
});

test("round 3: a command past the step budget is refused", () => {
  refused(project(), Array(20500).fill("$(true)").join(" "), /more scripts than the guard can check/);
});

test("round 3: deploy as a flag's value is not a command", () => {
  allowed(project(), "mytool --stage deploy build");
  refused(project(), "mytool --stage prod deploy", /changes a live system/);
});

test("round 3: rules the breakage tests showed were unpinned", () => {
  const dir = project({ "package.json": JSON.stringify({ workspaces: ["packages/*"], scripts: { rootship: "convex deploy", build: "vercel --prod" } }) });
  refused(dir, "npx nx run api:deploy", /`nx deploy`/);
  refused(dir, "turbo run rootship", /convex deploy/);
  allowed(dir, "bun build ./x.ts --outdir dist");
  allowed(dir, 'rm -rf "$(pwd)/dist"');
  refused(dir, 'rm -rf "$(pwd)"', /whole repository/);
  for (const c of ["sam sync", "prisma migrate deploy", "gh api -X DELETE x"]) assert.equal(refuseOnError(c, dir), true, c);
  refused(dir, "gh workflow run --json deploy.yml", /deploy\.yml/);
  refused(dir, "gh api -X PUT repos/o/r/contents/a.md -f message=x -f content=eA==", /default branch/);
  refused(dir, "coproc ship { npx convex deploy; }", /convex deploy/);
  refused(dir, "bash -c -o pipefail 'npx convex deploy'", /convex deploy/);
  refused(dir, "bash -c -- 'npx convex deploy'", /convex deploy/);
  refused(dir, "x=$(( 1 << 4 ))\ngit push origin main", /"main"/);
  refused(dir, "npm exec --workspaces -- convex deploy", /convex deploy/);
});

test("a long command is checked quickly", () => {
  const dir = project();
  const lines = Array.from({ length: 2000 }, (_, i) => `mkdir -p out/${i} && cp a out/${i}/`).join("\n");
  const start = Date.now();
  run(dir, lines);
  assert.ok(Date.now() - start < 5000, `took ${Date.now() - start} ms`);
  const pushes = Array.from({ length: 600 }, (_, i) => `git push origin feat/${i}`).join("\n");
  const again = Date.now();
  run(dir, pushes);
  assert.ok(Date.now() - again < 2500, `600 pushes took ${Date.now() - again} ms`);
  const heads = Array(500).fill("git push origin HEAD").join("\n");
  const third = Date.now();
  run(dir, heads);
  assert.ok(Date.now() - third < 1000, `500 HEAD pushes took ${Date.now() - third} ms`);
});

test("the core plugin runs the guard before every shell command", () => {
  const hooks = JSON.parse(readFileSync(join(here, "..", "hooks", "hooks.json"), "utf8"));
  const entry = hooks.hooks.PreToolUse.find((h) => h.matcher === "Bash");
  assert.ok(entry, "a PreToolUse entry for Bash");
  assert.match(entry.hooks[0].command, /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/guard\.mjs/);
});

test("round 4: tool-server calls that use a never entry are refused; file tools that mention it are not", () => {
  const dir = project();
  const call = (tool_name, tool_input, cwd = dir) => decide({ tool_name, tool_input, cwd });
  const no = call("mcp__plugin_convex_convex__run", { deploymentSelector: selector({ kind: "deploymentName", deploymentName: "prod-backend-9" }), functionName: "seed:all" });
  assert.equal(no.allow, false);
  assert.match(reasons(no), /"prod-backend-9", which .* lists under "agentsNeverTouch"/);
  assert.equal(call("mcp__vercel__get_logs", { request: { urls: ["https://APP.example.com/api"] } }).allow, false);
  assert.equal(call("mcp__plugin_convex_convex__run", { deploymentSelector: selector({ kind: "deploymentName", deploymentName: "staging-backend-1" }), functionName: "seed:all" }).allow, true);
  assert.equal(call("mcp__vercel__deploy", {}).allow, true);
  for (const tool of ["Write", "Edit", "Read", "MultiEdit", "Grep"]) {
    assert.equal(call(tool, { file_path: join(dir, "notes.md"), content: "prod-backend-9 is production", old_string: "app.example.com", pattern: "prod-backend-9" }).allow, true, tool);
  }
  assert.equal(call("mcp__x__y", { q: "prod-backend-9" }, project({}, null)).allow, true);
  assert.match(reasons(call("mcp__x__y", { q: "hi" }, project({ ".claude/verify.json": "{not json" }, null))), /can't be read/);
});

test("round 4: the hook checks tool-server calls end to end", () => {
  const dir = project();
  const logFile = join(mkdtempSync(join(tmpdir(), "guard-log-")), "log.jsonl");
  const hook = (input) => spawnSync("node", [script], { input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, CSTACK_GUARD_LOG: logFile } });
  const no = hook({ tool_name: "mcp__plugin_convex_convex__envSet", tool_input: { deploymentSelector: selector({ kind: "deploymentName", deploymentName: "prod-backend-9" }), name: "API_KEY", value: "sk_live_abcdef123456" }, cwd: dir });
  assert.equal(no.status, 2);
  assert.match(no.stderr, /cstack guard refused this tool call/);
  assert.match(no.stderr, /prod-backend-9/);
  assert.match(no.stderr, /mcp__plugin_convex_convex__envSet/);
  assert.match(no.stderr, /do it themselves/);
  assert.equal(hook({ tool_name: "mcp__plugin_convex_convex__envSet", tool_input: { deploymentSelector: selector({ kind: "ownDev" }), name: "A", value: "b" }, cwd: dir }).status, 0);
  assert.equal(hook({ tool_name: "Write", tool_input: { file_path: join(dir, "a.md"), content: "prod-backend-9 and app.example.com" }, cwd: dir }).status, 0);
  const lines = readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].tool, "mcp__plugin_convex_convex__envSet");
  assert.match(lines[0].command, /"deploymentSelector":"deploymentName:/);
  assert.doesNotMatch(lines[0].command, /sk_live_abcdef123456/);
});

test("round 4: the core plugin runs the guard before every tool-server call", () => {
  const hooks = JSON.parse(readFileSync(join(here, "..", "hooks", "hooks.json"), "utf8"));
  const entry = hooks.hooks.PreToolUse.find((h) => h.matcher !== "Bash");
  assert.ok(entry, "a PreToolUse entry for tool servers");
  const matches = (name) => new RegExp(`^(?:${entry.matcher})$`).test(name);
  assert.ok(matches("mcp__plugin_convex_convex__run"));
  assert.ok(matches("mcp__claude_ai_Vercel__deploy"));
  for (const name of ["Write", "Edit", "Read", "Bash"]) assert.ok(!matches(name), name);
  assert.match(entry.hooks[0].command, /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/guard\.mjs/);
});

test("round 4: names that only read about a release are allowed; deploy and release targets are not", () => {
  const dir = project();
  for (const c of ["make release-notes", "just release-notes", "make deploy-check", "make release:dry-run", "npm run release-notes", "make changelog"]) allowed(dir, c);
  for (const c of ["make deploy", "make release", "just release", "make deploy-web", "make release:ios", "npm run release:mobile", "make redeploy", "make notes-release"]) refused(dir, c, /changes a live system/);
});

test("round 4: helm dry runs and plugin installs are allowed; real installs are not", () => {
  const dir = project();
  for (const c of ["helm install --dry-run api ./chart", "helm upgrade --install api ./chart --dry-run=client", "helm plugin install https://example.com/diff", "helm plugin uninstall diff"]) allowed(dir, c);
  for (const c of ["helm install api ./chart", "helm upgrade --install api ./chart --dry-run=none", "helm uninstall api", "helm install plugin ./chart"]) refused(dir, c, /changes a live system/);
});

test("round 4: deleting anything inside .git is refused", () => {
  const dir = project();
  for (const c of ["rm -rf .git/objects", "rm -rf ./.git/refs/heads", "rm -rf .git/*"]) refused(dir, c, /history/);
  allowed(dir, "rm -rf .github/workflows/old");
  allowed(dir, "rm -rf .gitcache");
});

test("round 4: more kinds of secrets are hidden before a command is logged", () => {
  const secrets = [
    ["curl -u admin:hunter2pass https://x", "hunter2pass"],
    ["curl --user=admin:hunter2pass https://x", "hunter2pass"],
    ['curl -H "X-Api-Key: abc123secret" https://x', "abc123secret"],
    ["curl -H 'Authorization: Basic dXNlcjpwYXNz' https://x", "dXNlcjpwYXNz"],
    ['curl -H "Cookie: session=s3cr3tcookie" https://x', "s3cr3tcookie"],
    ["psql postgres://admin:hunter2pass@db.example.com/app", "hunter2pass"],
    ["git clone https://bot:ghs_tokenvalue@github.com/o/r", "ghs_tokenvalue"],
    ['wc -c <<< "hunter2pass"', "hunter2pass"],
    ["wc -c <<<hunter2pass", "hunter2pass"],
  ];
  for (const [command, secret] of secrets) assert.doesNotMatch(mask(command), new RegExp(secret), command);
  assert.equal(mask("git push -u origin main"), "git push -u origin main");
  assert.equal(mask("sudo -u deploy ls"), "sudo -u deploy ls");
  assert.equal(mask("open https://example.com/a:b"), "open https://example.com/a:b");
});

test("round 4: << inside quotes doesn't start a heredoc", () => {
  const dir = project();
  refused(dir, 'echo "a <<EOF"\nnpx convex deploy\nEOF', /convex deploy/);
  refused(dir, "echo 'use <<END here'\ngit push origin main", /"main"/);
  refused(dir, 'grep -n "<<-X" notes.md && npx convex deploy\nX', /convex deploy/);
  allowed(dir, "echo \"it's\" && cat <<'EOF'\napp.example.com\nEOF");
  allowed(dir, "# it's a note\ncat <<'EOF'\napp.example.com\nEOF");
  allowed(dir, 'git commit -m "$(cat <<\'EOF\'\nprod-backend-9 is production\nEOF\n)"');
  allowed(dir, 'git commit -m "$(echo "x" && cat <<\'EOF\'\nprod-backend-9 is production\nEOF\n)"');
});

test("round 4: when the guard itself fails, it refuses every word the full rules refuse", () => {
  const dir = project();
  for (const c of ["helm upgrade api ./chart", "helm install api ./chart", "pulumi update", "aws cloudformation create-stack --stack-name x", "npm version patch", "/opt/bin/terraform apply", "npx semantic-release", "npx release-it", "lerna publish"]) assert.equal(refuseOnError(c, dir), true, c);
  for (const c of ["ls -la", "bun test", "git status", "cat notes.md"]) assert.equal(refuseOnError(c, dir), false, c);
  assert.equal(refuseOnError('{"q":"push the release"}', dir, { tool: true }), false);
  assert.equal(refuseOnError('{"q":"prod-backend-9"}', dir, { tool: true }), true);
});

test("round 4: a script written with echo or printf and run in the same command is read", () => {
  const dir = project();
  const tmp = mkdtempSync(join(tmpdir(), "guard-echo-"));
  refused(dir, `echo 'npx convex deploy' > ${tmp}/a.sh && bash ${tmp}/a.sh`, /convex deploy/);
  refused(dir, `printf '#!/bin/sh\\nvercel --prod\\n' > ${tmp}/b.sh; chmod +x ${tmp}/b.sh; ${tmp}/b.sh`, /Vercel/);
  refused(dir, `printf '%s\\n' 'git push origin main' >> ${tmp}/c.sh && sh ${tmp}/c.sh`, /"main"/);
  refused(dir, `echo 'npx convex deploy' > ${tmp}/d.sh; echo 'echo done' >> ${tmp}/d.sh; bash ${tmp}/d.sh`, /convex deploy/);
  refused(dir, `echo 'npx convex deploy' >${tmp}/g.sh; echo 'echo done' >>${tmp}/g.sh; bash ${tmp}/g.sh`, /convex deploy/);
  refused(dir, `printf 'npx %s deploy' convex > ${tmp}/h.sh && bash ${tmp}/h.sh`, /convex deploy/);
  refused(dir, `echo -e 'echo hi\\nnpx convex deploy' > ${tmp}/i.sh && bash ${tmp}/i.sh`, /convex deploy/);
  refused(dir, `echo 'echo hi\nnpx convex deploy' > ${tmp}/l.sh && bash ${tmp}/l.sh`, /convex deploy/);
  refused(dir, `echo 'npx convex deploy' > ${tmp}/j.sh; cat >> ${tmp}/j.sh <<'EOF'\necho done\nEOF\nbash ${tmp}/j.sh`, /convex deploy/);
  refused(dir, `echo 'npx convex deploy' > ${tmp}/k.sh; tee -a ${tmp}/k.sh <<'EOF'\necho done\nEOF\nbash ${tmp}/k.sh`, /convex deploy/);
  allowed(dir, `echo 'echo hi' > ${tmp}/e.sh && bash ${tmp}/e.sh`);
  allowed(dir, `echo 'npx convex deploy' > ${tmp}/f.sh; echo 'echo hi' > ${tmp}/f.sh; bash ${tmp}/f.sh`);
});

test("round 4: aws s3 sync --delete to a bucket is a deploy", () => {
  const dir = project();
  for (const c of ["aws s3 sync ./dist s3://site-bucket --delete", "aws --profile x s3 sync dist s3://site-bucket --delete --exact-timestamps"]) refused(dir, c, /aws s3 sync --delete/);
  for (const c of ["aws s3 sync ./dist s3://site-bucket", "aws s3 sync s3://site-bucket ./backup --delete", "aws s3 sync ./dist s3://sandbox-dev --delete"]) allowed(dir, c);
});

test("round 4: a command that moves through more folders than the guard can check in time is refused", () => {
  const dir = project();
  const base = mkdtempSync(join(tmpdir(), "guard-cd-"));
  for (let i = 0; i < 201; i++) mkdirSync(join(base, `d${i}`));
  const visit = (n) => Array.from({ length: n }, (_, i) => `cd ${base}/d${i}`).join(" && ");
  // 200 folders is the limit; the folder the command starts in doesn't count.
  allowed(dir, visit(200));
  // The limit keeps the check well inside the hook's 30 second time limit, even on a busy machine.
  const start = Date.now();
  refused(dir, visit(201), /more than 200 folders/);
  assert.ok(Date.now() - start < 15000, `took ${Date.now() - start} ms`);
});

test("round 4: a heredoc inside $( ) or backticks that close on its first line has no body, so the next lines run", () => {
  const dir = project();
  for (const c of [
    "x=\"$(cat <<'EOF')\"\nnpx convex deploy\nEOF",
    "x=$(cat <<EOF)\nnpx convex deploy\nEOF",
    "x=`cat <<EOF`\nnpx convex deploy\nEOF",
    "x=\"$(cat <<'EOF' | tr -d '\"')\"\nnpx convex deploy\nEOF",
  ]) refused(dir, c, /convex deploy/);
  allowed(dir, "(cat <<'EOF')\nprod-backend-9 is production\nEOF");
  allowed(dir, "x=\"$(cat <<'EOF')\"\necho hi\nEOF\ncat <<'X'\nprod-backend-9 is production\nX");
  allowed(dir, "x=$(cat <<'EOF'\nprod-backend-9 is production\nEOF\n)");
});

test("round 4: a quote inside a heredoc's body doesn't hide the commands after it", () => {
  const dir = project();
  refused(dir, "cat <<'EOF'\nit's done\nEOF\nnpx convex deploy", /convex deploy/);
  refused(dir, 'cat <<EOF > notes.md\nshe said "hi\nEOF\nnpx convex deploy', /convex deploy/);
  refused(dir, "git commit -F - <<'EOF'\ndon't\nEOF\necho \"x <<Y\"\nnpx convex deploy\nY", /convex deploy/);
});

test("round 4: a never entry is matched in a tool call's input as written, not only in its JSON", () => {
  const dir = project({}, { integrationBranch: "main", agentsNeverTouch: ['bun run release --env "prod"', "C:\\prod\\keys"] });
  const call = (tool_input) => decide({ tool_name: "mcp__runner__run", tool_input, cwd: dir });
  assert.equal(call({ command: 'bun run release --env "prod"' }).allow, false);
  assert.equal(call({ args: { path: "C:\\prod\\keys\\a.pem" } }).allow, false);
  assert.equal(call({ command: "bun run release --env staging" }).allow, true);
});

test("round 4: when the guard fails on a tool call, it matches never entries in the input as written", () => {
  const dir = project({}, { integrationBranch: "main", agentsNeverTouch: ['bun run release --env "prod"'] });
  const logFile = join(mkdtempSync(join(tmpdir(), "guard-log-")), "log.jsonl");
  // A cwd the guard can't use makes it fail inside; the settings then come from the folder the hook runs in.
  const hook = (tool_input) => spawnSync("node", [script], { cwd: dir, input: JSON.stringify({ tool_name: "mcp__runner__run", tool_input, cwd: 42 }), encoding: "utf8", env: { ...process.env, CSTACK_GUARD_LOG: logFile } });
  const no = hook({ command: 'bun run release --env "prod"' });
  assert.equal(no.status, 2);
  assert.match(no.stderr, /failed while checking it/);
  assert.equal(hook({ command: "bun run release --env staging" }).status, 0);
});

test("round 5: a Convex tool-server call aimed at production is refused; development and preview are not", () => {
  const dir = project();
  const call = (tool_input) => decide({ tool_name: "mcp__plugin_convex_convex__run", tool_input, cwd: dir });
  for (const deployment of [{ kind: "prod" }, { kind: "implicitProd" }, { kind: "deploymentSelector", selector: "prod" }, { kind: "deploymentSelector", selector: "acme:app:prod" }]) {
    const r = call({ deploymentSelector: selector(deployment), functionName: "seed:all" });
    assert.equal(r.allow, false, deployment.kind);
    assert.match(reasons(r), /production Convex deployment/);
  }
  for (const deployment of [{ kind: "ownDev" }, { kind: "unspecified" }, { kind: "previewName", previewName: "pr-12" }, { kind: "deploymentSelector", selector: "dev" }, { kind: "deploymentName", deploymentName: "staging-backend-1" }]) {
    assert.equal(call({ deploymentSelector: selector(deployment), functionName: "seed:all" }).allow, true, deployment.kind);
  }
  assert.match(reasons(call({ deploymentSelector: selector({ kind: "deploymentSelector", selector: "prod-backend-9" }) })), /"prod-backend-9", which .* lists under "agentsNeverTouch"/);
  assert.match(reasons(call({ deploymentSelector: selector({ kind: "ownDev" }, "/work/APP.example.com") })), /app\.example\.com/);
  assert.equal(decide({ tool_name: "mcp__other__thing", tool_input: { nested: [{ target: selector({ kind: "prod" }) }] }, cwd: dir }).allow, false);
  assert.equal(call({ deploymentSelector: "prod:not-base64!" }).allow, true);
});

test("round 5: the hook refuses a production Convex selector end to end, and fails closed on it", () => {
  const dir = project();
  const hook = (input, cwd = dir, tool = "data") => spawnSync("node", [script], { cwd: dir, input: JSON.stringify({ tool_name: `mcp__plugin_convex_convex__${tool}`, tool_input: input, cwd }), encoding: "utf8", env: { ...process.env, CSTACK_GUARD_LOG: join(mkdtempSync(join(tmpdir(), "guard-log-")), "log.jsonl") } });
  assert.equal(hook({ deploymentSelector: selector({ kind: "prod" }), tableName: "users" }).status, 0);
  const no = hook({ deploymentSelector: selector({ kind: "prod" }), tableName: "users" }, dir, "envSet");
  assert.equal(no.status, 2);
  assert.match(no.stderr, /production Convex deployment/);
  assert.equal(hook({ deploymentSelector: selector({ kind: "ownDev" }), tableName: "users" }).status, 0);
  const broken = hook({ deploymentSelector: selector({ kind: "prod" }), tableName: "users" }, 42);
  assert.equal(broken.status, 2);
  assert.match(broken.stderr, /failed while checking it/);
  assert.equal(hook({ deploymentSelector: selector({ kind: "ownDev" }), tableName: "users" }, 42).status, 0);
});

test("round 5: commands inside an unquoted heredoc's body run, and are checked; a quoted heredoc's body is text", () => {
  const dir = project();
  for (const c of [
    "git commit -F - <<EOF\nfix: $(npx convex deploy)\nEOF",
    "git commit -F - <<EOF\nfix: `npx convex deploy`\nEOF",
    "cat <<EOF\ndon't $(npx convex deploy)\nEOF",
    "cat <<-EOF\n\t$(git push origin main)\n\tEOF",
  ]) refused(dir, c);
  for (const c of [
    "git commit -F - <<'EOF'\nfix: $(npx convex deploy)\nEOF",
    'git commit -F - <<"EOF"\nfix: `npx convex deploy`\nEOF',
    "git commit -F - <<\\EOF\nfix: $(npx convex deploy)\nEOF",
    "gh pr create --title x --body-file - <<'EOF'\nRun `npx convex deploy` and $(rm -rf ~) later; it's fine\nEOF",
    "cat <<EOF\nthe price is $5 and it's (fine)\nEOF",
  ]) allowed(dir, c);
});

test("round 5: heredoc spellings that used to hide the commands after them", () => {
  const dir = project();
  for (const c of [
    "cat <<\\EOF\nit's\nEOF\nnpx convex deploy",
    "cat <<'END-TEXT'\nit's\nEND-TEXT\nnpx convex deploy",
    "cat <<'END TEXT'\nit's\nEND TEXT\nnpx convex deploy",
    "cat <<A; cat <<B\nfirst\nA\nit's\nB\nnpx convex deploy",
    "cat <<EOF\nEOF\nnpx convex deploy",
    "true;# it's\necho 'a <<X '\nnpx convex deploy\nX",
    "echo $'it\\'s'\nnpx convex deploy",
    "echo $'it\\'s' && git push origin main",
    "(( y = 1 << 2 ))\nnpx convex deploy\n2",
    "echo ${x#<<EOF}\nnpx convex deploy\nEOF",
    "echo it\\'s '<<E '\nnpx convex deploy\nE",
  ]) refused(dir, c);
  for (const c of [
    "cat <<'END-TEXT'\nprod-backend-9 is production\nEND-TEXT",
    "cat <<A; cat <<B\nprod-backend-9\nA\nit's prod-backend-9\nB",
    "echo $'a\\tb' && cat <<'EOF'\nprod-backend-9\nEOF",
  ]) allowed(dir, c);
});

test("round 5: rules the mutation check showed were unpinned", () => {
  const dir = project();
  refused(dir, "make release-notes-then-publish", /changes a live system/);
  const keyed = project({}, { integrationBranch: "main", agentsNeverTouch: ["C:\\prod\\keys"] });
  assert.equal(decide({ tool_name: "mcp__fs__list", tool_input: { "C:\\prod\\keys": true }, cwd: keyed }).allow, false);
});

test("round 5: git's own leftovers and hooks may be deleted; the rest of .git may not", () => {
  const dir = project();
  for (const c of ["rm -rf .git/rebase-merge", "rm -rf .git/rebase-apply", "rm -rf .git/sequencer", "rm -rf .git/hooks/pre-push", "rm -rf .git/index.lock"]) allowed(dir, c);
  refused(dir, "rm -rf .git/objects", /inside the repository's \.git folder/);
  refused(dir, "rm -rf .git/config", /inside the repository's \.git folder/);
  refused(dir, "rm -rf .git", /the repository's history/);
});

test("round 5: $'...' quoting is read the way bash reads it everywhere a command is split", () => {
  const dir = project();
  refused(dir, "x=$(echo $'it\\'s)') ; npx convex deploy", /convex deploy/);
  refused(dir, "echo $'it\\'s' $(npx convex deploy)", /convex deploy/);
  allowed(dir, "rm -rf $'dist\\'s' build");
  refused(dir, "x=$(python3 - <<'EOF'\nimport urllib.request\nurllib.request.urlopen('https://app.example.com/admin')\nEOF\n)", /app\.example\.com/);
});

test("review round 1: heredoc shapes that hid a later push or deploy are refused", () => {
  const dir = project();
  const shapes = [
    "cat <<$'EOF'\nDon't\nEOF\n",
    "cat <<EOF\nDon't\n  EOF\nEOF\n",
    "echo '${' ; cat <<EOF '}'\nDon't\nEOF\n",
    "cat<<EOF\nDon't\nEOF\n",
    "cat >f<<EOF\nDon't\nEOF\n",
    "cat 0<<EOF\nDon't\nEOF\n",
    "x=$(cat<<'EOF'\nDon't\nEOF\n)\n",
    "x=$(cat <<'EOF'\nDon't\nEOF)\n",
  ];
  for (const shape of shapes) {
    for (const bad of ["git push origin main", "npx convex deploy"]) refused(dir, shape + bad);
  }
  // Ends inside a quote, a $( ) pair or a heredoc.
  for (const c of ["echo 'a", 'echo "a', "echo $(ls", "cat <<EOF\nabc", "cat <<EOF"]) refused(dir, c, /too complex/);
});

test("review round 1: valid commands with heredocs, ${ }, and arithmetic are still read and allowed", () => {
  const dir = project();
  for (const c of [
    "cat <<-EOF\n\tbody\n\tEOF\n",
    "cat<<'EOF'\nDon't prod-backend-9\nEOF",
    "cat <<$'EOF'\nDon't prod-backend-9\nEOF",
    "echo $((1<<2)) ${x:-it} && (( y = 1 << 2 ))",
    "cat <<<'a b' && git status",
    'gh pr create --body "$(cat <<\'EOF\'\nDon\'t run `npx convex deploy`\nEOF\n)"',
    'git commit -m "$(cat <<\'EOF\'\nDon\'t run `git push origin main`\nEOF\n)"',
  ]) allowed(dir, c);
  refused(dir, "cat <<-EOF\n\tbody\n\tEOF\nnpx convex deploy", /convex deploy/);
});

test("review round 1: Convex selectors are read the way Convex reads them", () => {
  const dir = project();
  const call = (v) => decide({ tool_name: "mcp__plugin_convex_convex__run", tool_input: { deploymentSelector: v }, cwd: dir });
  const b64 = (d) => Buffer.from(JSON.stringify({ projectDir: "/w", deployment: d })).toString("base64");
  const prod = b64({ kind: "prod" });
  const spellings = [
    `prod:${prod}:x`, `:${prod}`, `own-dev1:${prod}`, ` prod:${prod}`, `prod:${prod}\n`,
    `prod:${prod.slice(0, 8)} ${prod.slice(8)}`, `prod:${prod.slice(0, 8)}\n${prod.slice(8)}`,
    `prod:${prod.replace(/=+$/, "")}`, `prod:${prod.replace(/\+/g, "-").replace(/\//g, "_")}`,
  ];
  for (const s of spellings) assert.equal(call(s).allow, false, JSON.stringify(s));
  assert.equal(call(`prod:${b64({ kind: "ownDev" })}`).allow, false);
  for (const d of [{ kind: "ownDev" }, { kind: "previewName", previewName: "pr-1" }, { kind: "unspecified" }, { kind: "deploymentName", deploymentName: "staging-backend-1" }]) {
    assert.equal(call(`${d.kind}:${b64(d)}`).allow, true, d.kind);
    assert.equal(call(` ${d.kind}:${b64(d)}\n`).allow, true, d.kind);
  }
});
