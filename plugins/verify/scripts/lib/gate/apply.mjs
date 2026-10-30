// `verify gate <pr> --apply`: sets a pull request's draft state and its description's first line
// from the gate's call. It never merges, closes or pushes.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const LEAD = "**What you need to do:**";
export const STUCK_AFTER = 3;

// The heads of this pull request the gate called not ready with a fix reason, from its own records.
export function fixRounds(cwd, pr) {
  const common = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd, encoding: "utf8" });
  if (common.status !== 0) return 0;
  const dir = join(resolve(cwd, common.stdout.trim()), "verify", "gate");
  if (!existsSync(dir)) return 0;
  const heads = new Set();
  for (const f of readdirSync(dir).filter((n) => n.startsWith(`${pr}-`) && n.endsWith(".json"))) {
    try {
      const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (String(r.pr) === String(pr) && r.call !== "ready" && (r.reasons ?? []).some((x) => x.kind === "fix")) heads.add(r.head);
    } catch { /* an unreadable record is not a round */ }
  }
  return heads.size;
}

// On the third fix round every remaining reason becomes one owner question.
export function stuckReasons(reasons) {
  const list = reasons.map((r) => (r.kind === "owner" ? r.question ?? r.text : r.text).replace(/[.\s]+$/, "")).join("; ");
  const question = `Three fix rounds didn't clear: ${list}. How do you want to handle it?`;
  return [{ kind: "owner", text: question, question }];
}

export function ownerLine(questions) {
  if (questions.length === 1) return `${LEAD} answer this: ${questions[0]}`;
  return `${LEAD} answer these: ${questions.map((q, i) => `(${i + 1}) ${q}`).join(" ")}`;
}

// The description with `line` as its first line, replacing an earlier "What you need to do" line.
export function withFirstLine(body, line) {
  const lines = (body ?? "").split("\n");
  if (lines[0].startsWith(LEAD)) return [line, ...lines.slice(1)].join("\n");
  return `${line}\n\n${body ?? ""}`;
}

const gh = (cwd, args) => {
  const r = spawnSync("gh", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`gh ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
};

function setDescription(cwd, pr, body) {
  const tmp = mkdtempSync(join(tmpdir(), "verify-gate-body-"));
  try {
    writeFileSync(join(tmp, "body.md"), body);
    gh(cwd, ["pr", "edit", String(pr), "--body-file", join(tmp, "body.md")]);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// The description without an earlier "What you need to do" line, so a draft never says "review and merge".
export function withoutFirstLine(body) {
  const lines = (body ?? "").split("\n");
  if (!lines[0].startsWith(LEAD)) return body ?? "";
  return lines.slice(1).join("\n").replace(/^\n/, "");
}

// Returns the lines to print: what it did, then what the agent does next.
export function applyResult(cwd, pr, result) {
  const view = JSON.parse(gh(cwd, ["pr", "view", String(pr), "--json", "isDraft,body"]));
  let reasons = result.reasons;
  if (!result.ready && reasons.some((r) => r.kind === "fix") && fixRounds(cwd, pr) >= STUCK_AFTER) reasons = stuckReasons(reasons);
  const toDraft = () => { if (!view.isDraft) gh(cwd, ["pr", "ready", String(pr), "--undo"]); };
  const done = [];
  if (result.ready) {
    if (view.isDraft) gh(cwd, ["pr", "ready", String(pr)]);
    setDescription(cwd, pr, withFirstLine(view.body, `${LEAD} review and merge.`));
    done.push("Marked ready for review. Next: tell the owner it is ready to merge. Don't merge it yourself.");
  } else if (reasons.every((r) => r.kind === "owner")) {
    toDraft();
    setDescription(cwd, pr, withFirstLine(view.body, ownerLine(reasons.map((r) => r.question ?? r.text))));
    done.push("Kept as a draft and asked the owner. Next: stop and wait for the owner's answer.");
    for (const r of reasons) done.push(`owner - ${r.question ?? r.text}`);
  } else {
    toDraft();
    if ((view.body ?? "").startsWith(LEAD)) setDescription(cwd, pr, withoutFirstLine(view.body));
    const waiting = reasons.every((r) => r.kind !== "fix");
    done.push(waiting
      ? "Kept as a draft. Next: wait for the checks to finish, then run verify gate --apply again."
      : "Kept as a draft. Next: fix these, push, publish proof, and run verify gate --apply again. Owner questions wait until the fixes are done.");
    for (const r of reasons) done.push(`${r.kind} - ${r.kind === "owner" ? r.question ?? r.text : r.text}`);
  }
  return done.join("\n");
}
