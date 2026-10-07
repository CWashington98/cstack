#!/usr/bin/env node
// The cold reader: a separate Claude call that knows nothing about the
// project. It runs from an empty temporary folder with no settings,
// plugins, skills, tools or extra servers, and reports what it couldn't follow.
// Usage: node cold-read.mjs <file> [--model m] [--json]. Exit 0 passes, 1 fails, 2 error.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { htmlToText } from "../../../scripts/lib/text.mjs";
import { loadConfig } from "../../../scripts/lib/config.mjs";
import { READER_VERSION } from "./version.mjs";

const here = dirname(fileURLToPath(import.meta.url));

export function buildArgs(model) {
  const prompt = readFileSync(join(here, "..", "reader-prompt.md"), "utf8");
  return [
    "-p",
    "--model", model,
    "--setting-sources", "local",
    "--tools", "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--output-format", "text",
    "--system-prompt", prompt,
  ];
}

export function parseVerdict(stdout) {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end < start) return { pass: false, error: "The reader did not return JSON." };
  let v;
  try {
    v = JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return { pass: false, error: "The reader's JSON could not be read." };
  }
  const ok = Array.isArray(v.unclear_terms) && Array.isArray(v.missing_context) && typeof v.restatement === "string" && typeof v.ask === "string";
  if (!ok) return { pass: false, error: "The reader's JSON is missing fields." };
  return {
    readerVersion: READER_VERSION,
    pass: v.unclear_terms.length === 0 && v.missing_context.length === 0,
    unclear_terms: v.unclear_terms,
    missing_context: v.missing_context,
    restatement: v.restatement,
    ask: v.ask,
  };
}

function defaultRun({ args, cwd, input }) {
  return spawnSync("claude", args, { cwd, input, encoding: "utf8", timeout: 180_000 });
}

export function coldRead(text, { model = "sonnet", run = defaultRun } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "plain-reader-"));
  try {
    const result = run({ args: buildArgs(model), cwd, input: `Read this text and report as instructed.\n\n<text>\n${text}\n</text>` });
    if (result.status !== 0) return { pass: false, error: `The reader stopped with status ${result.status}: ${String(result.stderr ?? "").slice(0, 300)}` };
    return parseVerdict(String(result.stdout ?? ""));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function main(argv) {
  const args = argv.slice(2);
  const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--model");
  if (!file || !existsSync(file)) {
    console.error(`cold-read: file not found: ${file ?? "(none given)"}`);
    return 2;
  }
  const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : loadConfig(process.cwd()).readerModel;
  const raw = readFileSync(file, "utf8");
  const verdict = coldRead(file.endsWith(".html") ? htmlToText(raw) : raw, { model });
  if (args.includes("--json")) {
    console.log(JSON.stringify(verdict, null, 2));
  } else if (verdict.error) {
    console.log(`Error: ${verdict.error}`);
  } else {
    console.log(verdict.pass ? "Passes: the reader followed everything." : "Fails: the reader couldn't follow everything.");
    if (verdict.unclear_terms.length) console.log(`Unclear terms: ${verdict.unclear_terms.join(", ")}`);
    if (verdict.missing_context.length) console.log(`Missing context: ${verdict.missing_context.join("; ")}`);
    console.log(`What the reader thinks it says: ${verdict.restatement}`);
    console.log(`What the reader thinks it's asked to do: ${verdict.ask}`);
  }
  return verdict.error ? 2 : verdict.pass ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv));
