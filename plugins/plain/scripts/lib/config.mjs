// Reads a repository's plain settings and glossary. A repository opts in by
// having .claude/plain.json (shared) or .claude/plain.local.json (personal).
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_WATCH = ["docs/superpowers/specs", "docs/superpowers/plans", "openspec/changes"];

export function repoRoot(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export function parseGlossary(markdown) {
  const terms = [];
  let current = null;
  for (const line of markdown.split(/\r?\n/)) {
    const term = line.match(/^\*\*(.+?)\*\*:?\s*$/);
    if (term) {
      current = { term: term[1].trim(), avoid: [] };
      terms.push(current);
      continue;
    }
    const avoid = line.match(/^_Avoid_:\s*(.+)$/i);
    if (avoid && current) current.avoid.push(...avoid[1].split(",").map((s) => s.trim()).filter(Boolean));
  }
  return terms;
}

function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

export function loadConfig(cwd) {
  const root = repoRoot(cwd) ?? cwd;
  const shared = readJson(join(root, ".claude", "plain.json"));
  const personal = readJson(join(root, ".claude", "plain.local.json"));
  const defaults = JSON.parse(readFileSync(join(here, "..", "data", "common-words.json"), "utf8"));
  const glossary = [join(root, "GLOSSARY.md"), join(root, ".claude", "GLOSSARY.local.md")]
    .filter(existsSync)
    .flatMap((p) => parseGlossary(readFileSync(p, "utf8")));
  const common = new Set(defaults);
  const neverPublish = {};
  let watchFolders = null;
  let readerModel = null;
  for (const settings of [shared, personal]) {
    if (!settings) continue;
    for (const w of settings.commonWords ?? []) common.add(w);
    Object.assign(neverPublish, settings.neverPublish ?? {});
    if (settings.watchFolders) watchFolders = settings.watchFolders;
    if (settings.readerModel) readerModel = settings.readerModel;
  }
  return {
    root,
    enabled: Boolean(shared || personal),
    common,
    neverPublish,
    watchFolders: watchFolders ?? DEFAULT_WATCH,
    readerModel: readerModel ?? "sonnet",
    glossary,
  };
}
