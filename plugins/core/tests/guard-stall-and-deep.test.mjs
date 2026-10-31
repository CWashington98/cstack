// Two guard rules added together:
//   1. A recursive rm that Claude Code would stop and ask a person about is refused up front.
//   2. The owner can list scripts, in a file in their own Claude configuration folder, that agents
//      may run even though they nest deeper than the guard checks.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeRepo, git, tempDir } from "../../../tests/helpers.mjs";
import { decide } from "../scripts/guard.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "guard.mjs");
const BASE = { integrationBranch: "staging", agentsNeverTouch: ["prod-backend-9"], agentsMayDeployTo: ["staging-backend-1"] };
const repo = (files = {}, settings = BASE) => makeRepo({ ...(settings ? { ".claude/verify.json": JSON.stringify(settings) } : {}), "package.json": JSON.stringify({ scripts: {} }), ...files });
const run = (dir, command) => decide({ tool_name: "Bash", tool_input: { command }, cwd: dir });
const reasons = (r) => r.refusals.map((x) => x.reason).join("\n");
const refused = (dir, command, pattern) => {
  const r = run(dir, command);
  assert.equal(r.allow, false, `expected the guard to refuse: ${command}`);
  if (pattern) assert.match(reasons(r), pattern, command);
};
const allowed = (dir, command) => {
  const r = run(dir, command);
  assert.equal(r.allow, true, `expected the guard to allow: ${command}\n${reasons(r)}`);
};

// ---- Change 1: recursive rm that would stall on a permission prompt ----

const STALL = /as its own Bash call with the literal path/;

test("a recursive rm on a variable, a substitution or a wildcard is refused with the way out", () => {
  const dir = repo();
  for (const c of ['S=/tmp/x && rm -rf "$S"', 'rm -rf "$(cat f)"', "rm -rf /tmp/foo-*", "rm -rf /tmp/foo-?", "rm -rf /tmp/foo-[ab]", "rm -rf `cat f`", "rm -r $HOME_NOT_SET", 'rm --recursive "${X:-/tmp/y}"']) refused(dir, c, STALL);
  const r = run(dir, 'S=/tmp/x && rm -rf "$S" && mkdir -p "$S"');
  assert.match(reasons(r), /literal path/);
  assert.match(reasons(r), /rest .* separate/);
});

test("a recursive rm chained with other commands is refused, alone it is not", () => {
  const dir = repo();
  for (const c of ["cd /tmp && rm -r build", "rm -rf build; echo done", "echo a | rm -rf build", "if true; then rm -rf build; fi", "bash -c 'cd /tmp && rm -rf build'", "(rm -rf build)\nls", "echo $(rm -rf build)", "for i in 1; do rm -rf /tmp/scratch; done", "while true; do rm -rf /tmp/scratch; done", "{ rm -rf /tmp/scratch; }", "X=$(date) rm -rf /tmp/scratch", "cat <<EOF\n$(rm -rf /tmp/scratch)\nEOF"]) refused(dir, c, STALL);
  for (const c of ["rm -rf /tmp/x/tree", "rm -rf node_modules", "rm -r build/", "sudo rm -rf /tmp/x/tree", "rm -rf /tmp/x/tree 2>/dev/null", "bash -c 'rm -rf /tmp/x/tree'"]) allowed(dir, c);
});

test("commands that only look like a recursive delete are left alone", () => {
  const dir = repo();
  for (const c of ["rm -f a && echo ok", "rm a b; ls", "git rm -r --cached foo && git commit -m x", 'grep -rn "rm -rf" scripts/', "echo rm -rf stuff", 'git commit -m "never rm -rf $HOME"']) allowed(dir, c);
});

test("the rule is about what the shell sends Claude Code, not about scripts it runs", () => {
  const dir = repo({ "scripts/clean.sh": 'OUT=dist\nrm -rf "$OUT" build/*\n', "package.json": JSON.stringify({ scripts: { clean: 'rm -rf "$OUT_DIR" && rm -rf dist/*' } }) });
  allowed(dir, "bash scripts/clean.sh");
  allowed(dir, "npm run clean");
});

