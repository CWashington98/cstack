#!/usr/bin/env node
// The hold: runs before Bash commands and page publishes. In a repository
// that has opted in, it stops GitHub posts, page publishes and spec commits
// whose text fails the checker or has no pass stamp. Exit 2 holds, with the
// reason on standard error. Any internal error allows the action and is logged.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./lib/config.mjs";
import { checkString } from "./plain-check.mjs";
import { hasStamp, logOverride, logError } from "./plain-stamp.mjs";

const COMMIT_RULES = new Set(["capitals", "planning-code", "never-publish"]);
const GH_VERBS = { pr: ["create", "edit", "comment", "review"], issue: ["create", "edit", "comment"] };

export function extractHeredocs(cmd) {
  const heredocs = new Map();
  let n = 0;
  const text = cmd.replace(/\$\(\s*cat\s+<<-?\s*(['"]?)(\w+)\1\s*\n([\s\S]*?)\n\s*\2\s*\)/g, (_m, _q, _tag, body) => {
    const key = `__HEREDOC_${n++}__`;
    heredocs.set(key, body);
    return key;
  });
  return { text, heredocs };
}

export function segments(cmd) {
  const out = [];
  let cur = "";
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      cur += c;
      continue;
    }
    const pair = cmd.slice(i, i + 2);
    if (c === ";" || c === "\n" || pair === "&&" || pair === "||" || c === "|") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      if (pair === "&&" || pair === "||") i++;
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function tokenize(segment) {
  const out = [];
  let cur = "";
  let quote = null;
  let started = false;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < segment.length) cur += segment[++i];
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      started = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (started) out.push(cur);
      cur = "";
      started = false;
      continue;
    }
    cur += c;
    started = true;
  }
  if (started) out.push(cur);
  return out;
}

function values(tokens, names, { combined = false } = {}) {
  const found = [];
  tokens.forEach((tok, i) => {
    for (const name of names) {
      if (tok === name && i + 1 < tokens.length) found.push(tokens[i + 1]);
      else if (name.startsWith("--") && tok.startsWith(`${name}=`)) found.push(tok.slice(name.length + 1));
      else if (combined && name.length === 2 && /^-[a-zA-Z]+$/.test(tok) && tok.length > 2 && tok.endsWith(name[1]) && i + 1 < tokens.length) found.push(tokens[i + 1]);
    }
  });
  return found;
}

const isInline = (value) => value === "-" || value.includes("$(");

function fileCheck(label, path, base) {
  const full = resolve(base, path);
  if (!existsSync(full)) return null;
  return { type: "text", label, text: readFileSync(full, "utf8"), name: path, stamp: true };
}

