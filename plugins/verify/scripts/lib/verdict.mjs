// Review verdicts, tied to the exact commit and to a fingerprint of the change, so a
// verdict counts only for the code being merged. Only findings a separate check
// reproduced can make a verdict "not ready".
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const git = (repo, args, input) => execFileSync("git", args, { cwd: repo, encoding: "utf8", input, maxBuffer: 1 << 30 });
const rev = (repo, ref) => git(repo, ["rev-parse", `${ref}^{commit}`]).trim();
const short = (sha) => sha.slice(0, 12);

export const REVIEWERS = ["claims-auditor", "codex", "claude-fallback"];
export const NAMES = { "claims-auditor": "Claims auditor (Claude)", codex: "Codex (OpenAI)", "claude-fallback": "Fallback reviewer (Claude, standing in for Codex)" };
// The claims auditor used to be called karen. Verdicts written before the rename are
// stored as <commit>.karen.json with reviewer "karen"; read them as the claims auditor's
// so they keep counting. New verdicts are never written under the old name.
const OLD_NAMES = { karen: "claims-auditor" };
export const currentName = (v) => (v && OLD_NAMES[v.reviewer] ? { ...v, reviewer: OLD_NAMES[v.reviewer] } : v);

export function patchId(repo, from, to) {
  const diff = git(repo, ["diff", from, to]);
  if (!diff.trim()) return "empty";
  // --verbatim keeps whitespace, so re-indenting YAML, Python or a Makefile is a new change.
  return git(repo, ["patch-id", "--verbatim"], diff).trim().split(/\s+/)[0];
}

export function validateReport(r) {
  const problems = [];
  if (!["ready", "not ready"].includes(r?.verdict)) problems.push(`verdict must be "ready" or "not ready", got ${JSON.stringify(r?.verdict)}.`);
  if (typeof r?.summary !== "string" || !r.summary.trim()) problems.push("summary is missing.");
  if (!Array.isArray(r?.findings)) problems.push("findings must be a list (empty when there are none).");
  for (const [i, f] of (r?.findings ?? []).entries()) {
    const n = f.id ?? `#${i + 1}`;
    if (!f.claim) problems.push(`finding ${n} has no claim.`);
    if (!["blocking", "decide", "note"].includes(f.severity)) problems.push(`finding ${n}: severity must be "blocking", "decide" or "note".`);
    if (typeof f.reproduced !== "boolean") problems.push(`finding ${n} has no reproduction result. A separate check must try to reproduce every finding before the verdict is recorded.`);
    if (f.reproduced === true && !f.reproduction) problems.push(`finding ${n} is marked reproduced but does not say how.`);
    if (f.touches !== undefined && !(Array.isArray(f.touches) && f.touches.every((t) => typeof t === "string"))) problems.push(`finding ${n}: touches must be a list of file paths.`);
    if (f.done_when !== undefined && typeof f.done_when !== "string") problems.push(`finding ${n}: done_when must be text.`);
  }
  if (r?.merge_risk !== undefined && !["low", "medium", "high"].includes(r.merge_risk?.level)) problems.push("merge_risk.level must be low, medium or high.");
  return problems;
}

// Only "blocking" findings the separate check reproduced make a verdict "not ready".
// "decide" findings go to the owner as questions; "note" findings are worth fixing later.
export function effectiveVerdict(r) {
  const blocking = r.findings.filter((f) => f.severity === "blocking" && f.reproduced === true);
  const dropped = r.findings.filter((f) => f.reproduced === false);
  return { verdict: blocking.length ? "not ready" : "ready", blocking, dropped };
}

export function mergeValidation(report, validation) {
  const byId = new Map(validation.map((v) => [v.id, v]));
  return { ...report, findings: report.findings.map((f) => (byId.has(f.id) ? { ...f, reproduced: byId.get(f.id).reproduced, reproduction: byId.get(f.id).reproduction } : f)) };
}

