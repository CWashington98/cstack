// The spec compliance check: does a change do what its approved spec says?
// It traces every scenario to a task and a test, runs the tests, and reports what
// holds. Nothing here names a project or a test tool: a project's settings do.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep, basename, dirname } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { proseLines } from "./markdown.mjs";
import { checkScenarios, gather, ITEM } from "./plan.mjs";
import { walk } from "./app-skill.mjs";
import { runBreaks } from "./breaks.mjs";

export const CHECKS = {
  trace: "every-scenario-is-traced",
  ran: "scenario-tests-really-ran",
  failFirst: "tests-fail-first-then-pass",
  locked: "locked-acceptance-tests-stay-locked",
  scope: "nothing-built-outside-the-spec",
  approved: "spec-matches-what-was-approved",
  breaks: "tests-exercise-their-code",
  review: "spec-match-review",
  executable: "executable-specs-when-turned-on",
};

export function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

export function gitOk(root, ...args) {
  try { return git(root, ...args); } catch { return null; }
}

// ---- Paths and patterns ----

// "**" crosses folders, "*" and "?" stay inside one. A pattern with no "/" matches a
// file name anywhere, and one ending in "/" matches everything below that folder.
export function globToRegExp(glob) {
  let g = glob.trim().replace(/^\.\//, "");
  if (g.endsWith("/")) g += "**";
  let out = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*" && g[i + 1] === "*") {
      if (g[i + 2] === "/") { out += "(?:.*/)?"; i += 2; } else { out += ".*"; i += 1; }
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

export function matchesAny(path, globs) {
  return (globs ?? []).some((g) => globToRegExp(g).test(g.includes("/") ? path : basename(path)));
}

const posix = (p) => p.split(sep).join("/");

// ---- Reading the change ----

const readText = (file) => readFileSync(file, "utf8");

export const changeDir = (root, change) => join(root, "openspec", "changes", change);

export function specFiles(root, change) {
  const dir = join(changeDir(root, change), "specs");
  return walk(dir).filter((f) => f.endsWith(".md")).sort().map((f) => posix(relative(root, f)));
}

export function readScenarios(root, change) {
  return specFiles(root, change).flatMap((file) =>
    checkScenarios(proseLines(readText(join(root, file)))).scenarios.map((s) => ({ ...s, file })));
}

// Scenario IDs in the project's own specs, so a test may cite them too.
export function projectScenarioIds(root) {
  return walk(join(root, "openspec", "specs")).filter((f) => f.endsWith(".md"))
    .flatMap((f) => checkScenarios(proseLines(readText(f))).scenarios.map((s) => s.id));
}

const split = (text) => text.split(/[\s,]+/).map((x) => x.replace(/`/g, "").trim()).filter(Boolean);

export function parseTasks(root, change) {
  const file = join(changeDir(root, change), "tasks.md");
  if (!existsSync(file)) return [];
  const lines = proseLines(readText(file));
  const tasks = [];
  lines.forEach((l, i) => {
    const m = l.text.match(ITEM);
    if (!m) return;
    const text = gather(lines, i);
    const body = text.replace(ITEM, "$2");
    const covers = body.match(/\bCovers:\s*([^.]*?)(?:\.(?:\s|$)|$)/);
    const touches = body.match(/\bTouches:\s*(.+?)\s*$/);
    tasks.push({
      number: m[2].match(/^(\d+(?:\.\d+)*)\.?(?:\s|$)/)?.[1] ?? null,
      line: l.line,
      covers: covers ? split(covers[1]) : [],
      setup: /\bSetup:/i.test(body),
      touches: touches ? touches[1].replace(/\.$/, "").split(",").map((x) => x.replace(/`/g, "").trim().replace(/\.$/, "")).filter(Boolean) : [],
    });
  });
  return tasks;
}

// ---- Finding tests ----

// A file is a test when it sits in a test folder, is named like a test, or is one of
// the project's acceptance files.
export function isTestFile(path, acceptance = []) {
  if (/\.md$/i.test(path) || path.startsWith("openspec/")) return false;
  return matchesAny(path, acceptance)
    || /(^|\/)(tests?|__tests__|specs?)\//i.test(path)
    || /[._-](test|spec)\.[a-z0-9]+$/i.test(path)
    || /(^|\/)test_[^/]*$/i.test(path);
}

