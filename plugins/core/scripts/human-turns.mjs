#!/usr/bin/env node
// Pulls out the messages a person typed to Claude Code and Codex, and drops what tools and other agents wrote
// in their place: tool output, injected context, subagent runs, sessions another program started, and briefs
// one agent wrote for another. The automate-me skill mines the result for the person's working style.
//
// Usage: node human-turns.mjs --since <YYYY-MM-DD> --project <path part>... --out <folder>
//          [--claude <projects folder>]... [--codex <Codex home>]... [--marker <text>]... [--slices <n>]
// --project matches any part of a session's folder, so "shop" also matches the shop repository's worktrees.
// Claude defaults to $CLAUDE_CONFIG_DIR/projects (or ~/.claude/projects); Codex to $CODEX_HOME (or ~/.codex).
// The output folder is private (0700) and holds turns.jsonl, slice-<n>.jsonl in time order, and summary.json.
// It prints counts only, never message text.
import { readFileSync, readdirSync, existsSync, statSync, realpathSync, mkdirSync, chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

const BRIEF_CHARS = 1500;
const REPEAT_CHARS = 200;
const REPEAT_TIMES = 3;
// Text that tools put in the person's place, recognised by how it starts.
const INJECTED_PREFIXES = [
  "Delegated task node:", // a T3 Code delegated task reporting back
  "Update on pull request #", // T3 Code reporting on a watched pull request
  "Another Claude session sent a message:", // a message from another Claude Code session
  "Context handoff (", // T3 Code handing a thread to another provider
  "[Historical ", // T3 Code replaying earlier turns
  "This session is being continued from a previous conversation", // Claude Code's summary after compaction
  "[Request interrupted",
  "# AGENTS.md instructions", // Codex injecting the instruction files
];
const TAG_START = /^\s*<[a-z][\w-]*[\s>]/i;

const bump = (counts, reason) => { counts[reason] = (counts[reason] ?? 0) + 1; };
const readLines = (file) => readFileSync(file, "utf8").split("\n").flatMap((line) => { try { return line ? [JSON.parse(line)] : []; } catch { return []; } });
const uniqueDirs = (dirs) => [...new Map(dirs.filter((d) => existsSync(d)).map((d) => [realpathSync(d), d])).keys()];
const recentEnough = (file, since) => statSync(file).mtimeMs >= since;

// What the person typed, or null with the reason it isn't theirs.
function personText(text) {
  const command = text.match(/^\s*<command-name>([^<]*)<\/command-name>/);
  if (command) {
    const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1].trim();
    return args ? { text: `${command[1].trim()} ${args}` } : { reason: "added by the tool" };
  }
  if (TAG_START.test(text) || INJECTED_PREFIXES.some((p) => text.trimStart().startsWith(p))) return { reason: "added by the tool" };
  if (!text.trim()) return { reason: "no text" };
  return { text: text.trim() };
}

function claudeSessions(dirs, since, dropped) {
  const sessions = [];
  for (const dir of uniqueDirs(dirs)) {
    for (const slug of readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
      // Only <slug>/<session>.jsonl: subagent runs live deeper, in <session>/subagents/.
      const folder = join(dir, slug.name);
      for (const name of readdirSync(folder).filter((n) => n.endsWith(".jsonl"))) {
        const file = join(folder, name);
        if (!recentEnough(file, since)) continue;
        const session = { tool: "claude", id: name.replace(/\.jsonl$/, ""), cwd: "", messages: [] };
        for (const line of readLines(file)) {
          if (line.type !== "user" || line.isSidechain) continue;
          session.cwd ||= line.cwd ?? "";
          if (Date.parse(line.timestamp) < since) continue;
          if (line.isMeta || line.isCompactSummary) { bump(dropped, "added by the tool"); continue; }
          const content = line.message?.content;
          let text = content;
          if (Array.isArray(content)) {
            if (content.some((b) => b.type === "tool_result")) { bump(dropped, "tool output"); continue; }
            text = content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
          }
          const found = personText(String(text ?? ""));
          if (found.reason) { bump(dropped, found.reason); continue; }
          session.messages.push({ at: line.timestamp, cwd: line.cwd ?? session.cwd, text: found.text });
        }
        sessions.push(session);
      }
    }
  }
  return sessions;
}

const rollouts = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const path = join(dir, e.name);
  if (e.isDirectory()) return rollouts(path);
  return e.name.startsWith("rollout-") && e.name.endsWith(".jsonl") ? [path] : [];
});

