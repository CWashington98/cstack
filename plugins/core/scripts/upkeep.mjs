#!/usr/bin/env node
// cstack upkeep: reports what is out of date across every Claude account on
// this machine, and prints the command that fixes each problem. It changes
// nothing except refreshing plugin catalogs (skip that with --no-refresh).
//
// Usage: node upkeep.mjs [--repo <path>]... [--no-refresh] [--json]
// Repositories can also be listed in ~/.config/cstack/upkeep.json as {"repos": [...]}.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

const STALE_DAYS = 14;
const WATCHED_PACKAGES = ["@fission-ai/openspec"];
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

export function findProfiles(home = homedir()) {
  return readdirSync(home)
    .filter((name) => /^\.claude(-[\w-]+)?$/.test(name) && !/\.bak/.test(name))
    .map((name) => ({ name, dir: join(home, name) }))
    .filter((p) => existsSync(join(p.dir, "plugins", "installed_plugins.json")))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function staleCatalogs(markets, now = Date.now(), days = STALE_DAYS) {
  return Object.entries(markets)
    .map(([name, m]) => ({ name, days: Math.floor((now - Date.parse(m.lastUpdated)) / 86_400_000) }))
    .filter((m) => m.days > days);
}

const shortId = (s) => String(s ?? "").slice(0, 7);

export function compareInstalled(installed, catalogs) {
  const rows = [];
  for (const [plugin, installs] of Object.entries(installed)) {
    const [name, market] = plugin.split("@");
    const entry = (catalogs[market] ?? []).find((p) => p.name === name);
    const have = installs[0] ?? {};
    const installedId = have.version ?? shortId(have.gitCommitSha);
    if (!entry) {
      rows.push({ plugin, status: "not in catalog", installed: installedId, latest: "" });
      continue;
    }
    const latest = entry.version ?? shortId(entry.source?.sha);
    let status = "current";
    if (/^\[deprecated\]/i.test(entry.description ?? "")) status = "deprecated";
    else if (entry.version) status = entry.version === have.version ? "current" : "behind";
    else if (entry.source?.sha) {
      const pin = entry.source.sha;
      const ok = [have.gitCommitSha, have.version].some((id) => id && (pin.startsWith(id) || id.startsWith(shortId(pin))));
      status = ok ? "current" : "behind";
    }
    rows.push({ plugin, status, installed: installedId, latest, note: status === "deprecated" ? entry.description : undefined });
  }
  return rows;
}

// A project or local install at a different version from the main (user) install
// keeps loading the old version in that project. Summarized per plugin.
export function duplicateInstalls(installed) {
  const out = [];
  for (const [plugin, installs] of Object.entries(installed)) {
    const id = (i) => i.version ?? shortId(i.gitCommitSha);
    const main = installs.find((i) => i.scope === "user");
    if (!main) continue;
    const odd = installs.filter((i) => i !== main && i.scope !== "user" && id(i) && id(i) !== "unknown" && id(i) !== id(main));
    if (odd.length) out.push({ plugin, main: id(main), others: [...new Set(odd.map(id))].slice(0, 3), projects: odd.length });
  }
  return out;
}

const repoOf = (url) => url.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");

export async function pointerChanges(entries, compare) {
  const out = [];
  for (const e of entries) {
    const s = e.source;
    if (typeof s !== "object" || !s.sha || !s.url?.includes("github.com")) continue;
    const repo = repoOf(s.url);
    const result = await compare(repo, s.sha);
    if (!result || !result.ahead) continue;
    const base = s.path ? s.path.replace(/\/$/, "") + "/" : "";
    const picked = (e.skills ?? ["./"]).map((k) => (base + k.replace(/^\.\//, "")).replace(/\/$/, ""));
    const changed = result.files.filter((f) => f.startsWith(base) && picked.some((p) => p === base.replace(/\/$/, "") || f === p || f.startsWith(p + "/")));
    if (changed.length) out.push({ plugin: e.name, ahead: result.ahead, changed, compareUrl: `https://github.com/${repo}/compare/${s.sha}...HEAD` });
  }
  return out;
}

export function repoCopies(repos, pluginSkills) {
  return repos.flatMap((r) => r.skills.filter((s) => pluginSkills.has(s.name)).map((s) => ({ repo: r.path, skill: s.name, plugin: pluginSkills.get(s.name), changed: s.changed })));
}

function fixFor(row, profile) {
  const prefix = `CLAUDE_CONFIG_DIR=~/${profile}`;
  if (row.status === "deprecated") return `${prefix} claude plugin uninstall ${row.plugin}   # then install its replacement`;
  if (row.status === "behind") return `${prefix} claude plugin update ${row.plugin}`;
  if (row.status === "not in catalog") return `${prefix} claude plugin uninstall ${row.plugin}   # its catalog no longer lists it`;
  return "";
}

export function formatReport(r) {
  const lines = [];
  const problems = r.stale.length + r.plugins.filter((p) => p.status !== "current").length + r.duplicates.length + r.pointers.length + r.copies.length + r.npm.length;
  lines.push(`cstack upkeep, ${new Date().toISOString().slice(0, 10)}. Accounts checked: ${r.profiles.map((p) => p.name).join(", ") || "none"}.`);
  if (!problems) {
    lines.push("Everything is current.");
    return lines.join("\n");
  }
  if (r.stale.length) {
    lines.push("", "Plugin catalogs not refreshed in over two weeks (new versions and deprecations go unseen):");
    for (const s of r.stale) lines.push(`- ${s.name} in ${s.profile}: ${s.days} days.  Fix: CLAUDE_CONFIG_DIR=~/${s.profile} claude plugin marketplace update ${s.name}`);
  }
  const off = r.plugins.filter((p) => p.status !== "current");
  if (off.length) {
    lines.push("", "Installed plugins that are behind, deprecated or no longer listed:");
    for (const p of off) lines.push(`- ${p.plugin} in ${p.profile}: ${p.status} (installed ${p.installed}${p.latest ? `, latest ${p.latest}` : ""})${p.note ? `. ${p.note.replace(/\.$/, "")}` : ""}.  Fix: ${fixFor(p, p.profile)}`);
  }
  if (r.duplicates.length) {
    lines.push("", "Project installs that load an older version than the main install:");
    for (const d of r.duplicates) lines.push(`- ${d.plugin} in ${d.profile}: main install ${d.main}, but ${d.projects} project install(s) still load ${d.others.join(", ")}. Update or remove them with claude plugin update or uninstall, using --scope project from that project.`);
  }
  if (r.pointers.length) {
    lines.push("", "Pinned cstack pointers whose picked skills changed upstream (read the changes, then update the pin in .claude-plugin/marketplace.json):");
    const shorten = (list) => (list.length > 5 ? `${list.slice(0, 5).join(", ")} and ${list.length - 5} more` : list.join(", "));
    for (const p of r.pointers) lines.push(`- ${p.plugin}: ${p.ahead} new commits; changed: ${shorten(p.changed)}. Review: ${p.compareUrl}`);
  }
  if (r.copies.length) {
    lines.push("", "Skills copied into a repository that a plugin already provides (both load, and the copy falls behind):");
    for (const c of r.copies) lines.push(`- ${c.skill} in ${c.repo}, last changed ${c.changed}; also in ${c.plugin}.`);
  }
  if (r.npm.length) {
    lines.push("", "Pinned tools with a newer release:");
    for (const n of r.npm) lines.push(`- ${n.name} in ${n.repo}: pinned ${n.pinned}, latest ${n.latest}.`);
  }
  return lines.join("\n");
}

// Everything below touches the machine or the network; the functions above are pure.

function catalogsFor(profileDir) {
  const known = readJson(join(profileDir, "plugins", "known_marketplaces.json"));
  const catalogs = {};
  for (const [name, m] of Object.entries(known)) {
    const file = join(m.installLocation ?? "", ".claude-plugin", "marketplace.json");
    catalogs[name] = existsSync(file) ? readJson(file).plugins ?? [] : [];
  }
  return { known, catalogs };
}

function pluginSkillNames(profileDir, installed) {
  const map = new Map();
  for (const [plugin, installs] of Object.entries(installed)) {
    for (const i of installs) {
      const dir = join(i.installPath ?? "", "skills");
      if (existsSync(dir)) for (const s of readdirSync(dir)) map.set(s, plugin);
    }
  }
  return map;
}

function repoSkills(path) {
  const dir = join(path, ".claude", "skills");
  if (!existsSync(dir)) return { path, skills: [] };
  return {
    path,
    skills: readdirSync(dir).map((name) => {
      let changed = "";
      try {
        changed = execFileSync("git", ["log", "-1", "--format=%cs", "--", join(".claude", "skills", name)], { cwd: path, encoding: "utf8" }).trim();
      } catch {}
      return { name, changed: changed || "not committed" };
    }),
  };
}

function ghCompare(repo, sha) {
  try {
    const out = execFileSync("gh", ["api", `repos/${repo}/compare/${sha}...HEAD`, "--jq", "{ahead: .ahead_by, files: [.files[].filename]}"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function npmPins(paths) {
  const out = [];
  for (const path of paths) {
    const file = join(path, "package.json");
    if (!existsSync(file)) continue;
    const pkg = readJson(file);
    for (const name of WATCHED_PACKAGES) {
      const pinned = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
      if (!pinned) continue;
      try {
        const latest = execFileSync("npm", ["view", name, "version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        if (latest && pinned.replace(/^[\^~]/, "") !== latest) out.push({ repo: path, name, pinned, latest });
      } catch {}
    }
  }
  return out;
}

async function main(argv) {
  const args = argv.slice(2);
  const repos = args.flatMap((a, i) => (args[i - 1] === "--repo" ? [a] : []));
  const configFile = join(homedir(), ".config", "cstack", "upkeep.json");
  if (existsSync(configFile)) repos.push(...(readJson(configFile).repos ?? []).map((r) => r.replace(/^~/, homedir())));
  const profiles = findProfiles();
  const report = { profiles, stale: [], plugins: [], duplicates: [], pointers: [], copies: [], npm: [] };
  const allPluginSkills = new Map();
  for (const p of profiles) {
    if (!args.includes("--no-refresh")) {
      try {
        execFileSync("claude", ["plugin", "marketplace", "update"], { env: { ...process.env, CLAUDE_CONFIG_DIR: p.dir }, stdio: "ignore", timeout: 120_000 });
      } catch {}
    }
    const { known, catalogs } = catalogsFor(p.dir);
    const installedFile = readJson(join(p.dir, "plugins", "installed_plugins.json"));
    const installed = installedFile.plugins ?? installedFile;
    report.stale.push(...staleCatalogs(known).map((s) => ({ ...s, profile: p.name })));
    report.plugins.push(...compareInstalled(installed, catalogs).map((r) => ({ ...r, profile: p.name })));
    report.duplicates.push(...duplicateInstalls(installed).map((d) => ({ ...d, profile: p.name })));
    for (const [k, v] of pluginSkillNames(p.dir, installed)) allPluginSkills.set(k, v);
  }
  const cstackRoot = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");
  const market = join(cstackRoot, ".claude-plugin", "marketplace.json");
  if (existsSync(market)) report.pointers = await pointerChanges(readJson(market).plugins, async (repo, sha) => ghCompare(repo, sha));
  report.copies = repoCopies([...new Set(repos)].map(repoSkills), allPluginSkills);
  report.npm = npmPins([...new Set(repos)]);
  console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : formatReport(report));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv).then((code) => process.exit(code));