// "[scenario-id]", or "[domain/capability:requirement/scenario-id]" with the scenario ID last.
const TOKEN = /(?<![\w\])}])\[((?:[\w.-]+(?:\/[\w.-]+)*:[\w.-]+\/)?[a-z][a-z0-9]*(?:-[a-z0-9]+)*)\]/g;
const QUOTES = ["\"", "'", "`"];

export function testsInText(text) {
  const found = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(TOKEN)) {
      let start = -1;
      for (let k = m.index - 1; k >= 0; k--) if (QUOTES.includes(line[k])) { start = k; break; }
      if (start === -1) continue;
      const close = line.indexOf(line[start], m.index + m[0].length);
      const name = line.slice(start + 1, close === -1 ? undefined : close).trim();
      found.push({ id: m[1].split("/").pop(), token: `[${m[1]}]`, name, line: i + 1 });
    }
  });
  return found;
}

export function trackedFiles(root) {
  return git(root, "ls-files", "-z").split("\0").filter(Boolean);
}

export function findTests(root, acceptance) {
  return trackedFiles(root).filter((f) => isTestFile(f, acceptance) && existsSync(join(root, f))).flatMap((file) => {
    let text;
    try { text = readText(join(root, file)); } catch { return []; }
    return testsInText(text).map((t) => ({ ...t, file }));
  });
}

// ---- Tracing scenarios to tasks and tests ----

const hold = (check, fields) => ({ check, ...fields });

// The scenario entries of the report with their tasks and tests, and the holds for
// every missing or unknown link.
export function trace(root, change, settings) {
  const acceptance = settings.tests?.acceptance ?? [];
  const scenarios = readScenarios(root, change);
  const tasks = parseTasks(root, change);
  const tests = findTests(root, acceptance);
  const ids = new Set(scenarios.map((s) => s.id));
  const known = new Set([...ids, ...projectScenarioIds(root)]);
  const holds = [];

  const entries = scenarios.map((s) => {
    const mine = tests.filter((t) => t.id === s.id);
    const entry = {
      id: s.id, requirement: s.requirement,
      tasks: tasks.filter((t) => t.covers.includes(s.id)).map((t) => t.number),
      tests: mine.map((t) => t.name), testFiles: [...new Set(mine.map((t) => t.file))], tokens: [...new Set(mine.map((t) => t.token))],
      ran: false, failsFirst: false, passesNow: false, status: "held",
    };
    if (!entry.tasks.length) holds.push(hold(CHECKS.trace, { scenario: s.id, missing: "task", why: `Scenario ${s.id} has no task. Add a task whose Covers: line names ${s.id}.` }));
    if (!entry.tests.length) holds.push(hold(CHECKS.trace, { scenario: s.id, missing: "test", why: `Scenario ${s.id} has no test. Add a test whose name contains [${s.id}].` }));
    return entry;
  });

  for (const t of tasks) {
    for (const id of t.covers) {
      if (id === "all") {
        if (acceptance.length && !(t.touches.length && t.touches.every((p) => matchesAny(p, acceptance)))) {
          holds.push(hold(CHECKS.trace, { task: t.number, id, why: `Task ${t.number} says "Covers: all", which only the acceptance-test task may say. Name its scenarios.` }));
        }
        continue;
      }
      if (!ids.has(id)) holds.push(hold(CHECKS.trace, { task: t.number, id, why: `Task ${t.number} covers ${id}, but no scenario in this change has that ID.` }));
    }
  }
  const seen = new Set();
  for (const t of tests) {
    if (known.has(t.id)) continue;
    const key = `${t.file}\0${t.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    holds.push(hold(CHECKS.trace, { id: t.id, test: t.name, file: t.file, why: `The test "${t.name}" in ${t.file} cites ${t.token}, but no scenario in this change or the project's specs has that ID.` }));
  }
  return { scenarios: entries, tasks, tests, holds };
}

// ---- Running tests by name ----

