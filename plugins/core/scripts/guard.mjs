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
// It also runs before every call to a tool server (a tool whose name starts
// with mcp__, such as a hosting or database tool), and refuses a call whose
// input uses an entry on the "never" list. Built-in tools that read or edit
// files are not checked.
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
// shell through a pipe. docs/project-settings.md lists every known limit. It
// guards against mistakes, not against an agent working to get around it.
import { readFileSync, existsSync, statSync, readdirSync, appendFileSync, mkdirSync, realpathSync } from "node:fs";
import { resolve, join, dirname, basename, sep } from "node:path";
import { homedir, tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { extractHeredocs, substitutions, segments, tokenize } from "./lib/shell.mjs";

const SETTINGS = join(".claude", "verify.json");
const MAX_DEPTH = 8;
// The most commands one hook call checks. A command past this is refused, so a
// tangle of scripts can't run the guard past its time limit, which would let
// the command through.
const MAX_STEPS = 20000;
const MAX_FILE_BYTES = 256 * 1024;
// The most folders one command may move into. Each new folder costs a call to
// git, about 8 ms, so a command past this is refused rather than let run the
// guard past its time limit.
const MAX_FOLDERS = 200;
const DEPLOY_WORDS = /deploy|release|publish|submit|promote/i;
const PROD_WORDS = /deploy|release|publish|prod|promote|submit/i;
// Names that only read about a deploy or release, such as release-notes or deploy:check.
const ABOUT_A_DEPLOY = /[-:_.](notes?|changelog|check|lint|tests?|dry-?run|plan|diff|status|list|help)$/i;
const namesDeploy = (name) => DEPLOY_WORDS.test(name) && !ABOUT_A_DEPLOY.test(name);

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
const KEYWORDS = new Set(["if", "then", "elif", "else", "do", "while", "until", "!", "{", "}", "coproc"]);
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
  "drizzle-kit": ["push", "migrate"],
  helm: ["upgrade", "install", "uninstall", "rollback"],
  heroku: ["container:release", "releases:rollback", "container:push"],
};
const RELEASE_TOOLS = { "semantic-release": null, "release-it": null, changeset: ["publish"], lerna: ["publish"], fastlane: null };
const FASTLANE_RELEASE = /deliver|pilot|supply|release|upload|beta|appstore|app_store|playstore|play_store|submit|production|testflight/i;
const AWS_CHANGES = /^(deploy|delete-stack|create-stack|update-stack|execute-change-set)$/;
const GH_SETTINGS = { secret: /^(set|delete|remove)$/, variable: /^(set|delete|remove)$/, repo: /^(edit|delete|rename|archive|unarchive|deploy-key)$/, release: /^(create|delete|edit|upload)$/ };
const GH_SETTING_PATHS = /\/(rulesets|protection|actions\/secrets|actions\/variables|actions\/permissions|environments|collaborators|hooks|keys|teams|transfer)(\/|$)|^\/?repos\/[^/]+\/[^/]+\/?$/;
const GRAPHQL_SETTINGS = /\b((create|update|delete)BranchProtectionRule|(update|delete|archive|unarchive|transfer)Repository|(create|update|delete)RepositoryRuleset|updateRefs?|deleteRef)\b/;
// Words that make a command look guarded, for the fail-closed check, along
// with every program and command word in the deploy and release tables.
const LOOKS_GUARDED = /deploy|submit|publish|release|promote|rollback|push|--prod|--target|secret|variable|ruleset|protection|\brm\b|\bgh\s|apply|destroy|import|\bup\b|\beas\b|workflow|fastlane|alias|merge|\bsync\b|delete|remove|channel|migrate|cloudformation|\bversion\b/i;
const GUARDED_WORDS = new Set([...Object.keys(DEPLOY_TOOLS), ...Object.values(DEPLOY_TOOLS).flat(), ...Object.keys(RELEASE_TOOLS)]);
// bun's own commands. `bun build` runs bun's bundler, not a package script.
const BUN_BUILTINS = new Set(["build", "test", "install", "i", "add", "remove", "rm", "pm", "link", "unlink", "create", "init", "upgrade", "outdated", "publish", "patch", "x", "repl", "exec", "update", "audit", "info", "why"]);
// Programs that work on files, where a word like "deploy" names a folder.
// Programs that work on files, run tests or check code, where a word like
// "deploy" names a folder or a test filter, never a deploy.
const FILE_TOOLS = new Set([
  "mkdir", "cp", "mv", "touch", "ln", "chmod", "chown", "rmdir", "open", "code", "vim", "nano", "cursor", "du", "zip", "unzip", "tar", "realpath", "fd", "watchexec",
  "vitest", "jest", "mocha", "ava", "playwright", "cypress", "pytest", "tox", "cargo", "go", "node", "deno", "python", "python3", "ruby", "php",
  "eslint", "prettier", "biome", "tsc", "mypy", "ruff", "black", "flake8", "pylint", "yamllint", "markdownlint", "stylelint", "oxlint", "knip",
  "kubectl", "oc", "k9s",
]);
// Programs the guard reads in their own way, so the general deploy-word rule skips them.
const OWN_RULES = new Set(["git", "gh", "vercel", "netlify", "eas", "firebase", "convex", "npm", "pnpm", "yarn", "bun", "make", "just", "turbo", "run-s", "rm", "find", "nx", "ng", "lerna", "docker"]);
// nx commands that aren't the name of a target.
const NX_COMMANDS = new Set(["run", "run-many", "affected", "graph", "dep-graph", "show", "g", "generate", "init", "list", "migrate", "report", "reset", "daemon", "format", "format:write", "format:check", "release", "connect", "view-logs", "exec", "watch", "sync", "sync:check", "repair", "add", "import", "help"]);
const DEPLOY_TARGET = /(^|:)deploy(:|$)/;
// Programs that run other scripts or commands and pass flags on to them.
const RUNNERS = new Set(["npm", "pnpm", "yarn", "bun", "make", "just", "turbo", "run-s", "nx", "ng", "lerna", "npx", "bunx", "pnpx", "deno", "node", "python", "python3", "env", "xargs"]);
// $( ) forms whose value the guard can work out: the checked-out branch, the
// repository's top folder and the current folder.
const CURRENT_BRANCH = /\$\(\s*git\s+(branch\s+--show-current|rev-parse\s+--abbrev-ref\s+HEAD|symbolic-ref\s+--short(\s+-q)?\s+HEAD)\s*\)/g;
const TOP_FOLDER = /\$\(\s*git\s+rev-parse\s+--show-toplevel\s*\)/g;
const VERSION_LIKE = /^v?\d+\.\d+(\.\d+)?([-+][\w.]+)?$/;

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
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"']*:)[^\s@/"']+@/gi, "$1<hidden>@")
    .replace(/((?:^|\s)(?:-u|--user)(?:=|\s+)["']?[^\s:"']*:)[^\s"']+/g, "$1<hidden>")
    .replace(/\b([\w-]*(?:key|token|secret|auth|password|cookie)[\w-]*\s*:)\s*[^"'\n]+/gi, "$1 <hidden>")
    .replace(/("\w*(?:key|token|secret|password|pass|auth|value)\w*"\s*:\s*)"(?:[^"\\]|\\.)*"/gi, '$1"<hidden>"')
    .replace(/(<<<\s*)("[^"]*"|'[^']*'|\S+)/g, "$1<hidden>")
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
const settingsReason = (problem) => `${problem}. The guard refuses shell commands and tool-server calls until the file is fixed, because it can't see the "never" list. Fix the file with an editor, not a shell command.`;
const neverReason = (entry, file) => `It uses "${entry}", which ${file} lists under "agentsNeverTouch".`;
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
    if (w[0] === "coproc" && w[2] === "{") {
      w = w.slice(3);
      continue;
    }
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
      if (w[0] === "--") w.shift();
      continue;
    }
    if ((prog === "npm" && w[1] === "exec") || (prog === "bun" && w[1] === "x")) {
      w.splice(0, 2);
      const dash = w.indexOf("--");
      if (dash !== -1 && w.slice(0, dash).every((x) => x.startsWith("-"))) w = w.slice(dash + 1);
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
    this.heredocs = new Map();
    this.newTags = new Set();
    this.newBranches = new Set();
    this.running = new Set();
    this.checked = new Set();
    this.steps = 0;
  }

  refuse(rule, reason) {
    if (!this.reasons.has(reason)) this.reasons.set(reason, rule);
  }

  enter(dir) {
    if (!this.dirs.has(dir) && this.dirs.size >= MAX_FOLDERS) this.refuse("complex", `It moves through more folders than the guard can check in time (more than ${MAX_FOLDERS}). Run the parts separately.`);
    else this.dirs.add(dir);
    return dir;
  }

  run() {
    this.check(this.command, this.cwd, 0, { context: "", vars: new Map(), scriptDir: null, indirect: false });
    const projects = [...new Map([...this.dirs].map((d) => projectFor(d, this.cache)).map((p) => [p.root ?? p, p])).values()];
    for (const p of projects) if (p.problem) this.refuse("settings", settingsReason(p.problem));
    const entries = projects.flatMap((p) => listed(p.settings.agentsNeverTouch).map((entry) => ({ entry, file: p.settingsFile })));
    for (const text of this.used.filter(Boolean).map(lower)) {
      for (const { entry, file } of entries) if (text.includes(lower(entry))) this.refuse("never", neverReason(entry, file));
    }
    return [...this.reasons].map(([reason, rule]) => ({ rule, reason }));
  }

  // True when the text names a target the project lets agents deploy to.
  namesAllowed(text = "") {
    const allowed = [...this.dirs].flatMap((d) => listed(projectFor(d, this.cache).settings.agentsMayDeployTo));
    const low = lower(text);
    return allowed.some((t) => new RegExp(`(?<![\\w.-])${lower(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(low));
  }

  // A deploy goes ahead only when its own context names a target the project
  // lets agents deploy to.
  deploy(what, ctx) {
    if (this.namesAllowed(ctx.here)) return;
    const where = this.project.settingsFile ?? SETTINGS;
    this.refuse("deploy", `${what} changes a live system, and it names no target from "agentsMayDeployTo" in ${where}. Agents deploy only to targets listed there, such as a staging backend or a sandbox. The target must be named in the same command, or in a variable or env file that feeds it.`);
  }

  // Expands a word the way the shell would for a path: ~, $NAME, ${NAME:-x},
  // $(mktemp) and $(dirname "$0"). Returns null when the guard can't tell where
  // the path points.
  expand(word, ctx) {
    let unknown = false;
    const value = (name) => (name === "PWD" && ctx.dir ? ctx.dir : ctx.vars.has(name) ? ctx.vars.get(name) : process.env[name] ?? null);
    const out = word
      .replace(/^~(?=\/|$)/, homedir())
      .replace(CURRENT_BRANCH, () => (ctx.dir && this.currentBranch(ctx.dir)) || "$(unknown)")
      .replace(TOP_FOLDER, () => (ctx.dir && projectFor(ctx.dir, this.cache).root) || "$(unknown)")
      .replace(/\$\(\s*pwd\s*\)/g, () => ctx.dir ?? "$(unknown)")
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

  // A word once for each value of a loop variable it uses and each choice in
  // a {a,b} brace list, or just the word.
  variants(word, ctx) {
    const brace = word.match(/\{([^{}]*,[^{}]*)\}/);
    if (brace) return brace[1].split(",").flatMap((v) => this.variants(word.replace(brace[0], v), ctx));
    for (const [name, values] of ctx.loops ?? []) {
      const re = new RegExp(`\\$\\{?${name}\\}?(?![A-Za-z0-9_])`, "g");
      if (re.test(word)) return values.map((v) => word.replace(re, v));
    }
    return [word];
  }

  currentBranch(dir) {
    const key = `branch:${dir}`;
    if (!this.cache.has(key)) this.cache.set(key, gitOut(dir, "symbolic-ref", "--short", "-q", "HEAD"));
    return this.cache.get(key);
  }

  check(command, dir, depth, ctx) {
    if (depth > MAX_DEPTH) return this.refuse("complex", `It runs scripts nested more than ${MAX_DEPTH} levels deep, which the guard doesn't check. Run the inner command directly.`);
    if (++this.steps > MAX_STEPS) return this.refuse("complex", "It runs more scripts than the guard can check in time. Run the parts separately.");
    const { text, heredocs } = extractHeredocs(command);
    for (const [k, v] of heredocs) this.heredocs.set(k, v);
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
      const heredoc = words.includes("<<HEREDOC") ? this.heredocs.get(words[words.indexOf("<<HEREDOC") + 1]) ?? "" : null;
      const plain = words.filter((w, i) => w !== "<<HEREDOC" && words[i - 1] !== "<<HEREDOC");
      const segCtx = { ...ctx, vars, loops, dir, here: `${local}\n${segment}` };
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
      const lead = [];
      for (const word of plain) {
        if (!isAssignment(word)) break;
        lead.push(word);
      }
      segCtx.passVars = new Map(vars);
      for (const a of lead) {
        const [name, ...rest] = a.split("=");
        segCtx.passVars.set(name, this.expand(rest.join("="), segCtx));
      }
      const envText = this.envFiles(plain, dir);
      if (envText) segCtx.here += `\n${envText}`;
      const w = unwrap(plain);
      if (!w.length) continue;
      if (!mentionsOnly(w)) this.used.push(segment, envText);
      if (heredoc !== null) {
        for (const target of words.writes) this.write(dir, target, heredoc, words.appends.has(target));
        if (programName(w[0]) === "tee") for (const f of w.slice(1).filter((x) => !x.startsWith("-"))) this.write(dir, f, heredoc, w.includes("-a"));
        if (!mentionsOnly(w) && !SHELLS.has(programName(w[0]))) this.used.push(heredoc);
      }
      const printed = printedText(w);
      if (printed !== null) for (const target of words.writes) this.write(dir, target, printed, words.appends.has(target));
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

  // Remembers what a command writes to a file, so a script run later in the
  // same command is read from what was written.
  write(dir, target, text, append) {
    const file = real(resolve(dir, target));
    this.written.set(file, append ? `${this.written.get(file) ?? readText(file) ?? ""}\n${text}` : text);
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
      const after = w.slice(flag + 1);
      const cmd = flag === -1 ? undefined : after.find((x, j) => !/^([-+][a-zA-Z]+|--)$/.test(x) && !["-o", "+o", "-O", "+O"].includes(after[j - 1]));
      if (cmd !== undefined) {
        const fromHeredoc = cmd.match(/^\$\(\s*cat\s+<<HEREDOC\s+(__HEREDOC_\d+__)\s*\)$/);
        return this.check(fromHeredoc ? this.heredocs.get(fromHeredoc[1]) ?? "" : cmd, dir, depth + 1, same);
      }
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
    // A tool asked for its own help changes nothing. Script runners pass
    // flags on to the script, which still runs, so they never count, and
    // neither does `-h`, which some tools read as a host name.
    const beforeDash = w.indexOf("--") === -1 ? w : w.slice(0, w.indexOf("--"));
    if (!RUNNERS.has(prog) && (beforeDash.includes("--help") || w[1] === "help")) return;
    if (Object.hasOwn(RELEASE_TOOLS, prog)) {
      const words = RELEASE_TOOLS[prog];
      const args = w.slice(1).filter((x) => !x.startsWith("-"));
      if (prog === "fastlane" ? args.some((x) => FASTLANE_RELEASE.test(x)) : !words || args.some((x) => words.includes(x))) return this.refuse("release", `\`${prog}${words ? " publish" : ""}\` publishes a release for everyone to install.`);
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
        if (w.some((x) => /^--prod(uction)?(=(?!false$)|$)/.test(x)) || /prod/i.test(target ?? "") || ["promote", "rollback", "alias"].includes(sub)) this.deploy("A Vercel production deploy", ctx);
        return;
      }
      case "netlify":
        if (w.includes("deploy") && w.some((x) => x.startsWith("--prod") || x === "-p")) this.deploy("A Netlify production deploy", ctx);
        return;
      case "aws": {
        if (w.includes("cloudformation") && w.some((x) => AWS_CHANGES.test(x))) this.deploy("An AWS CloudFormation change", ctx);
        // A sync into a bucket that deletes what the source lacks replaces a live site.
        const from = w.slice(w.indexOf("sync") + 1).find((x) => !x.startsWith("-"));
        if (w.includes("s3") && w.includes("sync") && w.includes("--delete") && w.some((x) => x.startsWith("s3://") && x !== from)) this.deploy("`aws s3 sync --delete` into a bucket", ctx);
        return;
      }
      case "npm":
      case "pnpm":
      case "yarn":
      case "bun":
        return this.checkPackageManager(prog, w, dir, depth, ctx);
      case "run-s":
        return this.checkRunAll(w, dir, depth, ctx);
      case "docker":
        if (subcommand(w, ["-H", "--host", "--context", "-c", "--config", "-l", "--log-level"]) === "stack" && w.includes("deploy")) this.deploy("`docker stack deploy`", ctx);
        return;
      case "nx":
      case "ng":
      case "lerna":
        return this.checkMonorepoTool(prog, w, dir, depth, ctx);
      case "make":
      case "just":
      case "turbo":
      {
        const filters = [];
        const targets = [];
        for (let i = 1; i < w.length; i++) {
          if (w[i] === "--") break;
          if (prog === "turbo" && (w[i] === "--filter" || w[i] === "-F") && w[i + 1]) filters.push(w[++i]);
          else if (prog === "turbo" && w[i].startsWith("--filter=")) filters.push(w[i].slice(9));
          else if (!w[i].startsWith("-") && w[i] !== "run") targets.push(w[i]);
        }
        for (const target of targets) {
          if (namesDeploy(target)) this.deploy(`\`${prog} ${target}\``, ctx);
          if (prog !== "turbo") continue;
          if (!filters.length) this.runEverywhere(target, dir, depth, ctx);
          else for (const pkg of pickWorkspaces(dir, projectFor(dir, this.cache).root ?? dir, filters)) this.runScript(pkg, target, depth, ctx);
        }
        return;
      }
    }
    const words = DEPLOY_TOOLS[prog];
    const dash = w.indexOf("--");
    const args = w.slice(1, dash === -1 ? undefined : dash).filter((x) => !x.startsWith("-"));
    if (words) {
      const hit = args.find((x) => words.includes(x));
      if (prog === "helm" && (args[args.indexOf(hit) - 1] === "plugin" || w.some((x) => /^--dry-run(=(?!none$)|$)/.test(x)))) return;
      if (hit) this.deploy(`\`${prog} ${hit}\``, ctx);
      return;
    }
    if (prog === "supabase" && args[0] === "db" && args[1] === "push") return this.deploy("`supabase db push`", ctx);
    if (prog === "supabase" && args[0] === "migration" && args[1] === "up" && w.includes("--linked")) return this.deploy("`supabase migration up --linked`", ctx);
    // Any other tool whose command is `deploy`, such as `gcloud run deploy` or
    // `supabase functions deploy`. Only the tool's command words count, not a
    // flag's value.
    if (!OWN_RULES.has(prog) && !FILE_TOOLS.has(prog) && !mentionsOnly(w)) {
      const command = [];
      for (let i = 1; i < w.length && command.length < 3; i++) {
        if (w[i] === "--") break;
        if (w[i].startsWith("-")) {
          if (!w[i].includes("=") && w[i + 1] && !w[i + 1].startsWith("-")) i++;
          continue;
        }
        command.push(w[i]);
      }
      const hit = command.find((x) => DEPLOY_TARGET.test(x));
      if (hit) this.deploy(`\`${prog} ${command.slice(0, command.indexOf(hit) + 1).join(" ")}\``, ctx);
    }
  }

  // nx, Angular and Lerna run targets across the repository. A target named
  // deploy is a deploy; any other target is read as a package script in every
  // workspace that has it.
  checkMonorepoTool(prog, w, dir, depth, ctx) {
    const args = [];
    for (let i = 1; i < w.length; i++) {
      if (w[i] === "--") {
        if (prog === "lerna" && args[0] === "exec") return this.checkWords(unwrap(w.slice(i + 1)), dir, depth, ctx);
        break;
      }
      if (w[i].startsWith("-")) {
        if (!w[i].includes("=") && ["-t", "--target", "--targets", "-p", "--projects", "-c", "--configuration", "--base", "--head", "--scope"].includes(w[i])) i++;
        continue;
      }
      args.push(w[i]);
    }
    if (prog === "nx" && args[0] === "release" && !w.includes("--dry-run") && !w.includes("-d")) return this.refuse("release", "`nx release` versions, tags and publishes packages. The owner releases.");
    let targets = [];
    if (args[0] === "run" && args[1]) targets = [args[1].includes(":") ? args[1].split(":")[1] : args[1]];
    else if (["run-many", "affected"].includes(args[0])) targets = (flagValue(w, ["-t", "--target", "--targets"]) ?? "").split(",").filter(Boolean);
    else if (prog === "ng" && args[0] === "deploy") targets = ["deploy"];
    else if (prog === "nx" && args[0] && !NX_COMMANDS.has(args[0])) targets = [args[0].includes(":") ? args[0].split(":")[1] : args[0]];
    for (const t of targets) {
      if (DEPLOY_TARGET.test(t)) this.deploy(`\`${prog} ${t}\``, ctx);
      this.runEverywhere(t, dir, depth, ctx);
    }
  }

  // Runs a script in every workspace that has it, for commands that run a
  // script across the whole repository.
  runEverywhere(name, dir, depth, ctx) {
    const root = projectFor(dir, this.cache).root ?? dir;
    for (const pkg of [nearestPackage(root), ...workspacePackages(root)].filter(Boolean)) this.runScript(pkg, name, depth, ctx);
  }

  // Checks one package script, unless it is already being checked further up,
  // so a script that calls itself can't make the guard loop.
  runScript(pkg, name, depth, ctx) {
    const body = scriptsOf(pkg)[name];
    if (typeof body !== "string") return false;
    // A script's result depends only on its own text and on whether the command
    // that runs it names an allowed target, so each pair is checked once.
    const key = `${pkg}#${name}#${this.namesAllowed(ctx.here)}`;
    if (this.running.has(key) || this.checked.has(key)) return true;
    this.running.add(key);
    this.checked.add(key);
    const vars = new Map(ctx.passVars ?? ctx.vars ?? []);
    try {
      const json = JSON.parse(readFileSync(pkg, "utf8"));
      if (json.version) vars.set("npm_package_version", String(json.version));
      if (json.name) vars.set("npm_package_name", String(json.name));
    } catch {}
    this.check(body, dirname(pkg), depth + 1, { context: ctx.here, vars, scriptDir: null, indirect: true });
    this.running.delete(key);
    return true;
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
      else if (["-r", "--recursive", "--workspaces", "-ws", "-A", "--all"].includes(a)) filters.push("*every*");
      else if (["--registry", "--tag", "--otp", "--access", "--loglevel"].includes(a)) i++;
      else if (!a.startsWith("-")) args.push({ word: a, index: i });
    }
    if (prog === "yarn" && args[0]?.word === "workspace" && args[1]) {
      filters.push(args[1].word);
      args.splice(0, 2);
    }
    if (prog === "yarn" && args[0]?.word === "workspaces" && ["foreach", "run"].includes(args[1]?.word)) {
      filters.push("*every*");
      args.splice(0, args[1].word === "run" ? 1 : 2);
    }
    const sub = args[0]?.word;
    if (sub === "publish" || (prog === "yarn" && sub === "npm" && args[1]?.word === "publish")) {
      return this.refuse("release", `\`${prog} publish\` publishes a package for everyone to install.`);
    }
    if (sub === "version") {
      this.versionBump = true;
      const pkg = nearestPackage(dir);
      if (pkg) for (const name of ["preversion", "version", "postversion"]) this.runScript(pkg, name, depth, ctx);
      return;
    }
    if (prog === "bun" && sub === "exec") return this.check(w.slice(args[0].index + 1).join(" "), dir, depth + 1, { ...ctx, context: ctx.here });
    if (["exec", "dlx", "x"].includes(sub)) {
      const rest = w.slice(args[0].index + 1);
      return this.checkWords(unwrap(rest[0] === "--" ? rest.slice(1) : rest), dir, depth, ctx);
    }
    const named = sub === "run" || sub === "run-script" ? args[1] : prog === "npm" ? null : args[0];
    if (!named) return;
    // Without `run`, these name the tool's own command, not a package script.
    if (sub !== "run" && ((prog === "bun" && BUN_BUILTINS.has(named.word)) || (prog === "pnpm" && named.word === "deploy"))) return;
    const root = projectFor(dir, this.cache).root ?? dir;
    const packages = filters.includes("*every*") ? [nearestPackage(root), ...workspacePackages(root)].filter(Boolean) : filters.length ? pickWorkspaces(dir, root, filters) : [nearestPackage(dir)].filter(Boolean);
    let found = false;
    for (const pkg of packages) {
      for (const name of [`pre${named.word}`, named.word, `post${named.word}`]) {
        if (this.runScript(pkg, name, depth, ctx) && name === named.word) found = true;
      }
    }
    if (found) return;
    if (namesDeploy(named.word)) this.deploy(`The package script \`${named.word}\``, ctx);
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
    if (sub === "update" || sub === "update:republish" || sub === "update:roll-back-to-embedded") {
      const target = flagValue(w, ["--branch", "--channel"]);
      if (target === null || /prod/i.test(target)) this.refuse("release", `\`eas ${sub}\` without a non-production --branch or --channel can send an update to people's phones.`);
      return;
    }
    if (sub === "channel:edit" || sub === "channel:rollout") {
      const rest = w.slice(w.indexOf(sub) + 1);
      const channel = rest.find((x, j) => !x.startsWith("-") && !(rest[j - 1]?.startsWith("-") && !rest[j - 1].includes("=") && !["--json", "--non-interactive"].includes(rest[j - 1])));
      if (!channel || /prod/i.test(channel)) this.refuse("release", `\`eas ${sub}\` on ${channel ? `the channel "${channel}"` : "a channel it doesn't name"} changes what people's phones download.`);
      return;
    }
    if (sub === "deploy" && w.some((x) => /^--prod(uction)?(=(?!false$)|$)/.test(x))) return this.refuse("release", "`eas deploy --prod` publishes the production website.");
    if (sub === "workflow:run") {
      const file = w.slice(w.indexOf(sub) + 1).find((x) => !x.startsWith("-")) ?? "";
      const text = readText(resolve(this.cwd, file)) ?? readText(resolve(this.cwd, ".eas", "workflows", file)) ?? "";
      if (!file || PROD_WORDS.test(file) || /submit|production/i.test(text)) this.refuse("release", `\`eas workflow:run ${file}\` runs a workflow that builds for the stores, submits or deploys.`);
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
    if (w[i] === "tag") {
      const takesValue = (x) => ["--message", "--file", "--local-user"].includes(x) || /^-[a-zA-Z]*[mFu]$/.test(x ?? "");
      const rest = w.slice(i + 1);
      if (!rest.some((x) => ["-d", "--delete", "-l", "--list", "-v", "--verify", "--contains", "--points-at", "--merged"].includes(x))) {
        const name = rest.find((x, k) => !x.startsWith("-") && !takesValue(rest[k - 1]));
        if (name) this.newTags.add(name);
      }
      return;
    }
    if ((w[i] === "checkout" && w[i + 1] === "-b") || (w[i] === "switch" && ["-c", "--create"].includes(w[i + 1]))) {
      if (w[i + 2]) this.newBranches.add(w[i + 2]);
      return;
    }
    if (w[i] === "branch" && w[i + 1] && !w[i + 1].startsWith("-")) {
      this.newBranches.add(w[i + 1]);
      return;
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
    let refspecs = positional.slice(1);
    const tagWord = refspecs.indexOf("tag");
    if (tagWord !== -1 && refspecs[tagWord + 1]) {
      this.refuse("release", `It pushes the tag "${refspecs[tagWord + 1]}", and tags often start a release. The owner pushes tags.`);
      refspecs = refspecs.filter((_, j) => j !== tagWord && j !== tagWord + 1);
    }
    for (const r of refspecs) {
      if (/refs\/tags\//.test(r) || /^\+?v\$/.test(r.split(":").pop())) this.refuse("release", `It pushes the tag "${r}", and tags often start a release. The owner pushes tags.`);
    }
    if (refspecs.some((r) => r.includes("*"))) return this.refuse("push", "It pushes branches matching a pattern, which can include protected ones.");
    if (force || refspecs.some((r) => r.startsWith("+"))) this.refuse("push", "It force-pushes with `--force` or `+`, which can overwrite other people's work. Use `--force-with-lease` on your own branch, or ask the owner.");
    const current = () => this.currentBranch(dir);
    const targets = refspecs.length ? refspecs.flatMap((r) => this.variants(r, ctx)).map((r) => {
      const spec = r.replace(/^\+/, "");
      let dst = spec.includes(":") ? spec.split(":").pop() : spec;
      if (dst.includes("$")) {
        dst = this.expand(dst, ctx);
        if (dst === null && !ctx.indirect) this.refuse("push", `It pushes to "${r}", and the guard can't tell which branch that is. Name the branch.`);
      }
      return dst === "HEAD" || dst === "@" ? current() : dst;
    }) : del ? [] : [current()];
    for (const t of targets.filter(Boolean)) {
      const branchExists = this.refs(dir, "heads").has(t) || this.newBranches.has(t);
      const isTag = t.startsWith("refs/tags/") || (!t.startsWith("refs/heads/") && !branchExists && (this.refs(dir, "tags").has(t) || this.newTags.has(t) || VERSION_LIKE.test(t)));
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
    if (group === "workflow" && verb === "run") {
      const rest = w.slice(k + 2);
      const name = rest.find((x, j) => !x.startsWith("-") && !["-r", "--ref", "-R", "--repo", "-f", "-F", "--field", "--raw-field"].includes(rest[j - 1]));
      if (name && this.workflowDeploys(dir, name)) return this.refuse("deploy", `\`gh workflow run ${name}\` starts a workflow that deploys or releases. The owner starts it.`);
      return;
    }
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
      else if (!a.startsWith("-") && !path) path = a.replace(/^https?:\/\/[^/]+\/(api\/v3\/)?/, "");
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
    if (/\/contents\//.test(clean) && (method === "PUT" || method === "DELETE") && (field("branch") === undefined || branches.has(field("branch")))) return this.refuse("push", `It commits straight to ${field("branch") ? `the protected branch "${field("branch")}"` : "the default branch"} through the GitHub interface.`);
    if (/\/git\/(refs|tags)$/.test(clean) && /^refs\/tags\//.test(field("ref") ?? "")) return this.refuse("release", `It creates the tag "${field("ref").slice(10)}", and tags often start a release.`);
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
      if (roots.some((r) => target === join(r, ".git") || inside(target, join(r, ".git")))) {
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
    const filtered = w.some((x) => /^-(i?name|i?path|type|mtime|mmin|newer|i?regex|size|empty|user|perm|wholename|maxdepth|mindepth)$/.test(x));
    if (deletes) this.checkPaths(starts.length ? starts : ["."], dir, ctx, " with `find`", filtered);
    if (run.length && programName(run[0]) !== "rm") {
      const cmd = unwrap(run);
      this.used.push(cmd.join(" "));
      if (cmd.length) this.checkWords(cmd, dir, depth, ctx, null);
    }
  }
}

// The text echo or printf prints, roughly: printf's format with its values
// filled in, and \n read as a new line. Null for any other program.
function printedText(w) {
  const prog = programName(w[0]);
  if (prog === "echo") return w.slice(1).filter((x) => !/^-[neE]+$/.test(x)).join(" ").replace(/\\n/g, "\n");
  if (prog !== "printf" || w.includes("-v")) return null;
  const [format = "", ...values] = w.slice(1).filter((x) => x !== "--");
  const filled = format.replace(/%[-+ #0-9.]*[a-zA-Z%]/g, (spec) => (spec === "%%" ? "%" : values.shift() ?? ""));
  return [filled, ...values].join("\n").replace(/\\n/g, "\n");
}

// True when a command only mentions names: it reads or writes text, writes a
// commit, or posts a comment or pull request, and reaches nothing else.
function mentionsOnly(w) {
  const prog = programName(w[0]);
  if (TEXT_ONLY.has(prog)) return true;
  if (prog === "git") return !w.some((x) => GIT_REMOTE.has(x));
  if (prog === "gh") {
    if (["pr", "issue"].includes(w[1]) && ["create", "edit", "comment", "review", "view", "list"].includes(w[2])) return true;
    if (w[1] === "api") return w.some((x) => /\/(comments|reviews)(\/\d+)?(\?|$)|\/(pulls|issues)(\/\d+)?(\?|$)/.test(x));
  }
  return false;
}

// The input of a call to a tool server, as text: its JSON, and each name and
// text value in it as written.
function toolText(input) {
  const strings = [];
  const walk = (v) => {
    if (typeof v === "string") strings.push(v);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) strings.push(k), walk(x);
  };
  walk(input);
  return [JSON.stringify(input) ?? "", ...strings].join("\n");
}

const isToolServer = (name) => typeof name === "string" && name.startsWith("mcp__");

export function decide({ tool_name, tool_input = {}, cwd = process.cwd() }) {
  // A tool server, such as a hosting or database tool, can reach production
  // without a shell command. Its calls are checked against the "never" list
  // only. Built-in tools that edit or read files are never checked, so a file
  // that mentions a production name can still be written.
  if (isToolServer(tool_name)) {
    const project = projectFor(real(cwd), new Map());
    const refusals = project.problem ? [{ rule: "settings", reason: settingsReason(project.problem) }] : [];
    const text = lower(toolText(tool_input));
    for (const entry of listed(project.settings.agentsNeverTouch)) if (text.includes(lower(entry))) refusals.push({ rule: "never", reason: neverReason(entry, project.settingsFile) });
    return { allow: refusals.length === 0, refusals };
  }
  if (tool_name !== "Bash" || typeof tool_input.command !== "string") return { allow: true, refusals: [] };
  const refusals = new Checker(tool_input.command, cwd).run();
  return { allow: refusals.length === 0, refusals };
}

// What to do when the guard itself fails: refuse a command that looks guarded
// or names a "never" entry, and allow the rest. A tool-server call is judged
// by the "never" list only, as it is when the guard works.
export function refuseOnError(command, cwd, { tool = false } = {}) {
  if (!tool && (LOOKS_GUARDED.test(command) || command.split(/[\s;&|()`"'=]+/).some((x) => GUARDED_WORDS.has(programName(x))))) return true;
  try {
    const dir = typeof cwd === "string" ? cwd : process.cwd();
    const never = listed(projectFor(real(dir), new Map()).settings.agentsNeverTouch);
    return never.some((e) => lower(command).includes(lower(e)));
  } catch {
    return true;
  }
}

export function message(refusals, tool = null) {
  return [
    tool ? "The cstack guard refused this tool call. Only the owner does this." : "The cstack guard refused this command. Only the owner runs it.",
    ...refusals.map((r) => `- ${r.reason}`),
    "",
    tool
      ? `If the owner wants it done, give them the tool's name (${tool}) and its exact input, so they can do it themselves. Don't look for another way to do it.`
      : "If the owner wants it run, give them the exact command to run themselves with ! in front. Don't look for another way to run it.",
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
  const tool = isToolServer(input.tool_name) ? input.tool_name : null;
  let command = typeof input.tool_input?.command === "string" ? input.tool_input.command : "";
  try {
    if (tool) command = JSON.stringify(input.tool_input ?? {});
    const result = decide({ tool_name: input.tool_name, tool_input: input.tool_input, cwd });
    if (result.allow) return 0;
    log({ decision: "refused", tool: input.tool_name, cwd, rules: [...new Set(result.refusals.map((r) => r.rule))], command: mask(command) });
    process.stderr.write(message(result.refusals, tool) + "\n");
    return 2;
  } catch (error) {
    const refuse = refuseOnError(command, cwd, { tool: Boolean(tool) });
    log({ decision: refuse ? "refused-on-error" : "error", tool: input.tool_name, cwd: String(cwd), command: mask(command), error: String(error?.stack ?? error).slice(0, 600) });
    if (!refuse) return 0;
    process.stderr.write(message([{ reason: `The guard failed while checking it (${error?.message ?? error}), and it looks like something the guard refuses, so it refuses to be safe.` }], tool) + "\n");
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then((code) => process.exit(code));