test("the other delete rules still say their own reason", () => {
  const r = run(repo(), "cd /tmp && rm -rf ~/Documents");
  assert.match(reasons(r), STALL);
  assert.match(reasons(r), /outside this repository/);
});

test("the hook tells the agent to run the delete alone, not to hand it to the owner", () => {
  const dir = repo();
  const call = spawnSync(process.execPath, [script], { input: JSON.stringify({ cwd: dir, tool_name: "Bash", tool_input: { command: 'S=/tmp/x && rm -rf "$S"' } }), encoding: "utf8" });
  assert.equal(call.status, 2);
  assert.match(call.stderr, STALL);
  assert.doesNotMatch(call.stderr, /Only the owner runs it/);
  assert.doesNotMatch(call.stderr, /with ! in front/);
});

// ---- Change 2: the owner's list of deep scripts ----

// scripts/<prefix>0.sh runs <prefix>1.sh ... and the last one runs `last`.
const chain = (prefix, count, last = "echo done", folder = "scripts") => Object.fromEntries(Array.from({ length: count }, (_, i) => [`${folder}/${prefix}${i}.sh`, i === count - 1 ? `${last}\n` : `bash ${folder}/${prefix}${i + 1}.sh\n`]));
const DEEP = /nested more than 8 levels/;
const configFolder = tempDir("guard-config");
let counter = 0;
// Writes the owner's list: { "<repository>": ["script path", ...] }, and points the guard at it.
const owner = (lists) => {
  const file = join(configFolder, `deep-${++counter}.json`);
  writeFileSync(file, JSON.stringify({ repos: lists }));
  process.env.CSTACK_GUARD_DEEP_SCRIPTS = file;
  return file;
};
const noList = () => { process.env.CSTACK_GUARD_DEEP_SCRIPTS = join(configFolder, "does-not-exist.json"); };
after(() => { delete process.env.CSTACK_GUARD_DEEP_SCRIPTS; });

test("a listed script runs however it is started, though it nests deeper than the guard checks", () => {
  const dir = repo(chain("d", 12));
  owner({ [dir]: ["scripts/d0.sh"] });
  for (const c of ["bash scripts/d0.sh", "sh scripts/d0.sh", "bash ./scripts/d0.sh", "./scripts/d0.sh", "bash -x scripts/d0.sh", "cd scripts && bash d0.sh", "bash scripts/../scripts/d0.sh", "source scripts/d0.sh", "env CI=1 bash scripts/d0.sh"]) allowed(dir, c);
  // Without the owner's list, the same chain is refused with today's message.
  noList();
  const r = run(dir, "bash scripts/d0.sh");
  assert.equal(r.allow, false);
  assert.match(reasons(r), /It runs scripts nested more than 8 levels deep, which the guard doesn't check\. Run the inner command directly\./);
  owner({ [dir]: [] });
  refused(dir, "bash scripts/d0.sh", DEEP);
});

test("a package script that starts a listed script is allowed", () => {
  const dir = repo({ ...chain("d", 12), "package.json": JSON.stringify({ scripts: { preflight: "bash scripts/d0.sh", wrapped: "env CI=1 bash ./scripts/d0.sh" } }) });
  owner({ [dir]: ["scripts/d0.sh"] });
  for (const c of ["npm run preflight", "bun run preflight", "npm run wrapped"]) allowed(dir, c);
});

test("an unlisted deep script is still refused, and so is the same script run on its own path", () => {
  const dir = repo({ ...chain("d", 12), ...chain("u", 12) });
  owner({ [dir]: ["scripts/d0.sh"] });
  allowed(dir, "bash scripts/d0.sh");
  refused(dir, "bash scripts/u0.sh", DEEP);
  refused(dir, "bash scripts/d0.sh && bash scripts/u0.sh", DEEP);
  // d1.sh is deep when started on its own path, and it is not listed.
  refused(dir, "bash scripts/d1.sh", DEEP);
  const deep = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`s${i}`, `bun run s${i + 1}`]));
  const pkg = repo({ "package.json": JSON.stringify({ scripts: deep }) });
  owner({ [pkg]: ["scripts/d0.sh"] });
  refused(pkg, "bun run s0", DEEP);
});

