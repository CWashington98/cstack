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

// The date the picture shows, as YYYY-MM-DD plus the words it uses, or null.
export function visibleDate(svg) {
  const m = svg.match(LAST_CHECKED);
  const month = m && MONTHS.findIndex((name) => name.toLowerCase() === m[3].toLowerCase());
  if (!m || month < 0) return null;
  return { words: `${Number(m[2])} ${MONTHS[month]} ${m[4]}`, iso: `${m[4]}-${String(month + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}` };
}

function readStamps(folder) {
  const path = join(folder, "diagrams.json");
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf8")).diagrams ?? [];
  } catch {
    return [];
  }
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

function report(root, folder, svg, stamp, today, config) {
  const path = join(folder, svg);
  if (!stamp) return { state: "unstamped", path, why: "no entry in diagrams.json" };
  const shown = visibleDate(readFileSync(join(root, path), "utf8"));
  if (!shown) return { state: "unstamped", path, why: "the picture has no \"Last checked … on\" date" };
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
    for (const svg of svgs) findings.push(report(root, folder, svg, stamps.find((s) => s.file === svg), today, config));
  }
  return findings;
}

export const formatReport = (f) => `${f.state}  ${f.path}${f.why ? `: ${f.why}` : ` ${f.note}`}`;

// Holds for each open change with no stamped diagram, or a diagram its design.md never shows.
export function checkChanges(root) {
  const base = join(root, "openspec", "changes");
  if (!existsSync(base)) return [];
  const holds = [];
  for (const e of readdirSync(base, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === "archive") continue;
    const folder = join(base, e.name, "diagrams");
    const stamped = readStamps(folder).filter((s) => existsSync(join(folder, s.file)));
    if (!stamped.length) {
      holds.push(`hold  ${e.name} has no diagram. Draw one with to-diagram and stamp it in diagrams/diagrams.json.`);
      continue;
    }
    const designPath = join(base, e.name, "design.md");
    const design = existsSync(designPath) ? readFileSync(designPath, "utf8") : "";
    for (const s of stamped) if (!design.includes(`diagrams/${s.file}`)) holds.push(`hold  ${e.name}: ${s.file} isn't shown in design.md.`);
  }
  return holds;
}

// Re-validates one diagram: runs the checker, then sets both dates to today.
// Returns { ok, lines }. On a failure or a problem it changes nothing.
export function validate(file, today, config) {
  const svg = readFileSync(file, "utf8");
  const holds = (checkDiagram(svg, file, config) ?? []).filter((f) => f.level === "hold");
  if (holds.length) return { ok: false, lines: [formatFindings(holds)] };
  const stampPath = join(dirname(file), "diagrams.json");
  const data = existsSync(stampPath) ? JSON.parse(readFileSync(stampPath, "utf8")) : { diagrams: [] };
  const stamp = data.diagrams?.find((s) => s.file === basename(file));
  if (!stamp) return { ok: false, lines: [`unstamped  ${file}: no entry in diagrams.json. Add one before validating.`] };
  if (!LAST_CHECKED.test(svg)) return { ok: false, lines: [`unstamped  ${file}: the picture has no "Last checked … on" date to update.`] };
  stamp.lastValidated = today;
  writeFileSync(stampPath, `${JSON.stringify(data, null, 2)}\n`);
  writeFileSync(file, svg.replace(LAST_CHECKED, (_, lead) => `${lead}${inWords(today)}`));
  return { ok: true, lines: [`validated  ${file}: last checked ${inWords(today)}`] };
}
