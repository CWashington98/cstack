import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { matchesAny, zoneFor } from "./zone.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const run = (command, args, options = {}) => spawnSync(command, args, { encoding: "utf8", maxBuffer: 1 << 28, ...options });
const git = (cwd, ...args) => run("git", args, { cwd });
const lines = (text) => text.split("\n").map((l) => l.trim()).filter(Boolean);

function parseJson(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}

// The verify plugin's scripts folder: CSTACK_VERIFY, then the sibling folder, then the newest installed copy.
export function findVerifyScripts(env = process.env) {
  const hasScripts = (dir) => dir && existsSync(join(dir, "verdict.mjs")) && existsSync(join(dir, "evidence.mjs"));
  const candidates = [];
  if (env.CSTACK_VERIFY) candidates.push(env.CSTACK_VERIFY, join(env.CSTACK_VERIFY, "scripts"));
  candidates.push(resolve(here, "..", "..", "..", "verify", "scripts"));
  for (const dir of candidates) if (hasScripts(dir)) return dir;
  const home = env.HOME ?? "";
  try {
    for (const entry of readdirSync(home).filter((n) => n.startsWith(".claude")).sort()) {
      const cache = join(home, entry, "plugins", "cache", "cstack", "verify");
      if (!existsSync(cache)) continue;
      const versions = readdirSync(cache).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      for (const version of versions.reverse()) if (hasScripts(join(cache, version, "scripts"))) return join(cache, version, "scripts");
    }
  } catch { /* no home folder to look in */ }
  return null;
}

// "green", "pending", "red", or "none" when GitHub reports no checks at all.
export function summarizeChecks(rollup) {
  if (!Array.isArray(rollup) || rollup.length === 0) return "none";
  let pending = false;
  for (const check of rollup) {
    const state = String(check.conclusion || check.state || "").toUpperCase();
    const status = String(check.status || "").toUpperCase();
    if (status && status !== "COMPLETED") pending = true;
    else if (["PENDING", "EXPECTED", ""].includes(state)) pending = true;
    else if (!["SUCCESS", "NEUTRAL", "SKIPPED"].includes(state)) return "red";
  }
  return pending ? "pending" : "green";
}

export function countLines(files, settings) {
  let codeLines = 0, ignoredLines = 0;
  for (const file of files) {
    const n = (Number(file.additions) || 0) + (Number(file.deletions) || 0);
    if (matchesAny(file.path, settings.notCounted)) ignoredLines += n; else codeLines += n;
  }
  return { codeLines, ignoredLines };
}


function worktrees(cwd) {
  const result = git(cwd, "worktree", "list", "--porcelain");
  if (result.status !== 0) return [cwd];
  const paths = lines(result.stdout).filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9));
  return paths.length ? paths : [cwd];
}

