#!/usr/bin/env node
// The hold: runs before Bash commands and page publishes. In a repository
// that has opted in, it stops GitHub posts, page publishes and spec commits
// whose text fails the checker or has no pass stamp. Exit 2 holds, with the
// reason on standard error. Any internal error allows the action and is logged.
//
// It reads the command the way a shell would run it: it follows a leading
// `cd` and `git -C`, reads heredocs, and remembers a `git add` that comes
// before a `git commit` in the same command. Settings are only loaded when
// the command posts, publishes or commits, so other commands stay fast.
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { resolve, relative } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./lib/config.mjs";
import { checkString } from "./plain-check.mjs";
import { hasStamp, logOverride, logError } from "./plain-stamp.mjs";

const COMMIT_RULES = new Set(["capitals", "planning-code", "never-publish"]);
const GH_VERBS = { pr: ["create", "edit", "comment", "review"], issue: ["create", "edit", "comment"] };
const COMMIT_VALUE_FLAGS = new Set(["-m", "--message", "-F", "--file", "-C", "-c", "--reuse-message", "--reedit-message", "--author", "--date", "--fixup", "--squash", "-t", "--template", "--cleanup", "--trailer"]);

export function extractHeredocs(cmd) {
  const heredocs = new Map();
  let n = 0;
  const keep = (body) => {
    const key = `__HEREDOC_${n++}__`;
    heredocs.set(key, body);
    return key;
  };
  const text = cmd
    .replace(/\$\(\s*cat\s+<<-?\s*(['"]?)(\w+)\1\s*\n([\s\S]*?)\n\s*\2\s*\)/g, (_m, _q, _tag, body) => keep(body))
    .replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$)/g, (_m, _q, _tag, rest, body) => ` <STDIN ${keep(body)}${rest}`);
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

// Pulls standard input out of a segment's tokens: a heredoc marker or a `< file` redirect.
function takeStdin(tokens, heredocs) {
  const rest = [];
  let stdin = null;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === "<STDIN" && heredocs.has(tokens[i + 1])) {
      stdin = { text: heredocs.get(tokens[++i]) };
    } else if (tok === "<" && i + 1 < tokens.length) {
      stdin = { file: tokens[++i] };
    } else if (/^<[^<]/.test(tok)) {
      stdin = { file: tok.slice(1) };
    } else {
      rest.push(heredocs.get(tok) ?? tok);
    }
  }
  return { tokens: rest, stdin };
}

const isInline = (value) => value === "-" || value === "@-" || value.includes("$(");
const realDir = (dir) => (existsSync(dir) ? realpathSync(dir) : dir);

function fileCheck(label, path, dir) {
  const full = resolve(dir, path);
  if (!existsSync(full)) return { type: "missing", label, path, cwd: dir };
  return { type: "text", label, text: readFileSync(full, "utf8"), name: path, stamp: true, cwd: dir };
}

function commitPaths(args) {
  const paths = [];
  let afterDashes = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (afterDashes) paths.push(a);
    else if (a === "--") afterDashes = true;
    else if (COMMIT_VALUE_FLAGS.has(a) || (/^-[a-zA-Z]+$/.test(a) && a.length > 2 && /[mFcC]$/.test(a))) i++;
    else if (!a.startsWith("-")) paths.push(a);
  }
  return paths;
}

export function classify(tool, input, cwd) {
  if (tool === "Artifact") {
    if (input.asset || (input.action && input.action !== "publish") || !input.file_path) return [];
    return [fileCheck("Page", input.file_path, cwd)];
  }
  if (tool !== "Bash") return [];
  const { text: cmd, heredocs } = extractHeredocs(String(input.command ?? ""));
  const checks = [];
  let dir = cwd;
  const adds = [];
  for (const segment of segments(cmd)) {
    let { tokens: t, stdin } = takeStdin(tokenize(segment), heredocs);
    while (t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0])) t.shift();
    if (!t.length) continue;

    if (t[0] === "cd") {
      dir = resolve(dir, t[1] ?? homedir());
      continue;
    }

    if (t[0] === "gh" && GH_VERBS[t[1]]?.includes(t[2])) {
      for (const _body of values(t, ["-b", "--body"])) checks.push({ type: "inline", label: "Body", cwd: dir });
      for (const path of values(t, ["-F", "--body-file"])) checks.push(isInline(path) ? { type: "inline", label: "Body", cwd: dir } : fileCheck("Body", path, dir));
      for (const title of values(t, ["-t", "--title"])) checks.push({ type: "short", label: "Title", text: title, cwd: dir });
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
        if (key === "body") checks.push(value.startsWith("@") && !isInline(value) ? fileCheck("Body", value.slice(1), dir) : { type: "inline", label: "Body", cwd: dir });
        if (key === "title") checks.push({ type: "short", label: "Title", text: value, cwd: dir });
      }
      if (inputFile && isInline(inputFile)) checks.push({ type: "inline", label: "Body", cwd: dir });
      else if (inputFile && existsSync(resolve(dir, inputFile))) {
        const json = JSON.parse(readFileSync(resolve(dir, inputFile), "utf8"));
        if (typeof json.body === "string") checks.push({ type: "text", label: "Body", text: json.body, name: inputFile, stamp: true, cwd: dir });
        if (typeof json.title === "string") checks.push({ type: "short", label: "Title", text: json.title, cwd: dir });
      } else if (inputFile) checks.push({ type: "missing", label: "Body", path: inputFile, cwd: dir });
    }

    if (t[0] === "git") {
      let gitDir = dir;
      let g = t;
      if (g[1] === "-C" && g[2]) {
        gitDir = resolve(dir, g[2]);
        g = ["git", ...g.slice(3)];
      }
      if (g[1] === "add") {
        const args = g.slice(2);
        adds.push({ dir: gitDir, all: args.some((a) => ["-A", "--all", "-u", "--update"].includes(a)), paths: args.filter((a) => !a.startsWith("-")) });
      }
      if (g[1] === "commit") {
        const args = g.slice(2);
        const messages = values(g, ["-m", "--message"], { combined: true });
        const messageFile = values(g, ["-F", "--file"])[0];
        let message = null;
        if (messages.length) message = messages.join("\n\n");
        else if (messageFile === "-" && stdin?.text) message = stdin.text;
        else if (messageFile === "-" && stdin?.file && existsSync(resolve(gitDir, stdin.file))) message = readFileSync(resolve(gitDir, stdin.file), "utf8");
        else if (messageFile && messageFile !== "-" && existsSync(resolve(gitDir, messageFile))) message = readFileSync(resolve(gitDir, messageFile), "utf8");
        if (message && !message.includes("$(")) checks.push({ type: "short", label: "Commit message first line", text: message.replace(/^\s+/, "").split("\n")[0], rules: COMMIT_RULES, cwd: gitDir });
        const all = args.includes("--all") || args.some((x) => /^-[a-zA-Z]*a[a-zA-Z]*$/.test(x));
        checks.push({ type: "commit-specs", cwd: gitDir, all, adds: [...adds], paths: commitPaths(args) });
      }
    }
  }
  return checks;
}

