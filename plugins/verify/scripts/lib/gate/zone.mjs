import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORDER = ["low", "standard", "high"];

// "**/" matches any folders (or none), "**" any text, "*" and "?" stay inside one folder.
export function globToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") { out += "(?:.*/)?"; i += 2; } else { out += ".*"; i += 1; }
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

export const matchesAny = (path, globs = []) => globs.some((g) => globToRegExp(g).test(path));

// Zone from the changed paths only. The body is accepted and ignored on purpose.
export function classifyZone(paths, settings, _pullRequest = {}) {
  const lists = settings.zone ?? {};
  let zone = "low";
  for (const path of paths) {
    const own = ["high", "standard", "low"].find((name) => matchesAny(path, lists[name])) ?? "standard";
    if (ORDER.indexOf(own) > ORDER.indexOf(zone)) zone = own;
  }
  const neverMerge = paths.filter((path) => matchesAny(path, settings.neverMerge));
  return { zone: paths.length ? zone : "standard", neverMerge, source: "patterns" };
}

const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" });

// The zone command comes from the trunk commit, so it only runs in a clean checkout of it.
export function runZoneCommand(command, paths, { cwd, trunk }) {
  const here = git(cwd, "rev-parse", "HEAD");
  const there = git(cwd, "rev-parse", `${trunk}^{commit}`);
  if (here.status !== 0 || there.status !== 0) return { zone: null, problem: "can't read the trunk commit to run the zone command" };
  if (here.stdout.trim() !== there.stdout.trim()) return { zone: null, problem: "zone command not run: the main checkout is not on the trunk commit" };
  const status = git(cwd, "status", "--porcelain", "--untracked-files=no");
  if (status.status !== 0 || status.stdout.trim()) return { zone: null, problem: "zone command not run: the main checkout has local changes to tracked files" };
  const dir = mkdtempSync(join(tmpdir(), "factory-zone-"));
  try {
    const file = join(dir, "paths.json");
    writeFileSync(file, JSON.stringify(paths));
    const run = spawnSync(`${command} '${file}'`, { cwd, shell: true, encoding: "utf8" });
    if (run.status !== 0) return { zone: null, problem: `zone command failed: ${(run.stderr || `exit ${run.status}`).trim().slice(0, 200)}` };
    let zone;
    try { zone = JSON.parse(run.stdout).zone; } catch { zone = null; }
    if (!ORDER.includes(zone)) return { zone: null, problem: "zone command printed no valid zone" };
    return { zone, source: "command" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function zoneFor(paths, settings, { cwd, trunk, body } = {}) {
  const patterns = classifyZone(paths, settings, { body });
  if (!settings.zone?.command) return patterns;
  const result = runZoneCommand(settings.zone.command, paths, { cwd, trunk });
  return { ...patterns, ...result };
}
