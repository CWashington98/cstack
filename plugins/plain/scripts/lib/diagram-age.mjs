// Reads the stamp (diagrams.json) beside each diagram and reports whether it is
// unstamped, current, lagging, stale or due for removal. Also holds changes that
// have no stamped diagram, and re-validates a diagram that still passes the checker.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename, dirname, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { checkDiagram } from "../diagram-check.mjs";
import { formatFindings } from "../plain-check.mjs";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY = 86400000;
const LAST_CHECKED = /(Last checked[^<]*?\bon\s+)(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/;

const days = (n) => `${n} day${n === 1 ? "" : "s"}`;
const inWords = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

// Blanks out what a reader never sees: comments, <title> and <desc>. Same length, so positions still line up.
const hide = (svg) => svg
  .replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length))
  .replace(/<(title|desc)\b[\s\S]*?<\/\1\s*>/gi, (m) => " ".repeat(m.length));

// Every "Last checked … on <date>" the picture shows in its <text> and <tspan> words:
// { words, iso, at, lead }, where svg.slice(at, at + lead) is the part before the date.
function visibleDates(svg) {
  const shown = hide(svg);
  const found = [];
  for (const t of shown.matchAll(/<text(?=[\s>])[^>]*>([\s\S]*?)<\/text\s*>/gi)) {
    const start = t.index + t[0].indexOf(">") + 1;
    for (const m of t[1].matchAll(new RegExp(LAST_CHECKED, "g"))) {
      const month = MONTHS.findIndex((name) => name.toLowerCase() === m[3].toLowerCase());
      if (month < 0) continue;
      found.push({ words: `${Number(m[2])} ${MONTHS[month]} ${m[4]}`, iso: `${m[4]}-${String(month + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`, at: start + m.index, lead: m[1].length, end: start + m.index + m[0].length });
    }
  }
  return found;
}

// The date the picture shows, as YYYY-MM-DD plus the words it uses, or null. `count` is how many such lines show.
export function visibleDate(svg) {
  const dates = visibleDates(svg);
  return dates.length ? { words: dates[0].words, iso: dates[0].iso, count: dates.length } : null;
}

const isRealDate = (v) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === v;
};

// What is wrong with one diagrams.json entry, naming the field, or null.
function entryProblem(e) {
  if (!e || typeof e !== "object") return "its entry in diagrams.json is not an object";
  for (const field of ["file", "question", "depicts", "made", "lastValidated"]) {
    if (e[field] === undefined || e[field] === null || e[field] === "") return `its entry in diagrams.json is missing "${field}"`;
  }
  if (typeof e.question !== "string") return 'its entry in diagrams.json has a "question" that is not text';
  if (!Array.isArray(e.depicts)) return 'its entry in diagrams.json has a "depicts" that is not a list';
  for (const field of ["made", "lastValidated"]) {
    if (!isRealDate(e[field])) return `its entry in diagrams.json has a "${field}" of ${JSON.stringify(e[field])}, which is not a real YYYY-MM-DD date`;
  }
  return null;
}

// { entries } from a folder's diagrams.json, or { error } when it can't be used.
function readStamps(folder) {
  const path = join(folder, "diagrams.json");
  if (!existsSync(path)) return { entries: [] };
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { error: `diagrams.json is not valid JSON: ${e.message}` };
  }
  if (!data || !Array.isArray(data.diagrams)) return { error: 'diagrams.json has no "diagrams" list' };
  return { entries: data.diagrams };
}

// Every folder named diagrams under root, as paths from root.
export function findFolders(root, dir = root) {
  const found = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === "node_modules" || e.name === ".git") continue;
    const path = join(dir, e.name);
    if (e.name === "diagrams") found.push(relative(root, path));
    else found.push(...findFolders(root, path));
  }
  return found;
}

