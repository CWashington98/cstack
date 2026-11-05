import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, statSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { collect } from "../scripts/human-turns.mjs";
import { tempDir } from "../../../tests/helpers.mjs";

const script = fileURLToPath(new URL("../scripts/human-turns.mjs", import.meta.url));
const SINCE = Date.parse("2026-10-01T00:00:00Z");
const AT = "2026-10-20T12:00:00.000Z";
const PROJECT = "/work/shop";
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const write = (path, rows) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, jsonl(rows)); };

// One Claude Code transcript line from the person, in the shape Claude Code writes.
const claudeUser = (content, extra = {}) => ({ type: "user", isSidechain: false, userType: "external", cwd: PROJECT, sessionId: "s", timestamp: AT, message: { role: "user", content }, ...extra });
const claudeSession = (projects, id, lines, slug = "-work-shop") => write(join(projects, slug, `${id}.jsonl`), lines.map((l) => ({ ...l, sessionId: id })));

// One Codex rollout: a session_meta line, then the items Codex records.
const codexUserText = (text) => ({ timestamp: AT, type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
const codexSession = (home, id, meta, texts) => write(join(home, "sessions", "2026", "10", "20", `rollout-2026-10-20T12-00-00-${id}.jsonl`), [
  { timestamp: AT, type: "session_meta", payload: { id, cwd: PROJECT, originator: "T3 Code", source: "vscode", ...meta } },
  ...texts.map(codexUserText),
]);

const run = (opts) => collect({ since: SINCE, projects: [PROJECT], claude: [], codex: [], markers: [], ...opts });
const texts = (result) => result.turns.map((t) => t.text);

test("a Claude session the person typed in keeps their messages and nothing the tools injected", () => {
  const projects = tempDir("ht-claude");
  claudeSession(projects, "owner", [
    claudeUser("keep replies short, use tables when comparing"),
    claudeUser([{ type: "tool_result", tool_use_id: "t", content: "ok" }]),
    claudeUser("Base directory for this skill: /x", { isMeta: true }),
    claudeUser("This session is being continued from a previous conversation that ran out of context.", { isCompactSummary: true }),
    claudeUser("<local-command-stdout>Compacted</local-command-stdout>"),
    claudeUser("<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>"),
    claudeUser("<command-name>/review</command-name>\n<command-message>review</command-message>\n<command-args>only the diff please</command-args>"),
    claudeUser("[Request interrupted by user]"),
    claudeUser("Delegated task node:delegated-task:command%3Amcp%3Aabc finished"),
    claudeUser("Update on pull request #12 (https://example.com/pull/12): checks passed"),
    claudeUser("Another Claude session sent a message: <teammate-message teammate_id=\"x\">done</teammate-message>"),
    claudeUser("Context handoff (full_thread_summary): Provider context handoff."),
    claudeUser("[Historical user; user_message; thread=mcp:abc] earlier text"),
    claudeUser([{ type: "image", source: {} }]),
    claudeUser([{ type: "text", text: "no, run the real app, not just tests" }]),
  ]);
  const result = run({ claude: [projects] });
  assert.deepEqual(texts(result), ["keep replies short, use tables when comparing", "/review only the diff please", "no, run the real app, not just tests"]);
  assert.equal(result.turns[0].tool, "claude");
  assert.equal(result.turns[0].session, "owner");
});

test("Claude subagent transcripts and sidechain lines are never read as the person", () => {
  const projects = tempDir("ht-claude-sub");
  claudeSession(projects, "owner", [claudeUser("ship it"), claudeUser("You are a reviewer. Check the diff.", { isSidechain: true })]);
  write(join(projects, "-work-shop", "owner", "subagents", "agent-a1.jsonl"), [claudeUser("You are a test runner. Run npm test.")]);
  const result = run({ claude: [projects] });
  assert.deepEqual(texts(result), ["ship it"]);
});

test("Codex sessions another program started are dropped, with the reason counted", () => {
  const home = tempDir("ht-codex");
  codexSession(home, "mine", {}, ["<environment_context>\n  <cwd>/work/shop</cwd>\n</environment_context>", "# AGENTS.md instructions for /work/shop\n\n<INSTRUCTIONS>rules</INSTRUCTIONS>", "why is the build red?"]);
  codexSession(home, "from-claude", { originator: "Claude Code" }, ["Review this diff and report findings."]);
  codexSession(home, "exec", { originator: "codex_exec", source: "exec" }, ["Run the review loop."]);
  codexSession(home, "child", { source: { subagent: { thread_spawn: { parent_thread_id: "p" } } }, thread_source: "subagent" }, ["Implement task 3."]);
  const result = run({ codex: [home] });
  assert.deepEqual(texts(result), ["why is the build red?"]);
  assert.equal(result.turns[0].tool, "codex");
  assert.deepEqual(result.dropped.sessions, { "started by another program": 2, "subagent": 1 });
});

test("a session whose only message is a long brief is treated as delegated work, not the person", () => {
  const projects = tempDir("ht-brief");
  claudeSession(projects, "child", [claudeUser("Act as the implementation sub-agent for this task.\n" + "Step detail. ".repeat(200)), claudeUser("Another Claude session sent a message: <teammate-message>status?</teammate-message>")]);
  claudeSession(projects, "owner", [claudeUser("Here is the spec I wrote:\n" + "Spec detail. ".repeat(200)), claudeUser("now build slice 1")]);
  const result = run({ claude: [projects] });
  assert.deepEqual(result.turns.map((t) => t.session), ["owner", "owner"]);
  assert.equal(result.dropped.sessions["only message is a long brief"], 1);
});

test("the owner's brief markers drop a session an agent opened, and single messages an agent sent", () => {
  const projects = tempDir("ht-marker");
  claudeSession(projects, "child", [claudeUser("Act as the review sub-agent for this task. Check slice 2."), claudeUser("Round 2: fix the two findings.")]);
  claudeSession(projects, "owner", [claudeUser("what's left on slice 2?"), claudeUser("From the orchestrating session: rebase on main."), claudeUser("looks good, merge when green")]);
  const result = run({ claude: [projects], markers: ["sub-agent for this task", "From the orchestrating session"] });
  assert.deepEqual(texts(result), ["what's left on slice 2?", "looks good, merge when green"]);
  assert.equal(result.dropped.sessions["opened with a brief marker"], 1);
  assert.equal(result.dropped.messages["has a brief marker"], 1);
});

test("long text repeated three or more times is automation; short repeated replies stay", () => {
  const projects = tempDir("ht-repeat");
  const checkIn = "Overnight check-in for the release. Read the notes, check every open pull request and report status. ".repeat(3);
  claudeSession(projects, "owner", [claudeUser(checkIn), claudeUser(checkIn), claudeUser(checkIn), claudeUser("continue"), claudeUser("continue"), claudeUser("continue")]);
  const result = run({ claude: [projects] });
  assert.deepEqual(texts(result), ["continue", "continue", "continue"]);
  assert.equal(result.dropped.messages["repeated long text"], 3);
});

test("only the named projects and only messages since the start date are read", () => {
  const projects = tempDir("ht-scope");
  claudeSession(projects, "in", [claudeUser("in scope"), claudeUser("too old", { timestamp: "2026-09-01T00:00:00.000Z" })]);
  claudeSession(projects, "other", [claudeUser("private chat in another project", { cwd: "/personal/taxes" })], "-personal-taxes");
  const home = tempDir("ht-scope-codex");
  write(join(home, "sessions", "2026", "10", "20", "rollout-x-other.jsonl"), [{ timestamp: AT, type: "session_meta", payload: { id: "other", cwd: "/personal/taxes", originator: "T3 Code", source: "vscode" } }, codexUserText("codex chat elsewhere")]);
  const result = run({ claude: [projects], codex: [home] });
  assert.deepEqual(texts(result), ["in scope"]);
});

test("the same transcripts reached through two linked folders are read once", () => {
  const projects = tempDir("ht-dupe");
  claudeSession(projects, "owner", [claudeUser("once only")]);
  const link = join(tempDir("ht-dupe-link"), "projects");
  symlinkSync(projects, link);
  assert.deepEqual(texts(run({ claude: [projects, link] })), ["once only"]);
});

test("the command refuses to run without a project, so it can't read every chat on the machine", () => {
  const out = spawnSync(process.execPath, [script, "--since", "2026-10-01", "--out", join(tempDir("ht-cli-refuse"), "o")], { encoding: "utf8" });
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /--project/);
});

test("the command writes private turn and slice files, and prints counts, never message text", () => {
  const projects = tempDir("ht-cli");
  const days = ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"];
  claudeSession(projects, "owner", days.map((d) => claudeUser(`note from ${d}`, { timestamp: `${d}T10:00:00.000Z` })));
  const out = join(tempDir("ht-cli-out"), "mined");
  const stdout = execFileSync(process.execPath, [script, "--since", "2026-10-01", "--project", PROJECT, "--claude", projects, "--codex", tempDir("ht-cli-nocodex"), "--slices", "2", "--out", out], { encoding: "utf8" });
  assert.match(stdout, /Kept 4 messages from 1 session/);
  assert.doesNotMatch(stdout, /note from/);
  assert.equal(statSync(out).mode & 0o777, 0o700);
  assert.deepEqual(readdirSync(out).sort(), ["slice-1.jsonl", "slice-2.jsonl", "summary.json", "turns.jsonl"]);
  assert.equal(statSync(join(out, "turns.jsonl")).mode & 0o777, 0o600);
  const slice = (n) => readFileSync(join(out, `slice-${n}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l).text);
  assert.deepEqual(slice(1), ["note from 2026-10-05", "note from 2026-10-12"]);
  assert.deepEqual(slice(2), ["note from 2026-10-19", "note from 2026-10-26"]);
});
