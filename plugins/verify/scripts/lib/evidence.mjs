// Evidence runs: one folder per live check, with a run.json that records each step,
// so anyone can check later that the proof was real, complete and still there.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export const STATUSES = ["verified live", "verified by tests", "type check only", "blocked", "failed"];
export const KINDS = ["start", "health", "drive", "readback", "unreachable", "cleanup", "tests"];

const git = (dir, ...args) => {
  try { return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
};
const short = (sha) => (sha ? sha.slice(0, 12) : "(none)");
export const load = (dir) => JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
const save = (dir, run) => writeFileSync(join(dir, "run.json"), JSON.stringify(run, null, 2) + "\n");

export function startRun(root, app, now = new Date()) {
  if (!/^[a-z0-9-]+$/.test(app)) throw new Error(`the app name must be lowercase letters, digits and dashes, got "${app}"`);
  const commit = git(root, "rev-parse", "HEAD");
  const dirty = (git(root, "status", "--porcelain", "--untracked-files=no") ?? "") !== "";
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const dir = join(root, ".verify", "runs", app, `${stamp}-${(commit ?? "nocommit").slice(0, 7)}`);
  mkdirSync(dir, { recursive: true });
  save(dir, { version: 1, app, commit, dirty, startedAt: now.toISOString(), steps: [], status: null, finishedAt: null });
  return dir;
}

export function addStep(dir, { kind, feature = null, trigger = null, end = null, artifacts = [], sideEffects = null, ok, note = "" }, now = new Date()) {
  if (!KINDS.includes(kind)) throw new Error(`the kind must be one of: ${KINDS.join(", ")}`);
  if (typeof ok !== "boolean") throw new Error("say whether the step worked: --ok or --fail");
  if (["drive", "readback", "unreachable"].includes(kind) && !feature) throw new Error(`a ${kind} step needs --feature <id>`);
  if (kind === "unreachable" && !note.trim()) throw new Error("an unreachable step needs --note naming the missing prerequisite and the route tried");
  for (const f of [trigger, end, ...artifacts].filter(Boolean)) {
    if (!existsSync(join(dir, f))) throw new Error(`${f} is not in the run folder. Save evidence inside ${dir} and name it relative to that folder.`);
  }
  const run = load(dir);
  if (run.status) throw new Error("this run is finished; start a new one");
  run.steps.push({ kind, feature, trigger, end, artifacts, sideEffects, ok, note, at: now.toISOString() });
  save(dir, run);
  return run;
}

function rules(run, dir, { fullRun = false, head = null, cover = null } = {}) {
  const problems = [];
  const steps = run.steps;
  steps.forEach((s, i) => {
    for (const f of [s.trigger, s.end, ...(s.artifacts ?? [])].filter(Boolean)) {
      if (!existsSync(join(dir, f))) problems.push(`missing evidence: ${f} (step ${i + 1}). Clean-up must never delete evidence.`);
    }
  });
  let healthy = false;
  let sawHealth = false;
  steps.forEach((s, i) => {
    if (s.kind === "health") { healthy = s.ok; sawHealth = true; return; }
    if (s.kind === "drive" && !healthy) {
      problems.push(sawHealth
        ? `step ${i + 1} drove ${s.feature} after a failed step without a new passing health check.`
        : `step ${i + 1} drove ${s.feature} without a passing health check first.`);
    }
    if (!s.ok) healthy = false;
  });
  steps.forEach((s, i) => {
    if (s.kind !== "drive" || !s.ok) return;
    if (!s.trigger || !s.end) problems.push(`step ${i + 1} drove ${s.feature} but has no ${s.trigger ? "end-state" : "trigger"} evidence. Show the action and the result it caused.`);
    const noEffects = typeof s.sideEffects === "string" && /^none\s*[:—-]\s*\S/i.test(s.sideEffects);
    const readBack = steps.slice(i + 1).some((r) => r.kind === "readback" && r.ok && r.feature === s.feature);
    if (!noEffects && !readBack) problems.push(`step ${i + 1} drove ${s.feature} but nothing read back its side effects. Add a readback step, or --side-effects "none: <why>".`);
  });
  const okDrive = steps.some((s) => s.kind === "drive" && s.ok);
  if (run.status === "verified live") {
    if (!okDrive) problems.push(`"verified live" needs at least one successful drive.`);
    const bad = steps.filter((s) => !s.ok && ["drive", "readback"].includes(s.kind)).length;
    if (bad) problems.push(`"verified live" with ${bad} failed drive or read-back step(s). The status is "failed".`);
  }
  if (fullRun) {
    for (const k of ["start", "health", "cleanup"]) if (!steps.some((s) => s.kind === k && s.ok)) problems.push(`a full run needs a successful ${k} step.`);
    if (!okDrive) problems.push("a full run needs at least one successful drive.");
    const lastWork = Math.max(steps.findLastIndex((s) => s.kind === "drive"), steps.findLastIndex((s) => s.kind === "readback"));
    if (steps.findLastIndex((s) => s.kind === "cleanup") < lastWork) problems.push("clean-up ran before the last drive. Clean up after the last drive, then check the evidence survived.");
    if (!run.status) problems.push("the run has no final status. Finish it with: evidence.mjs finish <run> --status <status>.");
  }
  if (head) {
    if (run.dirty) problems.push("the run was recorded on a working copy with uncommitted changes, so it proves no commit.");
    if (run.commit !== head) problems.push(`stale: this evidence is from commit ${short(run.commit)}, but the code under review is ${short(head)}.`);
  }
  let coverage = null;
  if (cover) {
    const ids = existsSync(cover) ? readdirSync(cover).filter((f) => f.endsWith(".md") && f !== "README.md").map((f) => f.slice(0, -3)) : [];
    if (!ids.length) problems.push(`${cover} lists no features, so coverage can't be counted.`);
    const covered = ids.filter((id) => steps.some((s) => ((s.kind === "drive" && s.ok) || s.kind === "unreachable") && (s.feature === id || s.feature?.startsWith(`${id}/`))));
    for (const id of ids) if (!covered.includes(id)) problems.push(`feature ${id} was not driven and not reported unreachable.`);
    coverage = { covered: covered.length, total: ids.length };
  }
  return { problems, coverage };
}

export function checkRun(dir, opts = {}) {
  if (!existsSync(join(dir, "run.json"))) {
    return { problems: [`${dir} holds no run.json. The run folder is gone or was never started; clean-up must never delete evidence.`], run: null, coverage: null };
  }
  const run = load(dir);
  return { ...rules(run, dir, opts), run };
}

export function finishRun(dir, status, now = new Date()) {
  if (!STATUSES.includes(status)) throw new Error(`the status must be one of: ${STATUSES.join(", ")}`);
  const run = load(dir);
  run.status = status;
  run.finishedAt = now.toISOString();
  if (status === "verified live") {
    const { problems } = rules(run, dir, { fullRun: true });
    if (problems.length) throw new Error(`cannot mark it "verified live":\n- ${problems.join("\n- ")}`);
  }
  save(dir, run);
  return run;
}
