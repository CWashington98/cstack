#!/usr/bin/env node
// Records and checks an evidence run for a live check.
// Usage:
//   node evidence.mjs start --app <name> [--root <repository root>]      prints the run folder
//   node evidence.mjs add <run> --kind <kind> [--feature <id>] [--trigger <file>] [--end <file>]
//        [--artifact <file>]... [--side-effects "none: <why>"] (--ok | --fail) [--note <text>]
//   node evidence.mjs finish <run> --status "<status>"
//   node evidence.mjs check <run> [--full-run] [--head <commit>] [--cover <features folder>] [--json]
// Exit 0 passes, 1 the check fails, 2 wrong use.
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseArgs, UsageError } from "./lib/args.mjs";
import { startRun, addStep, finishRun, checkRun } from "./lib/evidence.mjs";
import { repoRoot } from "./verify-plan.mjs";

function main(argv) {
  const [cmd, ...rest] = argv.slice(2);
  let a;
  try {
    a = parseArgs(rest, { flags: ["ok", "fail", "full-run", "json"], lists: ["artifact"] });
    if (cmd === "start") {
      if (!a.app) throw new UsageError("start needs --app <name>");
      console.log(startRun(resolve(a.root ?? repoRoot(process.cwd())), a.app));
      return 0;
    }
    const dir = a._[0] && resolve(a._[0]);
    if (!dir) throw new UsageError(`${cmd ?? "a command"} needs a run folder`);
    if (cmd === "add") {
      if (a.ok === a.fail) throw new UsageError("say --ok or --fail");
      addStep(dir, { kind: a.kind, feature: a.feature, trigger: a.trigger, end: a.end, artifacts: a.artifact ?? [], sideEffects: a["side-effects"], ok: Boolean(a.ok), note: a.note ?? "" });
      return 0;
    }
    if (cmd === "finish") {
      finishRun(dir, a.status);
      console.log(`Finished: ${a.status}.`);
      return 0;
    }
    if (cmd === "check") {
      const head = a.head && execFileSync("git", ["rev-parse", a.head], { cwd: dir, encoding: "utf8" }).trim();
      const r = checkRun(dir, { fullRun: Boolean(a["full-run"]), head, cover: a.cover && resolve(a.cover) });
      if (a.json) console.log(JSON.stringify(r, null, 2));
      else {
        for (const p of r.problems) console.log(`hold  ${p}`);
        const cov = r.coverage ? `, covered ${r.coverage.covered} of ${r.coverage.total} features` : "";
        const steps = r.run ? `${r.run.steps.length} step(s), status ${r.run.status ?? "(not finished)"}` : "no run";
        console.log(r.problems.length ? `Held: ${r.problems.length} problem(s); ${steps}${cov}.` : `Passes: ${steps}${cov}.`);
      }
      return r.problems.length ? 1 : 0;
    }
    throw new UsageError(`unknown command "${cmd ?? ""}". Use start, add, finish or check.`);
  } catch (e) {
    console.error(`evidence: ${e.message}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv));
