// Evidence runs: one folder per live check, with a run.json that records each step,
// so anyone can check later that the proof was real, complete and still there.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, realpathSync, mkdtempSync, rmSync, cpSync } from "node:fs";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import { tmpdir } from "node:os";
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
  // Untracked files count: an app can run code that was never committed. Only the
  // evidence folder itself is left out.
  const dirty = (git(root, "status", "--porcelain", "--untracked-files=all", "--", ".", ":(exclude).verify") ?? "") !== "";
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

// The backticked IDs listed under a feature file's "## Sub-features" heading.
export function subFeatureIds(file) {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
  const section = text.split(/^## /m).find((s) => s.startsWith("Sub-features")) ?? "";
  return [...section.matchAll(/^\s*[-*]\s+`([a-z0-9-]+)`/gm)].map((m) => m[1]);
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
    // A step names a feature by its file ("create-note"), as "create-note/create-save",
    // or by a sub-feature ID the file lists ("create-save"). A sub-feature ID that two
    // files list counts for neither, because it can't say which path was driven.
    const subs = new Map(ids.map((id) => [id, subFeatureIds(join(cover, `${id}.md`))]));
    const owners = new Map();
    for (const [id, list] of subs) for (const sub of new Set(list)) owners.set(sub, [...(owners.get(sub) ?? []), id]);
    const counted = steps.filter((s) => (s.kind === "drive" && s.ok) || s.kind === "unreachable");
    const covered = ids.filter((id) => counted.some((s) =>
      s.feature === id || s.feature?.startsWith(`${id}/`) || (subs.get(id).includes(s.feature) && owners.get(s.feature).length === 1)));
    for (const name of new Set(counted.map((s) => s.feature))) {
      const files = owners.get(name);
      if (files?.length > 1 && !ids.includes(name)) problems.push(`"${name}" is listed by more than one feature file (${files.join(", ")}). Record it as ${files.map((f) => `${f}/${name}`).join(" or ")}.`);
    }
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
  if (run.status) throw new Error(`this run is already finished as "${run.status}". A finished run is final; start a new one.`);
  run.status = status;
  run.finishedAt = now.toISOString();
  if (status === "verified live") {
    const { problems } = rules(run, dir, { fullRun: true });
    if (problems.length) throw new Error(`cannot mark it "verified live":\n- ${problems.join("\n- ")}`);
  }
  save(dir, run);
  return run;
}

// ---- Publishing a run's evidence to a pull request ----
// Files go to an orphan branch that holds only evidence, so they never mix with the code.

export const EVIDENCE_BRANCH = "verify-evidence";
export const SECTION_START = "<!-- verify-evidence:start -->";
export const SECTION_END = "<!-- verify-evidence:end -->";

// The newest finished run for a commit, or null.
export function newestRunFor(root, head) {
  const runsDir = join(root, ".verify", "runs");
  if (!existsSync(runsDir)) return null;
  const found = [];
  for (const app of readdirSync(runsDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const r of readdirSync(join(runsDir, app.name), { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const dir = join(runsDir, app.name, r.name);
      if (!existsSync(join(dir, "run.json"))) continue;
      let run;
      try { run = load(dir); } catch { continue; }
      if (run.commit === head && run.status) found.push({ dir, run, name: `${app.name}/${r.name}` });
    }
  }
  const when = (x) => `${x.run.finishedAt ?? x.run.startedAt ?? ""} ${x.name}`;
  return found.sort((a, b) => when(a).localeCompare(when(b))).at(-1) ?? null;
}

// Every file the run names, and any that resolve outside its folder, following links.
export function runFiles(dir, run) {
  const top = realpathSync(dir);
  const inside = (p) => { const rel = relative(top, p); return rel && !rel.startsWith("..") && !isAbsolute(rel); };
  const names = [...new Set(run.steps.flatMap((s) => [s.trigger, s.end, ...(s.artifacts ?? [])]).filter(Boolean))];
  const outside = names.filter((f) => isAbsolute(f) || !inside(resolve(top, f)) || (existsSync(join(top, f)) && !inside(realpathSync(join(top, f)))));
  const missing = names.filter((f) => !outside.includes(f) && !existsSync(join(top, f)));
  return { files: names.filter((f) => !outside.includes(f) && !missing.includes(f)), outside, missing };
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;

export function proofSection({ run, name, head, links }) {
  const lines = [SECTION_START, "## Proof it works", "", `**${run.status}** on commit \`${head.slice(0, 7)}\`, from the run \`${name}\`.`, ""];
  for (const { file, url } of links) lines.push(IMAGE.test(file) ? `![${file}](${url})` : `- [${file}](${url})`);
  if (!links.length) lines.push("The run saved no screenshots or recordings.");
  lines.push(SECTION_END);
  return lines.join("\n");
}

// The description with the section put in place of the old one, or added at the end.
export function withSection(body, section) {
  const text = body ?? "";
  const start = text.indexOf(SECTION_START);
  const end = text.indexOf(SECTION_END, start);
  if (start !== -1 && end !== -1) return text.slice(0, start) + section + text.slice(end + SECTION_END.length);
  return `${text.replace(/\s*$/, "")}${text.trim() ? "\n\n" : ""}${section}\n`;
}

export function evidenceProtected(root) {
  const local = join(root, ".claude", "verify.json");
  const common = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
  const file = existsSync(local) ? local : common && join(dirname(common), ".claude", "verify.json");
  if (!file || !existsSync(file)) return false;
  const listed = JSON.parse(readFileSync(file, "utf8")).protectedBranches ?? [];
  return [listed].flat().includes(EVIDENCE_BRANCH);
}

const sh = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const bot = ["-c", "user.name=verify-evidence", "-c", "user.email=verify-evidence@localhost"];

// Copies the files to pr-<n>/<head>/ on the evidence branch and pushes only that branch.
export function pushEvidence(root, { pr, head, dir, files }) {
  const tmp = mkdtempSync(join(tmpdir(), "verify-evidence-"));
  const scratch = `verify-evidence-${process.pid}-${Date.now()}`;
  let orphan = false;
  try {
    let existing = true;
    try { sh(root, "fetch", "-q", "origin", `+refs/heads/${EVIDENCE_BRANCH}:refs/remotes/origin/${EVIDENCE_BRANCH}`); } catch { existing = false; }
    if (existing) sh(root, "worktree", "add", "-q", "--detach", tmp, `refs/remotes/origin/${EVIDENCE_BRANCH}`);
    else {
      sh(root, "worktree", "add", "-q", "--detach", tmp, "HEAD");
      sh(tmp, "checkout", "-q", "--orphan", scratch);
      orphan = true;
      sh(tmp, "rm", "-rqf", "--ignore-unmatch", ".");
      sh(tmp, "clean", "-fdxq");
    }
    const dest = join(tmp, `pr-${pr}`, head);
    rmSync(dest, { recursive: true, force: true });
    for (const f of files) {
      mkdirSync(dirname(join(dest, f)), { recursive: true });
      cpSync(join(dir, f), join(dest, f));
    }
    sh(tmp, "add", "-A");
    sh(tmp, ...bot, "commit", "-qm", `evidence for pull request ${pr} at ${head.slice(0, 7)}`, "--allow-empty");
    sh(tmp, "push", "-q", "origin", `HEAD:refs/heads/${EVIDENCE_BRANCH}`);
  } finally {
    try { sh(root, "worktree", "remove", "--force", tmp); } catch { rmSync(tmp, { recursive: true, force: true }); sh(root, "worktree", "prune"); }
    if (orphan) try { sh(root, "branch", "-D", scratch); } catch { /* never made */ }
  }
}

export const evidenceUrl = (prUrl, pr, head, file) =>
  `${prUrl.replace(/\/pull\/\d+.*$/, "")}/blob/${EVIDENCE_BRANCH}/pr-${pr}/${head}/${file.split("/").map(encodeURIComponent).join("/")}?raw=true`;