test("a listed script is still checked by every other rule within the levels the guard checks", () => {
  const files = {
    "scripts/bad-top.sh": "npx convex deploy\nbash scripts/d0.sh\n",
    "scripts/bad-mid.sh": "bash scripts/m1.sh\n",
    "scripts/m1.sh": "bash scripts/m2.sh\n",
    "scripts/m2.sh": "git push origin staging\nbash scripts/d0.sh\n",
    "scripts/bad-never.sh": "curl https://prod-backend-9.convex.cloud\nbash scripts/d0.sh\n",
    "scripts/bad-prod.sh": "vercel --prod\nbash scripts/d0.sh\n",
    "scripts/bad-rm.sh": "rm -rf ~/Documents\nbash scripts/d0.sh\n",
    ...chain("d", 12),
  };
  const dir = repo(files);
  owner({ [dir]: ["scripts/bad-*.sh", "scripts/m*.sh", "scripts/d0.sh"] });
  refused(dir, "bash scripts/bad-top.sh", /convex deploy/);
  refused(dir, "bash scripts/bad-mid.sh", /protected branch "staging"/);
  refused(dir, "bash scripts/bad-never.sh", /agentsNeverTouch/);
  refused(dir, "bash scripts/bad-prod.sh", /Vercel/);
  refused(dir, "bash scripts/bad-rm.sh", /outside this repository/);
  // The command that runs the script is checked as always.
  refused(dir, "bash scripts/d0.sh && git push origin staging", /protected branch/);
  refused(dir, "npx convex deploy && bash scripts/d0.sh", /convex deploy/);
});

test("inside a listed script, the 8th level is read and the 9th is not", () => {
  const at = (n) => {
    const files = {};
    for (let i = 0; i < 12; i++) files[`scripts/d${i}.sh`] = `${i === n ? "git push origin staging\n" : ""}${i === 11 ? "echo done" : `bash scripts/d${i + 1}.sh`}\n`;
    const dir = repo(files);
    owner({ [dir]: ["scripts/d0.sh"] });
    return dir;
  };
  refused(at(7), "bash scripts/d0.sh", /protected branch/);
  allowed(at(8), "bash scripts/d0.sh");
});

test("a package script skipped past the depth limit inside a listed script is still read in full when it comes up shallower", () => {
  const files = { "package.json": JSON.stringify({ scripts: { danger: "npx convex deploy" } }), "scripts/listed.sh": "bash scripts/d1.sh\nnpm run danger\n" };
  for (let i = 1; i <= 7; i++) files[`scripts/d${i}.sh`] = i === 7 ? "npm run danger\n" : `bash scripts/d${i + 1}.sh\n`;
  const dir = repo(files);
  owner({ [dir]: ["scripts/listed.sh"] });
  refused(dir, "bash scripts/listed.sh", /convex deploy/);
  writeFileSync(join(dir, "scripts", "listed.sh"), "npm run danger\nbash scripts/d1.sh\n");
  refused(dir, "bash scripts/listed.sh", /convex deploy/);
  // And a package script read inside a listed script is read again, in full, outside one.
  const deep = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`s${i}`, `bun run s${i + 1}`]));
  const pkg = repo({ "package.json": JSON.stringify({ scripts: deep }), "scripts/runs-s0.sh": "bun run s0\n" });
  owner({ [pkg]: ["scripts/runs-s0.sh"] });
  allowed(pkg, "bash scripts/runs-s0.sh");
  refused(pkg, "bun run s0", DEEP);
  refused(pkg, "bash scripts/runs-s0.sh && bun run s0", DEEP);
  refused(pkg, "bun run s0 && bash scripts/runs-s0.sh", DEEP);
});

