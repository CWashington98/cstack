#!/usr/bin/env node
// Checks that a spec or plan names its evidence.
// Usage: node verify-plan.mjs <file> [--since <git ref>] [--json]
// Exit 0 passes, 1 held, 2 file not found or wrong use.
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseArgs, UsageError } from "./lib/args.mjs";
import { checkFile } from "./lib/plan.mjs";

export function repoRoot(dir) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return dir;
  }
}

function main(argv) {
  let args;
  try { args = parseArgs(argv.slice(2), { flags: ["json"] }); } catch (e) {
    if (e instanceof UsageError) { console.error(`verify-plan: ${e.message}`); return 2; }
    throw e;
  }
  const file = args._[0] && resolve(args._[0]);
  if (!file || !existsSync(file)) {
    console.error(`verify-plan: file not found: ${args._[0] ?? "(none given)"}`);
    return 2;
  }
  let r;
  try { r = checkFile(readFileSync(file, "utf8"), { file, root: repoRoot(dirname(file)), since: args.since }); } catch (e) {
    if (e instanceof UsageError) { console.error(`verify-plan: ${e.message}`); return 2; }
    throw e;
  }
  if (args.json) console.log(JSON.stringify({ file, ...r }, null, 2));
  else {
    for (const f of r.findings) console.log(`line ${f.line}  ${f.level.padEnd(6)}  ${f.message}`);
    const counted = `${r.scenarios} scenario(s) and ${r.items} plan item(s) checked`;
    console.log(r.held ? `Held: ${r.findings.length} problem(s) to fix; ${counted}.` : `Passes: ${counted}; each names its evidence.`);
  }
  return r.held ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv));
