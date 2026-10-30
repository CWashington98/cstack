#!/usr/bin/env node
// Records and checks an evidence run for a live check.
// Usage:
//   node evidence.mjs start --app <name> [--root <repository root>]      prints the run folder
//   node evidence.mjs add <run> --kind <kind> [--feature <id>] [--trigger <file>] [--end <file>]
//        [--artifact <file>]... [--side-effects "none: <why>"] (--ok | --fail) [--note <text>]
//   node evidence.mjs finish <run> --status "<status>"
//   node evidence.mjs check <run> [--full-run] [--head <commit>] [--cover <features folder>] [--json]
//   node evidence.mjs publish --pr <number>   puts the newest run for the pull request's head
//        into its description, with the files on the verify-evidence branch
// Exit 0 passes, 1 the check fails or nothing was published, 2 wrong use.
import { resolve, join } from "node:path";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseArgs, UsageError } from "./lib/args.mjs";
import { startRun, addStep, finishRun, checkRun, newestRunFor, runFiles, proofSection, withSection, evidenceProtected, pushEvidence, evidenceUrl, EVIDENCE_BRANCH } from "./lib/evidence.mjs";
import { repoRoot } from "./verify-plan.mjs";

// Every check runs before anything is pushed or edited.
function publish(root, pr) {
  const fail = (m) => { console.error(`evidence: ${m}`); return 1; };
  if (evidenceProtected(root)) return fail(`the project lists ${EVIDENCE_BRANCH} in protectedBranches, so nothing was published.`);
  const view = JSON.parse(execFileSync("gh", ["pr", "view", pr, "--json", "headRefOid,body,url"], { cwd: root, encoding: "utf8" }));
  const head = view.headRefOid;
  const found = newestRunFor(root, head);
  if (!found) return fail(`no run matches the head ${head.slice(0, 7)} of pull request ${pr}. Run the live check on that commit, with nothing uncommitted, first. Nothing was published.`);
  const { files, outside, missing } = runFiles(found.dir, found.run);
  if (outside.length) return fail(`the run names files outside its folder: ${outside.join(", ")}. Nothing was published.`);
  if (missing.length) return fail(`the run's evidence is missing: ${missing.join(", ")}. Nothing was published.`);
  pushEvidence(root, { pr, head, dir: found.dir, files });
  const section = proofSection({ run: found.run, name: found.name, head, links: files.map((file) => ({ file, url: evidenceUrl(view.url, pr, head, file) })) });
  const tmp = mkdtempSync(join(tmpdir(), "verify-evidence-body-"));
  try {
    writeFileSync(join(tmp, "body.md"), withSection(view.body, section));
    execFileSync("gh", ["pr", "edit", pr, "--body-file", join(tmp, "body.md")], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  console.log(`Published ${files.length} file(s) from ${found.name} to pull request ${pr}.`);
  return 0;
}

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
    if (cmd === "publish") {
      if (!/^\d+$/.test(a.pr ?? "")) throw new UsageError("publish needs --pr <number>");
      return publish(repoRoot(process.cwd()), a.pr);
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
    throw new UsageError(`unknown command "${cmd ?? ""}". Use start, add, finish, check or publish.`);
  } catch (e) {
    console.error(`evidence: ${e.message}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv));
