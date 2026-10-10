#!/usr/bin/env node
// Builds what reviewers see: the change since the branch point, the spec, the pull
// request description, and one private copy of the code per reviewer. Each copy has
// two commits, "base" and "change under review", so no author reasoning travels with it.
// Usage: node review-prep.mjs --base <ref> [--head <ref>] [--spec <file>]... [--pr-body <file>]
//        [--copies claims-auditor,codex,validator] --out <folder>
//        node review-prep.mjs --remove <folder>
// Exit 0 done, 2 wrong use.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, copyFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, UsageError } from "./lib/args.mjs";
import { patchId } from "./lib/verdict.mjs";

const identity = { GIT_AUTHOR_NAME: "review", GIT_AUTHOR_EMAIL: "review@localhost", GIT_COMMITTER_NAME: "review", GIT_COMMITTER_EMAIL: "review@localhost" };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 30, env: { ...process.env, ...identity } });

function unpack(repo, rev, dest) {
  const tar = execFileSync("git", ["-C", repo, "archive", "--format=tar", rev], { maxBuffer: 2 ** 31 });
  execFileSync("tar", ["-x", "-C", dest], { input: tar });
}

export function makeCopy(repo, mergeBase, head, dest) {
  mkdirSync(dest, { recursive: true });
  git(dest, "init", "-q");
  unpack(repo, mergeBase, dest);
  git(dest, "add", "-A");
  git(dest, "commit", "-qm", "base", "--allow-empty");
  git(dest, "rm", "-rq", "--ignore-unmatch", ".");
  unpack(repo, head, dest);
  git(dest, "add", "-A");
  git(dest, "commit", "-qm", "change under review", "--allow-empty");
}

export function prepare({ repo, base, head = "HEAD", specs = [], prBody = null, copies = ["claims-auditor", "codex", "validator"], out }) {
  if (existsSync(out) && readdirSync(out).length) throw new Error(`${out} already has files. Use a new folder for each review.`);
  const headSha = git(repo, "rev-parse", `${head}^{commit}`).trim();
  const mergeBase = git(repo, "merge-base", base, headSha).trim();
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "change.patch"), git(repo, "diff", mergeBase, headSha));
  writeFileSync(join(out, "files.txt"), git(repo, "diff", "--name-status", mergeBase, headSha));
  if (specs.length) {
    mkdirSync(join(out, "spec"), { recursive: true });
    for (const s of specs) copyFileSync(s, join(out, "spec", basename(s)));
  }
  if (prBody) copyFileSync(prBody, join(out, "pr.md"));
  const meta = { base, mergeBase, head: headSha, patchId: patchId(repo, mergeBase, headSha), copies: {} };
  for (const name of copies) {
    const dest = join(out, name, "repo");
    makeCopy(repo, mergeBase, headSha, dest);
    meta.copies[name] = dest;
  }
  writeFileSync(join(out, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
  return meta;
}

function main(argv) {
  try {
    const a = parseArgs(argv.slice(2), { lists: ["spec"] });
    if (a.remove) { rmSync(resolve(a.remove), { recursive: true, force: true }); return 0; }
    if (!a.base || !a.out) throw new UsageError("needs --base <ref> and --out <folder>");
    const meta = prepare({
      repo: process.cwd(), base: a.base, head: a.head ?? "HEAD",
      specs: (a.spec ?? []).map((s) => resolve(s)), prBody: a["pr-body"] ? resolve(a["pr-body"]) : null,
      copies: (a.copies ?? "claims-auditor,codex,validator").split(",").map((s) => s.trim()).filter(Boolean),
      out: resolve(a.out),
    });
    console.log(JSON.stringify(meta, null, 2));
    return 0;
  } catch (e) {
    console.error(`review-prep: ${e.message}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv));