// A bracketed scenario token anywhere on a line of test output.
const OUTPUT_TOKEN = new RegExp(TOKEN.source, "g");
const SKIPPED = /#\s*(?:SKIP|TODO)\b|\bskipped\b|^\s*\uFE63/i;
const FAILED = /^\s*(?:\u2716|\u2717|\u2718|\u00D7|not ok\b|FAIL\b)|\.\.\. (?:FAIL|ERROR)\b/;
const PASSED = /^\s*(?:\u2714|\u2713|ok\b|PASS\b)|\.\.\. ok\b/;
const RANK = { passed: 0, skipped: 1, failed: 2 };

// What a test tool printed about each test whose name carries a scenario ID:
// one entry per distinct test, where failed beats skipped beats passed. Tools
// print a failing test twice (live, then in a summary), so the same name is one test.
export function readRun(out) {
  const tests = new Map();
  for (const line of out.split(/\r?\n/)) {
    const ids = [...line.matchAll(OUTPUT_TOKEN)].map((m) => m[1].split("/").pop());
    if (!ids.length) continue;
    const status = SKIPPED.test(line) ? "skipped" : FAILED.test(line) ? "failed" : PASSED.test(line) ? "passed" : null;
    if (!status) continue;
    const name = line.replace(/^\s*(?:\S{1,2}\s+|(?:not )?ok\s+\d*\s*-?\s*)/, "").replace(/\s*\(\d[\d.]*m?s\)\s*$/, "").replace(/\s*(?:#|\.\.\.).*$/, "").trim() || line.trim();
    for (const id of new Set(ids)) {
      const key = `${id}\0${name}`;
      const before = tests.get(key);
      if (!before || RANK[status] > RANK[before.status]) tests.set(key, { id, name, status });
    }
  }
  return [...tests.values()];
}

// Node sets this inside its own test runs; left in, a nested run would print for its parent.
const cleanEnv = () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
};

export function runCommand(cwd, template, name) {
  const command = template.replaceAll("{name}", name);
  const r = spawnSync(command, { cwd, shell: true, encoding: "utf8", env: cleanEnv(), timeout: 10 * 60 * 1000, maxBuffer: 256 * 1024 * 1024 });
  return { command, status: r.status ?? (r.signal ? -1 : 1), out: `${r.stdout ?? ""}${r.stderr ?? ""}`, error: r.error ?? null };
}

// Runs a scenario's tests by name, once for each bracket form its tests use, and adds up what ran.
export function runScenario(cwd, template, entry) {
  const runs = entry.tokens.map((token) => runCommand(cwd, template, token));
  const tests = runs.flatMap((r) => readRun(r.out)).filter((t) => t.id === entry.id);
  const count = (status) => tests.filter((t) => t.status === status).length;
  return {
    runs, tests, passed: count("passed"), failed: count("failed"), skipped: count("skipped"),
    exits: runs.map((r) => r.status), out: runs.map((r) => r.out).join("\n"),
  };
}

const tail = (text, n = 6) => text.trim().split(/\r?\n/).slice(-n).join(" / ").slice(0, 400);

export function whyNotRun(entry, r) {
  if (r.skipped && !r.passed && !r.failed) return `The test for ${entry.id} was skipped, so it did not run.`;
  if (r.skipped) return `Some of the tests for ${entry.id} were skipped, so they did not run.`;
  if (r.runs.some((x) => x.error)) return `The command that runs ${entry.id}'s tests could not start: ${r.runs.find((x) => x.error).error.message}.`;
  return `The test command found no test for ${entry.id}: no test named [${entry.id}] ran (the command ended with code ${r.exits.join(", ")}; last output: ${tail(r.out)}). Check the test is picked up by the command in tests.byName.`;
}

// ---- The starting commit, in a temporary worktree ----

// Runs fn(folder) in a throwaway checkout of the starting commit with the latest
// acceptance tests laid over it, since those tests did not exist yet when the
// change started. Folders git ignores at the top (installed dependencies) are
// linked in so the old code can run. The checkout is always removed.
export function withBaseTree(root, base, acceptance, fn) {
  const holder = mkdtempSync(join(tmpdir(), "compliance-base-"));
  const tree = join(holder, "tree");
  git(root, "worktree", "add", "--detach", "--quiet", tree, base);
  try {
    for (const file of git(root, "ls-tree", "-r", "--name-only", "-z", "HEAD").split("\0").filter(Boolean)) {
      if (!matchesAny(file, acceptance)) continue;
      const bytes = execFileSync("git", ["show", `HEAD:${file}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
      mkdirSync(dirname(join(tree, file)), { recursive: true });
      writeFileSync(join(tree, file), bytes);
    }
    const ignored = gitOk(root, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z") ?? "";
    for (const dir of ignored.split("\0").filter((d) => d.endsWith("/") && !d.startsWith(".verify/"))) {
      const link = join(tree, dir.slice(0, -1));
      if (existsSync(link) || !existsSync(dirname(link))) continue;
      try { symlinkSync(join(root, dir), link); } catch { /* the old code may not need it */ }
    }
    return fn(tree);
  } finally {
    gitOk(root, "worktree", "remove", "--force", tree);
    rmSync(holder, { recursive: true, force: true });
    gitOk(root, "worktree", "prune");
  }
}

// A failure only counts when a test ran and an assertion failed. A crash, a missing
// file or a test that never ran leaves no failed test with the scenario's ID.
const ASSERTION = /assert|expect/i;

export function judgeFirstRun(entry, r) {
  const passedAll = r.failed === 0 && r.passed > 0 && r.exits.every((x) => x === 0);
  if (passedAll) return { failsFirst: false, why: `The test for ${entry.id} passes on the starting commit as well as the latest, so it doesn't depend on the change. Write a test that fails until the change is built.` };
  if (r.failed > 0 && r.exits.some((x) => x !== 0) && ASSERTION.test(r.out)) return { failsFirst: true };
  return { failsFirst: false, why: `On the starting commit the test for ${entry.id} did not fail by an assertion: it crashed, a file it needs was missing, or it never ran (exit ${r.exits.join(", ")}; last output: ${tail(r.out)}). Write a test that reaches an assertion on the old code, for example through a stub.` };
}

// ---- Locked tests ----

const short = (sha) => sha.slice(0, 7);
const SPEC_CHANGE = /^Spec-Change:[ \t]*(\S.*)$/m;
const SKIP = /\.(?:skip|todo|only)\s*\(|\b(?:xit|xtest|xdescribe|xcontext|pending)\s*\(|@(?:\w+\.)?skip|\.mark\.(?:skip|xfail)|\bt\.Skip\(|#\[ignore\]|@(?:Disabled|Ignore)\b/;
const ASSERTION_LINE = /\bassert|\bexpect\s*\(|\.should\b|\bt\.(?:Error|Fatal)f?\(/i;
const TEST_LINE = /\b(?:test|it|describe)\s*\(|\bdef test_|@Test\b|\bfunc Test\w|#\[test\]/;

// The commits after the starting one, oldest first, with the files each touched.
export function commitsSince(root, base) {
  const shas = git(root, "rev-list", "--reverse", "--no-merges", `${base}..HEAD`).split("\n").filter(Boolean);
  return shas.map((sha) => {
    const message = git(root, "log", "-1", "--format=%B", sha);
    const files = git(root, "diff-tree", "-r", "-M", "--no-commit-id", "--name-status", "-z", sha).split("\0").filter(Boolean);
    const changes = [];
    for (let i = 0; i < files.length;) {
      const status = files[i][0];
      if (status === "R" || status === "C") { changes.push({ status, path: files[i + 1], to: files[i + 2] }); i += 3; } else { changes.push({ status, path: files[i + 1] }); i += 2; }
    }
    return { sha, message, specChange: message.match(SPEC_CHANGE)?.[1].trim() ?? null, changes };
  });
}

const lines = (patch, sign) => patch.split("\n").filter((l) => l.startsWith(sign) && !l.startsWith(sign.repeat(3))).map((l) => l.slice(1));

// Holds for any edit to a locked acceptance test, and for any existing test that was
// skipped, deleted or given fewer assertions, unless the commit has a Spec-Change: line.
export function checkLocks(root, base, settings) {
  const acceptance = settings.tests?.acceptance ?? [];
  const holds = [];
  const allowedEdits = [];
  const locked = new Set(git(root, "ls-tree", "-r", "--name-only", "-z", base).split("\0").filter((f) => f && matchesAny(f, acceptance)));
  for (const c of commitsSince(root, base)) {
    for (const ch of c.changes) {
      if (ch.status === "A") { if (matchesAny(ch.path, acceptance)) locked.add(ch.path); continue; }
      if (locked.has(ch.path)) {
        if (ch.to) { locked.delete(ch.path); locked.add(ch.to); }
        const what = ch.status === "D" ? "deleted" : ch.to ? `renamed to ${ch.to}` : "changed";
        if (c.specChange) {
          allowedEdits.push({ commit: short(c.sha), file: ch.path, specChange: c.specChange, why: `Commit ${short(c.sha)} ${what} the locked test ${ch.path}; allowed by Spec-Change: ${c.specChange}.` });
        } else {
          holds.push(hold(CHECKS.locked, { commit: short(c.sha), file: ch.path, why: `Commit ${short(c.sha)} ${what} the locked acceptance test ${ch.path} with no Spec-Change: line. Put the edit in a commit that says which spec change needs it, or undo it.` }));
        }
        continue;
      }
      if (c.specChange || !isTestFile(ch.path, acceptance)) continue;
      const name = (text) => [...new Set(testsInText(text).map((t) => t.token))].join(", ");
      const parent = gitOk(root, "show", `${c.sha}~1:${ch.path}`) ?? "";
      const at = `Commit ${short(c.sha)}`;
      if (ch.status === "D") {
        holds.push(hold(CHECKS.locked, { commit: short(c.sha), file: ch.path, why: `${at} deleted the test file ${ch.path}${name(parent) ? ` (${name(parent)})` : ""} with no Spec-Change: line.` }));
        continue;
      }
      const patch = gitOk(root, "diff-tree", "-p", "-U0", "--no-commit-id", c.sha, "--", ch.to ?? ch.path) ?? "";
      const added = lines(patch, "+");
      const removed = lines(patch, "-");
      const count = (list, re) => list.filter((l) => re.test(l)).length;
      const problem = added.some((l) => SKIP.test(l)) ? "marked a test as skipped"
        : count(removed, TEST_LINE) > count(added, TEST_LINE) ? "deleted a test"
        : count(removed, ASSERTION_LINE) > count(added, ASSERTION_LINE) ? "removed an assertion from a test" : null;
      if (problem) {
        const tests = name([...added, ...removed].join("\n")) || name(parent);
        holds.push(hold(CHECKS.locked, { commit: short(c.sha), file: ch.path, ...(tests ? { tests } : {}), why: `${at} ${problem} in ${ch.path}${tests ? ` (${tests})` : ""} with no Spec-Change: line. A test is made weaker only when a spec change says so.` }));
      }
    }
  }
  return { holds, allowedEdits };
}

// ---- Scope ----

export const declares = (touch, file) => matchesAny(file, [touch]) || file.startsWith(`${touch.replace(/\/+$/, "")}/`);

// Changed files that no task says it touches. Test files, the change's own folder and
// the project's always-allowed patterns are left out.
export function checkScope(root, base, change, tasks, settings) {
  const own = `openspec/changes/${change}/`;
  const allowed = settings.tests?.alwaysAllowed ?? [];
  const touches = tasks.flatMap((t) => t.touches);
  const changed = git(root, "diff", "--name-only", "--no-renames", "-z", base, "HEAD").split("\0").filter(Boolean);
  return changed
    .filter((f) => !isTestFile(f, settings.tests?.acceptance ?? []) && !f.startsWith(own) && !matchesAny(f, allowed) && !touches.some((x) => declares(x, f)))
    .map((file) => hold(CHECKS.scope, { file, why: `${file} changed, but no task says it touches it. Possible scope creep: add it to a task's Touches: line, or take it out.` }));
}

// ---- The approved spec ----

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// One spec file: the hash of its bytes. Several: the hash of a sorted list of
// "<hash>  <path>" lines, paths relative to the change's folder.
export function fingerprintOf(files) {
  if (files.length === 1) return sha256(files[0].bytes);
  return sha256(files.slice().sort((a, b) => (a.path < b.path ? -1 : 1)).map((f) => `${sha256(f.bytes)}  ${f.path}\n`).join(""));
}

const diffLines = (patch) => patch.split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));

// Holds when the spec files no longer match the fingerprint recorded at approval, and
// shows the lines that differ from the approved text when that text is in the history.
export function checkApproval(root, change, settings) {
  const dir = changeDir(root, change);
  const rel = `openspec/changes/${change}`;
  const file = join(dir, "approval.json");
  const fail = (why, extra = {}) => [hold(CHECKS.approved, { why, ...extra })];
  if (!existsSync(file)) return fail(`The change has no approval.json, so there is no record of which spec text was approved. Record the approval, then run the check again.`);
  let approval;
  try { approval = JSON.parse(readText(file)); } catch (e) { return fail(`approval.json is not valid JSON: ${e.message}`); }
  const recorded = String(approval.fingerprint ?? "").replace(/^sha256:/, "");
  if (!recorded) return fail(`approval.json has no fingerprint of the approved spec.`);
  const covers = approval.covers ?? "specs/**/*.md";
  const inScope = (path) => matchesAny(path, [covers]);
  const now = walk(dir).map((f) => posix(relative(dir, f))).filter(inScope).sort()
    .map((path) => ({ path, bytes: readFileSync(join(dir, path)) }));
  const current = now.length ? fingerprintOf(now) : null;
  if (current === recorded) return [];

  // Look back through the history for the text that was approved.
  let approvedAt = null;
  const history = (gitOk(root, "log", "--format=%H", "-n", "200", "--", rel) ?? "").split("\n").filter(Boolean);
  for (const sha of history) {
    const names = (gitOk(root, "ls-tree", "-r", "--name-only", "-z", sha, "--", rel) ?? "").split("\0").filter(Boolean)
      .map((n) => n.slice(rel.length + 1)).filter(inScope).sort();
    if (!names.length) continue;
    const files = names.map((path) => ({ path, bytes: execFileSync("git", ["show", `${sha}:${rel}/${path}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 }) }));
    if (fingerprintOf(files) === recorded) { approvedAt = { sha, names }; break; }
  }
  let shown = "";
  let lines = [];
  if (approvedAt) {
    const paths = [...new Set([...approvedAt.names, ...now.map((f) => f.path)])].map((p) => `${rel}/${p}`);
    lines = diffLines(gitOk(root, "diff", "-U0", approvedAt.sha, "--", ...paths) ?? "");
    shown = lines.length ? ` Lines that differ from the approved text: ${lines.map((l) => `${l[0]} ${l.slice(1).trim()}`).join(" | ")}` : "";
  } else {
    shown = " The approved text is not in the history, so the edited lines cannot be shown.";
  }
  return fail(`The spec no longer matches what was approved (recorded ${recorded.slice(0, 12)}, now ${current ? current.slice(0, 12) : "no spec files"}), so it needs approval again.${shown}`, { approvedCommit: approvedAt ? short(approvedAt.sha) : null, lines });
}

// ---- The whole check ----

const now = () => Number(process.hrtime.bigint() / 1000000n);

export function runCompliance({ root, change, base, lane = "normal", settings }) {
  const commit = git(root, "rev-parse", "HEAD").trim();
  const timeMs = { trace: 0, run: 0, breaks: 0 };
  let t = now();
  const traced = trace(root, change, settings);
  timeMs.trace = now() - t;
  const holds = [...traced.holds];
  const warnings = [];
  t = now();
  const locks = checkLocks(root, base, settings);
  holds.push(...locks.holds);
  warnings.push(...checkScope(root, base, change, traced.tasks, settings));
  holds.push(...checkApproval(root, change, settings));
  timeMs.trace += now() - t;
  t = now();
  const runs = new Map();
  for (const entry of traced.scenarios) {
    if (!entry.tokens.length) continue;
    const r = runScenario(root, settings.tests.byName, entry);
    runs.set(entry.id, r);
    entry.ran = r.passed + r.failed > 0 && r.skipped === 0;
    if (!entry.ran) holds.push(hold(CHECKS.ran, { scenario: entry.id, why: whyNotRun(entry, r) }));
  }
  const ran = traced.scenarios.filter((e) => e.ran);
  const first = ran.length ? withBaseTree(root, base, settings.tests.acceptance ?? [], (tree) =>
    new Map(ran.map((e) => [e.id, runScenario(tree, settings.tests.byName, e)]))) : new Map();
  for (const entry of ran) {
    const now_ = runs.get(entry.id);
    entry.passesNow = now_.failed === 0 && now_.passed > 0 && now_.exits.every((x) => x === 0);
    const judged = judgeFirstRun(entry, first.get(entry.id));
    entry.failsFirst = judged.failsFirst;
    if (!judged.failsFirst) holds.push(hold(CHECKS.failFirst, { scenario: entry.id, why: judged.why }));
    if (!entry.passesNow) {
      const failing = now_.tests.filter((x) => x.status === "failed").map((x) => x.name);
      holds.push(hold(CHECKS.failFirst, { scenario: entry.id, tests: failing, files: entry.testFiles, why: `The test for ${entry.id} fails on the latest commit: ${failing.join("; ") || tail(now_.out)} (${entry.testFiles.join(", ")}).` }));
    }
    entry.status = entry.failsFirst && entry.passesNow ? "proven" : "held";
  }
  timeMs.run = now() - t;
  let breaks = { skipped: true, reason: "the normal lane does not break changed lines", entries: [] };
  if (lane === "high-risk") {
    t = now();
    const live = traced.scenarios.filter((e) => e.passesNow);
    const owners = (file) => live.filter((e) => traced.tasks.some((k) => e.tasks.includes(k.number) && k.touches.some((p) => declares(p, file))));
    const r = runBreaks({ root, base, deps: {
      check: CHECKS.breaks,
      keep: (f) => !isTestFile(f, settings.tests.acceptance ?? []) && !/\.md$/i.test(f) && !f.startsWith("openspec/"),
      owners,
      withTree: (fn) => withBaseTree(root, "HEAD", [], fn),
      runScenario: (tree, entry) => runScenario(tree, settings.tests.byName, entry),
    } });
    holds.push(...r.holds);
    breaks = { skipped: false, tried: r.tried, entries: r.entries };
    timeMs.breaks = now() - t;
  }
  const report = {
    change, commit, base, lane, held: false,
    scenarios: traced.scenarios, holds, warnings, allowedEdits: locks.allowedEdits,
    counts: { expected: traced.scenarios.length, ran: traced.scenarios.filter((e) => e.ran).length },
    breaks,
    reviewer: { mismatches: 0 },
    timeMs,
  };
  report.held = holds.length > 0;
  report.holdsByCheck = holds.reduce((n, h) => ({ ...n, [h.check]: (n[h.check] ?? 0) + 1 }), {});
  return report;
}

// What a person reads at the end of the command's output.
export function summarize(report) {
  const out = [];
  const n = report.scenarios.length;
  out.push(`${report.counts.ran} of ${report.counts.expected} scenario tests ran.`);
  out.push(report.held
    ? `Held: spec compliance for ${report.change} found ${report.holds.length} problem(s) to fix.`
    : `Proven: every one of the ${n} scenario(s) in ${report.change} is traced, tested and passing.`);
  for (const h of report.holds) out.push(`  - ${h.why}`);
  if (report.warnings.length) {
    out.push(`${report.warnings.length} warning(s), which do not hold the change:`);
    for (const w of report.warnings) out.push(`  - ${w.why}`);
  }
  if (report.allowedEdits.length) {
    out.push(`${report.allowedEdits.length} edit(s) to locked tests, allowed by a Spec-Change: line:`);
    for (const e of report.allowedEdits) out.push(`  - ${e.why}`);
  }
  if (report.breaks.skipped) out.push(`Breaking changed lines: skipped (${report.breaks.reason}).`);
  else out.push(`Breaking changed lines: ${report.breaks.tried} break(s) tried, ${report.breaks.entries.filter((e) => e.status === "covered").length} noticed by a test.`);
  return out.join("\n");
}