function gitLines(root, ...args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function covers(root, base, spec, file) {
  const rel = relative(root, resolve(realDir(base), spec)).split("\\").join("/");
  return rel === "" || file === rel || file.startsWith(rel.replace(/\/$/, "") + "/");
}

function specFilesForCommit(config, check) {
  const root = config.root;
  const names = new Set(gitLines(root, "diff", "--cached", "--name-only"));
  const modified = gitLines(root, "diff", "--name-only");
  const untracked = gitLines(root, "ls-files", "--others", "--exclude-standard");
  if (check.all) modified.forEach((f) => names.add(f));
  for (const add of check.adds) {
    for (const f of [...modified, ...untracked]) {
      if (add.paths.length ? add.paths.some((p) => covers(root, add.dir, p, f)) : add.all) names.add(f);
    }
  }
  for (const f of modified) if (check.paths.some((p) => covers(root, check.cwd, p, f))) names.add(f);
  const watched = (f) => config.watchFolders.some((w) => f.startsWith(w.replace(/\/$/, "") + "/"));
  return [...names].filter((f) => /\.(md|html)$/.test(f) && watched(f));
}

function evaluate(check, config) {
  if (config.error) return [config.error];
  if (check.type === "inline") return [`${check.label}: the text is written inline in the command or sent through standard input. Save it to a file, use --body-file (or -F body=@file), and run /plain on that file first.`];
  if (check.type === "missing") return [`${check.label} file ${check.path} wasn't found from ${check.cwd}. Check the path.`];
  if (check.type === "commit-specs") {
    return specFilesForCommit(config, check).flatMap((f) => evaluate(fileCheck(`Spec or plan file ${f}`, f, config.root), config));
  }
  const { findings } = checkString(check.text, check.name ?? "", check.cwd, config);
  const holds = findings.filter((f) => f.level === "hold" && (!check.rules || check.rules.has(f.rule)));
  if (holds.length) {
    return [`${check.label} has ${holds.length} problem(s):`, ...holds.slice(0, 8).map((f) => `  line ${f.line}: ${f.message}`), ...(check.name ? [`  Fix them with /plain on ${check.name}.`] : [])];
  }
  if (check.stamp && !hasStamp(check.cwd, check.text)) return [`${check.label} has no pass stamp for this exact text. Run /plain on ${check.name} first.`];
  return [];
}

export function decide({ tool_name, tool_input = {}, cwd = process.cwd() }) {
  const command = tool_name === "Bash" ? String(tool_input.command ?? "") : "";
  const checks = classify(tool_name, tool_input, cwd);
  if (!checks.length) return { allow: true, messages: [] };
  const configs = new Map();
  const configFor = (dir) => {
    if (!configs.has(dir)) configs.set(dir, loadConfig(dir));
    return configs.get(dir);
  };
  const active = checks.filter((c) => configFor(c.cwd).enabled);
  if (!active.length) return { allow: true, messages: [] };
  const prefix = command.match(/^\s*PLAIN_OVERRIDE=(?:"([^"]*)"|'([^']*)'|(\S*))(?:\s+|$)/);
  const reason = prefix ? (prefix[1] ?? prefix[2] ?? prefix[3] ?? "").trim() : (process.env.PLAIN_OVERRIDE ?? "").trim();
  if (prefix && !reason) return { allow: false, messages: ['PLAIN_OVERRIDE needs a reason, for example PLAIN_OVERRIDE="quoting a customer word for word".'] };
  if (reason) {
    logOverride(active[0].cwd, { reason, tool: tool_name, command: command.slice(0, 200) });
    return { allow: true, messages: [], override: reason };
  }
  const messages = [...new Set(active.flatMap((c) => evaluate(c, configFor(c.cwd))))];
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