test("matching is by exact path or a simple glob from the repository root", () => {
  const files = { ...chain("q", 12, "echo done", "z"), "scripts/__tests__/preflight.test.sh": "bash z/q0.sh\n", "scripts/__tests__/preflight-extra.test.sh": "bash z/q0.sh\n", "scripts/__tests__/other.test.sh": "bash z/q0.sh\n", "scripts/__tests__/sub/preflight.test.sh": "bash z/q0.sh\n", "scripts/preflight.sh": "bash z/q0.sh\n", "scripts/preflight-fixture-suites.sh": "bash z/q0.sh\n", "tools/scripts/preflight.sh": "bash z/q0.sh\n", "scripts/preflight.sh.bak": "bash z/q0.sh\n" };
  const dir = repo(files);
  owner({ [dir]: ["scripts/preflight.sh", "scripts/__tests__/preflight*.test.sh", "scripts/preflight-fixture-suites.sh"] });
  for (const f of ["scripts/preflight.sh", "scripts/__tests__/preflight.test.sh", "scripts/__tests__/preflight-extra.test.sh", "scripts/preflight-fixture-suites.sh"]) allowed(dir, `bash ${f}`);
  for (const f of ["scripts/__tests__/other.test.sh", "scripts/__tests__/sub/preflight.test.sh", "tools/scripts/preflight.sh", "scripts/preflight.sh.bak"]) refused(dir, `bash ${f}`, DEEP);
});

test("globs mean what the documentation says", () => {
  const files = { ...chain("q", 12, "echo done", "z"), "scripts/__tests__/preflight/x.test.sh": "bash z/q0.sh\n", "scripts/x.test.sh": "bash z/q0.sh\n", "scripts/a/b/x.test.sh": "bash z/q0.sh\n", "scripts/pre/flight.sh": "bash z/q0.sh\n", "scripts/preXflight.sh": "bash z/q0.sh\n", "scripts/aXb.sh": "bash z/q0.sh\n", "scripts/a.b.sh": "bash z/q0.sh\n", "scripts/a+b.sh": "bash z/q0.sh\n", "scripts/aab.sh": "bash z/q0.sh\n" };
  const dir = repo(files);
  owner({ [dir]: ["scripts/__tests__/preflight*.test.sh", "scripts/pre?flight.sh"] });
  refused(dir, "bash scripts/__tests__/preflight/x.test.sh", DEEP); // * stops at a slash
  refused(dir, "bash scripts/pre/flight.sh", DEEP); // so does ?
  allowed(dir, "bash scripts/preXflight.sh");
  owner({ [dir]: ["scripts/**/*.test.sh"] });
  allowed(dir, "bash scripts/x.test.sh"); // ** may be no folder at all
  allowed(dir, "bash scripts/a/b/x.test.sh");
  allowed(dir, "bash scripts/__tests__/preflight/x.test.sh");
  owner({ [dir]: ["scripts/a.b.sh", "scripts/a+b.sh"] });
  allowed(dir, "bash scripts/a.b.sh");
  allowed(dir, "bash scripts/a+b.sh");
  refused(dir, "bash scripts/aXb.sh", DEEP); // a dot is only a dot
  refused(dir, "bash scripts/aab.sh", DEEP); // a plus is only a plus
});

test("a link is followed first: it counts only when what it points at is listed", () => {
  const dir = repo({ ...chain("d", 12), ...chain("e", 12), "other/evil.sh": "bash scripts/e0.sh\n" });
  owner({ [dir]: ["scripts/d0.sh", "scripts/preflight.sh"] });
  symlinkSync(join(dir, "other", "evil.sh"), join(dir, "scripts", "preflight.sh"));
  symlinkSync(join(dir, "scripts", "d0.sh"), join(dir, "scripts", "alias.sh"));
  refused(dir, "bash scripts/preflight.sh", DEEP); // listed by name, but really other/evil.sh
  allowed(dir, "bash scripts/alias.sh"); // not listed by name, but really scripts/d0.sh
});

