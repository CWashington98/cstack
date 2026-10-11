#!/usr/bin/env node
// The guard: runs before every shell command an agent sends, in every project.
// It refuses the commands only the owner runs:
//   - deploys that change a live system, unless that deploy names a target the
//     project lets agents deploy to
//   - store submissions, production app builds, package publishes, GitHub
//     releases, tag pushes, and GitHub workflows that deploy or release
//   - pushes to protected branches, force pushes and deleting protected branches
//   - changes to GitHub secrets, rulesets, branch protection, access and
//     repository settings, and merges that override the code host's rules
//   - recursive deletes outside the repository and temporary folders, of a whole
//     repository, or of its history
//   - anything that uses an entry on the project's "never" list
// Ordinary merges are not guarded: agents merge when the owner says so.
//
// Project facts come from the project's settings file, .claude/verify.json.
// See docs/project-settings.md in cstack for every field. The guard reads:
//   agentsNeverTouch   text agents must never use: production backend names,
//                      addresses, cloud profiles, or whole commands
//   agentsMayDeployTo  deploy targets agents may use, such as a staging backend
//                      or a sandbox profile
//   protectedBranches  branches agents never push to (default main and master),
//                      plus integrationBranch
//
// Each deploy is judged on its own: the target has to be named in the same
// command, in a variable or env file that feeds it, or in the command that ran
// the script it sits in. A target named somewhere else in the line doesn't count.
//
// Exit 2 refuses, with the reasons on standard error. If the guard fails while
// checking a command that looks guarded or names a "never" entry, it refuses;
// otherwise it allows the command and logs the error. If the settings file
// can't be read, it refuses every shell command until the file is fixed.
//
// Its limit, stated plainly: it reads command text, the package scripts and
// shell scripts that text runs, and the env files it loads. Commands started
// from inside a program (a Node or Python script, a Makefile recipe, a
// workflow's own steps) can still get past it, and so can commands fed to a
// shell through a pipe. It guards against mistakes, not against an agent
// working to get around it.
import { readFileSync, existsSync, statSync, readdirSync, appendFileSync, mkdirSync, realpathSync } from "node:fs";
import { resolve, join, dirname, basename, sep } from "node:path";
import { homedir, tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { extractHeredocs, substitutions, segments, tokenize } from "./lib/shell.mjs";

const SETTINGS = join(".claude", "verify.json");
const MAX_DEPTH = 8;
const MAX_FILE_BYTES = 256 * 1024;
const DEPLOY_WORDS = /deploy|release|publish|submit|promote/i;
const PROD_WORDS = /deploy|release|publish|prod|promote|submit/i;

// Each wrapper maps to its flags that take a value. A wrapper only passes
// control to the words after it.
const PLAIN_WRAPPERS = {
  sudo: ["-u", "-g", "-C", "-h"], time: [], nohup: [], exec: ["-a"], command: [], builtin: [], caffeinate: ["-t", "-w"],
  xargs: ["-I", "-L", "-n", "-P", "-d", "-E", "-s"], npx: ["-p", "--package", "-c"], bunx: ["-p", "--package"], pnpx: [],
  nice: ["-n"], stdbuf: ["-i", "-o", "-e"], watch: ["-n", "--interval", "-d"],
};
// Wrappers that load secrets or env files, then run the command after `--`
// (or after their own flags). Each maps to its flags that take a value.
const RUN_WRAPPERS = {
  dotenvx: ["-f", "--env-file", "-fk", "--env-keys-file", "-e", "--env", "--convention"], doppler: ["-p", "--project", "-c", "--config"],
  op: ["--env-file"], infisical: ["--env", "--path", "--projectId"], chamber: [], "aws-vault": ["--duration"],
  dotenv: ["-e", "-c", "-v"], "dotenv-cli": ["-e", "-c", "-v"], "env-cmd": ["-f", "--file", "-e", "--environments", "-r", "--rc-file"], "cross-env": [],
};
// Flags, per program, whose value is an env file the program loads.
const ENV_FILE_FLAGS = { dotenvx: ["-f", "--env-file"], dotenv: ["-e"], "dotenv-cli": ["-e"], "env-cmd": ["-f", "--file"], op: ["--env-file"], node: ["--env-file"], bun: ["--env-file"] };
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
// Shell words that start or end a block. They come before the command, or alone.
const KEYWORDS = new Set(["if", "then", "elif", "else", "do", "while", "until", "!", "{", "}"]);
const BLOCK_ONLY = new Set(["fi", "done", "esac", "for", "case", "select", "in", ";;"]);
// Programs that only read or write text. A "never" name inside them is being
// mentioned, as in a search or a commit message, not used.
const TEXT_ONLY = new Set(["cat", "head", "tail", "less", "more", "grep", "egrep", "fgrep", "rg", "ag", "ack", "wc", "echo", "printf", "jq", "yq", "sort", "uniq", "diff", "ls", "tree", "file", "stat", "which", "type", "sed", "awk", "tee", "cut", "tr", "column", "true", "false", "test", "["]);
// git subcommands that reach another machine. Only these can use a "never" target.
const GIT_REMOTE = new Set(["push", "pull", "fetch", "clone", "ls-remote", "remote", "submodule"]);
// Other names some tools are run by.
const ALIASES = { "eas-cli": "eas", "aws-cdk": "cdk", flyctl: "fly", "netlify-cli": "netlify", sls: "serverless", tofu: "terraform", "npm-run-all": "run-s", "run-p": "run-s" };
// Infrastructure tools and the words that change live systems. Any of these
// words, wherever the tool's own flags put it, counts.
const DEPLOY_TOOLS = {
  cdk: ["deploy", "destroy"],
  sam: ["deploy", "delete", "sync"],
  serverless: ["deploy", "remove"],
  terraform: ["apply", "destroy", "import"],
  pulumi: ["up", "update", "destroy"],
  amplify: ["publish", "push", "delete"],
  firebase: ["deploy"],
  fly: ["deploy"],
  wrangler: ["deploy", "publish"],
  railway: ["up"],
};
const RELEASE_TOOLS = { "semantic-release": null, "release-it": null, changeset: ["publish"], lerna: ["publish"], fastlane: null };
const FASTLANE_RELEASE = /deliver|pilot|supply|release|upload|beta|appstore|app_store|playstore|play_store|submit|production|testflight/i;
const AWS_CHANGES = /^(deploy|delete-stack|create-stack|update-stack|execute-change-set)$/;
const GH_SETTINGS = { secret: /^(set|delete|remove)$/, variable: /^(set|delete|remove)$/, repo: /^(edit|delete|rename|archive|unarchive|deploy-key)$/, release: /^(create|delete|edit|upload)$/ };
const GH_SETTING_PATHS = /\/(rulesets|protection|actions\/secrets|actions\/variables|actions\/permissions|environments|collaborators|hooks|keys|teams|transfer)(\/|$)|^\/?repos\/[^/]+\/[^/]+\/?$/;
const GRAPHQL_SETTINGS = /\b((create|update|delete)BranchProtectionRule|(update|delete|archive|unarchive|transfer)Repository|(create|update|delete)RepositoryRuleset|updateRefs?|deleteRef)\b/;
// Words that make a command look guarded, for the fail-closed check.
const LOOKS_GUARDED = /deploy|submit|publish|release|promote|rollback|push|--prod|--target|secret|variable|ruleset|protection|\brm\b|\bgh\s|apply|destroy|import|\bup\b|\beas\b|workflow|fastlane|alias|merge/i;

const log = (entry) => {
  try {
    const file = process.env.CSTACK_GUARD_LOG || join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "cstack", "guard-log.jsonl");
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), ...entry }) + "\n");
  } catch {}
};

