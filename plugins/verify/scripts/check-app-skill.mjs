#!/usr/bin/env node
// Checks that an app's verification skill is complete and honest: its sections,
// facts, feature map, and the test flows it relies on.
// Usage: node check-app-skill.mjs <skill folder> [--repo <repository root>] [--json]
// Exit 0 passes, 1 held, 2 folder not found or wrong use.
import { existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, UsageError } from "./lib/args.mjs";
import { checkAppSkill, checkRepoSettings } from "./lib/app-skill.mjs";
import { repoRoot } from "./verify-plan.mjs";

function main(argv) {
  let args;
  try { args = parseArgs(argv.slice(2), { flags: ["json"] }); } catch (e) {
    if (e instanceof UsageError) { console.error(`check-app-skill: ${e.message}`); return 2; }
    throw e;
  }
  const dir = args._[0] && resolve(args._[0]);
  if (!dir || !existsSync(dir)) {
    console.error(`check-app-skill: folder not found: ${args._[0] ?? "(none given)"}`);
    return 2;
  }
  const repo = resolve(args.repo ?? repoRoot(dir));
  const r = checkAppSkill(dir, repo);
  const findings = [...r.findings, ...checkRepoSettings(repo)];
  if (args.json) console.log(JSON.stringify({ dir, ...r, findings }, null, 2));
  else {
    for (const f of findings) console.log(`${relative(process.cwd(), f.file)}${f.line ? `:${f.line}` : ""}  hold  ${f.message}`);
    const counted = `${r.features} feature file(s) and ${r.flows} flow or replay file(s) checked`;
    console.log(findings.length ? `Held: ${findings.length} problem(s) to fix; ${counted}.` : `Passes: ${counted}.`);
  }
  return findings.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv));
