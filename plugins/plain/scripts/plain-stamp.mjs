#!/usr/bin/env node
// Pass stamps: proof that an exact text passed the checker and the cold reader.
// A stamp counts only under the current checker and reader versions. For a
// spec or plan in a watched folder, the reader's flags are advice: the reader
// must have run, but it doesn't have to pass.
// Stored in the repository's shared git folder, so they are never committed
// and every worktree sees them.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync, appendFileSync, realpathSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { CHECKER_VERSION } from "./lib/version.mjs";
import { checkString } from "./plain-check.mjs";
import { loadConfig } from "./lib/config.mjs";
import { READER_VERSION } from "../skills/cold-reader/scripts/version.mjs";

export function fingerprint(text) {
  const normal = text.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  return createHash("sha256").update(normal).digest("hex");
}

export function plainDir(cwd) {
  try {
    const common = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return join(resolve(cwd, common), "plain");
  } catch {
    return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "plain");
  }
}

export function writeStamp(cwd, text, verdict) {
  const dir = join(plainDir(cwd), "stamps");
  mkdirSync(dir, { recursive: true });
  const fp = fingerprint(text);
  writeFileSync(join(dir, `${fp}.json`), JSON.stringify({ fingerprint: fp, checkerVersion: CHECKER_VERSION, readerVersion: READER_VERSION, reader: verdict, at: new Date().toISOString() }, null, 2));
  return fp;
}

// "none" when this exact text was never stamped, "stale" when it was stamped
// under an older checker or reader version, "current" otherwise.
export function stampStatus(cwd, text) {
  const path = join(plainDir(cwd), "stamps", `${fingerprint(text)}.json`);
  if (!existsSync(path)) return "none";
  try {
    const stamp = JSON.parse(readFileSync(path, "utf8"));
    return stamp.checkerVersion === CHECKER_VERSION && stamp.readerVersion === READER_VERSION ? "current" : "stale";
  } catch {
    return "none";
  }
}

export const hasStamp = (cwd, text) => stampStatus(cwd, text) === "current";

function appendLog(cwd, name, entry) {
  const dir = plainDir(cwd);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, name), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
}

export function isWatchedSpec(cwd, file) {
  const config = loadConfig(cwd);
  const full = resolve(cwd, file);
  const rel = relative(config.root, existsSync(full) ? realpathSync(full) : full).split("\\").join("/");
  return config.watchFolders.some((w) => rel.startsWith(w.replace(/\/$/, "") + "/"));
}

export const logOverride = (cwd, entry) => appendLog(cwd, "overrides.log", entry);
export const logError = (cwd, error) => appendLog(cwd, "errors.log", { error: String(error?.stack ?? error) });

function main(argv) {
  const [command, file, ...rest] = argv.slice(2);
  if (!file || !existsSync(file)) {
    console.error(`plain-stamp: file not found: ${file ?? "(none given)"}`);
    return 1;
  }
  const text = readFileSync(file, "utf8");
  if (command === "has") return hasStamp(process.cwd(), text) ? 0 : 1;
  if (command !== "write") {
    console.error("Usage: plain-stamp.mjs write <file> --verdict <verdict.json> | has <file>");
    return 1;
  }
  const verdictPath = rest[rest.indexOf("--verdict") + 1];
  if (!rest.includes("--verdict") || !verdictPath || !existsSync(verdictPath)) {
    console.error("plain-stamp: --verdict <file> is required (the cold reader's JSON output).");
    return 1;
  }
  if (checkString(text, file, process.cwd()).held) {
    console.error("plain-stamp: the checker still holds this text. Fix it first.");
    return 1;
  }
  const verdict = JSON.parse(readFileSync(verdictPath, "utf8"));
  if (verdict.readerVersion !== READER_VERSION) {
    console.error(`plain-stamp: this verdict was made by an older version of the cold reader (${verdict.readerVersion ?? "none"}, now ${READER_VERSION}). Run the cold reader again.`);
    return 1;
  }
  if (verdict.error || !Array.isArray(verdict.unclear_terms) || !Array.isArray(verdict.missing_context)) {
    console.error(`plain-stamp: the cold reader didn't run properly${verdict.error ? `: ${verdict.error}` : "."} Run it again.`);
    return 1;
  }
  const advice = verdict.pass !== true && isWatchedSpec(process.cwd(), file);
  if (verdict.pass !== true && !advice) {
    console.error("plain-stamp: the cold reader did not pass this text.");
    return 1;
  }
  const fp = writeStamp(process.cwd(), text, verdict).slice(0, 12);
  console.log(advice ? `Stamped ${file} (${fp}). The reader's flags were advice, because this is a spec or plan.` : `Stamped ${file} (${fp}).`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv));
