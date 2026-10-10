import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "install.sh");
const market = JSON.parse(readFileSync(join(root, ".claude-plugin", "marketplace.json"), "utf8"));
const EVERYDAY = ["cstack", "plain", "verify", "pstack-picks", "ponytail-picks", "caveman-picks"];
const EXPO = ["expo-picks", "rn-callstack-picks", "rn-vercel-picks"];

// A fake `claude` that records every call. `list` entries may use "HERE" as projectPath for the
// project folder. `fail` names plugins whose install or update exits 1. It reads all of its input,
// so a script that doesn't protect its own input would lose the rest of itself when piped.
function run(args = [], { pkgs = {}, files = [], list = [], fail = [], piped = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cstack-install-"));
  const bin = join(dir, "bin"), project = join(dir, "project"), log = join(dir, "calls.log");
  mkdirSync(bin); mkdirSync(project);
  const here = realpathSync(project);
  const json = JSON.stringify(list.map((e) => ({ ...e, projectPath: e.projectPath === "HERE" ? here : e.projectPath })));
  writeFileSync(join(dir, "list.json"), json);
  writeFileSync(join(bin, "claude"), [
    "#!/bin/sh",
    `echo "$*" >> "${log}"`,
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
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const r = piped
    ? spawnSync("bash", ["-s", "--", ...args], { cwd: project, encoding: "utf8", env, input: readFileSync(script, "utf8") })
    : spawnSync("bash", [script, ...args], { cwd: project, encoding: "utf8", env, input: "" });
  let calls = [];
  try { calls = readFileSync(log, "utf8").trim().split("\n").filter(Boolean); } catch {}
  return { code: r.status, out: r.stdout, err: r.stderr, calls, here };
}
const acted = (calls) => calls.filter((c) => /^plugin (install|update) /.test(c));
const names = (calls) => acted(calls).map((c) => c.split(" ")[2].replace(/@cstack$/, ""));
const callFor = (calls, p) => acted(calls).find((c) => c.split(" ")[2].replace(/@cstack$/, "") === p) ?? "";

test("every plugin the script can install is listed in the marketplace", () => {
  const text = readFileSync(script, "utf8");
  const known = new Set(market.plugins.map((p) => p.name));
  for (const m of text.matchAll(/^GROUP_[A-Z]+="([^"]*)"/gm)) for (const n of m[1].split(" ").filter(Boolean)) assert.ok(known.has(n), `${n} is not in the marketplace`);
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
