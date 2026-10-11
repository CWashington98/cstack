#!/usr/bin/env node
// Writes the spec-match reviewer's result into a spec compliance record: how many
// scenarios it marked "partly" or "missing", and how long the reviewer took.
// Usage: node record-review.mjs --spec-match <spec-match.json> --report <compliance.json> [--time-ms <n>]
// Exit 0 written, 2 wrong use or an answer with no scenario verdicts.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, UsageError } from "./lib/args.mjs";

export function countMismatches(review) {
  if (!Array.isArray(review?.scenarios) || !review.scenarios.length) throw new UsageError("the spec-match answer has no scenario verdicts");
  return review.scenarios.filter((s) => s.verdict === "partly" || s.verdict === "missing").length;
}

export function record({ specMatch, report, timeMs = null }) {
  const mismatches = countMismatches(JSON.parse(readFileSync(specMatch, "utf8")));
  const saved = JSON.parse(readFileSync(report, "utf8"));
  saved.reviewer = { ...saved.reviewer, mismatches, timeMs };
  delete saved.reviewer.note;
  writeFileSync(report, JSON.stringify(saved, null, 2) + "\n");
  return saved.reviewer;
}

function main(argv) {
  try {
    const a = parseArgs(argv.slice(2));
    if (!a["spec-match"] || !a.report) throw new UsageError("needs --spec-match <spec-match.json> and --report <compliance.json>");
    const timeMs = a["time-ms"] === undefined ? null : Number(a["time-ms"]);
    if (timeMs !== null && !Number.isFinite(timeMs)) throw new UsageError("--time-ms must be a number of milliseconds");
    const r = record({ specMatch: resolve(a["spec-match"]), report: resolve(a.report), timeMs });
    console.log(`record-review: ${r.mismatches} scenario(s) marked partly or missing${r.timeMs === null ? "" : `, reviewer took ${r.timeMs} ms`}.`);
    return 0;
  } catch (e) {
    console.error(`record-review: ${e.message}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv));
