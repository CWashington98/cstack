#!/usr/bin/env node
// Checks a file against the plain writing rules.
// Usage: node plain-check.mjs <file> [--json]. Exit 0 passes, 1 held, 2 file not found.
import { readFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./lib/config.mjs";
import { prepare } from "./lib/text.mjs";
import { checkText } from "./lib/rules.mjs";

export function checkString(raw, name, cwd, config = loadConfig(cwd)) {
  const findings = checkText(prepare(raw, name), config);
  return { findings, held: findings.some((f) => f.level === "hold") };
}

export function formatFindings(findings) {
  return findings.map((f) => `line ${f.line}  ${f.level.padEnd(6)}  ${f.message}`).join("\n");
}

function main(argv) {
  const args = argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file || !existsSync(file)) {
    console.error(`plain-check: file not found: ${file ?? "(none given)"}`);
    return 2;
  }
  const { findings, held } = checkString(readFileSync(file, "utf8"), file, process.cwd());
  if (args.includes("--json")) {
    console.log(JSON.stringify({ file, held, findings }, null, 2));
  } else {
    if (findings.length) console.log(formatFindings(findings));
    const holds = findings.filter((f) => f.level === "hold").length;
    const advice = findings.length - holds;
    console.log(held ? `Held: ${holds} problem(s) to fix, ${advice} piece(s) of advice.` : `Passes: no problems to fix${advice ? `, ${advice} piece(s) of advice` : ""}.`);
  }
  return held ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv));
