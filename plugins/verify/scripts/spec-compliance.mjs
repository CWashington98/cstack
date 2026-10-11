#!/usr/bin/env node
// Checks that a change does what its approved spec says.
// Usage: node spec-compliance.mjs <change-name> [--lane normal|high-risk] [--base <commit>]
// Writes compliance.json next to the evidence runs and prints a plain summary.
// Exit 0 proven, 1 held, 2 a settings problem or wrong use.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, UsageError } from "./lib/args.mjs";
import { git, gitOk, changeDir, readSettings, runCompliance, summarize } from "./lib/compliance.mjs";

function main(argv) {
  const say = (m) => console.error(`spec-compliance: ${m}`);
  let args;
  try { args = parseArgs(argv.slice(2)); } catch (e) {
    if (e instanceof UsageError) { say(e.message); return 2; }
    throw e;
  }
  const change = args._[0];
  if (!change) { say("name the change to check. Usage: spec-compliance.mjs <change-name> [--lane normal|high-risk] [--base <commit>]"); return 2; }
  const lane = args.lane ?? "normal";
  if (!["normal", "high-risk"].includes(lane)) { say(`--lane must be "normal" or "high-risk", got "${lane}".`); return 2; }
  const root = gitOk(process.cwd(), "rev-parse", "--show-toplevel")?.trim();
  if (!root) { say("run this inside the project's git repository."); return 2; }
  if (!existsSync(changeDir(root, change))) { say(`there is no change named "${change}" under openspec/changes/.`); return 2; }

  const settings = readSettings(root);
  let base = args.base;
  if (!base) {
    base = gitOk(root, "merge-base", "HEAD", settings.integrationBranch)?.trim();
    if (!base || base === git(root, "rev-parse", "HEAD").trim()) {
      say(`can't tell which commit the change started from. Pass --base <commit>.`);
      return 2;
    }
  }
  const resolved = gitOk(root, "rev-parse", "--verify", "--quiet", `${base}^{commit}`)?.trim();
  if (!resolved) { say(`--base ${base} is not a commit in this repository.`); return 2; }

  const report = runCompliance({ root, change, base: resolved, lane, settings });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const dir = join(root, ".verify", "runs", "spec-compliance", `${stamp}-${report.commit.slice(0, 7)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "compliance.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`Report: ${join(dir, "compliance.json")}`);
  console.log(summarize(report));
  return report.held ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv));
