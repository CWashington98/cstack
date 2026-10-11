#!/usr/bin/env node
// The guard: runs before every shell command an agent sends, in every project.
// It refuses the commands only the owner runs:
//   - production deploys, unless the command names a target the project lets agents deploy to
//   - store submissions, production app builds, package publishes and GitHub releases
//   - pushes to protected branches, force pushes and deleting protected branches
//   - changes to GitHub secrets, rulesets, branch protection and repository settings
//   - deleting folders outside the repository and temporary folders
//   - anything that names an entry on the project's "never" list
// Merges are not guarded: agents merge when the owner says so, and the code
// host's own rules decide who may merge.
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
// Exit 2 refuses, with the reasons on standard error. If the guard fails while
// checking a command that looks guarded, it refuses; otherwise it allows the
// command and logs the error. If the settings file can't be read, it refuses
// every shell command until the file is fixed, because it can't see the
// "never" list.
//
// Its limit, stated plainly: it reads command text, and the shell scripts that
// text runs. A deploy started from inside a program (a Node or Python script
// that starts other commands) can still get past it. It guards against
// mistakes, not against an agent working to get around it.
import { readFileSync, existsSync, statSync, appendFileSync, mkdirSync, realpathSync } from "node:fs";
import { resolve, join, dirname, basename, sep } from "node:path";
import { homedir, tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { extractHeredocs, substitutions, segments, tokenize } from "./lib/shell.mjs";

const SETTINGS = join(".claude", "verify.json");
const MAX_DEPTH = 6;
const MAX_SCRIPT_BYTES = 256 * 1024;

// Words a command can start with that only pass control to the next words.
// Each wrapper maps to its flags that take a value.
const PLAIN_WRAPPERS = {
  sudo: ["-u", "-g", "-C", "-h"], time: [], nohup: [], exec: ["-a"], command: [], builtin: [], caffeinate: ["-t", "-w"],
  xargs: ["-I", "-L", "-n", "-P", "-d", "-E", "-s"], npx: ["-p", "--package", "-c"], bunx: ["-p", "--package"], pnpx: [],
  nice: ["-n"], stdbuf: ["-i", "-o", "-e"],
};
// Programs that only read or write text. A "never" name inside them is being
// mentioned, as in a search or a commit message, not used.
const TEXT_ONLY = new Set(["cat", "head", "tail", "less", "more", "grep", "egrep", "fgrep", "rg", "ag", "ack", "wc", "echo", "printf", "jq", "yq", "sort", "uniq", "diff", "ls", "find", "tree", "file", "stat", "which", "type", "sed", "awk", "tee", "cut", "tr", "column"]);
// git subcommands that reach another machine. Only these can use a "never" target.
const GIT_REMOTE = new Set(["push", "pull", "fetch", "clone", "ls-remote", "remote", "submodule"]);
const RUN_WRAPPERS = new Set(["dotenvx", "doppler", "op", "infisical", "chamber", "aws-vault"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
// Other names some tools are run by.
const ALIASES = { "eas-cli": "eas", "aws-cdk": "cdk", flyctl: "fly", "netlify-cli": "netlify", sls: "serverless", tofu: "terraform" };
// Infrastructure tools and the subcommands that change live systems.
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
const AWS_CHANGES = /^(deploy|delete-stack|create-stack|update-stack|execute-change-set)$/;
const GH_SETTINGS = { secret: /^(set|delete|remove)$/, variable: /^(set|delete|remove)$/, repo: /^(edit|delete|rename|archive|unarchive)$/, release: /^(create|delete|edit|upload)$/ };
const GH_SETTING_PATHS = /\/(rulesets|protection|actions\/secrets|actions\/variables|environments|collaborators|hooks|keys|teams)(\/|$|\?)|^\/?repos\/[^/]+\/[^/]+\/?$/;
const GRAPHQL_SETTINGS = /\b((create|update|delete)BranchProtectionRule|(update|delete)Repository|(create|update|delete)RepositoryRuleset|updateRefs?|deleteRef)\b/;
// Words that make a command look guarded, for the fail-closed check.
const LOOKS_GUARDED = /deploy|submit|publish|release|promote|rollback|push|--prod|secret|ruleset|protection|\brm\b|\bgh\s+(api|repo)|apply|destroy|\beas\b/i;

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
    .replace(/\b([A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|PASS)[A-Z0-9_]*)=("[^"]*"|'[^']*'|\S+)/g, "$1=<hidden>")
    .replace(/\|[A-Za-z0-9+/=_-]{16,}/g, "|<hidden>")
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

// The repository a folder belongs to, and its settings. A worktree without its
// own settings file uses the main checkout's, since a settings file kept only
// on the owner's machine lives there.
function projectFor(dir, cache) {
  const top = gitOut(dir, "rev-parse", "--show-toplevel");
  const key = top || dir;
  if (cache.has(key)) return cache.get(key);
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
    }
  }
  cache.set(key, project);
  return project;
}

const lower = (s) => s.toLowerCase();
const listed = (list = []) => list.map((s) => s.trim()).filter(Boolean);

function protectedBranches(settings) {
  const set = new Set(listed(settings.protectedBranches ?? ["main", "master"]));
  if (typeof settings.integrationBranch === "string" && settings.integrationBranch.trim()) set.add(settings.integrationBranch.trim());
  return set;
}

// Drops leading NAME=value words and wrapper commands, so the words start with
// the program that really runs. Returns the words and any folder set by git -C.
export function unwrap(words) {
  let w = [...words];
  for (let guard = 0; guard < 20 && w.length; guard++) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) {
      w.shift();
      continue;
    }
    const prog = basename(w[0]);
    if (prog === "env") {
      w.shift();
      while (w[0] && (w[0].startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]))) w.splice(0, w[0] === "-u" || w[0] === "-C" ? 2 : 1);
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
    if (RUN_WRAPPERS.has(prog)) {
      const dash = w.indexOf("--");
      if (dash !== -1) w = w.slice(dash + 1);
      else {
        w.shift();
        if (w[0] === "run" || w[0] === "exec") w.shift();
        while (w[0]?.startsWith("-")) w.shift();
      }
      continue;
    }
    break;
  }
  return w;
}