function changedSpecFiles(config, all) {
  const run = (...args) => execFileSync("git", args, { cwd: config.root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  let names = run("diff", "--cached", "--name-only").split("\n");
  if (all) names = names.concat(run("diff", "--name-only").split("\n"));
  const watched = (f) => config.watchFolders.some((w) => f.startsWith(w.replace(/\/$/, "") + "/"));
  return [...new Set(names.filter((f) => f && /\.(md|html)$/.test(f) && watched(f)))];
}

export function classify(tool, input, cwd, config) {
  if (tool === "Artifact") {
    if (input.asset || (input.action && input.action !== "publish") || !input.file_path) return [];
    return [fileCheck("Page", input.file_path, cwd)].filter(Boolean);
  }
  if (tool !== "Bash") return [];
  const { text: cmd, heredocs } = extractHeredocs(String(input.command ?? ""));
  const checks = [];
  for (const segment of segments(cmd)) {
    const t = tokenize(segment).map((tok) => heredocs.get(tok) ?? tok);
    while (t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0])) t.shift();

    if (t[0] === "gh" && GH_VERBS[t[1]]?.includes(t[2])) {
      for (const _body of values(t, ["-b", "--body"])) checks.push({ type: "inline", label: "Body" });
      for (const path of values(t, ["-F", "--body-file"])) checks.push(isInline(path) ? { type: "inline", label: "Body" } : fileCheck("Body", path, cwd));
      for (const title of values(t, ["-t", "--title"])) checks.push({ type: "short", label: "Title", text: title });
    }

    if (t[0] === "gh" && t[1] === "api") {
      const endpoint = t.slice(2).find((x) => /^\/?repos\//.test(x)) ?? "";
      if (!/\/(pulls|issues)(\/|$)/.test(endpoint)) continue;
      const fields = values(t, ["-f", "--raw-field", "-F", "--field"]);
      const method = (values(t, ["-X", "--method"])[0] ?? "").toUpperCase();
      const inputFile = values(t, ["--input"])[0];
      if (!fields.length && !inputFile && (!method || method === "GET")) continue;
      for (const field of fields) {
        const eq = field.indexOf("=");
        const key = field.slice(0, eq);
        const value = field.slice(eq + 1);
        if (key === "body") checks.push(value.startsWith("@") ? fileCheck("Body", value.slice(1), cwd) : { type: "inline", label: "Body" });
        if (key === "title") checks.push({ type: "short", label: "Title", text: value });
      }
      if (inputFile && existsSync(resolve(cwd, inputFile))) {
        const json = JSON.parse(readFileSync(resolve(cwd, inputFile), "utf8"));
        if (typeof json.body === "string") checks.push({ type: "text", label: "Body", text: json.body, name: inputFile, stamp: true });
        if (typeof json.title === "string") checks.push({ type: "short", label: "Title", text: json.title });
      }
    }

    if (t[0] === "git" && t[1] === "commit") {
      const messages = values(t, ["-m", "--message"], { combined: true });
      const messageFile = values(t, ["-F", "--file"])[0];
      const message = messages.length ? messages.join("\n\n") : messageFile && existsSync(resolve(cwd, messageFile)) ? readFileSync(resolve(cwd, messageFile), "utf8") : null;
      if (message && !message.includes("$(")) checks.push({ type: "short", label: "Commit message first line", text: message.split("\n")[0], rules: COMMIT_RULES });
      const all = t.includes("--all") || t.slice(2).some((x) => /^-[a-zA-Z]*a[a-zA-Z]*$/.test(x));
      for (const file of changedSpecFiles(config, all)) checks.push(fileCheck(`Spec or plan file ${file}`, file, config.root));
    }
  }
  return checks.filter(Boolean);
}

function evaluate(check, cwd, config) {
  if (check.type === "inline") return [`${check.label}: the text is written inline in the command. Save it to a file, use --body-file (or -F body=@file), and run /plain on that file first.`];
  const { findings } = checkString(check.text, check.name ?? "", cwd, config);
  const holds = findings.filter((f) => f.level === "hold" && (!check.rules || check.rules.has(f.rule)));
  if (holds.length) {
    return [`${check.label} has ${holds.length} problem(s):`, ...holds.slice(0, 8).map((f) => `  line ${f.line}: ${f.message}`), ...(check.name ? [`  Fix them with /plain on ${check.name}.`] : [])];
  }
  if (check.stamp && !hasStamp(cwd, check.text)) return [`${check.label} has no pass stamp for this exact text. Run /plain on ${check.name} first.`];
  return [];
}

export function decide({ tool_name, tool_input = {}, cwd = process.cwd() }) {
  const config = loadConfig(cwd);
  if (!config.enabled) return { allow: true, messages: [] };
  const command = tool_name === "Bash" ? String(tool_input.command ?? "") : "";
  const prefix = command.match(/^\s*PLAIN_OVERRIDE=(?:"([^"]*)"|'([^']*)'|(\S*))(?:\s+|$)/);
  const reason = prefix ? (prefix[1] ?? prefix[2] ?? prefix[3] ?? "").trim() : (process.env.PLAIN_OVERRIDE ?? "").trim();
  if (prefix && !reason) return { allow: false, messages: ['PLAIN_OVERRIDE needs a reason, for example PLAIN_OVERRIDE="quoting a customer word for word".'] };
  const checks = classify(tool_name, tool_input, cwd, config);
  if (!checks.length) return { allow: true, messages: [] };
  if (reason) {
    logOverride(cwd, { reason, tool: tool_name, command: command.slice(0, 200) });
    return { allow: true, messages: [], override: reason };
  }
  const messages = checks.flatMap((c) => evaluate(c, cwd, config));
  return messages.length ? { allow: false, messages } : { allow: true, messages: [] };
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return 0;
  }
  const cwd = input.cwd || process.cwd();
  try {
    const result = decide({ tool_name: input.tool_name, tool_input: input.tool_input, cwd });
    if (result.allow) return 0;
    process.stderr.write(["plain held this post.", ...result.messages, "", 'For a deliberate exception, put PLAIN_OVERRIDE="your reason" in front of the command.'].join("\n") + "\n");
    return 2;
  } catch (error) {
    try {
      logError(cwd, error);
    } catch {}
    return 0;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().then((code) => process.exit(code));