const subfolders = (dir) => { try { return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };

// Evidence runs for the head commit, found in every worktree. Needs "verified live" and verify's own check.
function liveProofFor(cwd, head, verify) {
  for (const tree of worktrees(cwd)) {
    const root = join(tree, ".verify", "runs");
    for (const app of subfolders(root).filter((n) => n !== "spec-compliance")) {
      for (const name of subfolders(join(root, app))) {
        const dir = join(root, app, name);
        const record = parseJson(existsSync(join(dir, "run.json")) ? readFileSync(join(dir, "run.json"), "utf8") : "");
        if (record?.commit !== head || record.status !== "verified live") continue;
        if (run("node", [join(verify, "evidence.mjs"), "check", dir, "--full-run", "--head", head], { cwd: tree }).status === 0) return "verified live";
      }
    }
  }
  return null;
}

// The newest compliance report for this change and head, from any worktree.
function complianceFor(cwd, head, change) {
  const found = [];
  for (const tree of worktrees(cwd)) {
    const root = join(tree, ".verify", "runs", "spec-compliance");
    for (const name of subfolders(root)) {
      const report = parseJson(existsSync(join(root, name, "compliance.json")) ? readFileSync(join(root, name, "compliance.json"), "utf8") : "");
      if (report && report.commit === head && report.change === change) found.push({ name, report });
    }
  }
  const newest = found.sort((a, b) => a.name.localeCompare(b.name)).at(-1);
  return newest ? { ok: newest.report.held === false } : null;
}

// Reads the world. Anything it can't read goes in `missing`, and the gate holds on it.
export function collectFacts({ cwd, pr, settings, env = process.env }) {
  const missing = [];
  const lost = (fact, why) => missing.push({ fact, why });
  const facts = { pr: Number(pr), missing };

  const view = run("gh", ["pr", "view", String(pr), "--json", "number,baseRefName,headRefOid,isDraft,body,files,statusCheckRollup"], { cwd, env });
  const data = view.status === 0 ? parseJson(view.stdout) : undefined;
  if (!data || typeof data.headRefOid !== "string" || !data.baseRefName || !Array.isArray(data.files)) {
    lost("pull request data", "gh pr view gave nothing usable");
    return { ...facts, head: null, base: null, changedFiles: [] };
  }
  const changedFiles = data.files.map((f) => f.path);
  const head = data.headRefOid;
  const base = data.baseRefName;
  const description = typeof data.body === "string" ? data.body : "";
  const baseAllowed = settings.allowedBases.includes(base);
  Object.assign(facts, { head, base, baseAllowed, changedFiles, description, draft: data.isDraft === true, ...countLines(data.files, settings) });
  if (typeof data.isDraft !== "boolean") lost("draft state", "gh did not say");
  facts.checks = summarizeChecks(data.statusCheckRollup);

  // Review threads.
  const graphql = run("gh", ["api", "graphql", "-F", "owner={owner}", "-F", "name={repo}", "-F", `number=${pr}`, "-f",
    "query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){pageInfo{hasNextPage} nodes{isResolved}}}}}"], { cwd, env });
  const threads = parseJson(graphql.status === 0 ? graphql.stdout : "")?.data?.repository?.pullRequest?.reviewThreads;
  if (!threads || !Array.isArray(threads.nodes)) lost("review threads", "gh api graphql gave nothing usable");
  else facts.unresolvedThreads = threads.pageInfo?.hasNextPage === true || threads.nodes.some((n) => !n.isResolved);

  // Stack: the base must not be another open pull request's branch.
  if (baseAllowed) facts.bottomOfStack = true;
  else {
    const open = run("gh", ["pr", "list", "--state", "open", "--json", "headRefName", "--limit", "200"], { cwd, env });
    const list = parseJson(open.status === 0 ? open.stdout : "");
    if (!Array.isArray(list)) { lost("open pull requests", "gh pr list gave nothing usable"); facts.bottomOfStack = false; }
    else facts.bottomOfStack = !list.some((p) => p.headRefName === base);
  }

  // Git: fetch quietly, never check anything out.
  const trunkName = baseAllowed ? base : settings.allowedBases[0];
  const hasOrigin = lines(git(cwd, "remote").stdout ?? "").includes("origin");
  if (hasOrigin && git(cwd, "fetch", "--quiet", "origin", trunkName).status !== 0) lost("trunk", `could not fetch ${trunkName}`);
  const trunk = git(cwd, "rev-parse", "--verify", "--quiet", `origin/${trunkName}^{commit}`).status === 0 ? `origin/${trunkName}` : trunkName;
  if (git(cwd, "cat-file", "-e", `${head}^{commit}`).status !== 0 && hasOrigin) git(cwd, "fetch", "--quiet", "origin", `pull/${pr}/head`);
  const haveHead = git(cwd, "cat-file", "-e", `${head}^{commit}`).status === 0;
  const haveTrunk = git(cwd, "rev-parse", "--verify", "--quiet", `${trunk}^{commit}`).status === 0;
  if (!haveHead) lost("head commit", `${head.slice(0, 12)} is not in this checkout`);
  if (!haveTrunk) lost("trunk", `${trunk} is not in this checkout`);

  if (haveHead && haveTrunk) {
    const mergeBase = git(cwd, "merge-base", trunk, head);
    if (mergeBase.status !== 0) lost("merge base", "trunk and the pull request share no history");
    else {
      const moved = git(cwd, "diff", "--name-only", `${mergeBase.stdout.trim()}..${trunk}`);
      if (moved.status !== 0) lost("trunk changes", "git diff failed");
      else {
        const trunkFiles = lines(moved.stdout);
        facts.trunkTouched = changedFiles.filter((p) => trunkFiles.includes(p));
        facts.ciChanged = trunkFiles.some((p) => matchesAny(p, [".github/**"]));
      }
    }
    const tree = git(cwd, "merge-tree", "--write-tree", trunk, head);
    if (tree.status === 0) facts.conflict = false;
    else if (tree.status === 1) facts.conflict = true;
    else lost("conflict check", "git merge-tree failed");
    facts.fresh = facts.conflict === false && facts.trunkTouched?.length === 0 && facts.ciChanged === false;
  }

  // Zone, from the diff.
  const zone = zoneFor(changedFiles, settings, { cwd, trunk, body: description });
  facts.zone = zone.zone;
  facts.neverMergePaths = zone.neverMerge;
  if (zone.problem) lost("zone", zone.problem);

  facts.runtimeChanged = changedFiles.some((p) => matchesAny(p, settings.runtimeSurface));

  // Verdicts, live proof and compliance come through the verify plugin's scripts.
  const verify = findVerifyScripts(env);
  facts.verdicts = [];
  facts.liveProof = null;
  if (!verify) lost("verify plugin", "verify plugin not found");
  else if (haveHead && haveTrunk) {
    const check = run("node", [join(verify, "verdict.mjs"), "check", "--base", trunk, "--head", head, "--json"], { cwd, env });
    const result = check.status === 0 || check.status === 1 ? parseJson(check.stdout) : undefined;
    if (!result) lost("review verdicts", "verdict check failed to run");
    else {
      facts.patchId = result.patchId;
      facts.verdicts = [result.claimsAuditor, result.other].filter(Boolean).map((v) => ({
        reviewer: v.reviewer, verdict: v.verdict === "ready" ? "READY" : "NOT READY", model: v.model ?? null,
      }));
    }
    if (facts.runtimeChanged) facts.liveProof = liveProofFor(cwd, head, verify);
  }

  const change = /^Change:\s*(\S+)/m.exec(description)?.[1];
  if (change) {
    facts.complianceChange = change;
    facts.compliance = complianceFor(cwd, head, change);
  }
  return facts;
}
