// Rules for specs and plans: every scenario says how it will be proved,
// and every plan item names its evidence.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, join, extname } from "node:path";
import { homedir } from "node:os";
import { proseLines, HEADING } from "./markdown.mjs";

const SCENARIO = /^#{2,6}\s+Scenario:\s*(.*)$/;
const ITEM = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/;
const PROVED = /^\s*(?:[-*]\s+)?Proved by:/i;

export const hold = (line, message) => ({ line, level: "hold", message });

// A line plus the indented lines that continue it.
export function gather(lines, i) {
  const parts = [lines[i].text];
  for (let j = i + 1; j < lines.length; j++) {
    const t = lines[j].text;
    if (!t.trim() || HEADING.test(t) || /^\S/.test(t) || /^\s*[-*]\s/.test(t)) break;
    parts.push(t.trim());
  }
  return parts.join(" ");
}

export function checkScenarios(lines) {
  const findings = [];
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].text.match(SCENARIO);
    if (!m) continue;
    count++;
    const name = m[1].trim() || "(unnamed)";
    let end = lines.findIndex((l, j) => j > i && HEADING.test(l.text));
    if (end === -1) end = lines.length;
    const at = lines.slice(i + 1, end).findIndex((l) => PROVED.test(l.text));
    if (at === -1) {
      findings.push(hold(lines[i].line, `Scenario "${name}" has no "Proved by" line. Add one that names where it is checked, the evidence, and what passing looks like.`));
      continue;
    }
    const idx = i + 1 + at;
    const text = gather(lines, idx).replace(PROVED, "").trim();
    const where = text.split(";")[0].trim();
    const say = (msg) => findings.push(hold(lines[idx].line, `Scenario "${name}": the "Proved by" line ${msg}`));
    if (!where || /^evidence:/i.test(where)) say("does not say where it is checked: a test file, or live in which app and feature.");
    if (!/evidence:\s*\S/i.test(text)) say(`names no evidence. Add "evidence:" and what comes out: a recording, a screenshot, a read-back, a test result.`);
    if (!/pass when\s*\S/i.test(text)) say(`says no pass condition. Add "pass when" and the result you can observe.`);
  }
  return { findings, count };
}

const KINDS = ["test", "file", "screenshot", "log", "commit", "run", "link"];
const MEDIA = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp4", ".mov", ".webm"]);
const HELP = {
  test: 'Write: test <file> "<test name>".',
  file: "Write: file <path>.",
  screenshot: "Write: screenshot <path>.",
  log: 'Write: log <file> "<text it must contain>".',
  run: "Write: run <evidence folder>.",
};

export function parseEvidence(text) {
  const m = text.match(/\bEvidence:\s*(.+)$/);
  if (!m) return null;
  return m[1].split(";").map((s) => s.replace(/\*+$/, "").trim()).filter(Boolean).map((raw) => {
    const kind = raw.split(/\s+/)[0].toLowerCase();
    const rest = raw.slice(kind.length).trim();
    const quoted = rest.match(/"([^"]+)"/)?.[1] ?? null;
    const target = rest.replace(/"[^"]*"/, "").replace(/`/g, "").trim();
    return { raw, kind, target, quoted };
  });
}

const at = (root, p) => (p.startsWith("~/") || p === "~" ? join(homedir(), p.slice(2)) : resolve(root, p));

function newestRun(dir) {
  if (existsSync(join(dir, "run.json"))) return join(dir, "run.json");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return null;
  const runs = readdirSync(dir).filter((d) => existsSync(join(dir, d, "run.json"))).sort();
  return runs.length ? join(dir, runs.at(-1), "run.json") : null;
}

export function checkEvidence(ev, ticked, root) {
  if (!KINDS.includes(ev.kind)) return [`unknown evidence kind "${ev.kind}". Use one of: ${KINDS.join(", ")}.`];
  const complete = { test: ev.target && ev.quoted, file: ev.target, screenshot: ev.target, log: ev.target && ev.quoted, commit: true, run: ev.target, link: true };
  if (!complete[ev.kind]) return [`"${ev.raw}" is incomplete. ${HELP[ev.kind]}`];
  if (!ticked) return [];
  const path = ev.target && at(root, ev.target);
  switch (ev.kind) {
    case "test":
    case "log":
      if (!existsSync(path)) return [`${ev.target} does not exist.`];
      return readFileSync(path, "utf8").includes(ev.quoted) ? [] : [`${ev.target} does not contain "${ev.quoted}".`];
    case "file":
      return existsSync(path) ? [] : [`${ev.target} does not exist.`];
    case "screenshot":
      if (!existsSync(path)) return [`${ev.target} does not exist.`];
      return MEDIA.has(extname(path).toLowerCase()) ? [] : [`${ev.target} is not an image or video.`];
    case "commit": {
      const [sha, repo] = ev.target.split(/\s+in\s+/);
      if (!/^[0-9a-f]{7,40}$/.test(sha ?? "")) return ["is ticked but names no commit ID. Write: commit <commit ID>."];
      try {
        execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: repo ? at(root, repo) : root, stdio: "ignore" });
        return [];
      } catch {
        return [`${sha} is not a commit in ${repo ?? "this repository"}.`];
      }
    }
    case "run": {
      const file = newestRun(path);
      if (!file) return [`${ev.target} holds no evidence run (no run.json).`];
      return JSON.parse(readFileSync(file, "utf8")).status ? [] : [`the run in ${ev.target} has no final status.`];
    }
    case "link":
      return /^https:\/\/\S+$/.test(ev.target) ? [] : [`"${ev.target}" is not a full https:// address.`];
  }
  return [];
}

export function checkItems(lines, root) {
  const findings = [];
  const items = [];
  lines.forEach((l, i) => {
    const m = l.text.match(ITEM);
    if (!m) return;
    const ticked = m[1] !== " ";
    const title = m[2].replace(/\*\*/g, "").slice(0, 60);
    items.push({ line: l.line, ticked, title });
    const evs = parseEvidence(gather(lines, i));
    if (!evs || !evs.length) {
      findings.push(hold(l.line, `"${title}" names no evidence. Add "Evidence:" and what will show it is done: a test, a file, a screenshot, a log line, a commit.`));
      return;
    }
    for (const ev of evs) for (const p of checkEvidence(ev, ticked, root)) findings.push(hold(l.line, `"${title}": ${p}`));
  });
  return { findings, count: items.length, items };
}

export function checkFile(raw, { file, root, since } = {}) {
  const lines = proseLines(raw);
  const sc = checkScenarios(lines);
  const it = checkItems(lines, root);
  const findings = [...sc.findings, ...it.findings];
  if (!sc.count && !it.count) {
    findings.push(hold(1, `Found no scenarios and no plan items, so there is nothing to check. A spec has "#### Scenario:" headings; a plan has checkbox items.`));
  }
  findings.sort((a, b) => a.line - b.line);
  return { findings, scenarios: sc.count, items: it.count, held: findings.some((f) => f.level === "hold") };
}

export { ITEM };
