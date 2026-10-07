#!/usr/bin/env node
// Checks that bytes an app served are exactly a stored source file, by comparing
// sha256 fingerprints. An empty list, an empty body or any unmatched body fails.
// Usage: node match-bytes.mjs --source <file>... (--body <file>... | --hash <hex>...) [--json]
// Exit 0 every body matches, 1 something doesn't, 2 wrong use.
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs, UsageError } from "./lib/args.mjs";

export const fingerprint = (buf) => createHash("sha256").update(buf).digest("hex");

export function matchBytes({ sources = [], bodies = [], hashes = [] }) {
  const problems = [];
  if (!sources.length) problems.push("no source files given (--source).");
  const known = new Map();
  for (const f of sources) {
    if (!existsSync(f)) { problems.push(`source ${f} does not exist.`); continue; }
    known.set(fingerprint(readFileSync(f)), f);
  }
  const items = [];
  for (const f of bodies) {
    if (!existsSync(f)) { problems.push(`body ${f} does not exist.`); continue; }
    const b = readFileSync(f);
    items.push({ label: f, size: b.length, hash: b.length ? fingerprint(b) : null });
  }
  for (const h of hashes) items.push({ label: `fingerprint ${h.slice(0, 12)}`, size: null, hash: h.toLowerCase() });
  if (!items.length) problems.push("nothing to compare: no bodies or fingerprints given. An empty comparison is a failure, not a pass.");
  const rows = items.map((it) => ({ ...it, match: it.hash ? known.get(it.hash) ?? null : null }));
  for (const r of rows) {
    if (r.size === 0) problems.push(`${r.label} is empty.`);
    else if (!r.match) problems.push(`${r.label} matches no source file. The app served bytes that are not a stored file.`);
  }
  return { rows, problems, matched: rows.filter((r) => r.match).length };
}

function main(argv) {
  let a;
  try { a = parseArgs(argv.slice(2), { flags: ["json"], lists: ["source", "body", "hash"] }); } catch (e) {
    if (e instanceof UsageError) { console.error(`match-bytes: ${e.message}`); return 2; }
    throw e;
  }
  const r = matchBytes({ sources: a.source ?? [], bodies: a.body ?? [], hashes: a.hash ?? [] });
  if (a.json) console.log(JSON.stringify(r, null, 2));
  else {
    for (const row of r.rows) console.log(`${row.match ? "match   " : "NO MATCH"}  ${row.label}${row.match ? `  =  ${row.match}` : ""}`);
    for (const p of r.problems) console.log(`hold  ${p}`);
    console.log(r.problems.length ? `Held: ${r.matched} of ${r.rows.length} served file(s) match a stored file.` : `Passes: ${r.matched} of ${r.rows.length} served file(s) match a stored file.`);
  }
  return r.problems.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv));
