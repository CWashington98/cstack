// Review verdicts, tied to the exact commit and to a fingerprint of the change, so a
// verdict counts only for the code being merged. Only findings a separate check
// reproduced can make a verdict "not ready".
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const git = (repo, args, input) => execFileSync("git", args, { cwd: repo, encoding: "utf8", input, maxBuffer: 1 << 30 });
const rev = (repo, ref) => git(repo, ["rev-parse", `${ref}^{commit}`]).trim();
const short = (sha) => sha.slice(0, 12);

export const REVIEWERS = ["karen", "codex", "claude-fallback"];
export const NAMES = { karen: "Karen (Claude)", codex: "Codex (OpenAI)", "claude-fallback": "Fallback reviewer (Claude, standing in for Codex)" };

export function patchId(repo, from, to) {
  const diff = git(repo, ["diff", from, to]);
  if (!diff.trim()) return "empty";
  return git(repo, ["patch-id", "--stable"], diff).trim().split(/\s+/)[0];
}

export function validateReport(r) {
  const problems = [];
  if (!["ready", "not ready"].includes(r?.verdict)) problems.push(`verdict must be "ready" or "not ready", got ${JSON.stringify(r?.verdict)}.`);
  if (typeof r?.summary !== "string" || !r.summary.trim()) problems.push("summary is missing.");
  if (!Array.isArray(r?.findings)) problems.push("findings must be a list (empty when there are none).");
  for (const [i, f] of (r?.findings ?? []).entries()) {
    const n = f.id ?? `#${i + 1}`;
    if (!f.claim) problems.push(`finding ${n} has no claim.`);
    if (!["blocking", "note"].includes(f.severity)) problems.push(`finding ${n}: severity must be "blocking" or "note".`);
    if (typeof f.reproduced !== "boolean") problems.push(`finding ${n} has no reproduction result. A separate check must try to reproduce every finding before the verdict is recorded.`);
    if (f.reproduced === true && !f.reproduction) problems.push(`finding ${n} is marked reproduced but does not say how.`);
  }
  return problems;
}

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

export function writeVerdict(repo, { reviewer, report, head = "HEAD", base, model = null, note = null }) {
  if (!REVIEWERS.includes(reviewer)) throw new Error(`reviewer must be one of: ${REVIEWERS.join(", ")}`);
  if (reviewer === "claude-fallback" && !note) throw new Error("a fallback reviewer must say why Codex could not review (--note).");
  const problems = validateReport(report);
  if (problems.length) throw new Error(problems.join("\n"));
  const headSha = rev(repo, head);
  const mergeBase = git(repo, ["merge-base", base, headSha]).trim();
  const eff = effectiveVerdict(report);
  const record = { reviewer, model, note, head: headSha, base, mergeBase, patchId: patchId(repo, mergeBase, headSha), said: report.verdict, verdict: eff.verdict, summary: report.summary, findings: report.findings, date: new Date().toISOString() };
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
  const all = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8"))) : [];
  const newest = (list) => list.sort((a, b) => a.date.localeCompare(b.date)).at(-1) ?? null;
  const pick = (names) => {
    for (const name of names) {
      const exact = newest(all.filter((v) => v.reviewer === name && v.head === headSha));
      if (exact) return exact;
      const carried = newest(all.filter((v) => v.reviewer === name && pid !== "empty" && v.patchId === pid));
      if (carried) return { ...carried, carriedFrom: carried.head };
    }
    return null;
  };
  const karen = pick(["karen"]);
  const other = pick(["codex", "claude-fallback"]);
  const problems = [];
  if (!karen) problems.push(`No verdict from Karen for commit ${short(headSha)}. A new commit clears earlier verdicts unless the change is identical.`);
  if (!other) problems.push(`No verdict from Codex, or from a fallback reviewer standing in for it, for commit ${short(headSha)}.`);
  if (karen && other) {
    if (karen.verdict !== other.verdict) problems.push(`The reviewers disagree: Karen says "${karen.verdict}" and ${NAMES[other.reviewer]} says "${other.verdict}". The owner decides.`);
    else if (karen.verdict === "not ready") problems.push("Both reviewers say not ready.");
  }
  return { ok: problems.length === 0, problems, head: headSha, patchId: pid, karen, other };
}

export function renderComment(v) {
  const list = (items) => items.map((f) => `- ${f.claim}${f.file ? ` (\`${f.file}${f.line ? `:${f.line}` : ""}\`)` : ""}${f.reproduction ? `. Checked: ${f.reproduction}` : ""}`);
  const blocking = v.findings.filter((f) => f.severity === "blocking" && f.reproduced === true);
  const notes = v.findings.filter((f) => f.severity === "note" && f.reproduced === true);
  const dropped = v.findings.filter((f) => f.reproduced === false);
  const out = [
    `<!-- verify-verdict reviewer=${v.reviewer} head=${v.head} patch-id=${v.patchId} -->`,
    `## ${NAMES[v.reviewer]}: ${v.verdict}`,
    "",
    `For commit \`${short(v.head)}\`. A new commit clears this verdict, unless a rebase leaves the change identical.`,
    "",
    v.summary,
  ];
  if (v.note) out.push("", `Why a fallback reviewer: ${v.note}`);
  if (v.said !== v.verdict) out.push("", `The reviewer said "${v.said}". Only findings a separate check reproduced count, so the verdict is "${v.verdict}".`);
  if (blocking.length) out.push("", "### Must fix before merge", ...list(blocking));
  if (notes.length) out.push("", "### Notes", ...list(notes));
  if (dropped.length) out.push("", "### Dropped, because a separate check could not reproduce them", ...list(dropped));
  return out.join("\n") + "\n";
}
