import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "install.sh");
const market = JSON.parse(readFileSync(join(root, ".claude-plugin", "marketplace.json"), "utf8"));
const EVERYDAY = ["cstack", "plain", "verify", "pstack-picks", "ponytail-picks", "caveman-picks"];

// A fake `claude` that records every call and reports `installed` as already installed.
function run(args = [], { pkgs = {}, files = [], installed = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cstack-install-"));
  const bin = join(dir, "bin"), project = join(dir, "project"), log = join(dir, "calls.log");
  mkdirSync(bin); mkdirSync(project);
  const list = JSON.stringify(installed.map((p) => ({ id: `${p}@cstack` })));
  writeFileSync(join(bin, "claude"), `#!/bin/sh\necho "$*" >> "${log}"\nif [ "$1 $2" = "plugin list" ]; then echo '${list}'; fi\nexit 0\n`);
  chmodSync(join(bin, "claude"), 0o755);
  for (const [rel, deps] of Object.entries(pkgs)) {
    mkdirSync(join(project, dirname(rel)), { recursive: true });
    writeFileSync(join(project, rel), JSON.stringify({ dependencies: deps }));
  }
  for (const f of files) { mkdirSync(join(project, dirname(f)), { recursive: true }); writeFileSync(join(project, f), "{}"); }
  const out = execFileSync("bash", [script, ...args], { cwd: project, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  let calls = [];
  try { calls = readFileSync(log, "utf8").trim().split("\n"); } catch {}
  return { out, calls };
}
const installedNames = (calls) => calls.filter((c) => /^plugin (install|update) /.test(c)).map((c) => c.split(" ")[2].replace(/@cstack$/, ""));

test("every plugin the script can install is listed in the marketplace", () => {
  const text = readFileSync(script, "utf8");
  const names = new Set(market.plugins.map((p) => p.name));
  for (const m of text.matchAll(/^GROUP_[A-Z]+="([^"]*)"/gm)) for (const n of m[1].split(" ").filter(Boolean)) assert.ok(names.has(n), `${n} is not in the marketplace`);
});

test("with no arguments in a project with no package.json, it installs the everyday set", () => {
  const { calls } = run();
  assert.deepEqual(installedNames(calls).sort(), [...EVERYDAY].sort());
});

test("it adds the cstack catalog if missing, by installing through the marketplace source", () => {
  const { calls } = run();
  assert.ok(calls.some((c) => c.startsWith("plugin marketplace update cstack") || c.includes("--marketplace CWashington98/cstack")), calls.join("\n"));
  assert.ok(calls.filter((c) => c.startsWith("plugin install ")).every((c) => c.includes("--marketplace CWashington98/cstack")));
});

test("an Expo app adds the Expo and React Native pointers, not the web ones", () => {
  const names = installedNames(run([], { pkgs: { "apps/mobile/package.json": { expo: "54", react: "19", "react-native": "0.81" } } }).calls);
  for (const n of ["expo-picks", "rn-callstack-picks", "rn-vercel-picks"]) assert.ok(names.includes(n), n);
  assert.ok(!names.includes("vercel-react-picks"));
});

test("a React web app adds the web pointers; a Vercel project adds the deploy pointer", () => {
  const names = installedNames(run([], { pkgs: { "apps/web/package.json": { next: "16", react: "19", "react-dom": "19" } }, files: ["vercel.json"] }).calls);
  for (const n of ["vercel-react-picks", "good-css-picks", "vercel-deploy-picks"]) assert.ok(names.includes(n), n);
  assert.ok(!names.includes("expo-picks"));
});

test("package.json files inside node_modules are ignored", () => {
  const names = installedNames(run([], { pkgs: { "node_modules/expo/package.json": { expo: "54" } } }).calls);
  assert.ok(!names.includes("expo-picks"));
});

test("naming groups installs exactly the everyday set plus those groups", () => {
  const names = installedNames(run(["expo"]).calls);
  assert.deepEqual(names.sort(), [...EVERYDAY, "expo-picks", "rn-callstack-picks", "rn-vercel-picks"].sort());
});

test("plugins already installed are updated instead of installed again", () => {
  const { calls } = run([], { installed: ["cstack", "plain"] });
  assert.ok(calls.includes("plugin update cstack@cstack"));
  assert.ok(calls.includes("plugin update plain@cstack"));
  assert.ok(!calls.some((c) => c.startsWith("plugin install cstack@cstack") || c.startsWith("plugin install cstack ")));
});

test("an unknown group stops before installing anything", () => {
  let code = 0, calls = [];
  try { run(["webb"]); } catch (e) { code = e.status; }
  assert.equal(code, 2);
});

test("it ends by telling you to restart Claude Code", () => {
  assert.match(run().out, /[Rr]estart Claude Code/);
});
