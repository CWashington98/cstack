#!/usr/bin/env node
// Writes, checks and renders review verdicts tied to a commit.
// Usage:
//   node verdict.mjs patch-id --base <ref> [--head <ref>]
//   node verdict.mjs merge --report <json> --validation <json> --out <json>
//   node verdict.mjs write --reviewer <karen|codex|claude-fallback> --report <json> --meta <review meta.json>
//        [--head <ref>] [--base <ref>] [--model <name>] [--note <why a fallback>]
//        The verdict lands on the commit in meta.json; --head and --base must match it.
//   node verdict.mjs check --base <ref> [--head <ref>] [--json]
//   node verdict.mjs review --karen <verdict file> --other <verdict file> --writer <json>
//        Prints the one review comment, or each problem with the writer's text and exit 1.
//   node verdict.mjs items <comment file>
//        Prints the comment's work packets as JSON, one per item, for a fixer agent or the build loop.
// Exit 0 passes, 1 the check fails, 2 wrong use.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseArgs, UsageError } from "./lib/args.mjs";
import { patchId, writeVerdict, checkVerdicts, mergeValidation } from "./lib/verdict.mjs";
import { checkWriter, renderReview, extractItems } from "./lib/review-comment.mjs";

const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));

function main(argv) {
  const [cmd, ...rest] = argv.slice(2);
  const repo = process.cwd();
  try {
    const a = parseArgs(rest, { flags: ["json"] });
    const need = (...names) => { for (const n of names) if (!a[n]) throw new UsageError(`${cmd} needs --${n}`); };
    if (cmd === "patch-id") {
      need("base");
      const head = a.head ?? "HEAD";
      const mb = execFileSync("git", ["merge-base", a.base, head], { cwd: repo, encoding: "utf8" }).trim();
      console.log(patchId(repo, mb, head));
      return 0;
    }
    if (cmd === "merge") {
      need("report", "validation", "out");
      writeFileSync(a.out, JSON.stringify(mergeValidation(readJson(a.report), readJson(a.validation)), null, 2) + "\n");
      return 0;
    }
    if (cmd === "write") {
      need("reviewer", "report", "meta");
      const meta = readJson(a.meta);
      const head = a.head ? execFileSync("git", ["rev-parse", `${a.head}^{commit}`], { cwd: repo, encoding: "utf8" }).trim() : meta.head;
      if (head !== meta.head) throw new UsageError(`--head ${a.head} is not the reviewed commit ${meta.head} in ${a.meta}.`);
      if (a.base && a.base !== meta.base) throw new UsageError(`--base ${a.base} is not the reviewed base ${meta.base} in ${a.meta}.`);
      const { file, record } = writeVerdict(repo, { reviewer: a.reviewer, report: readJson(a.report), head, base: meta.base, meta, model: a.model ?? null, note: a.note ?? null });
      console.log(`${record.verdict}  ${file}`);
      return 0;
    }
    if (cmd === "check") {
      need("base");
      const r = checkVerdicts(repo, { base: a.base, head: a.head ?? "HEAD" });
      if (a.json) console.log(JSON.stringify(r, null, 2));
      else {
        for (const p of r.problems) console.log(`hold  ${p}`);
        const carried = [r.karen, r.other].filter((v) => v?.carriedFrom).map((v) => `${v.reviewer} carried over from ${v.carriedFrom.slice(0, 12)}`);
        console.log(r.ok ? `Passes: both reviewers say ready for ${r.head.slice(0, 12)}${carried.length ? ` (${carried.join("; ")}, identical change)` : ""}.` : `Held: ${r.problems.length} problem(s).`);
      }
      return r.ok ? 0 : 1;
    }
    if (cmd === "review") {
      need("karen", "other", "writer");
      const verdicts = { karen: readJson(a.karen), other: readJson(a.other) };
      const writer = readJson(a.writer);
      const problems = checkWriter(verdicts, writer);
      if (problems.length) {
        for (const p of problems) console.log(`hold  ${p}`);
        console.log(`Held: ${problems.length} problem(s) with the writer's text. Fix them and run review again.`);
        return 1;
      }
      process.stdout.write(renderReview({ ...verdicts, writer }));
      return 0;
    }
    if (cmd === "items") {
      if (!a._[0]) throw new UsageError("items needs a comment file");
      console.log(JSON.stringify(extractItems(readFileSync(a._[0], "utf8")), null, 2));
      return 0;
    }
    throw new UsageError(`unknown command "${cmd ?? ""}". Use patch-id, merge, write, check, review or items.`);
  } catch (e) {
    console.error(`verdict: ${e.message}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv));
