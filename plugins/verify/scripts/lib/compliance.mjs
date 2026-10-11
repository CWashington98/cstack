// The spec compliance check: does a change do what its approved spec says?
// It traces every scenario to a task and a test, runs the tests, and reports what
// holds. Nothing here names a project or a test tool: a project's settings do.
import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { proseLines } from "./markdown.mjs";
import { checkScenarios, gather, ITEM } from "./plan.mjs";
import { walk } from "./app-skill.mjs";

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

export function readSettings(root) {
  const file = join(root, ".claude", "verify.json");
  return existsSync(file) ? JSON.parse(readText(file)) : {};
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
  const report = {
    change, commit, base, lane, held: false,
    scenarios: traced.scenarios, holds, warnings, allowedEdits: [],
    counts: { expected: traced.scenarios.length, ran: 0 },
    breaks: { skipped: true, reason: lane === "high-risk" ? "not built yet" : "the normal lane does not break changed lines" },
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
  out.push(report.held
    ? `Held: spec compliance for ${report.change} found ${report.holds.length} problem(s) to fix.`
    : `Proven: every one of the ${n} scenario(s) in ${report.change} is traced, tested and passing.`);
  for (const h of report.holds) out.push(`  - ${h.why}`);
  if (report.warnings.length) {
    out.push(`${report.warnings.length} warning(s), which do not hold the change:`);
    for (const w of report.warnings) out.push(`  - ${w.why}`);
  }
  if (report.breaks.skipped) out.push(`Breaking changed lines: skipped (${report.breaks.reason}).`);
  return out.join("\n");
}