// The program name, without folders, version tags or alternative names.
export function programName(word = "") {
  let name = basename(word).replace(/(?<=.)@[^@/]*$/, "");
  if (name.startsWith("@")) name = name.split("/").pop();
  return ALIASES[name] ?? name;
}

function flagValue(words, names) {
  for (let i = 0; i < words.length; i++) {
    for (const n of names) {
      if (words[i] === n) return words[i + 1] ?? "";
      if (n.startsWith("--") && words[i].startsWith(`${n}=`)) return words[i].slice(n.length + 1);
    }
  }
  return null;
}

// Expands a word the way the shell would for a path: ~ and $NAME. Returns null
// when a variable is unknown, so the caller can't tell where the path points.
function expandPath(word) {
  let unknown = false;
  const out = word
    .replace(/^~(?=\/|$)/, homedir())
    .replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_m, name) => {
      if (process.env[name] === undefined) unknown = true;
      return process.env[name] ?? "";
    });
  return unknown || /^~|`|\$\(/.test(out) ? null : out;
}

const inside = (child, parent) => child !== parent && child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

function nearestPackage(dir) {
  for (let d = dir; ; d = dirname(d)) {
    const file = join(d, "package.json");
    if (existsSync(file)) return file;
    if (dirname(d) === d) return null;
  }
}

function readScript(file) {
  try {
    if (!existsSync(file) || statSync(file).size > MAX_SCRIPT_BYTES) return null;
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

class Checker {
  constructor(command, cwd) {
    this.command = command;
    this.cwd = real(cwd);
    this.cache = new Map();
    this.project = projectFor(this.cwd, this.cache);
    this.reasons = new Map();
    this.texts = [command];
    this.seenDirs = [this.cwd];
    this.used = [];
  }

  refuse(rule, reason) {
    if (!this.reasons.has(reason)) this.reasons.set(reason, rule);
  }

  projects() {
    const seen = new Map();
    for (const d of this.seenDirs) {
      const p = projectFor(d, this.cache);
      seen.set(p.root ?? d, p);
    }
    return [...seen.values()];
  }

  run() {
    this.check(this.command, this.cwd, 0);
    const projects = this.projects();
    for (const p of projects) if (p.problem) this.refuse("settings", `${p.problem}. The guard refuses shell commands until the file is fixed, because it can't see the "never" list. Fix the file with an editor, not a shell command.`);
    for (const { text, dir } of this.used) {
      for (const p of this.projects()) {
        for (const entry of listed(p.settings.agentsNeverTouch)) {
          if (lower(text).includes(lower(entry))) this.refuse("never", `It uses "${entry}", which ${p.settingsFile} lists under "agentsNeverTouch".`);
        }
      }
    }
    this.checkDeploys(this.projects(), lower(this.texts.join("\n")));
    return [...this.reasons].map(([reason, rule]) => ({ rule, reason }));
  }

  // Deploys are allowed only when the command names a target the project lets
  // agents deploy to. They are collected first and decided here, because the
  // target is often named in another part of the line.
  checkDeploys(projects, text) {
    if (!this.deploys?.length) return;
    const allowed = projects.flatMap((p) => listed(p.settings.agentsMayDeployTo));
    if (allowed.some((t) => text.includes(lower(t)))) return;
    const where = this.project.settingsFile ?? SETTINGS;
    for (const what of this.deploys) {
      this.refuse("deploy", `${what} changes a live system, and the command names no target from "agentsMayDeployTo" in ${where}. Agents deploy only to targets listed there, such as a staging backend or a sandbox.`);
    }
  }

  deploy(what) {
    (this.deploys ??= []).push(what);
  }

  check(command, dir, depth) {
    if (depth > MAX_DEPTH) return;
    const { text, heredocs } = extractHeredocs(command);
    for (const inner of substitutions(text)) this.check(inner, dir, depth + 1);
    for (const segment of segments(text)) {
      const words = tokenize(segment);
      const heredoc = words.includes("<<HEREDOC") ? heredocs.get(words[words.indexOf("<<HEREDOC") + 1]) : null;
      const plain = words.filter((w, i) => w !== "<<HEREDOC" && words[i - 1] !== "<<HEREDOC");
      const w = unwrap(plain);
      if (!w.length) continue;
      if (!mentionsOnly(w)) this.used.push({ text: segment, dir });
      if ((w[0] === "cd" || w[0] === "pushd") && w[1]) {
        const target = expandPath(w[1]);
        if (target) {
          dir = real(resolve(dir, target));
          this.seenDirs.push(dir);
        }
        continue;
      }
      this.checkWords(w, dir, depth, heredoc);
    }
  }

  checkWords(w, dir, depth, heredoc) {
    const prog = programName(w[0]);
    const sub = w[1];
    if (SHELLS.has(prog) || prog === "eval") {
      const c = prog === "eval" ? w.slice(1).join(" ") : flagValue(w, ["-c", "-lc", "-ic"]);
      if (c !== null) return this.check(c, dir, depth + 1);
      if (heredoc) return this.check(heredoc, dir, depth + 1);
      const file = w.slice(1).find((x) => !x.startsWith("-"));
      if (file) return this.checkScriptFile(resolve(dir, file), dir, depth);
      return;
    }
    if (/\.(sh|bash|zsh)$/.test(w[0]) || (w[0].includes("/") && !w[0].startsWith("/usr") && !w[0].startsWith("/bin"))) {
      const file = resolve(dir, w[0]);
      const body = readScript(file);
      if (body && (/\.(sh|bash|zsh)$/.test(file) || /^#!.*\b(ba|z|da|k)?sh\b/.test(body))) this.checkScriptFile(file, dir, depth);
    }
    switch (prog) {
      case "git":
        return this.checkGit(w, dir);
      case "gh":
        return this.checkGh(w);
      case "rm":
        return this.checkRm(w, dir);
      case "convex":
        if (sub === "deploy") this.deploy("`convex deploy`");
        if (w.includes("--prod")) this.refuse("production", "It uses `--prod`, which points a Convex command at the production deployment.");
        return;
      case "eas":
        return this.checkEas(w);
      case "vercel":
        if (w.includes("--prod") || w.includes("--production") || ["promote", "rollback"].includes(sub)) this.deploy("A Vercel production deploy");
        return;
      case "netlify":
        if (sub === "deploy" && w.includes("--prod")) this.deploy("A Netlify production deploy");
        return;
      case "aws":
        if (w.some((x) => AWS_CHANGES.test(x)) && w.includes("cloudformation")) this.deploy("An AWS CloudFormation change");
        return;
      case "npm":
      case "pnpm":
      case "yarn":
      case "bun":
        return this.checkPackageManager(prog, w, dir, depth);
      case "make":
      case "just":
      case "turbo":
        for (const target of w.slice(1).filter((x) => !x.startsWith("-") && x !== "run")) {
          if (/deploy|release|publish|submit|promote/i.test(target)) this.deploy(`\`${prog} ${target}\``);
        }
        return;
    }
    if (DEPLOY_TOOLS[prog]?.includes(sub)) this.deploy(`\`${prog} ${sub}\``);
  }

  checkScriptFile(file, dir, depth) {
    const body = readScript(file);
    if (body === null) return;
    this.texts.push(body);
    this.check(body, dir, depth + 1);
  }

  checkPackageManager(prog, w, dir, depth) {
    const args = [];
    for (let i = 1; i < w.length; i++) {
      if (["--cwd", "--prefix", "-C", "--dir"].includes(w[i]) && w[i + 1]) {
        const target = expandPath(w[++i]);
        if (target) dir = real(resolve(dir, target));
      } else if (["--filter", "-F", "--workspace", "-w"].includes(w[i])) i++;
      else if (!w[i].startsWith("-")) args.push(w[i]);
    }
    if (args[0] === "publish" || (prog === "yarn" && args[0] === "npm" && args[1] === "publish")) {
      return this.refuse("release", `\`${prog} publish\` publishes a package for everyone to install.`);
    }
    let name;
    if (args[0] === "run" || args[0] === "run-script") name = args[1];
    else if (prog !== "npm") name = args[0];
    if (!name) return;
    const pkgFile = nearestPackage(dir);
    let scripts = {};
    try {
      scripts = pkgFile ? JSON.parse(readFileSync(pkgFile, "utf8")).scripts ?? {} : {};
    } catch {}
    const body = scripts[name];
    if (typeof body === "string") {
      this.texts.push(body);
      this.check(body, dirname(pkgFile), depth + 1);
    } else if ((args[0] === "run" || args[0] === "run-script") && /deploy|release|publish|submit|promote/i.test(name)) {
      this.deploy(`The package script \`${name}\``);
    }
  }

  checkEas(w) {
    const sub = w[1];
    if (sub === "submit") return this.refuse("release", "`eas submit` sends a build to the app stores.");
    if (sub === "build") {
      const profile = flagValue(w, ["--profile", "-e"]);
      if (profile === null || /prod/i.test(profile)) this.refuse("release", `\`eas build\` ${profile === null ? "with no profile uses the production profile" : `with the profile "${profile}" makes a store build`}. Name a development or preview profile.`);
      return;
    }
    if (sub === "update") {
      const target = flagValue(w, ["--branch", "--channel"]);
      if (target === null || /prod/i.test(target)) this.refuse("release", "`eas update` without a non-production --branch or --channel can send an update to people's phones.");
    }
  }

  checkGit(w, dir) {
    let i = 1;
    while (i < w.length && w[i].startsWith("-")) {
      if (w[i] === "-C" && w[i + 1]) {
        const target = expandPath(w[i + 1]);
        if (target) {
          dir = real(resolve(dir, target));
          this.seenDirs.push(dir);
        }
        i += 2;
      } else if (["-c", "--git-dir", "--work-tree", "--namespace"].includes(w[i])) i += 2;
      else i++;
    }
    if (w[i] !== "push") return;
    const args = w.slice(i + 1);
    const branches = protectedBranches(projectFor(dir, this.cache).settings);
    const positional = [];
    let force = false;
    let del = false;
    for (let j = 0; j < args.length; j++) {
      const a = args[j];
      if (/^(-f|--force|--force-with-lease(=.*)?|--force-if-includes)$/.test(a) || (/^-[a-zA-Z]+$/.test(a) && a.includes("f"))) force = true;
      else if (a === "--mirror" || a === "--all" || a === "--branches") return this.refuse("push", `\`git push ${a}\` pushes every branch, including protected ones.`);
      else if (a === "-d" || a === "--delete") del = true;
      else if (["-o", "--push-option", "--repo", "--receive-pack", "--exec"].includes(a)) j++;
      else if (!a.startsWith("-")) positional.push(a);
    }
    if (force || positional.slice(1).some((r) => r.startsWith("+"))) this.refuse("push", "It force-pushes, which can overwrite other people's work. The owner runs force pushes.");
    const refspecs = positional.slice(1);
    const current = () => gitOut(dir, "symbolic-ref", "--short", "-q", "HEAD");
    const targets = refspecs.length ? refspecs.map((r) => {
      const spec = r.replace(/^\+/, "");
      const dst = spec.includes(":") ? spec.split(":").pop() : spec;
      return dst === "HEAD" || dst === "@" ? current() : dst;
    }) : del ? [] : [current()];
    for (const t of targets.map((b) => b.replace(/^refs\/heads\//, ""))) {
      if (!branches.has(t)) continue;
      if (del || refspecs.some((r) => r.startsWith(":"))) this.refuse("push", `It deletes the protected branch "${t}".`);
      else this.refuse("push", `It pushes straight to the protected branch "${t}". Push a feature branch and open a pull request instead.`);
    }
  }

  checkGh(w) {
    const [, group, verb] = w;
    if (GH_SETTINGS[group]?.test(verb ?? "")) {
      const rule = group === "release" ? "release" : "github-settings";
      return this.refuse(rule, `\`gh ${group} ${verb}\` changes ${group === "release" ? "a published GitHub release" : "GitHub settings or secrets"}. The owner does this.`);
    }
    if (group !== "api") return;
    const rest = w.slice(2);
    const methodFlag = flagValue(rest, ["-X", "--method"]);
    const hasFields = rest.some((x) => /^(-f|-F|--field|--raw-field|--input)$/.test(x) || /^--(raw-)?field=/.test(x));
    const method = (methodFlag ?? (hasFields ? "POST" : "GET")).toUpperCase();
    const path = rest.find((x, k) => !x.startsWith("-") && !/^(-X|--method|-f|-F|--field|--raw-field|-H|--header|--input|-q|--jq|-t|--template|--hostname|--cache)$/.test(rest[k - 1] ?? "")) ?? "";
    if (path === "graphql") {
      if (GRAPHQL_SETTINGS.test(this.command)) this.refuse("github-settings", "It changes repository settings, branch protection or branches through the GitHub GraphQL interface.");
      return;
    }
    if (method === "GET") return;
    if (GH_SETTING_PATHS.test(path.split("?")[0])) return this.refuse("github-settings", `It sends ${method} to ${path}, which changes GitHub settings, secrets or access.`);
    const ref = path.match(/\/git\/refs\/heads\/(.+)$/);
    if (ref && (method === "DELETE" || method === "PATCH")) {
      const settings = this.project.settings;
      if (protectedBranches(settings).has(ref[1])) this.refuse("push", `It ${method === "DELETE" ? "deletes" : "moves"} the protected branch "${ref[1]}" through the GitHub interface.`);
    }
  }

  checkRm(w, dir) {
    const flags = w.slice(1).filter((x) => x.startsWith("-") && x !== "--");
    if (!flags.some((f) => f === "--recursive" || (/^-[a-zA-Z]+$/.test(f) && /[rR]/.test(f)))) return;
    const ends = w.indexOf("--");
    const paths = w.slice(1).filter((x, k) => (ends !== -1 && k + 1 > ends) || !x.startsWith("-")).filter((x) => x !== "--");
    const roots = [this.project.root ?? this.cwd, projectFor(dir, this.cache).root].filter(Boolean);
    const temps = [tmpdir(), "/tmp", "/private/tmp", "/var/folders", "/private/var/folders"].map(real);
    for (const p of paths) {
      const expanded = expandPath(p);
      if (expanded === null) {
        this.refuse("delete", `It deletes "${p}", and the guard can't tell where that points. Write the path out in full.`);
        continue;
      }
      const fixed = expanded.split(sep).reduce((acc, part) => (acc.stop || /[*?[]/.test(part) ? { ...acc, stop: true } : { parts: [...acc.parts, part], stop: false }), { parts: [], stop: false });
      const base = fixed.parts.join(sep) || ".";
      const target = real(resolve(dir, base));
      const repoRoots = roots.map(real);
      if (repoRoots.some((r) => target === r || inside(r, target))) {
        this.refuse("delete", `It deletes "${p}", which is a whole repository or a folder that holds one.`);
        continue;
      }
      if (repoRoots.some((r) => inside(target, r)) || temps.some((t) => inside(target, t))) continue;
      this.refuse("delete", `It deletes "${p}", which is outside this repository and outside temporary folders.`);
    }
  }
}

// True when a command only mentions names: it reads or writes text, writes a
// commit, or posts a comment or pull request, and reaches nothing else.
function mentionsOnly(w) {
  const prog = programName(w[0]);
  if (TEXT_ONLY.has(prog)) return true;
  if (prog === "git") return !w.some((x) => GIT_REMOTE.has(x));
  if (prog === "gh") return ["pr", "issue"].includes(w[1]) && ["create", "edit", "comment", "review", "view", "list"].includes(w[2]);
  return false;
}

export function decide({ tool_name, tool_input = {}, cwd = process.cwd() }) {
  if (tool_name !== "Bash" || typeof tool_input.command !== "string") return { allow: true, refusals: [] };
  const refusals = new Checker(tool_input.command, cwd).run();
  return { allow: refusals.length === 0, refusals };
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
    const guarded = LOOKS_GUARDED.test(command);
    log({ decision: guarded ? "refused-on-error" : "error", cwd, command: mask(command), error: String(error?.stack ?? error).slice(0, 600) });
    if (!guarded) return 0;
    process.stderr.write(message([{ reason: `The guard failed while checking it (${error?.message ?? error}), and the command looks like one it guards, so it refuses to be safe.` }]) + "\n");
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().then((code) => process.exit(code));