// Hides secrets before a command is written to the log.
export function mask(text) {
  return text
    .replace(/\b([A-Za-z0-9_]*(key|token|secret|password|pass|auth)[A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S+)/gi, "$1=<hidden>")
    .replace(/(--body|-b|--value)(=|\s+)("[^"]*"|'[^']*'|\S+)/g, "$1$2<hidden>")
    .replace(/(Bearer|Basic|token)\s+[^\s"']+/gi, "$1 <hidden>")
    .replace(/(\benv\s+set\s+\S+\s+)("[^"]*"|'[^']*'|\S+)/g, "$1<hidden>")
    .replace(/\|[A-Za-z0-9+/=_-]{16,}/g, "|<hidden>")
    .replace(/(?<![\w/.-])(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}(?![\w/.-])/g, "<hidden>")
    .slice(0, 400);
}

function gitOut(dir, ...args) {
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

// The real path, following links. For a path that doesn't exist yet, the real
// path of its nearest existing folder plus the rest, so /var and /private/var
// on macOS compare equal either way.
function real(p) {
  const full = resolve(p);
  try {
    return realpathSync(full);
  } catch {
    const parent = dirname(full);
    return parent === full ? full : join(real(parent), basename(full));
  }
}

function readText(file) {
  try {
    if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size > MAX_FILE_BYTES) return null;
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

// The repository a folder belongs to, and its settings. A worktree without its
// own settings file uses the main checkout's, since a settings file kept only
// on the owner's machine lives there.
function projectFor(dir, cache) {
  if (cache.has(dir)) return cache.get(dir);
  const top = gitOut(dir, "rev-parse", "--show-toplevel");
  const key = top ? `repo:${top}` : `dir:${dir}`;
  if (cache.has(key)) {
    cache.set(dir, cache.get(key));
    return cache.get(key);
  }
  let file = top && join(top, SETTINGS);
  if (top && !existsSync(file)) {
    const common = gitOut(dir, "rev-parse", "--path-format=absolute", "--git-common-dir");
    const mainFile = common && join(dirname(common), SETTINGS);
    if (mainFile && existsSync(mainFile)) file = mainFile;
  }
  const project = { root: top ? real(top) : null, settingsFile: file && existsSync(file) ? file : null, settings: {}, problem: null };
  if (project.settingsFile) {
    try {
      project.settings = JSON.parse(readFileSync(project.settingsFile, "utf8"));
      for (const field of ["agentsNeverTouch", "agentsMayDeployTo", "protectedBranches"]) {
        const v = project.settings[field];
        if (v !== undefined && !(Array.isArray(v) && v.every((x) => typeof x === "string"))) throw new Error(`"${field}" must be a list of text entries`);
      }
    } catch (e) {
      project.problem = `${project.settingsFile} can't be read: ${e.message}`;
      project.settings = {};
    }
  }
  cache.set(key, project);
  cache.set(dir, project);
  return project;
}

const lower = (s) => s.toLowerCase();
const listed = (list = []) => list.map((s) => s.trim()).filter(Boolean);

function protectedBranches(settings) {
  const set = new Set(listed(settings.protectedBranches ?? ["main", "master"]));
  if (typeof settings.integrationBranch === "string" && settings.integrationBranch.trim()) set.add(settings.integrationBranch.trim());
  return set;
}

const isAssignment = (w) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(w);

// Drops leading NAME=value words, shell block words and wrapper commands, so
// the words start with the program that really runs.
export function unwrap(words) {
  let w = [...words];
  for (let guard = 0; guard < 30 && w.length; guard++) {
    if (isAssignment(w[0]) || KEYWORDS.has(w[0])) {
      w.shift();
      continue;
    }
    if (w[0] === "function") {
      const brace = w.indexOf("{");
      w = brace === -1 ? [] : w.slice(brace + 1);
      continue;
    }
    const prog = programName(w[0]);
    if (prog === "env") {
      w.shift();
      while (w[0] && (w[0].startsWith("-") || isAssignment(w[0]))) w.splice(0, w[0] === "-u" || w[0] === "-C" ? 2 : 1);
      continue;
    }
    if (prog === "timeout") {
      w.shift();
      while (w[0]?.startsWith("-")) w.splice(0, w[0] === "-s" || w[0] === "-k" ? 2 : 1);
      w.shift();
      continue;
    }
    if (Object.hasOwn(PLAIN_WRAPPERS, prog)) {
      w.shift();
      while (w[0]?.startsWith("-")) w.splice(0, PLAIN_WRAPPERS[prog].includes(w[0]) ? 2 : 1);
      continue;
    }
    if ((prog === "pnpm" || prog === "yarn") && (w[1] === "dlx" || w[1] === "exec")) {
      w.splice(0, 2);
      continue;
    }
    if ((prog === "npm" && w[1] === "exec") || (prog === "bun" && w[1] === "x")) {
      w.splice(0, 2);
      if (w[0] === "--") w.shift();
      continue;
    }
    if (Object.hasOwn(RUN_WRAPPERS, prog)) {
      const dash = w.indexOf("--");
      if (dash !== -1) w = w.slice(dash + 1);
      else {
        w.shift();
        if (w[0] === "run" || w[0] === "exec") w.shift();
        while (w[0]?.startsWith("-")) w.splice(0, RUN_WRAPPERS[prog].includes(w[0]) ? 2 : 1);
      }
      continue;
    }
    break;
  }
  return w;
}

// The program name, without folders, version tags or alternative names.
export function programName(word = "") {
  const name = basename(word).replace(/(?<=.)@[^@/]*$/, "");
  return ALIASES[name] ?? name;
}

// The value of a flag, written as `--flag value`, `--flag=value` or, for a
// one-letter flag, `-Xvalue`.
function flagValue(words, names) {
  for (let i = 0; i < words.length; i++) {
    for (const n of names) {
      if (words[i] === n) return words[i + 1] ?? "";
      if (n.startsWith("--") && words[i].startsWith(`${n}=`)) return words[i].slice(n.length + 1);
      if (/^-[A-Za-z]$/.test(n) && words[i].startsWith(n) && words[i].length > 2 && !words[i].startsWith("--")) return words[i].slice(2);
    }
  }
  return null;
}

// The first word after the program that isn't a flag or a flag's value.
function subcommand(w, valueFlags = []) {
  for (let i = 1; i < w.length; i++) {
    if (w[i] === "--") return undefined;
    if (w[i].startsWith("-")) {
      if (valueFlags.includes(w[i])) i++;
      continue;
    }
    return w[i];
  }
  return undefined;
}

const inside = (child, parent) => child !== parent && child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

function nearestPackage(dir) {
  for (let d = dir; ; d = dirname(d)) {
    const file = join(d, "package.json");
    if (existsSync(file)) return file;
    if (dirname(d) === d) return null;
  }
}

function scriptsOf(pkgFile) {
  try {
    return JSON.parse(readFileSync(pkgFile, "utf8")).scripts ?? {};
  } catch {
    return {};
  }
}

// Every workspace package.json in the repository: from package.json
// "workspaces" and pnpm-workspace.yaml, where a pattern ends in /* or /**.
function workspacePackages(root) {
  const patterns = [];
  try {
    const ws = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).workspaces;
    patterns.push(...(Array.isArray(ws) ? ws : ws?.packages ?? []));
  } catch {}
  const pnpm = readText(join(root, "pnpm-workspace.yaml"));
  if (pnpm) patterns.push(...[...pnpm.matchAll(/^\s*-\s*['"]?([^'"\n#]+?)['"]?\s*$/gm)].map((m) => m[1]));
  const files = new Set();
  for (const pattern of patterns.filter((p) => !p.startsWith("!"))) {
    const base = pattern.replace(/\/\*\*?$/, "");
    if (base.includes("*")) continue;
    let dirs = [join(root, base)];
    if (pattern.endsWith("*")) {
      try {
        dirs = readdirSync(join(root, base), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(root, base, d.name));
      } catch {
        dirs = [];
      }
    }
    for (const d of dirs) if (existsSync(join(d, "package.json"))) files.add(join(d, "package.json"));
  }
  return [...files];
}

// The package.json files a workspace filter picks: by package name or folder.
// When nothing matches, every workspace, so a script can't hide behind a name
// the guard can't resolve.
function pickWorkspaces(dir, root, filters) {
  const all = workspacePackages(root);
  const picked = all.filter((file) => {
    let name = "";
    try {
      name = JSON.parse(readFileSync(file, "utf8")).name ?? "";
    } catch {}
    const folder = real(dirname(file));
    return filters.some((f) => {
      const clean = f.replace(/^\{|\}$/g, "").replace(/^\.\.\.|\.\.\.$/g, "").replace(/\^/g, "");
      return clean === name || real(resolve(dir, clean)) === folder || real(resolve(root, clean)) === folder || basename(folder) === clean;
    });
  });
  return picked.length ? picked : all;
}

class Checker {
  constructor(command, cwd) {
    this.command = command;
    this.cwd = real(cwd);
    this.cache = new Map();
    this.project = projectFor(this.cwd, this.cache);
    this.reasons = new Map();
    this.dirs = new Set([this.cwd]);
    this.used = [];
    this.written = new Map();
  }

  refuse(rule, reason) {
    if (!this.reasons.has(reason)) this.reasons.set(reason, rule);
  }

  enter(dir) {
    this.dirs.add(dir);
    return dir;
  }

  run() {
    this.check(this.command, this.cwd, 0, { context: "", vars: new Map(), scriptDir: null, indirect: false });
    const projects = [...new Map([...this.dirs].map((d) => projectFor(d, this.cache)).map((p) => [p.root ?? p, p])).values()];
    for (const p of projects) if (p.problem) this.refuse("settings", `${p.problem}. The guard refuses shell commands until the file is fixed, because it can't see the "never" list. Fix the file with an editor, not a shell command.`);
    const entries = projects.flatMap((p) => listed(p.settings.agentsNeverTouch).map((entry) => ({ entry, file: p.settingsFile })));
    for (const text of this.used.filter(Boolean).map(lower)) {
      for (const { entry, file } of entries) if (text.includes(lower(entry))) this.refuse("never", `It uses "${entry}", which ${file} lists under "agentsNeverTouch".`);
    }
    return [...this.reasons].map(([reason, rule]) => ({ rule, reason }));
  }

  // A deploy goes ahead only when its own context names a target the project
  // lets agents deploy to.
  deploy(what, ctx) {
    const allowed = [...this.dirs].flatMap((d) => listed(projectFor(d, this.cache).settings.agentsMayDeployTo));
    const text = lower(ctx.here ?? "");
    if (allowed.some((t) => text.includes(lower(t)))) return;
    const where = this.project.settingsFile ?? SETTINGS;
    this.refuse("deploy", `${what} changes a live system, and it names no target from "agentsMayDeployTo" in ${where}. Agents deploy only to targets listed there, such as a staging backend or a sandbox. The target must be named in the same command, or in a variable or env file that feeds it.`);
  }

  // Expands a word the way the shell would for a path: ~, $NAME, ${NAME:-x},
  // $(mktemp) and $(dirname "$0"). Returns null when the guard can't tell where
  // the path points.
  expand(word, ctx) {
    let unknown = false;
    const value = (name) => (ctx.vars.has(name) ? ctx.vars.get(name) : process.env[name] ?? null);
    const out = word
      .replace(/^~(?=\/|$)/, homedir())
      .replace(/\$\(\s*mktemp\b[^)]*\)/g, () => join(tmpdir(), "guard-mktemp"))
      .replace(/\$\(\s*(?:cd\s+)?"?\$\(\s*dirname\s+"?\$\{?0\}?"?\s*\)"?(?:\s*&&\s*pwd)?\s*\)|\$\(\s*dirname\s+"?\$\{?0\}?"?\s*\)/g, () => {
        if (!ctx.scriptDir) unknown = true;
        return ctx.scriptDir ?? "";
      })
      .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*):?-([^}]*)\}/g, (_m, name, fallback) => value(name) ?? fallback)
      .replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_m, name) => {
        const v = value(name);
        if (v === null) unknown = true;
        return v ?? "";
      });
    return unknown || /^~|`|\$\(|\$[0-9@*#?]/.test(out) ? null : out;
  }

  // A word once for each value of a loop variable it uses, or just the word.
  variants(word, ctx) {
    for (const [name, values] of ctx.loops ?? []) {
      const re = new RegExp(`\\$\\{?${name}\\}?(?![A-Za-z0-9_])`, "g");
      if (re.test(word)) return values.map((v) => word.replace(re, v));
    }
    return [word];
  }

  check(command, dir, depth, ctx) {
    if (depth > MAX_DEPTH) return;
    const { text, heredocs } = extractHeredocs(command);
    for (const inner of substitutions(text)) this.check(inner, dir, depth + 1, { ...ctx, here: undefined });
    const vars = new Map(ctx.vars);
    const loops = new Map(ctx.loops ?? []);
    let local = ctx.context;
    for (const segment of segments(text)) {
      const words = tokenize(segment);
      // `for NAME in a b c` gives NAME each of those values in the commands after it.
      if (words[0] === "for" && words[2] === "in") {
        loops.set(words[1], words.slice(3));
        this.used.push(words.slice(3).filter((x) => !x.startsWith("$(")).join(" "));
      }
      if (!words.length || BLOCK_ONLY.has(words[0])) continue;
      const heredoc = words.includes("<<HEREDOC") ? heredocs.get(words[words.indexOf("<<HEREDOC") + 1]) ?? "" : null;
      const plain = words.filter((w, i) => w !== "<<HEREDOC" && words[i - 1] !== "<<HEREDOC");
      const segCtx = { ...ctx, vars, loops, here: `${local}\n${segment}` };
      // A line of NAME=value words only sets variables for the commands after it.
      const bare = plain.filter((w) => !KEYWORDS.has(w));
      const assigns = bare[0] && ["export", "local", "readonly", "declare"].includes(bare[0]) ? bare.slice(1).filter((w) => !w.startsWith("-")) : bare;
      if (assigns.length && assigns.every(isAssignment)) {
        for (const a of assigns) {
          const [name, ...rest] = a.split("=");
          vars.set(name, this.expand(rest.join("="), segCtx));
        }
        local += `\n${segment}`;
        this.used.push(segment);
        continue;
      }
      const envText = this.envFiles(plain, dir);
      if (envText) segCtx.here += `\n${envText}`;
      const w = unwrap(plain);
      if (!w.length) continue;
      if (!mentionsOnly(w)) this.used.push(segment, envText);
      if (heredoc !== null) {
        for (const target of words.writes) this.written.set(real(resolve(dir, target)), heredoc);
        if (programName(w[0]) === "tee") for (const f of w.slice(1).filter((x) => !x.startsWith("-"))) this.written.set(real(resolve(dir, f)), heredoc);
        if (!mentionsOnly(w) && !SHELLS.has(programName(w[0]))) this.used.push(heredoc);
      }
      if ((w[0] === "cd" || w[0] === "pushd") && w[1]) {
        const target = this.expand(w[1], segCtx);
        if (target) dir = this.enter(real(resolve(dir, target)));
        continue;
      }
      if (programName(plain[0]) === "xargs" && programName(w[0]) === "rm" && !ctx.indirect) {
        const recursive = w.slice(1).some((f) => f === "--recursive" || /^-[a-zA-Z]*[rR]/.test(f));
        if (recursive && !w.slice(1).some((x) => !x.startsWith("-"))) this.refuse("delete", "It deletes folders named by another command's output through `xargs rm -r`, and the guard can't tell what they are. Delete them by name.");
      }
      this.checkWords(w, dir, depth, segCtx, heredoc);
    }
  }

  // The text of env files a wrapper or program loads, so a "never" name or a
  // deploy target inside them counts.
  envFiles(words, dir) {
    const texts = [];
    for (let i = 0; i < words.length; i++) {
      const flags = ENV_FILE_FLAGS[programName(words[i])];
      if (!flags) continue;
      for (let j = i + 1; j < words.length && words[j] !== "--"; j++) {
        for (const f of flags) {
          let file = null;
          if (words[j] === f) file = words[j + 1];
          else if (f.startsWith("--") && words[j].startsWith(`${f}=`)) file = words[j].slice(f.length + 1);
          if (file) texts.push(readText(resolve(dir, file)) ?? "");
        }
      }
    }
    return texts.join("\n");
  }

  checkWords(w, dir, depth, ctx, heredoc) {
    const prog = programName(w[0]);
    const inner = { context: ctx.here, vars: new Map(), scriptDir: null, indirect: true };
    if (SHELLS.has(prog) || prog === "eval") {
      const same = { ...ctx, context: ctx.here };
      if (prog === "eval") return this.check(w.slice(1).join(" "), dir, depth + 1, same);
      const flag = w.findIndex((x, i) => i > 0 && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(x));
      if (flag !== -1 && w[flag + 1] !== undefined) return this.check(w[flag + 1], dir, depth + 1, same);
      if (heredoc) return this.check(heredoc, dir, depth + 1, same);
      const file = w.slice(1).find((x, i) => !x.startsWith("-") && !["-o", "+o"].includes(w[i]));
      if (file) this.checkScriptFile(resolve(dir, file), dir, depth, inner);
      return;
    }
    if (prog === "source" || w[0] === ".") {
      if (w[1]) this.checkScriptFile(resolve(dir, w[1]), dir, depth, inner);
      return;
    }
    if (w[0].includes("/") && !/^\/(usr|bin|sbin|opt\/homebrew)\//.test(w[0])) {
      const file = real(resolve(dir, w[0]));
      const body = this.written.get(file) ?? readText(file);
      if (body && (/\.(sh|bash|zsh)$/.test(file) || /^#!.*\b(ba|z|da|k)?sh\b/.test(body))) this.checkScriptFile(file, dir, depth, inner);
    }
    if (Object.hasOwn(RELEASE_TOOLS, prog)) {
      const words = RELEASE_TOOLS[prog];
      const args = w.slice(1).filter((x) => !x.startsWith("-"));
      if (prog === "fastlane" ? args.some((x) => FASTLANE_RELEASE.test(x)) : !words || args.some((x) => words.includes(x))) this.refuse("release", `\`${prog}${words ? " publish" : ""}\` publishes a release for everyone to install.`);
      return;
    }
    switch (prog) {
      case "git":
        return this.checkGit(w, dir, ctx);
      case "gh":
        return this.checkGh(w, dir);
      case "rm":
        return this.checkRm(w, dir, ctx);
      case "find":
        return this.checkFind(w, dir, depth, ctx);
      case "convex": {
        const sub = subcommand(w, ["--url", "--admin-key", "--env-file", "--deployment-name", "--deployment", "--preview-name", "--cmd"]);
        if (sub === "deploy") this.deploy("`convex deploy`", ctx);
        if (w.includes("--prod") && sub !== "dashboard") this.refuse("production", "It uses `--prod`, which points a Convex command at the production deployment. Only `convex dashboard --prod` is allowed, because it only prints an address.");
        return;
      }
      case "eas":
        return this.checkEas(w);
      case "vercel": {
        const sub = subcommand(w, ["--scope", "--token", "--cwd", "--target", "-A", "--local-config", "-e", "--env", "-b", "--build-env", "-m", "--meta"]);
        if (sub === "build" || sub === "pull" || sub === "env" || sub === "link") return;
        const target = flagValue(w, ["--target"]);
        if (w.includes("--prod") || w.includes("--production") || /prod/i.test(target ?? "") || ["promote", "rollback", "alias"].includes(sub)) this.deploy("A Vercel production deploy", ctx);
        return;
      }
      case "netlify":
        if (w.includes("deploy") && w.some((x) => x.startsWith("--prod"))) this.deploy("A Netlify production deploy", ctx);
        return;
      case "aws":
        if (w.includes("cloudformation") && w.some((x) => AWS_CHANGES.test(x))) this.deploy("An AWS CloudFormation change", ctx);
        return;
      case "npm":
      case "pnpm":
      case "yarn":
      case "bun":
        return this.checkPackageManager(prog, w, dir, depth, ctx);
      case "run-s":
        return this.checkRunAll(w, dir, depth, ctx);
      case "make":
      case "just":
      case "turbo":
        for (const target of w.slice(1).filter((x) => !x.startsWith("-") && x !== "run")) {
          if (DEPLOY_WORDS.test(target)) this.deploy(`\`${prog} ${target}\``, ctx);
        }
        return;
    }
    const words = DEPLOY_TOOLS[prog];
    if (words) {
      const dash = w.indexOf("--");
      const hit = w.slice(1, dash === -1 ? undefined : dash).find((x) => !x.startsWith("-") && words.includes(x));
      if (hit) this.deploy(`\`${prog} ${hit}\``, ctx);
    }
  }

  checkScriptFile(file, dir, depth, ctx) {
    const full = real(file);
    const body = this.written.get(full) ?? readText(full);
    if (body === null) return;
    this.check(body, dir, depth + 1, { ...ctx, scriptDir: dirname(full) });
  }

  // Runs a package script the way npm, pnpm, yarn and bun do: with its pre and
  // post scripts, in the right workspace. A name that isn't a script runs as a
  // program, as yarn, pnpm and bun do.
  checkPackageManager(prog, w, dir, depth, ctx) {
    const args = [];
    const filters = [];
    for (let i = 1; i < w.length; i++) {
      const a = w[i];
      if (a === "--") break;
      const glued = a.match(/^--(cwd|prefix|dir|filter|workspace)=(.*)$/);
      if (glued) {
        if (["filter", "workspace"].includes(glued[1])) filters.push(glued[2]);
        else dir = this.enter(real(resolve(dir, glued[2])));
      } else if (["--cwd", "--prefix", "-C", "--dir"].includes(a) && w[i + 1]) dir = this.enter(real(resolve(dir, w[++i])));
      else if (["--filter", "-F", "--workspace", "-w"].includes(a) && w[i + 1]) filters.push(w[++i]);
      else if (["--registry", "--tag", "--otp", "--access", "--loglevel"].includes(a)) i++;
      else if (!a.startsWith("-")) args.push({ word: a, index: i });
    }
    if (prog === "yarn" && args[0]?.word === "workspace" && args[1]) {
      filters.push(args[1].word);
      args.splice(0, 2);
    }
    const sub = args[0]?.word;
    if (sub === "publish" || (prog === "yarn" && sub === "npm" && args[1]?.word === "publish")) {
      return this.refuse("release", `\`${prog} publish\` publishes a package for everyone to install.`);
    }
    if (["exec", "dlx", "x"].includes(sub)) {
      const rest = w.slice(args[0].index + 1);
      return this.checkWords(unwrap(rest[0] === "--" ? rest.slice(1) : rest), dir, depth, ctx);
    }
    const named = sub === "run" || sub === "run-script" ? args[1] : prog === "npm" ? null : args[0];
    if (!named) return;
    const root = projectFor(dir, this.cache).root ?? dir;
    const packages = filters.length ? pickWorkspaces(dir, root, filters) : [nearestPackage(dir)].filter(Boolean);
    let found = false;
    for (const pkg of packages) {
      const scripts = scriptsOf(pkg);
      for (const name of [`pre${named.word}`, named.word, `post${named.word}`]) {
        if (typeof scripts[name] !== "string") continue;
        if (name === named.word) found = true;
        this.check(scripts[name], dirname(pkg), depth + 1, { context: ctx.here, vars: new Map(), scriptDir: null, indirect: true });
      }
    }
    if (found) return;
    if (DEPLOY_WORDS.test(named.word)) this.deploy(`The package script \`${named.word}\``, ctx);
    if (prog !== "npm") this.checkWords(w.slice(named.index), dir, depth, ctx);
  }

  // run-s, run-p and npm-run-all run package scripts by name or pattern.
  checkRunAll(w, dir, depth, ctx) {
    const pkg = nearestPackage(dir);
    if (!pkg) return;
    const scripts = scriptsOf(pkg);
    for (const pattern of w.slice(1).filter((x) => !x.startsWith("-"))) {
      const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*?/g, ".*")}$`);
      for (const [name, body] of Object.entries(scripts)) {
        if (re.test(name) && typeof body === "string") this.check(body, dirname(pkg), depth + 1, { context: ctx.here, vars: new Map(), scriptDir: null, indirect: true });
      }
    }
  }

  checkEas(w) {
    const sub = subcommand(w);
    if (sub === "submit") return this.refuse("release", "`eas submit` sends a build to the app stores.");
    if (sub === "build") {
      if (w.some((x) => x.startsWith("--auto-submit"))) return this.refuse("release", "`eas build --auto-submit` sends the build to the app stores.");
      const profile = flagValue(w, ["--profile", "-e"]);
      if (profile === null || /prod/i.test(profile)) this.refuse("release", `\`eas build\` ${profile === null ? "with no profile uses the production profile" : `with the profile "${profile}" makes a store build`}. Name a development or preview profile.`);
      return;
    }
    if (sub === "update") {
      const target = flagValue(w, ["--branch", "--channel"]);
      if (target === null || /prod/i.test(target)) this.refuse("release", "`eas update` without a non-production --branch or --channel can send an update to people's phones.");
    }
  }

  checkGit(w, dir, ctx) {
    let i = 1;
    while (i < w.length && w[i].startsWith("-")) {
      if (w[i] === "-C" && w[i + 1]) {
        const target = this.expand(w[i + 1], ctx);
        if (target) dir = this.enter(real(resolve(dir, target)));
        i += 2;
      } else if (["-c", "--git-dir", "--work-tree", "--namespace"].includes(w[i])) i += 2;
      else i++;
    }
    if (w[i] !== "push") return;
    const args = w.slice(i + 1);
    if (args.some((a) => a === "--dry-run" || a === "-n")) return;
    const branches = protectedBranches(projectFor(dir, this.cache).settings);
    const positional = [];
    let force = false;
    let del = false;
    for (let j = 0; j < args.length; j++) {
      const a = args[j];
      if (a === "-f" || a === "--force" || (/^-[a-zA-Z]+$/.test(a) && a.includes("f"))) force = true;
      else if (a === "--mirror" || a === "--all" || a === "--branches") return this.refuse("push", `\`git push ${a}\` pushes every branch, including protected ones.`);
      else if (a === "--tags" || a === "--follow-tags") return this.refuse("release", `\`git push ${a}\` pushes tags, which often start a release. The owner pushes tags.`);
      else if (a === "-d" || a === "--delete") del = true;
      else if (["-o", "--push-option", "--repo", "--receive-pack", "--exec"].includes(a)) j++;
      else if (!a.startsWith("-")) positional.push(a);
    }
    const refspecs = positional.slice(1);
    if (force || refspecs.some((r) => r.startsWith("+"))) this.refuse("push", "It force-pushes with `--force` or `+`, which can overwrite other people's work. Use `--force-with-lease` on your own branch, or ask the owner.");
    const current = () => gitOut(dir, "symbolic-ref", "--short", "-q", "HEAD");
    const CURRENT = /^\$\(\s*git\s+(branch\s+--show-current|rev-parse\s+--abbrev-ref\s+HEAD|symbolic-ref\s+--short\s+HEAD)\s*\)$/;
    const targets = refspecs.length ? refspecs.flatMap((r) => this.variants(r, ctx)).map((r) => {
      const spec = r.replace(/^\+/, "");
      let dst = spec.includes(":") ? spec.split(":").pop() : spec;
      if (CURRENT.test(dst)) return current();
      if (dst.includes("$")) {
        dst = this.expand(dst, ctx);
        if (dst === null && !ctx.indirect) this.refuse("push", `It pushes to "${r}", and the guard can't tell which branch that is. Name the branch.`);
      }
      return dst === "HEAD" || dst === "@" ? current() : dst;
    }) : del ? [] : [current()];
    for (const t of targets.filter(Boolean)) {
      const isTag = t.startsWith("refs/tags/") || (!t.startsWith("refs/heads/") && this.refs(dir, "tags").has(t) && !this.refs(dir, "heads").has(t));
      if (isTag && !del) {
        this.refuse("release", `It pushes the tag "${t.replace(/^refs\/tags\//, "")}", and tags often start a release. The owner pushes tags.`);
        continue;
      }
      const branch = t.replace(/^refs\/heads\//, "");
      if (!branches.has(branch)) continue;
      if (del || refspecs.some((r) => r.startsWith(":"))) this.refuse("push", `It deletes the protected branch "${branch}".`);
      else this.refuse("push", `It pushes straight to the protected branch "${branch}". Push a feature branch and open a pull request instead.`);
    }
  }

  // The tag or branch names in a folder's repository, read once per command.
  refs(dir, kind) {
    const key = `${kind}:${dir}`;
    if (!this.cache.has(key)) this.cache.set(key, new Set(gitOut(dir, "for-each-ref", "--format=%(refname:short)", `refs/${kind}`).split("\n").filter(Boolean)));
    return this.cache.get(key);
  }

  // True when a workflow deploys or releases: by its name, or because its file
  // uses a production environment.
  workflowDeploys(dir, name) {
    if (PROD_WORDS.test(name)) return true;
    const root = projectFor(dir, this.cache).root ?? dir;
    const base = join(root, ".github", "workflows");
    const text = [name, `${name}.yml`, `${name}.yaml`].map((f) => readText(join(base, f))).find((t) => t !== null);
    return Boolean(text && /environment:\s*(\n\s*name:\s*)?["']?[\w-]*prod/i.test(text));
  }

  checkGh(w, dir) {
    let k = 1;
    while (w[k]?.startsWith("-")) k += ["-R", "--repo", "--hostname"].includes(w[k]) ? 2 : 1;
    const [group, verb] = [w[k], w[k + 1]];
    if (GH_SETTINGS[group]?.test(verb ?? "")) {
      const rule = group === "release" ? "release" : "github-settings";
      return this.refuse(rule, `\`gh ${group} ${verb}\` changes ${group === "release" ? "a published GitHub release" : "GitHub settings, keys or secrets"}. The owner does this.`);
    }
    if (group === "pr" && verb === "merge" && w.includes("--admin")) return this.refuse("github-settings", "`gh pr merge --admin` overrides the repository's merge rules. Merge without `--admin`, or ask the owner.");
    if (group === "workflow" && verb === "run" && w[k + 2] && this.workflowDeploys(dir, w[k + 2])) return this.refuse("deploy", `\`gh workflow run ${w[k + 2]}\` starts a workflow that deploys or releases. The owner starts it.`);
    if (group !== "api") return;
    const rest = w.slice(k + 1);
    let method = null;
    const fields = [];
    let path = "";
    for (let j = 0; j < rest.length; j++) {
      const a = rest[j];
      if (a === "-X" || a === "--method") method = rest[++j];
      else if (/^-X.+/.test(a)) method = a.slice(2);
      else if (a.startsWith("--method=")) method = a.slice(9);
      else if (["-f", "-F", "--field", "--raw-field"].includes(a)) fields.push(rest[++j] ?? "");
      else if (/^-[fF].+/.test(a)) fields.push(a.slice(2));
      else if (/^--(raw-)?field=/.test(a)) fields.push(a.replace(/^--(raw-)?field=/, ""));
      else if (a === "--input") fields.push(`@${rest[++j] ?? ""}`);
      else if (["-H", "--header", "-q", "--jq", "-t", "--template", "--hostname", "--cache", "-p", "--preview"].includes(a)) j++;
      else if (!a.startsWith("-") && !path) path = a;
    }
    method = (method ?? (fields.length ? "POST" : "GET")).toUpperCase();
    const field = (name) => fields.find((f) => f.startsWith(`${name}=`))?.slice(name.length + 1);
    if (path === "graphql") {
      let query = field("query") ?? "";
      if (query.startsWith("@")) query = readText(resolve(dir, query.slice(1))) ?? "";
      if (GRAPHQL_SETTINGS.test(`${query}\n${this.command}`)) this.refuse("github-settings", "It changes repository settings, branch protection or branches through the GitHub GraphQL interface.");
      return;
    }
    if (method === "GET") return;
    const clean = path.split("?")[0];
    if (GH_SETTING_PATHS.test(clean)) return this.refuse("github-settings", `It sends ${method} to ${path}, which changes GitHub settings, secrets or access.`);
    if (/\/releases(\/|$)/.test(clean)) return this.refuse("release", `It sends ${method} to ${path}, which changes a published GitHub release.`);
    const wf = clean.match(/\/actions\/workflows\/([^/]+)\/dispatches$/);
    if (wf ? this.workflowDeploys(dir, wf[1]) : /\/dispatches$/.test(clean)) return this.refuse("deploy", `It sends ${method} to ${path}, which starts a workflow that may deploy or release. The owner starts it.`);
    const branches = protectedBranches(this.project.settings);
    if (/\/merges$/.test(clean) && branches.has(field("base") ?? "")) return this.refuse("push", `It merges straight into the protected branch "${field("base")}" without a pull request.`);
    const ref = clean.match(/\/git\/refs\/heads\/(.+)$/);
    if (ref && (method === "DELETE" || method === "PATCH") && branches.has(ref[1])) this.refuse("push", `It ${method === "DELETE" ? "deletes" : "moves"} the protected branch "${ref[1]}" through the GitHub interface.`);
  }

  // Judges each folder a recursive delete would remove.
  checkPaths(paths, dir, ctx, how, contents = false) {
    const roots = [this.project.root, projectFor(dir, this.cache).root].filter(Boolean);
    const temps = [tmpdir(), "/tmp", "/private/tmp", "/var/folders", "/private/var/folders"].map(real);
    for (const p of paths) {
      const expanded = this.expand(p, ctx);
      if (expanded === null) {
        if (!ctx.indirect) this.refuse("delete", `It deletes "${p}"${how}, and the guard can't tell where that points. Write the path out in full, or set the variable earlier in the same command.`);
        continue;
      }
      const parts = expanded.split(sep);
      const glob = parts.findIndex((part) => /[*?[]/.test(part));
      let base = glob === -1 ? expanded : parts.slice(0, glob).join(sep) || (expanded.startsWith(sep) ? sep : ".");
      if (contents || (glob !== -1 && !/^\.?\*$/.test(parts[glob]))) base = join(base, "glob-match");
      const target = real(resolve(dir, base));
      if (roots.some((r) => target === r || inside(r, target))) {
        this.refuse("delete", `It deletes "${p}"${how}, which is a whole repository or a folder that holds one.`);
        continue;
      }
      if (roots.some((r) => target === join(r, ".git"))) {
        this.refuse("delete", `It deletes "${p}"${how}, the repository's history.`);
        continue;
      }
      if (roots.some((r) => inside(target, r)) || temps.some((t) => inside(target, t))) continue;
      this.refuse("delete", `It deletes "${p}"${how}, which is outside this repository and outside temporary folders.`);
    }
  }

  checkRm(w, dir, ctx) {
    const flags = w.slice(1).filter((x) => x.startsWith("-") && x !== "--");
    if (!flags.some((f) => f === "--recursive" || (/^-[a-zA-Z]+$/.test(f) && /[rR]/.test(f)))) return;
    const ends = w.indexOf("--");
    const paths = w.slice(1).filter((x, k) => x !== "--" && ((ends !== -1 && k + 1 > ends) || !x.startsWith("-")));
    this.checkPaths(paths.flatMap((p) => this.variants(p, ctx)), dir, ctx, "");
  }

  // find deletes with -delete or -exec rm, and runs other commands with -exec.
  checkFind(w, dir, depth, ctx) {
    const starts = [];
    for (let i = 1; i < w.length && !/^[-(!]/.test(w[i]); i++) starts.push(w[i]);
    const execAt = w.findIndex((x) => x === "-exec" || x === "-execdir" || x === "-ok");
    let run = [];
    if (execAt !== -1) {
      const end = w.findIndex((x, k) => k > execAt && (x === ";" || x === "+"));
      run = w.slice(execAt + 1, end === -1 ? undefined : end);
    }
    const deletes = w.includes("-delete") || (run.length > 0 && programName(run[0]) === "rm");
    if (deletes) this.checkPaths(starts.length ? starts : ["."], dir, ctx, " with `find`", true);
    if (run.length && programName(run[0]) !== "rm") {
      const cmd = unwrap(run);
      this.used.push(cmd.join(" "));
      if (cmd.length) this.checkWords(cmd, dir, depth, ctx, null);
    }
  }
}

// True when a command only mentions names: it reads or writes text, writes a
// commit, or posts a comment or pull request, and reaches nothing else.
function mentionsOnly(w) {
  const prog = programName(w[0]);
  if (TEXT_ONLY.has(prog)) return true;
  if (prog === "git") return !w.some((x) => GIT_REMOTE.has(x));
  if (prog === "gh") {
    if (["pr", "issue"].includes(w[1]) && ["create", "edit", "comment", "review", "view", "list"].includes(w[2])) return true;
    if (w[1] === "api") return w.some((x) => /\/(comments|reviews)(\/\d+)?(\?|$)/.test(x));
  }
  return false;
}

export function decide({ tool_name, tool_input = {}, cwd = process.cwd() }) {
  if (tool_name !== "Bash" || typeof tool_input.command !== "string") return { allow: true, refusals: [] };
  const refusals = new Checker(tool_input.command, cwd).run();
  return { allow: refusals.length === 0, refusals };
}

// What to do when the guard itself fails: refuse a command that looks guarded
// or names a "never" entry, and allow the rest.
export function refuseOnError(command, cwd) {
  if (LOOKS_GUARDED.test(command)) return true;
  try {
    const dir = typeof cwd === "string" ? cwd : process.cwd();
    const never = listed(projectFor(real(dir), new Map()).settings.agentsNeverTouch);
    return never.some((e) => lower(command).includes(lower(e)));
  } catch {
    return true;
  }
}

export function message(refusals) {
  return [
    "The cstack guard refused this command. Only the owner runs it.",
    ...refusals.map((r) => `- ${r.reason}`),
    "",
    "If the owner wants it run, give them the exact command to run themselves with ! in front. Don't look for another way to run it.",
  ].join("\n");
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try {
    input = JSON.parse(raw);
  } catch (error) {
    // Claude Code always sends valid input; anything else isn't a command to judge.
    log({ decision: "error", error: `unreadable hook input: ${error.message}` });
    return 0;
  }
  const cwd = input.cwd || process.cwd();
  const command = typeof input.tool_input?.command === "string" ? input.tool_input.command : "";
  try {
    const result = decide({ tool_name: input.tool_name, tool_input: input.tool_input, cwd });
    if (result.allow) return 0;
    log({ decision: "refused", cwd, rules: [...new Set(result.refusals.map((r) => r.rule))], command: mask(command) });
    process.stderr.write(message(result.refusals) + "\n");
    return 2;
  } catch (error) {
    const refuse = refuseOnError(command, cwd);
    log({ decision: refuse ? "refused-on-error" : "error", cwd: String(cwd), command: mask(command), error: String(error?.stack ?? error).slice(0, 600) });
    if (!refuse) return 0;
    process.stderr.write(message([{ reason: `The guard failed while checking it (${error?.message ?? error}), and the command looks like one it guards, so it refuses to be safe.` }]) + "\n");
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then((code) => process.exit(code));