export const verdictDir = (repo) => join(resolve(repo, git(repo, ["rev-parse", "--git-common-dir"]).trim()), "verify", "verdicts");

// head is the full ID of the reviewed commit, never a moving name like HEAD, so a commit made
// while the review ran can't inherit its verdict. meta is review-prep's meta.json.
export function writeVerdict(repo, { reviewer, report, head, base, model = null, note = null, meta = null, now = new Date() }) {
  if (!REVIEWERS.includes(reviewer)) throw new Error(`reviewer must be one of: ${REVIEWERS.join(", ")}`);
  if (reviewer === "claude-fallback" && !note) throw new Error("a fallback reviewer must say why Codex could not review (--note).");
  if (!/^[0-9a-f]{40}$/.test(head ?? "")) throw new Error(`the verdict must name the reviewed commit by its full commit ID, got ${JSON.stringify(head ?? null)}. Take it from the review's meta.json.`);
  if (meta && meta.head !== head) throw new Error(`commit ${short(head)} does not match the reviewed commit ${short(meta.head ?? "")} in meta.json.`);
  const problems = validateReport(report);
  if (problems.length) throw new Error(problems.join("\n"));
  const headSha = rev(repo, head);
  const mergeBase = git(repo, ["merge-base", base, headSha]).trim();
  const pid = patchId(repo, mergeBase, headSha);
  if (meta?.patchId && meta.patchId !== pid) throw new Error(`the change from ${short(mergeBase)} to ${short(headSha)} does not match the reviewed change in meta.json. Review it again.`);
  const eff = effectiveVerdict(report);
  const record = { reviewer, model, note, head: headSha, base, mergeBase, patchId: pid, said: report.verdict, verdict: eff.verdict, summary: report.summary, findings: report.findings, date: now.toISOString() };
  // What the change does, its merge risk and what was and wasn't checked feed the review comment.
  for (const k of ["what_it_does", "merge_risk", "checked", "not_checked"]) if (report[k] !== undefined) record[k] = report[k];
  const dir = verdictDir(repo);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${headSha}.${reviewer}.json`);
  writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
  return { file, record };
}

export function checkVerdicts(repo, { base, head = "HEAD" }) {
  const headSha = rev(repo, head);
  const mergeBase = git(repo, ["merge-base", base, headSha]).trim();
  const pid = patchId(repo, mergeBase, headSha);
  const dir = verdictDir(repo);
  const all = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => currentName(JSON.parse(readFileSync(join(dir, f), "utf8")))) : [];
  const newest = (list) => list.sort((a, b) => a.date.localeCompare(b.date)).at(-1) ?? null;
  // An exact verdict for this commit, from any acceptable reviewer, beats one carried over
  // from an identical change. Within each group the newest wins.
  const pick = (names) => {
    const mine = all.filter((v) => names.includes(v.reviewer));
    const exact = newest(mine.filter((v) => v.head === headSha));
    if (exact) return exact;
    const carried = newest(mine.filter((v) => pid !== "empty" && v.patchId === pid));
    return carried ? { ...carried, carriedFrom: carried.head } : null;
  };
  const claimsAuditor = pick(["claims-auditor"]);
  const other = pick(["codex", "claude-fallback"]);
  const problems = [];
  if (!claimsAuditor) problems.push(`No verdict from the claims auditor for commit ${short(headSha)}. A new commit clears earlier verdicts unless the change is identical.`);
  if (!other) problems.push(`No verdict from Codex, or from a fallback reviewer standing in for it, for commit ${short(headSha)}.`);
  if (claimsAuditor && other) {
    if (claimsAuditor.verdict !== other.verdict) problems.push(`The reviewers disagree: the claims auditor says "${claimsAuditor.verdict}" and ${NAMES[other.reviewer]} says "${other.verdict}". The owner decides.`);
    else if (claimsAuditor.verdict !== "ready") problems.push("Both reviewers say not ready.");
  }
  return { ok: problems.length === 0, problems, head: headSha, patchId: pid, claimsAuditor, other };
}