// The newest commit that changed a depicted path: { date, file }, or null.
function lastChange(root, depicts) {
  if (!depicts?.length) return null;
  try {
    const out = execFileSync("git", ["log", "-n", "1", "--name-only", "--date=short", "--format=@%ad", "--", ...depicts], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const [head, ...files] = out.split("\n").filter(Boolean);
    return head ? { date: head.slice(1), file: files[0] } : null;
  } catch {
    return null;
  }
}

function report(root, folder, svg, stamps, today, config) {
  const path = join(folder, svg);
  if (stamps.error) return { state: "unstamped", path, why: stamps.error };
  const stamp = stamps.entries.find((s) => s?.file === svg);
  if (!stamp) return { state: "unstamped", path, why: "no entry in diagrams.json" };
  const problem = entryProblem(stamp);
  if (problem) return { state: "unstamped", path, why: problem };
  const dates = visibleDates(readFileSync(join(root, path), "utf8"));
  if (!dates.length) return { state: "unstamped", path, why: "the picture has no \"Last checked … on\" date" };
  if (dates.length > 1) return { state: "unstamped", path, why: `the picture shows ${dates.length} Last checked lines` };
  const shown = dates[0];
  if (shown.iso !== stamp.lastValidated) return { state: "unstamped", path, why: `the picture says ${shown.words}, diagrams.json says ${stamp.lastValidated}` };
  const age = daysBetween(stamp.lastValidated, today);
  if (age > config.diagramRemoveAfterDays) return { state: "remove?", path, why: `last checked ${days(age)} ago. Re-check it or delete it.` };
  if (age > config.diagramMaxAgeDays) return { state: "stale", path, why: `last checked ${days(age)} ago` };
  const change = lastChange(root, stamp.depicts);
  if (change && change.date > stamp.lastValidated) {
    return { state: "lagging", path, why: `${basename(change.file)} changed on ${inWords(change.date)}, after it was last checked on ${inWords(stamp.lastValidated)}` };
  }
  return { state: "current", path, note: `(checked ${days(age)} ago)` };
}

// One finding per diagram in every diagrams folder.
export function checkAll(root, today, config) {
  const findings = [];
  for (const folder of findFolders(root)) {
    const stamps = readStamps(join(root, folder));
    const svgs = readdirSync(join(root, folder)).filter((f) => f.endsWith(".svg")).sort();
    for (const svg of svgs) findings.push(report(root, folder, svg, stamps, today, config));
  }
  return findings;
}

export const formatReport = (f) => `${f.state}  ${f.path}${f.why ? `: ${f.why}` : ` ${f.note}`}`;

// Holds for each open change with no diagram, a diagram the checker fails, a diagram with no usable
// diagrams.json entry, or a diagram its design.md never shows (a comment doesn't show it).
export function checkChanges(root, config = {}) {
  const base = join(root, "openspec", "changes");
  if (!existsSync(base)) return [];
  const holds = [];
  for (const e of readdirSync(base, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === "archive") continue;
    const folder = join(base, e.name, "diagrams");
    const svgs = existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith(".svg")).sort() : [];
    if (!svgs.length) {
      holds.push(`hold  ${e.name} has no diagram. Draw one with to-diagram and stamp it in diagrams/diagrams.json.`);
      continue;
    }
    const designPath = join(base, e.name, "design.md");
    const design = existsSync(designPath) ? readFileSync(designPath, "utf8").replace(/<!--[\s\S]*?-->/g, "") : "";
    const stamps = readStamps(folder);
    for (const svg of svgs) {
      const entry = stamps.entries?.find((s) => s?.file === svg);
      if (stamps.error) holds.push(`hold  ${e.name}: ${svg} can't be stamped. ${stamps.error}.`);
      else if (!entry) holds.push(`hold  ${e.name}: ${svg} has no entry in diagrams.json.`);
      else if (entryProblem(entry)) holds.push(`hold  ${e.name}: ${svg} is unstamped, because ${entryProblem(entry)}.`);
      const first = (checkDiagram(readFileSync(join(folder, svg), "utf8"), svg, config) ?? []).find((f) => f.level === "hold");
      if (first) holds.push(`hold  ${e.name}: ${svg} fails the diagram checker: ${first.message}`);
      if (!design.includes(`diagrams/${svg}`)) holds.push(`hold  ${e.name}: ${svg} isn't shown in design.md.`);
    }
  }
  return holds;
}

// Re-validates one diagram: runs the checker, then sets both dates to today.
// Returns { ok, lines }. On a failure or a problem it changes nothing.
export function validate(file, today, config) {
  const svg = readFileSync(file, "utf8");
  const holds = (checkDiagram(svg, file, config) ?? []).filter((f) => f.level === "hold");
  if (holds.length) return { ok: false, lines: [formatFindings(holds)] };
  const stamps = readStamps(dirname(file));
  if (stamps.error) return { ok: false, lines: [`unstamped  ${file}: ${stamps.error}. Fix it before validating.`] };
  const stamp = stamps.entries.find((s) => s?.file === basename(file));
  if (!stamp) return { ok: false, lines: [`unstamped  ${file}: no entry in diagrams.json. Add one before validating.`] };
  // lastValidated is the field validating sets, so it may be what's wrong.
  const problem = entryProblem({ ...stamp, lastValidated: "2000-01-01" });
  if (problem) return { ok: false, lines: [`unstamped  ${file}: ${problem}. Fix it before validating.`] };
  const dates = visibleDates(svg);
  if (!dates.length) return { ok: false, lines: [`unstamped  ${file}: the picture has no "Last checked … on" date to update.`] };
  if (dates.length > 1) return { ok: false, lines: [`unstamped  ${file}: the picture shows ${dates.length} Last checked lines. Keep one before validating.`] };
  stamp.lastValidated = today;
  const [d] = dates;
  const stampPath = join(dirname(file), "diagrams.json");
  writeFileSync(stampPath, `${JSON.stringify({ ...JSON.parse(readFileSync(stampPath, "utf8")), diagrams: stamps.entries }, null, 2)}\n`);
  writeFileSync(file, `${svg.slice(0, d.at + d.lead)}${inWords(today)}${svg.slice(d.end)}`);
  return { ok: true, lines: [`validated  ${file}: last checked ${inWords(today)}`] };
}