test("a repository is known by its main checkout, so a worktree shares the entry, and one repository's entry does not reach another", () => {
  const dir = repo(chain("d", 12));
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "start");
  const worktree = join(tempDir("guard-worktree"), "wt");
  git(dir, "worktree", "add", "-q", worktree, "-b", "feature");
  owner({ [dir]: ["scripts/d0.sh"] });
  allowed(dir, "bash scripts/d0.sh");
  allowed(worktree, "bash scripts/d0.sh");
  // A key that is a link to the checkout is the same checkout.
  const alias = join(tempDir("guard-alias"), "link");
  symlinkSync(dir, alias);
  owner({ [alias]: ["scripts/d0.sh"] });
  allowed(worktree, "bash scripts/d0.sh");
  // Another repository with the same script names is not listed, whichever folder the command starts in.
  const other = repo(chain("d", 12));
  refused(other, "bash scripts/d0.sh", DEEP);
  allowed(other, `cd ${dir} && bash scripts/d0.sh`);
});

test("the list is only ever read from the owner's file, never from the repository", () => {
  const list = ["scripts/d0.sh"];
  const dir = repo({
    ...chain("d", 12),
    ".claude/verify.json": JSON.stringify({ ...BASE, agentsMayRunDeepScripts: list, deepScripts: list }),
    ".claude/deep-scripts.json": JSON.stringify({ repos: {} }),
    "cstack/deep-scripts.json": "{}",
  });
  noList();
  writeFileSync(join(dir, ".claude", "deep-scripts.json"), JSON.stringify({ repos: { [dir]: list } }));
  writeFileSync(join(dir, "cstack", "deep-scripts.json"), JSON.stringify({ repos: { [dir]: list } }));
  writeFileSync(join(dir, "inside.json"), JSON.stringify({ repos: { [dir]: list } }));
  refused(dir, "bash scripts/d0.sh", DEEP);
  // The rest of the settings file still works as before.
  refused(dir, "npx convex deploy", /convex deploy/);
});

test("the owner's file is found beside the guard log by default, and a missing or unreadable file lists nothing", () => {
  const dir = repo(chain("d", 12));
  const saved = { override: process.env.CSTACK_GUARD_DEEP_SCRIPTS, config: process.env.CLAUDE_CONFIG_DIR };
  try {
    delete process.env.CSTACK_GUARD_DEEP_SCRIPTS;
    const home = tempDir("guard-home");
    process.env.CLAUDE_CONFIG_DIR = home;
    refused(dir, "bash scripts/d0.sh", DEEP); // no file yet
    mkdirSync(join(home, "cstack"), { recursive: true });
    const file = join(home, "cstack", "deep-scripts.json");
    writeFileSync(file, JSON.stringify({ repos: { [dir]: ["scripts/d0.sh"] } }));
    allowed(dir, "bash scripts/d0.sh");
    for (const bad of ["{not json", "[]", "null", '{"repos": []}', '{"repos": "x"}', JSON.stringify({ repos: { [dir]: "scripts/d0.sh" } }), JSON.stringify({ repos: { [dir]: [1, null, {}] } })]) {
      writeFileSync(file, bad);
      refused(dir, "bash scripts/d0.sh", DEEP);
    }
    // A folder where the file should be can't be read either.
    const folderCase = tempDir("guard-home2");
    mkdirSync(join(folderCase, "cstack", "deep-scripts.json"), { recursive: true });
    process.env.CLAUDE_CONFIG_DIR = folderCase;
    refused(dir, "bash scripts/d0.sh", DEEP);
  } finally {
    for (const [name, key] of [["override", "CSTACK_GUARD_DEEP_SCRIPTS"], ["config", "CLAUDE_CONFIG_DIR"]]) {
      if (saved[name] === undefined) delete process.env[key];
      else process.env[key] = saved[name];
    }
  }
});

test("entries that are not plain relative script paths list nothing", () => {
  const dir = repo(chain("d", 12));
  for (const entry of [join(dir, "scripts/d0.sh"), "../x/scripts/d0.sh", "scripts/../scripts/d0.sh", "scripts/", "**", "*", "", "/"]) {
    owner({ [dir]: [entry] });
    refused(dir, "bash scripts/d0.sh", DEEP);
  }
  // A good entry beside bad ones still works.
  owner({ [dir]: ["../x", "", "scripts/d0.sh"] });
  allowed(dir, "bash scripts/d0.sh");
});