function codexSessions(homes, since, dropped, droppedSessions) {
  const sessions = [];
  for (const home of uniqueDirs(homes)) {
    const root = join(home, "sessions");
    if (!existsSync(root)) continue;
    for (const file of rollouts(root)) {
      if (!recentEnough(file, since)) continue;
      const lines = readLines(file);
      const meta = lines.find((l) => l.type === "session_meta")?.payload ?? {};
      if (typeof meta.source === "object" && meta.source?.subagent) { bump(droppedSessions, "subagent"); continue; }
      if (meta.source === "exec" || meta.originator === "codex_exec" || /claude/i.test(meta.originator ?? "")) { bump(droppedSessions, "started by another program"); continue; }
      const session = { tool: "codex", id: meta.id ?? file, cwd: meta.cwd ?? "", messages: [] };
      for (const line of lines) {
        const p = line.payload;
        if (line.type !== "response_item" || p?.type !== "message" || p.role !== "user") continue;
        if (Date.parse(line.timestamp) < since) continue;
        const found = personText((p.content ?? []).filter((c) => c.type === "input_text").map((c) => c.text).join("\n"));
        if (found.reason) { bump(dropped, found.reason); continue; }
        session.messages.push({ at: line.timestamp, cwd: session.cwd, text: found.text });
      }
      sessions.push(session);
    }
  }
  return sessions;
}

export function collect({ since, projects, claude = [], codex = [], markers = [], briefChars = BRIEF_CHARS }) {
  const dropped = { sessions: {}, messages: {} };
  const all = [...claudeSessions(claude, since, dropped.messages), ...codexSessions(codex, since, dropped.messages, dropped.sessions)];
  const kept = [];
  for (const session of all) {
    if (!session.messages.length) continue;
    if (!projects.some((p) => session.cwd.includes(p))) { bump(dropped.sessions, "outside the named projects"); continue; }
    // A session that opens with a brief was started by an agent, so nothing in it is the person's.
    if (markers.some((marker) => session.messages[0].text.includes(marker))) { bump(dropped.sessions, "opened with a brief marker"); continue; }
    const messages = session.messages.filter((m) => {
      if (!markers.some((marker) => m.text.includes(marker))) return true;
      bump(dropped.messages, "has a brief marker");
      return false;
    });
    if (messages.length === 1 && messages[0].text.length > briefChars) { bump(dropped.sessions, "only message is a long brief"); continue; }
    kept.push(...messages.map((m) => ({ tool: session.tool, session: session.id, cwd: m.cwd, at: m.at, text: m.text })));
  }
  const seen = {};
  for (const t of kept) if (t.text.length >= REPEAT_CHARS) seen[t.text] = (seen[t.text] ?? 0) + 1;
  const turns = kept.filter((t) => {
    if ((seen[t.text] ?? 0) < REPEAT_TIMES) return true;
    bump(dropped.messages, "repeated long text");
    return false;
  }).sort((a, b) => a.at.localeCompare(b.at));
  return { turns, sessions: new Set(turns.map((t) => `${t.tool}:${t.session}`)).size, dropped };
}

function parseArgs(argv) {
  const opts = { projects: [], claude: [], codex: [], markers: [], slices: 3 };
  const lists = { "--project": "projects", "--claude": "claude", "--codex": "codex", "--marker": "markers" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i], value = argv[i + 1];
    if (lists[flag]) { opts[lists[flag]].push(value); i++; }
    else if (flag === "--since") { opts.since = Date.parse(`${value}T00:00:00Z`); opts.sinceText = value; i++; }
    else if (flag === "--out") { opts.out = value; i++; }
    else if (flag === "--slices") { opts.slices = Math.max(1, Number(value) || 1); i++; }
    else throw new Error(`Unknown option ${flag}`);
  }
  if (!Number.isFinite(opts.since)) throw new Error("Give a start date: --since YYYY-MM-DD");
  if (!opts.projects.length) throw new Error("Name at least one --project. This keeps chats from other projects out of the mining.");
  if (!opts.out) throw new Error("Give an output folder: --out <folder>");
  if (!opts.claude.length) opts.claude.push(join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects"));
  if (!opts.codex.length) opts.codex.push(process.env.CODEX_HOME || join(homedir(), ".codex"));
  return opts;
}

function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exit(2); }
  const result = collect(opts);
  mkdirSync(opts.out, { recursive: true });
  chmodSync(opts.out, 0o700);
  const lines = (turns) => turns.map((t) => JSON.stringify(t)).join("\n") + (turns.length ? "\n" : "");
  writeFileSync(join(opts.out, "turns.jsonl"), lines(result.turns), { mode: 0o600 });
  const size = Math.ceil(result.turns.length / opts.slices) || 1;
  for (let n = 0; n < opts.slices; n++) writeFileSync(join(opts.out, `slice-${n + 1}.jsonl`), lines(result.turns.slice(n * size, (n + 1) * size)), { mode: 0o600 });
  const summary = { since: opts.sinceText, projects: opts.projects, claude: opts.claude, codex: opts.codex, kept: { messages: result.turns.length, sessions: result.sessions }, dropped: result.dropped };
  writeFileSync(join(opts.out, "summary.json"), JSON.stringify(summary, null, 2) + "\n", { mode: 0o600 });
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  console.log(`Kept ${plural(result.turns.length, "message")} from ${plural(result.sessions, "session")} since ${opts.sinceText} in ${opts.projects.join(", ")}.`);
  for (const [kind, counts] of Object.entries(result.dropped)) for (const [reason, n] of Object.entries(counts)) console.log(`Dropped ${plural(n, kind.replace(/s$/, ""))}: ${reason}`);
  console.log(`Wrote ${opts.out}/turns.jsonl and ${opts.slices} slice files (private to you).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
