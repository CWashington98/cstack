#!/usr/bin/env node
// Reports every diagram's stamp and age: unstamped, remove?, stale, lagging or current.
// Usage: node diagram-age.mjs [--today YYYY-MM-DD] [--validate <file.svg>] [--changes]
// Exit 1 when a diagram is unstamped, a validation is refused, or --changes finds a hold.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig, repoRoot } from "./lib/config.mjs";
import { checkAll, checkChanges, formatReport, validate } from "./lib/diagram-age.mjs";

const realToday = () => new Date().toLocaleDateString("en-CA");

function main(argv) {
  const args = argv.slice(2);
  const after = (flag) => args[args.indexOf(flag) + 1];
  const today = args.includes("--today") ? after("--today") : realToday();
  const root = repoRoot(process.cwd()) ?? process.cwd();
  const config = loadConfig(process.cwd());

  if (args.includes("--validate")) {
    const result = validate(resolve(after("--validate") ?? ""), today, config);
    console.log(result.lines.join("\n"));
    return result.ok ? 0 : 1;
  }
  if (args.includes("--changes")) {
    const holds = checkChanges(root, config);
    console.log(holds.length ? holds.join("\n") : "Every open change has a stamped diagram that design.md shows.");
    return holds.length ? 1 : 0;
  }
  const findings = checkAll(root, today, config);
  if (findings.length) console.log(findings.map(formatReport).join("\n"));
  else console.log("No diagrams found.");
  return findings.some((f) => f.state === "unstamped") ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv));