test("the hook, run as the agent would run it, honours the owner's file and refuses without it", () => {
  const dir = repo(chain("d", 12));
  const file = owner({ [dir]: ["scripts/d0.sh"] });
  const call = (env) => spawnSync(process.execPath, [script], { input: JSON.stringify({ cwd: dir, tool_name: "Bash", tool_input: { command: "bash scripts/d0.sh" } }), encoding: "utf8", env: { ...process.env, ...env } });
  assert.equal(call({ CSTACK_GUARD_DEEP_SCRIPTS: file }).status, 0);
  const refusal = call({ CSTACK_GUARD_DEEP_SCRIPTS: join(configFolder, "nope.json") });
  assert.equal(refusal.status, 2);
  assert.match(refusal.stderr, DEEP);
});

test("the depth allowance is counted from where the listed script starts, so wrapper scripts can't use it up", () => {
  const files = { "scripts/listed.sh": "git push origin staging\n" };
  for (let i = 0; i < 8; i++) files[`scripts/w${i}.sh`] = i === 7 ? "bash scripts/listed.sh\n" : `bash scripts/w${i + 1}.sh\n`;
  const dir = repo(files);
  owner({ [dir]: ["scripts/listed.sh"] });
  refused(dir, "bash scripts/listed.sh", /protected branch/);
  refused(dir, "bash scripts/w0.sh", /protected branch/);
});

test("a package script read under one listed script is read again under another that starts shallower", () => {
  // A and B both run package script p at the same depth, but A started deeper in the chain, so it has less allowance left.
  const files = { "package.json": JSON.stringify({ scripts: { p: "bash scripts/p1.sh" } }), "scripts/p1.sh": "bash scripts/p2.sh\n", "scripts/p2.sh": "bash scripts/p3.sh\n", "scripts/p3.sh": "bash scripts/p4.sh\n", "scripts/p4.sh": "bash scripts/p5.sh\n", "scripts/p5.sh": "git push origin staging\n", "scripts/A.sh": "bash scripts/a1.sh\n", "scripts/a1.sh": "bash scripts/a2.sh\n", "scripts/a2.sh": "npm run p\n", "scripts/B.sh": "npm run p\n", "scripts/w0.sh": "bash scripts/w1.sh\n", "scripts/w1.sh": "bash scripts/B.sh\n" };
  const dir = repo(files);
  owner({ [dir]: ["scripts/A.sh", "scripts/B.sh"] });
  allowed(dir, "bash scripts/A.sh"); // the push is past A's allowance
  refused(dir, "bash scripts/w0.sh", /protected branch/);
  refused(dir, "bash scripts/A.sh && bash scripts/w0.sh", /protected branch/);
  refused(dir, "bash scripts/w0.sh && bash scripts/A.sh", /protected branch/);
});

test("a listed script run from inside another listed script keeps the outer allowance", () => {
  const files = { "scripts/outer.sh": "bash scripts/inner.sh\ngit push origin staging\n", "scripts/inner.sh": "echo hi\n" };
  const dir = repo(files);
  owner({ [dir]: ["scripts/outer.sh", "scripts/inner.sh"] });
  refused(dir, "bash scripts/outer.sh", /protected branch/);
});

test("with no list file, reading script files does not ask git about each one", () => {
  const files = {};
  for (let i = 0; i < 150; i++) files[`scripts/s${i}.sh`] = "echo hi\n";
  files["scripts/all.sh"] = Array.from({ length: 150 }, (_, i) => `bash scripts/s${i}.sh`).join("\n") + "\n";
  const dir = repo(files);
  noList();
  const start = Date.now();
  allowed(dir, "bash scripts/all.sh");
  assert.ok(Date.now() - start < 3000, `took ${Date.now() - start} ms`);
});
