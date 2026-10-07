#!/usr/bin/env node
// Scores the cold reader against its labeled test set (evals/evals.json).
// Each reader flag goes to the first label whose pattern matches. A fair label
// with a flag is caught; a noise label with a flag is noise the reader raised.
// Flags that match no label are counted as unlabeled, for a person to label.
// Usage: PLAIN_LIVE=1 node score.mjs [--only name,name] [--model m] [--json out.json]
// It calls the model once per case, so it only runs with PLAIN_LIVE=1.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { coldRead } from "./cold-read.mjs";
import { htmlToText } from "../../../scripts/lib/text.mjs";
import { READER_VERSION } from "./version.mjs";

const skillDir = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadEvals(dir = skillDir) {
  const { evals } = JSON.parse(readFileSync(join(dir, "evals", "evals.json"), "utf8"));
  return evals.map((e) => ({
    ...e,
    text: e.files
      .map((f) => {
        const raw = readFileSync(join(dir, f), "utf8");
        return f.endsWith(".html") ? htmlToText(raw) : raw;
      })
      .join("\n\n"),
  }));
}

export function assignFlags(labels, flags) {
  const patterns = labels.map((l) => ({ label: l.label, res: l.match.map((m) => new RegExp(m, "i")) }));
  const byLabel = new Map(labels.map((l) => [l.label, []]));
  const unlabeled = [];
  for (const flag of flags) {
    const hit = patterns.find((p) => p.res.some((re) => re.test(flag)));
    if (hit) byLabel.get(hit.label).push(flag);
    else unlabeled.push(flag);
  }
  return { byLabel, unlabeled };
}

export function scoreCase(evalCase, verdict) {
  const fair = evalCase.labels.filter((l) => l.verdict === "fair");
  const noise = evalCase.labels.filter((l) => l.verdict === "noise");
  const base = { name: evalCase.name, expectPass: evalCase.expect_pass, fairTotal: fair.length, noiseTotal: noise.length };
  if (verdict.error) {
    return { ...base, error: verdict.error, pass: null, fairCaught: 0, fairMissed: fair.map((l) => l.label), noiseRaised: 0, noiseFlags: [], unlabeled: [], restatement: false, verdictRight: false };
  }
  const { byLabel, unlabeled } = assignFlags(evalCase.labels, [...verdict.unclear_terms, ...verdict.missing_context]);
  const fairMissed = fair.filter((l) => byLabel.get(l.label).length === 0).map((l) => l.label);
  const noiseFlags = noise.filter((l) => byLabel.get(l.label).length > 0).map((l) => l.label);
  return {
    ...base,
    pass: verdict.pass,
    fairCaught: fair.length - fairMissed.length,
    fairMissed,
    noiseRaised: noiseFlags.length,
    noiseFlags,
    unlabeled,
    restatement: typeof verdict.restatement === "string" && verdict.restatement.trim().length > 0,
    verdictRight: verdict.pass === evalCase.expect_pass,
  };
}

export function scoreAll(evals, { run, model = "sonnet", only } = {}) {
  const chosen = only?.length ? evals.filter((e) => only.includes(e.name)) : evals;
  const results = chosen.map((e) => scoreCase(e, coldRead(e.text, run ? { model, run } : { model })));
  const sum = (key) => results.reduce((n, r) => n + r[key], 0);
  const totals = {
    cases: results.length,
    fairCaught: sum("fairCaught"),
    fairTotal: sum("fairTotal"),
    noiseRaised: sum("noiseRaised"),
    noiseTotal: sum("noiseTotal"),
    unlabeled: results.reduce((n, r) => n + r.unlabeled.length, 0),
    restatements: results.filter((r) => r.restatement).length,
    verdictsRight: results.filter((r) => r.verdictRight).length,
    errors: results.filter((r) => r.error).length,
  };
  return { results, totals };
}

const word = (pass) => (pass === null ? "error" : pass ? "pass" : "fail");

export function formatTable(results, totals) {
  const rows = [["Case", "Expected", "Got", "Fair caught", "Noise raised", "Unlabeled", "Restatement"]];
  for (const r of results) {
    rows.push([r.name, word(r.expectPass), word(r.pass), `${r.fairCaught}/${r.fairTotal}`, `${r.noiseRaised}/${r.noiseTotal}`, String(r.unlabeled.length), r.restatement ? "yes" : "no"]);
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)));
  const line = (row) => `| ${row.map((cell, i) => cell.padEnd(widths[i])).join(" | ")} |`;
  const out = [line(rows[0]), `|${widths.map((w) => "-".repeat(w + 2)).join("|")}|`, ...rows.slice(1).map(line), ""];
  out.push(`Fair flags caught: ${totals.fairCaught} of ${totals.fairTotal}`);
  out.push(`Noise flags raised: ${totals.noiseRaised} of ${totals.noiseTotal}`);
  out.push(`Verdicts right: ${totals.verdictsRight} of ${totals.cases}`);
  out.push(`Restatements present: ${totals.restatements} of ${totals.cases}`);
  out.push(`Unlabeled flags: ${totals.unlabeled}`);
  if (totals.errors) out.push(`Reader errors: ${totals.errors}`);
  const details = results.filter((r) => r.error || r.fairMissed.length || r.noiseFlags.length || r.unlabeled.length);
  if (details.length) out.push("", "Details:");
  for (const r of details) {
    if (r.error) out.push(`- ${r.name}: reader error: ${r.error}`);
    if (!r.error && r.fairMissed.length) out.push(`- ${r.name}: missed ${r.fairMissed.join("; ")}`);
    if (r.noiseFlags.length) out.push(`- ${r.name}: raised noise ${r.noiseFlags.join("; ")}`);
    if (r.unlabeled.length) out.push(`- ${r.name}: unlabeled ${r.unlabeled.join("; ")}`);
  }
  return out.join("\n");
}

function main(argv) {
  if (process.env.PLAIN_LIVE !== "1") {
    console.error("score: this calls the model once per case. Run it with PLAIN_LIVE=1.");
    return 2;
  }
  const args = argv.slice(2);
  const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const only = value("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
  const { results, totals } = scoreAll(loadEvals(), { model: value("--model") ?? "sonnet", only });
  console.log(`Cold reader version ${READER_VERSION}\n`);
  console.log(formatTable(results, totals));
  const jsonOut = value("--json");
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ readerVersion: READER_VERSION, totals, results }, null, 2));
  return totals.errors ? 2 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv));
