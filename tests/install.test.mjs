import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, realpathSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "install.sh");
const market = JSON.parse(readFileSync(join(root, ".claude-plugin", "marketplace.json"), "utf8"));
const EVERYDAY = ["cstack", "plain", "verify", "pstack-picks", "ponytail-picks", "caveman-picks"];
const EXPO = ["expo-picks", "rn-callstack-picks", "rn-vercel-picks"];

const which = (tool) => spawnSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim();
const PYTHON3 = which("python3");

// A folder holding only the tools the script and the fake need, without node, so the script
// must fall back. With reader "python3" it holds python3 too; with "none" it holds neither.
function toolbox(dir, reader) {
  const box = join(dir, "tools");
  mkdirSync(box);
  for (const t of ["bash", "find", "grep", "cat", ...(reader === "python3" ? ["python3"] : [])]) symlinkSync(which(t), join(box, t));
  return box;
}

// A fake `claude` that records every call, the folder it ran in, and any call whose input was open
// rather than /dev/null. Node hands a child its input through a socket, not a pipe, so the check is
// "not a character device" (/dev/null is one; a terminal is too, but tests never have one). `list` entries may use "HERE" as projectPath for the project folder. `fail`
// names plugins whose install or update exits 1. It reads all of its input, so a script that
// doesn't protect its own input would lose the rest of itself when piped. `repo` makes the project
// a git repository, `cwd` runs the script from a subfolder of it, `reader` limits the PATH, and
// `home` makes the project folder the home folder. `shoutPwd` hands bash the folder's name in
// capitals, as a shell on a case-blind disk can after `cd` with the wrong case.
function run(args = [], { pkgs = {}, files = [], list = [], fail = [], piped = false, repo = false, cwd = "", reader = "node", home = false, shoutPwd = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cstack-install-"));
  const bin = join(dir, "bin"), project = join(dir, "project"), log = join(dir, "calls.log");
  const whereLog = join(dir, "where.log"), openLog = join(dir, "open-input.log");
  mkdirSync(bin); mkdirSync(project);
  const here = realpathSync(project);
  const json = JSON.stringify(list.map((e) => ({ ...e, projectPath: e.projectPath === "HERE" ? here : e.projectPath })));
  writeFileSync(join(dir, "list.json"), json);
  writeFileSync(join(bin, "claude"), [
    "#!/bin/sh",
    `echo "$*" >> "${log}"`,
    `echo "$(pwd -P)	$*" >> "${whereLog}"`,
    `if [ ! -c /dev/stdin ]; then echo "$*" >> "${openLog}"; fi`,
    "cat > /dev/null",
    `if [ "$1 $2" = "plugin list" ]; then cat "${join(dir, "list.json")}"; exit 0; fi`,
    ...fail.map((p) => `case "$*" in *"plugin install ${p} "*|*"plugin update ${p}@cstack"*) exit 1;; esac`),
    "exit 0",
  ].join("\n") + "\n");
  chmodSync(join(bin, "claude"), 0o755);
  for (const [rel, body] of Object.entries(pkgs)) {
    mkdirSync(join(project, dirname(rel)), { recursive: true });
    writeFileSync(join(project, rel), JSON.stringify(body.dependencies || body.keywords ? body : { dependencies: body }));
  }
  for (const f of files) {
    if (f.endsWith("/")) { mkdirSync(join(project, f), { recursive: true }); continue; }
    mkdirSync(join(project, dirname(f)), { recursive: true });
    writeFileSync(join(project, f), "{}");
  }
  if (repo) spawnSync("git", ["init", "-q"], { cwd: project });
  if (cwd) mkdirSync(join(project, cwd), { recursive: true });
  // No git setting from a surrounding run (such as a hook) may leak in, and git stops at the
  // temporary folder, so a project that isn't a repository never finds one further up.
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  const path = reader === "node" ? `${bin}:${process.env.PATH}` : `${bin}:${toolbox(dir, reader)}`;
  const env = { ...base, PATH: path, GIT_CEILING_DIRECTORIES: dir, ...(home ? { HOME: here } : {}), ...(shoutPwd ? { PWD: join(here, cwd).toUpperCase() } : {}) };
  const r = piped
    ? spawnSync("bash", ["-s", "--", ...args], { cwd: join(project, cwd), encoding: "utf8", env, input: readFileSync(script, "utf8") })
    : spawnSync("bash", [script, ...args], { cwd: join(project, cwd), encoding: "utf8", env, input: "" });
  const lines = (f) => { try { return readFileSync(f, "utf8").trim().split("\n").filter(Boolean); } catch { return []; } };
  const where = lines(whereLog).map((l) => { const [at, call] = l.split("\t"); return { at, call }; });
  return { code: r.status, out: r.stdout, err: r.stderr, calls: lines(log), where, openInput: lines(openLog), here };
}
const acted = (calls) => calls.filter((c) => /^plugin (install|update) /.test(c));
const names = (calls) => acted(calls).map((c) => c.split(" ")[2].replace(/@cstack$/, ""));
const callFor = (calls, p) => acted(calls).find((c) => c.split(" ")[2].replace(/@cstack$/, "") === p) ?? "";

test("every plugin the script can install is listed in the marketplace", () => {
  const text = readFileSync(script, "utf8");
  const known = new Set(market.plugins.map((p) => p.name));
  const groups = [...text.matchAll(/^\s*(?:local\s+)?GROUP_[A-Z]+="([^"]*)"/gm)];
  assert.equal(groups.length, 4, "the four groups (everyday, web, vercel, expo) are found, so this check can't go quiet");
  for (const m of groups) for (const n of m[1].split(" ").filter(Boolean)) assert.ok(known.has(n), `${n} is not in the marketplace`);
});

test("with no arguments and no package.json, it installs the everyday set for the user", () => {
  const { calls, code } = run();
  assert.equal(code, 0);
  assert.deepEqual(names(calls).sort(), [...EVERYDAY].sort());
  for (const p of EVERYDAY) assert.match(callFor(calls, p), /--scope user/, p);
});

test("it refreshes the cstack catalog, and every install names the catalog's source so a missing catalog is added", () => {
  const { calls } = run();
  assert.ok(calls.includes("plugin marketplace update cstack"), calls.join("\n"));
  const installs = calls.filter((c) => c.startsWith("plugin install "));
  assert.ok(installs.length > 0 && installs.every((c) => c.includes("--marketplace CWashington98/cstack")));
});

test("a detected group installs for this project only", () => {
  const { calls } = run([], { pkgs: { "apps/mobile/package.json": { expo: "54" } } });
  for (const p of EXPO) assert.match(callFor(calls, p), /--scope local/, p);
});

test("an Expo app adds the Expo and React Native pointers, not the web ones", () => {
  const n = names(run([], { pkgs: { "apps/mobile/package.json": { expo: "54", react: "19", "react-native": "0.81" } } }).calls);
  for (const p of EXPO) assert.ok(n.includes(p), p);
  assert.ok(!n.includes("vercel-react-picks"));
});

test("an Expo app that lists react-dom for Expo's web support doesn't count as a web app", () => {
  const n = names(run([], { pkgs: { "package.json": { expo: "54", "react-dom": "19" } } }).calls);
  assert.ok(n.includes("expo-picks") && !n.includes("vercel-react-picks"));
});

test("a monorepo with an Expo app and a separate Next.js app gets both", () => {
  const n = names(run([], { pkgs: { "apps/mobile/package.json": { expo: "54", "react-dom": "19" }, "apps/web/package.json": { next: "16", "react-dom": "19" } } }).calls);
  assert.ok(n.includes("expo-picks") && n.includes("vercel-react-picks"));
});

test("a Next.js app with no react-dom listed counts as a web app", () => {
  assert.ok(names(run([], { pkgs: { "package.json": { next: "16" } } }).calls).includes("vercel-react-picks"));
});

test("the word expo outside the dependencies, such as a keyword, doesn't make it an Expo app", () => {
  const n = names(run([], { pkgs: { "package.json": { keywords: ["expo"], dependencies: { "react-dom": "19" } } } }).calls);
  assert.ok(!n.includes("expo-picks") && n.includes("vercel-react-picks"));
});

test("a vercel.json file or a .vercel folder adds the deploy pointer", () => {
  assert.ok(names(run([], { files: ["vercel.json"] }).calls).includes("vercel-deploy-picks"));
  assert.ok(names(run([], { files: ["apps/web/.vercel/"] }).calls).includes("vercel-deploy-picks"));
});

test("package.json and vercel.json files in node_modules or hidden folders are ignored", () => {
  const n = names(run([], {
    pkgs: { "node_modules/expo/package.json": { expo: "54" }, ".claude/worktrees/old/package.json": { expo: "54" }, "apps/web/.next/package.json": { next: "16" } },
    files: [".worktrees/old/vercel.json"],
  }).calls);
  for (const p of ["expo-picks", "vercel-react-picks", "vercel-deploy-picks"]) assert.ok(!n.includes(p), p);
});

test("folder names with spaces or brackets are read correctly", () => {
  const n = names(run([], { pkgs: { "apps/my app/package.json": { expo: "54" }, "apps/[a]/package.json": { next: "16" } } }).calls);
  assert.ok(n.includes("expo-picks") && n.includes("vercel-react-picks"));
});

test("naming groups installs the everyday set plus those groups, and all means every group", () => {
  assert.deepEqual(names(run(["expo"]).calls).sort(), [...EVERYDAY, ...EXPO].sort());
  const all = names(run(["all"]).calls);
  for (const p of [...EXPO, "vercel-react-picks", "good-css-picks", "vercel-deploy-picks"]) assert.ok(all.includes(p), p);
});

test("a plugin installed for the user is updated for the user", () => {
  const { calls } = run([], { list: [{ id: "cstack@cstack", scope: "user" }] });
  assert.ok(calls.includes("plugin update cstack@cstack --scope user"), calls.join("\n"));
});

test("a plugin installed only in another project counts as not installed here", () => {
  const { calls } = run(["expo"], { list: [{ id: "rn-callstack-picks@cstack", scope: "local", projectPath: "/somewhere/else" }] });
  assert.match(callFor(calls, "rn-callstack-picks"), /^plugin install rn-callstack-picks .*--scope local/);
});

test("a group plugin already installed for this project is updated for this project", () => {
  const { calls } = run(["expo"], { list: [{ id: "expo-picks@cstack", scope: "local", projectPath: "HERE" }] });
  assert.ok(calls.includes("plugin update expo-picks@cstack --scope local"), calls.join("\n"));
});

test("a group plugin already installed for the user everywhere is updated there, not installed again", () => {
  const { calls } = run(["expo"], { list: [{ id: "expo-picks@cstack", scope: "user" }] });
  assert.ok(calls.includes("plugin update expo-picks@cstack --scope user"), calls.join("\n"));
});

test("when one plugin fails, the others still run, the failure is named and the exit code is 1", () => {
  const { code, err, calls } = run([], { fail: ["plain"] });
  assert.equal(code, 1);
  assert.match(err, /didn't install or update: plain/);
  assert.ok(names(calls).includes("caveman-picks"), "plugins after the failure still ran");
});

test("an unknown group stops with exit 2 before calling claude at all", () => {
  const { code, calls } = run(["expo", "webb"]);
  assert.equal(code, 2);
  assert.deepEqual(calls, []);
});

test("piped into bash, the script survives claude reading input and runs every plugin", () => {
  const { code, calls } = run([], { piped: true });
  assert.equal(code, 0);
  assert.deepEqual(names(calls).sort(), [...EVERYDAY].sort());
});

test("it ends by telling you to restart Claude Code", () => {
  assert.match(run().out, /Restart Claude Code/);
});

test("when a project-only plugin fails, it is named and the exit code is 1", () => {
  const { code, err } = run(["expo"], { fail: ["expo-picks"] });
  assert.equal(code, 1);
  assert.match(err, /didn't install or update: expo-picks/);
});

// Issue #11, item 1: the fallback readers and the protected input.
test("without node, python3 reads the installed list the same way", { skip: !PYTHON3 && "python3 isn't on this machine" }, () => {
  const { code, calls, err } = run(["expo"], { reader: "python3", list: [
    { id: "cstack@cstack", scope: "user" },
    { id: "expo-picks@cstack", scope: "local", projectPath: "HERE" },
    { id: "rn-callstack-picks@cstack", scope: "local", projectPath: "/somewhere/else" },
  ] });
  assert.equal(code, 0, err);
  assert.doesNotMatch(err, /can't be read/, "python3 can read the list, so there is no warning");
  assert.ok(calls.includes("plugin update cstack@cstack --scope user"), calls.join("\n"));
  assert.ok(calls.includes("plugin update expo-picks@cstack --scope local"), calls.join("\n"));
  assert.match(callFor(calls, "rn-callstack-picks"), /^plugin install rn-callstack-picks .*--scope local/);
  assert.match(callFor(calls, "plain"), /^plugin install plain .*--scope user/);
});

test("every claude call gets empty input, so it can never wait on the keyboard or read the script", () => {
  const { calls, openInput } = run(["expo"], { list: [{ id: "cstack@cstack", scope: "user" }] });
  for (const kind of ["plugin marketplace update", "plugin list", "plugin update", "plugin install"]) {
    assert.ok(calls.some((c) => c.startsWith(kind)), `${kind} ran, so its input was checked`);
  }
  assert.deepEqual(openInput, [], "these claude calls were handed open input instead of /dev/null");
});

// Issue #11, item 2: deliberate choices, pinned for both readers.
for (const reader of ["node", "python3"]) {
  const skip = reader === "python3" && !PYTHON3 && "python3 isn't on this machine";
  test(`${reader}: a plugin installed for the whole project (project scope) counts as installed here`, { skip }, () => {
    const { calls } = run(["expo"], { reader, list: [{ id: "expo-picks@cstack", scope: "project", projectPath: "HERE" }] });
    assert.ok(calls.includes("plugin update expo-picks@cstack --scope project"), calls.join("\n"));
  });

  test(`${reader}: an install for the user everywhere wins over one for this folder`, { skip }, () => {
    const { calls } = run([], { reader, list: [
      { id: "cstack@cstack", scope: "local", projectPath: "HERE" },
      { id: "cstack@cstack", scope: "user" },
    ] });
    assert.ok(calls.includes("plugin update cstack@cstack --scope user"), calls.join("\n"));
    assert.ok(!calls.includes("plugin update cstack@cstack --scope local"), calls.join("\n"));
  });
}

// Issue #11, item 3.
test("react-dom or next outside the dependencies, such as a keyword, doesn't make it a web app", () => {
  const n = names(run([], { pkgs: { "package.json": { keywords: ["react-dom", "next"], dependencies: { lodash: "4" } } } }).calls);
  assert.ok(!n.includes("vercel-react-picks") && !n.includes("good-css-picks"), n.join(" "));
});

// Issue #11, item 4.
test("a group plugin installed for the user everywhere is named with the command to remove it, and nothing is removed", () => {
  const { code, out, calls } = run(["web"], { list: [
    { id: "cstack@cstack", scope: "user" },
    { id: "expo-picks@cstack", scope: "user" },
    { id: "good-css-picks@cstack", scope: "user" },
  ] });
  assert.equal(code, 0);
  assert.match(out, /^ *claude plugin uninstall expo-picks@cstack --scope user$/m);
  assert.match(out, /^ *claude plugin uninstall good-css-picks@cstack --scope user$/m);
  assert.doesNotMatch(out, /uninstall cstack@cstack/, "the everyday set belongs everywhere");
  assert.ok(!calls.some((c) => /uninstall/.test(c)), calls.join("\n"));
  assert.doesNotMatch(run(["web"]).out, /uninstall/, "no group plugin is installed everywhere, so nothing is said");
});

test("exactly one group plugin left for the user is named, and one installed only for this project is not", () => {
  const { out } = run(["web"], { list: [
    { id: "expo-picks@cstack", scope: "user" },
    { id: "good-css-picks@cstack", scope: "local", projectPath: "HERE" },
  ] });
  const lines = out.split("\n").filter((l) => /claude plugin uninstall/.test(l)).map((l) => l.trim());
  assert.deepEqual(lines, ["claude plugin uninstall expo-picks@cstack --scope user"], out);
});

// Issue #11, item 5.
test("with neither node nor python3, it warns that the installed list can't be read, then installs everything", () => {
  const { code, err, calls } = run([], { reader: "none", list: [{ id: "cstack@cstack", scope: "user" }] });
  assert.equal(code, 0, err);
  assert.match(err, /Neither node nor python3/);
  assert.match(err, /can't be read/);
  assert.match(callFor(calls, "cstack"), /^plugin install cstack /);
  assert.doesNotMatch(run().err, /can't be read/, "with node present there is no warning");
});

// Issue #11, item 6.
test("run from a subfolder of a git project, the group plugins are handled from the project's top folder", () => {
  const { code, out, where, here } = run([], {
    repo: true, cwd: "apps/mobile",
    pkgs: { "apps/mobile/package.json": { expo: "54" } },
    list: [{ id: "expo-picks@cstack", scope: "local", projectPath: "HERE" }],
  });
  assert.equal(code, 0);
  assert.ok(out.includes(`Working from the project's top folder: ${here}`), out);
  assert.ok(where.some((w) => w.call === "plugin update expo-picks@cstack --scope local"), "the top folder's install was found");
  for (const p of EXPO) {
    const w = where.find((x) => / plugin (install|update) /.test(` ${x.call}`) && x.call.split(" ")[2].replace(/@cstack$/, "") === p);
    assert.ok(w, `${p} ran`);
    assert.equal(w.at, here, `${p} ran from the top folder`);
  }
});

test("run from a subfolder outside any git project, it stays in the current folder", () => {
  const { where, here } = run([], { cwd: "apps/mobile", pkgs: { "apps/mobile/package.json": { expo: "54" } } });
  const w = where.find((x) => x.call.startsWith("plugin install expo-picks "));
  assert.ok(w, "expo-picks ran");
  assert.equal(w.at, join(here, "apps/mobile"));
});

test("run from a package.json five folders down, that app's own group is still found", () => {
  const { code, out, where, here } = run([], {
    repo: true, cwd: "packages/clients/apps/mobile",
    pkgs: { "packages/clients/apps/mobile/package.json": { expo: "54" }, "apps/web/package.json": { next: "16" } },
  });
  assert.equal(code, 0);
  assert.match(out, /Detected for this project: .*expo/, out);
  for (const p of [...EXPO, "vercel-react-picks"]) {
    const w = where.find((x) => x.call.startsWith(`plugin install ${p} `));
    assert.ok(w, `${p} ran`);
    assert.match(w.call, /--scope local/, p);
    assert.equal(w.at, here, `${p} ran from the top folder`);
  }
});

test("run from an app folder, the groups of the rest of the repository are found too", () => {
  const n = names(run([], { repo: true, cwd: "apps/mobile", pkgs: { "apps/mobile/package.json": { expo: "54" }, "apps/web/package.json": { next: "16" } } }).calls);
  assert.ok(n.includes("expo-picks") && n.includes("vercel-react-picks"), n.join(" "));
});

test("run from the top folder of a git project, it says nothing about moving and stays there", () => {
  const { code, out, where, here } = run([], { repo: true, pkgs: { "apps/mobile/package.json": { expo: "54" } } });
  assert.equal(code, 0);
  assert.doesNotMatch(out, /Working from/);
  assert.ok(where.length > 0 && where.every((w) => w.at === here), JSON.stringify(where));
});

test("the move to the top folder is announced before what was detected", () => {
  const { out } = run([], { repo: true, cwd: "apps/mobile", pkgs: { "apps/mobile/package.json": { expo: "54" } } });
  const moved = out.indexOf("Working from"), detected = out.indexOf("Detected for this project");
  assert.ok(moved >= 0 && detected > moved, out);
});

test("a home folder that is itself a git repository isn't treated as the project", () => {
  const { out, where, here } = run([], { repo: true, home: true, cwd: "Source/app", pkgs: { "Source/app/package.json": { expo: "54" } } });
  assert.doesNotMatch(out, /Working from/);
  const w = where.find((x) => x.call.startsWith("plugin install expo-picks "));
  assert.ok(w, "expo-picks ran");
  assert.equal(w.at, join(here, "Source/app"));
});

const caseBlind = existsSync(realpathSync(tmpdir()).toUpperCase());
test("at the top folder, a different letter case in the folder's name doesn't count as a move", { skip: !caseBlind && "this disk tells letter case apart" }, () => {
  const { code, out } = run([], { repo: true, shoutPwd: true });
  assert.equal(code, 0);
  assert.doesNotMatch(out, /Working from/);
});
