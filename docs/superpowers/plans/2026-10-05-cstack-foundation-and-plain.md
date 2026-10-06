# cstack groundwork and the `plain` plugin: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give cstack a test setup and cleaner skill sources, then build the `plain` plugin: writing rules, a checker script, a blank cold reader, a pass stamp, and a hold that stops unclear text from being posted to GitHub, published as a page, or committed as a spec.

**Architecture:** `plain` is a new plugin in `plugins/plain/`. Four small Node scripts do the work (check, read, stamp, hold), sharing three library files (text, settings, rules). A skill tells Claude how to use them, and a `PreToolUse` hook runs the hold before Bash commands and page publishes. Everything is plain Node with no dependencies, so the checker also runs outside Claude.

**Tech stack:** Node 22 (built-in test runner, `node:` modules only), git, the `gh` command line tool, the `claude` command line tool, JSON, Markdown.

**Spec:** `docs/specs/2026-10-05-plain-design.md` (second version). Scope and order: `docs/specs/2026-10-05-program-plan.md`.

## Global constraints

- Node 22 or newer. No npm dependencies. Every script is an ES module ending in `.mjs`.
- All text a person reads (messages, docs, skill files, commit messages) follows the `plain` rules: written for a junior developer or a product manager, no unexplained acronyms or planning codes, short sentences.
- The hold only runs in a repository that has `.claude/plain.json` (shared) or `.claude/plain.local.json` (personal, git-ignored). With neither, it allows everything.
- Nothing in this plan commits anything to onehearthealth.
- A hook blocks by exiting with code 2 and writing the reason to standard error. On any internal error the hook allows the action (fails open) and logs the error.
- Tests run with `npm test` (which calls `node --test`). No test needs the network, except the live cold-reader probe, which only runs when `PLAIN_LIVE=1` is set.
- Work happens in the worktree `~/Source/cstack-kit` on branch `feat/ai-native-kit`. Commit after each task. Do not push.
- Every commit message ends with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review focus

The five inputs most likely to break `plain` in real use. Each one has a test in the task named in brackets.

1. **Claude's usual commit command,** which passes the message through a heredoc: `git commit -m "$(cat <<'EOF' ... EOF )"`. The hold must read the message inside it. [Task 10]
2. **A body pulled in with `$(cat file)`** or `--body-file -`. The hold can't see that text, so it must be held with "save it to a file". [Task 10]
3. **HTML pages with style and script blocks** (`:root{--BG:#FFF}`). These must not produce findings. [Task 4]
4. **File names and paths in prose** (`CLAUDE.md`, `.claude/plain.json`). These must not count as acronyms. [Task 4]
5. **Folders that are not git repositories, and repositories without plain settings.** The hook must allow at once, and stamps must still work. [Tasks 8 and 10]

---

## File map

| File | Responsibility |
|---|---|
| `package.json` | `npm test` runs every test in the repository |
| `tests/marketplace.test.mjs` | Checks the marketplace file: local plugins exist, outside pointers are pinned |
| `tests/helpers.mjs` | Shared test helpers: make a temporary git repository, run git |
| `plugins/core/...` | Existing core plugin; the copied Matt Pocock skills are removed (Task 3) |
| `plugins/plain/.claude-plugin/plugin.json` | Plugin manifest |
| `plugins/plain/hooks/hooks.json` | Registers the hold before Bash commands and page publishes |
| `plugins/plain/scripts/lib/version.mjs` | The checker version; a change makes old stamps invalid |
| `plugins/plain/scripts/lib/text.mjs` | Turns Markdown or HTML into checkable prose; splits sentences |
| `plugins/plain/scripts/lib/config.mjs` | Reads the repository's glossary and plain settings |
| `plugins/plain/scripts/lib/rules.mjs` | The writing rules, returning findings |
| `plugins/plain/scripts/data/common-words.json` | Acronyms a junior developer or product manager already knows |
| `plugins/plain/scripts/data/reader-prompt.md` | The cold reader's instructions |
| `plugins/plain/scripts/plain-check.mjs` | Checker command and `checkString()` |
| `plugins/plain/scripts/plain-stamp.mjs` | Pass stamps and the override log |
| `plugins/plain/scripts/plain-read.mjs` | The cold reader |
| `plugins/plain/scripts/plain-hold.mjs` | The hook: decides allow or hold |
| `plugins/plain/skills/plain/SKILL.md` | How Claude uses all of the above |
| `plugins/plain/skills/plain/rules.md` | The writing rules for people and Claude |
| `plugins/plain/skills/plain/pr-layout.md` | The pull request description layout |
| `plugins/plain/skills/plain/glossary-format.md` | Glossary and settings file formats |
| `plugins/plain/tests/*.test.mjs` | Tests for each script |

---

### Task 1: Test setup and the `plain` plugin shell

**Files:**
- Create: `package.json`
- Create: `tests/helpers.mjs`
- Create: `tests/marketplace.test.mjs`
- Create: `plugins/plain/.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json` (add the `plain` entry)

**Interfaces:**
- Produces: `makeRepo(files: Record<string,string>): string` (path of a new temporary git repository containing the files), `git(dir: string, ...args: string[]): string` (runs git with a test identity, returns output). Both from `tests/helpers.mjs`, used by every later test.

- [ ] **Step 1: Write the failing marketplace test**

`tests/marketplace.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const market = JSON.parse(readFileSync(join(root, ".claude-plugin", "marketplace.json"), "utf8"));

test("every local plugin has a manifest with the same name", () => {
  for (const p of market.plugins.filter((p) => typeof p.source === "string")) {
    const manifest = join(root, p.source, ".claude-plugin", "plugin.json");
    assert.ok(existsSync(manifest), `${p.name}: missing ${manifest}`);
    assert.equal(JSON.parse(readFileSync(manifest, "utf8")).name, p.name);
  }
});

test("every outside plugin is pinned to an exact commit", () => {
  for (const p of market.plugins.filter((p) => typeof p.source === "object")) {
    assert.match(p.source.sha ?? "", /^[0-9a-f]{40}$/, `${p.name} is not pinned`);
  }
});

test("pointers into part of someone else's repository list the skills they pick", () => {
  for (const p of market.plugins.filter((p) => p.source?.source === "git-subdir")) {
    assert.equal(p.strict, false, `${p.name} must set strict: false`);
    assert.ok(Array.isArray(p.skills) && p.skills.length > 0, `${p.name} must list its skills`);
    for (const s of p.skills) assert.match(s, /^\.\//, `${p.name}: skill paths start with ./`);
  }
});

test("the plain plugin is listed", () => {
  assert.ok(market.plugins.some((p) => p.name === "plain" && p.source === "./plugins/plain"));
});
```

- [ ] **Step 2: Add `package.json` and run the test to see it fail**

`package.json`:

```json
{
  "name": "cstack",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "node --test \"tests/*.test.mjs\" \"plugins/*/tests/*.test.mjs\""
  }
}
```

Run: `npm test`
Expected: FAIL on "the plain plugin is listed".

- [ ] **Step 3: Add the plugin shell, the marketplace entry and the test helpers**

`plugins/plain/.claude-plugin/plugin.json`:

```json
{
  "name": "plain",
  "version": "0.1.0",
  "description": "Plain-English writing check: rules, a checker script, a blank cold reader, and a hold before posting to GitHub, publishing a page or committing a spec. A repository opts in with .claude/plain.json or .claude/plain.local.json.",
  "author": { "name": "Crishon Washington" },
  "license": "MIT"
}
```

Add this object to the `plugins` array in `.claude-plugin/marketplace.json`, after the `cstack` entry:

```json
{
  "name": "plain",
  "source": "./plugins/plain",
  "description": "Keeps everything we publish readable for a junior developer or product manager with no outside context: writing rules, a checker, a blank cold reader and a hold before posting. Opt in per repository with .claude/plain.json."
}
```

`tests/helpers.mjs`:

```js
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";

const identity = {
  GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com",
};

export function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, ...identity } });
}

export function makeRepo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "plain-test-"));
  git(dir, "init", "-q");
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}
```

- [ ] **Step 4: Run the tests and check the manifest**

Run: `npm test`
Expected: PASS (4 tests).

Run: `claude plugin validate .`
Expected: "Validation passed" (a warning about a missing marketplace description is fine).

- [ ] **Step 5: Commit**

```bash
git add package.json tests plugins/plain .claude-plugin/marketplace.json
git commit -m "Add a test setup and the empty plain plugin

npm test now checks that local plugins exist and that outside plugins are
pinned to an exact commit.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Point at the pstack skills we use

**Files:**
- Modify: `.claude-plugin/marketplace.json`
- Modify: `THIRD-PARTY-NOTICES.md`
- Test: `tests/marketplace.test.mjs` (the Task 1 tests now also cover this entry)

**Interfaces:**
- Consumes: the marketplace tests from Task 1.
- Produces: a `pstack-picks` plugin that later plans can rely on for `principle-never-block-on-the-human` and `show-me-your-work`.

- [ ] **Step 1: Confirm the folder names exist at the pinned commit**

Run:

```bash
gh api 'repos/cursor/plugins/contents/pstack/skills?ref=e5a8186d7b43be8d6ac4452440fbead5f1a51c70' --jq '.[].name' \
  | grep -xE 'principle-never-block-on-the-human|show-me-your-work|principle-encode-lessons-in-structure|unslop'
```

Expected: all four names print. If one is missing, stop and report it.

- [ ] **Step 2: Add the pointer**

Add to the `plugins` array in `.claude-plugin/marketplace.json`:

```json
{
  "name": "pstack-picks",
  "description": "Pinned pointer to four of Lauren Tan's pstack skills (pstack 0.15.13, MIT): never block on the human, show your work (a reviewable decision log), encode lessons in structure, and unslop. show-me-your-work needs the other two, so they come together.",
  "source": {
    "source": "git-subdir",
    "url": "https://github.com/cursor/plugins.git",
    "path": "pstack/skills",
    "sha": "e5a8186d7b43be8d6ac4452440fbead5f1a51c70"
  },
  "strict": false,
  "skills": [
    "./principle-never-block-on-the-human",
    "./show-me-your-work",
    "./principle-encode-lessons-in-structure",
    "./unslop"
  ]
}
```

- [ ] **Step 3: Record it in the third-party notices**

In `THIRD-PARTY-NOTICES.md`, add this row to the "Pinned pointers (never vendored)" table:

```markdown
| [cursor/plugins, pstack folder](https://github.com/cursor/plugins/tree/main/pstack) (Lauren Tan) | MIT | `pstack-picks`: principle-never-block-on-the-human, show-me-your-work, principle-encode-lessons-in-structure, unslop |
```

If the table's columns differ, match them.

- [ ] **Step 4: Run the tests and try the install in a throwaway config**

Run: `npm test`
Expected: PASS.

Run:

```bash
T=$(mktemp -d); export CLAUDE_CONFIG_DIR="$T"
claude plugin marketplace add "$PWD" && claude plugin install pstack-picks@cstack
claude plugin details pstack-picks@cstack | sed -n '5,7p'
unset CLAUDE_CONFIG_DIR
```

Expected: "Skills (4)" listing the four names. The throwaway folder leaves the owner's real accounts untouched.

- [ ] **Step 5: Commit**

```bash
git add .claude-plugin/marketplace.json THIRD-PARTY-NOTICES.md
git commit -m "Point at four pinned pstack skills instead of copying them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Stop shipping copies of Matt Pocock's skills

His skills now come from his own plugin (`mattpocock-skills` in the official marketplace), so cstack's July copies only add duplicates that fall behind his updates. This is a breaking change for anyone calling `cstack:tdd` and the others, so the core plugin goes to version 2.0.0.

**Files:**
- Delete: `plugins/core/skills/{tdd,diagnose,triage,to-prd,to-issues,grill-with-docs,grill-me,handoff,improve-codebase-architecture,prototype}/`
- Modify: `plugins/core/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (core description), `README.md`, `THIRD-PARTY-NOTICES.md`
- Test: `tests/marketplace.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/marketplace.test.mjs`:

```js
import { readdirSync } from "node:fs";

test("the core plugin ships only our own skills plus the web design guidelines", () => {
  const skills = readdirSync(join(root, "plugins", "core", "skills")).sort();
  assert.deepEqual(skills, ["bootstrap-agents", "caveman", "deslop", "web-design-guidelines", "write-a-skill"]);
});
```

Run: `npm test`
Expected: FAIL, listing the extra skills.

- [ ] **Step 2: Remove the copies**

```bash
git rm -rq plugins/core/skills/{tdd,diagnose,triage,to-prd,to-issues,grill-with-docs,grill-me,handoff,improve-codebase-architecture,prototype}
```

- [ ] **Step 3: Update the version, descriptions and docs**

- `plugins/core/.claude-plugin/plugin.json`: set `"version": "2.0.0"`. Description: `"Crishon's own Claude Code skills (caveman, deslop, write-a-skill, bootstrap-agents, web-design-guidelines) and the karen verification agent. Matt Pocock's skills now come from his own plugin."`
- `.claude-plugin/marketplace.json`: give the `cstack` entry the same description.
- `README.md`: replace the skills list with the five that remain. Add this section:

```markdown
## Matt Pocock's skills

cstack used to ship copies of these. They now come from his plugin, which he keeps current:

    claude plugin install mattpocock-skills@claude-plugins-official

| Old cstack name | Name in his plugin |
|---|---|
| tdd | tdd |
| diagnose | diagnosing-bugs |
| triage | triage |
| to-prd | to-spec |
| to-issues | to-tickets |
| grill-with-docs | grill-with-docs |
| grill-me | grill-me |
| handoff | handoff |
| improve-codebase-architecture | improve-codebase-architecture |
| prototype | prototype |
```

- `THIRD-PARTY-NOTICES.md`: in the "Vendored" table, remove the mattpocock/skills row and the paragraph about `grill-me` and `prototype`. Add a sentence below the table: "Matt Pocock's skills are no longer copied here; install his plugin instead (see README)."

- [ ] **Step 4: Run the tests and search for old names**

Run: `npm test`
Expected: PASS.

Run: `grep -rnE 'cstack:(tdd|diagnose|triage|to-prd|to-issues|grill|handoff|improve-codebase|prototype)' --include='*.md' . | grep -v docs/specs`
Expected: no output. Fix any line it prints.

- [ ] **Step 5: Commit**

```bash
git add -A plugins/core .claude-plugin/marketplace.json README.md THIRD-PARTY-NOTICES.md tests
git commit -m "Stop shipping copies of Matt Pocock's skills (core 2.0.0)

His own plugin now provides them and stays current. The README maps the
old cstack names to his.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Turn Markdown and HTML into checkable prose

**Files:**
- Create: `plugins/plain/scripts/lib/text.mjs`
- Test: `plugins/plain/tests/text.test.mjs`

**Interfaces:**
- Produces:
  - `stripIgnored(markdown: string): string` returns the text with code, links, quotes, comments and file names replaced. It has the same number of lines as the input.
  - `htmlToText(html: string): string` returns the text of a page with style, script, pre, code and svg blocks blanked and tags removed. It has the same number of lines as the input.
  - `prepare(raw: string, name?: string): string` uses `htmlToText` first when `name` ends in `.html`, then `stripIgnored`.
  - `sentences(prose: string): Array<{ text: string, line: number, words: number }>` treats headings, list items and table cells as separate pieces.

- [ ] **Step 1: Write the failing tests**

`plugins/plain/tests/text.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripIgnored, htmlToText, prepare, sentences } from "../scripts/lib/text.mjs";

test("code, links and quoted lines are removed, and the line count is kept", () => {
  const md = "Intro BLUF\n```\nconst SHA = 1\n```\nSee `READY` and [the pull request](https://x.y/Q21).\n> QUOTED LOG\nEnd";
  const out = stripIgnored(md).split("\n");
  assert.equal(out.length, 7);
  assert.equal(out[0], "Intro BLUF");
  assert.equal(out[1], "");
  assert.equal(out[2], "");
  assert.equal(out[4], "See code and the pull request.");
  assert.equal(out[5], "");
  assert.equal(out[6], "End");
});

test("file names and paths do not look like acronyms", () => {
  assert.equal(stripIgnored("Edit CLAUDE.md, GLOSSARY.md and .claude/plain.json now"), "Edit file, file and file now");
});

test("HTML pages lose styles, scripts and code, keep their text, and keep their line count", () => {
  const html = "<style>\n:root{--BG:#FFF}\n</style>\n<p>Hello &amp; welcome</p>\n<pre><code>READY\n</code></pre>\n<script>let SHA=1</script>";
  const out = htmlToText(html);
  assert.equal(out.split("\n").length, html.split("\n").length);
  assert.doesNotMatch(out, /BG|FFF|READY|SHA/);
  assert.match(out, /Hello & welcome/);
});

test("prepare uses the HTML path only for .html files", () => {
  assert.match(prepare("<p>A</p>", "page.html"), /^\s*A\s*$/);
  assert.equal(prepare("<p>A</p>", "notes.md"), "<p>A</p>");
});

test("sentences are split and counted; list items, table cells and headings stand alone", () => {
  const s = sentences("One two three. Four five.\n\n- item one\n| a b | c |\n|---|---|\n# Head");
  assert.deepEqual(
    s.map((x) => [x.text, x.line, x.words]),
    [["One two three.", 1, 3], ["Four five.", 1, 2], ["item one", 3, 2], ["a b", 4, 2], ["c", 4, 1], ["Head", 6, 1]],
  );
});

test("Windows line endings are handled", () => {
  assert.equal(stripIgnored("a\r\nb").split("\n").length, 2);
});
```

Run: `npm test`
Expected: FAIL, "Cannot find module .../text.mjs".

- [ ] **Step 2: Write the implementation**

`plugins/plain/scripts/lib/text.mjs`:

```js
// Turns Markdown or HTML into prose the rules can check. Ignored parts
// (code, links, quotes, comments, file names) are replaced without
// changing the number of lines, so findings point at the right line.

const FILE_NAME = /(?:[\w.-]+\/)*[\w.-]*\w\.(?:md|mdx|json|mjs|cjs|js|jsx|ts|tsx|py|sh|ya?ml|html|css|txt|toml|lock)\b/g;

export function stripIgnored(markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let fence = null;
  let inComment = false;
  for (let line of lines) {
    const fenceMark = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      if (fenceMark && fenceMark[1][0] === fence[0] && fenceMark[1].length >= fence.length) fence = null;
      out.push("");
      continue;
    }
    if (fenceMark) {
      fence = fenceMark[1];
      out.push("");
      continue;
    }
    if (inComment) {
      const end = line.indexOf("-->");
      if (end === -1) {
        out.push("");
        continue;
      }
      inComment = false;
      line = line.slice(end + 3);
    }
    line = line.replace(/<!--.*?-->/g, " ");
    const open = line.indexOf("<!--");
    if (open !== -1) {
      inComment = true;
      line = line.slice(0, open);
    }
    if (/^\s*>/.test(line)) {
      out.push("");
      continue;
    }
    out.push(
      line
        .replace(/`[^`]*`/g, "code")
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/<https?:\/\/[^>]+>/g, "link")
        .replace(/https?:\/\/\S+/g, "link")
        .replace(FILE_NAME, "file"),
    );
  }
  return out.join("\n");
}

export function htmlToText(html) {
  const blank = (match) => match.replace(/[^\n]/g, "");
  return html
    .replace(/\r\n?/g, "\n")
    .replace(/<(style|script|pre|code|svg)\b[\s\S]*?<\/\1>/gi, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/<[^>]+>/g, (tag) => (/\n/.test(tag) ? blank(tag) : " "))
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;|&#\d+;/gi, " ");
}

export function prepare(raw, name = "") {
  return stripIgnored(name.endsWith(".html") ? htmlToText(raw) : raw);
}

function splitSentences(chunk, line, out) {
  for (const piece of chunk.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)) {
    const text = piece.trim();
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words) out.push({ text, line, words });
  }
}

export function sentences(prose) {
  const result = [];
  let buffer = [];
  let start = 0;
  const flush = () => {
    if (buffer.length) splitSentences(buffer.join(" "), start, result);
    buffer = [];
  };
  prose.split("\n").forEach((raw, i) => {
    const line = i + 1;
    const t = raw.trim();
    if (!t) return flush();
    if (t.startsWith("|")) {
      flush();
      if (/^\|[\s:|-]+\|?$/.test(t)) return;
      for (const cell of t.split("|").map((c) => c.trim()).filter(Boolean)) splitSentences(cell, line, result);
      return;
    }
    if (/^(#{1,6}\s|[-*+]\s|\d+[.)]\s)/.test(t)) {
      flush();
      buffer = [t.replace(/^(#{1,6}|[-*+]|\d+[.)])\s+/, "")];
      start = line;
      return;
    }
    if (!buffer.length) start = line;
    buffer.push(t);
  });
  flush();
  return result;
}
```

- [ ] **Step 3: Run the tests**

Run: `npm test`
Expected: PASS. If the `prepare` test fails only on spacing, check what `htmlToText` produces and adjust the test's expected value, never the rule.

- [ ] **Step 4: Commit**

```bash
git add plugins/plain/scripts/lib/text.mjs plugins/plain/tests/text.test.mjs
git commit -m "plain: turn Markdown and HTML into checkable prose

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Read the glossary and plain settings

**Files:**
- Create: `plugins/plain/scripts/lib/config.mjs`
- Create: `plugins/plain/scripts/data/common-words.json`
- Test: `plugins/plain/tests/config.test.mjs`

**Interfaces:**
- Consumes: `makeRepo` from `tests/helpers.mjs`.
- Produces:
  - `parseGlossary(markdown: string): Array<{ term: string, avoid: string[] }>`
  - `DEFAULT_WATCH: string[]`
  - `loadConfig(cwd: string)` returns `{ root, enabled, common, neverPublish, watchFolders, readerModel, glossary }`. Here `common` is a `Set<string>` and `neverPublish` is a `Record<string, string>`.

- [ ] **Step 1: Write the failing tests**

`plugins/plain/tests/config.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo } from "../../../tests/helpers.mjs";
import { parseGlossary, loadConfig, DEFAULT_WATCH } from "../scripts/lib/config.mjs";

test("glossary terms and the words to avoid are read", () => {
  const g = parseGlossary("# Heart\n\n**Recording**:\nAudio of the heart.\n_Avoid_: clip, sample\n\n**VSD**:\nVentricular septal defect.\n");
  assert.deepEqual(g, [{ term: "Recording", avoid: ["clip", "sample"] }, { term: "VSD", avoid: [] }]);
});

test("a repository without plain settings has not opted in", () => {
  assert.equal(loadConfig(makeRepo({ "README.md": "hi" })).enabled, false);
});

test("shared and personal settings merge, and personal values win", () => {
  const dir = makeRepo({
    ".claude/plain.json": JSON.stringify({ commonWords: ["S3"], neverPublish: { BLUF: "Put the summary first." }, readerModel: "sonnet" }),
    ".claude/plain.local.json": JSON.stringify({ commonWords: ["T3"], readerModel: "haiku" }),
    "GLOSSARY.md": "**Karen**:\nOur automated code reviewer.\n",
    ".claude/GLOSSARY.local.md": "**Atlas**:\nThe zoomable map of the system.\n",
  });
  const c = loadConfig(dir);
  assert.equal(c.enabled, true);
  for (const w of ["S3", "T3", "API"]) assert.ok(c.common.has(w), w);
  assert.equal(c.readerModel, "haiku");
  assert.equal(c.neverPublish.BLUF, "Put the summary first.");
  assert.deepEqual(c.glossary.map((g) => g.term), ["Karen", "Atlas"]);
  assert.deepEqual(c.watchFolders, DEFAULT_WATCH);
});

test("a personal settings file alone is enough to opt in", () => {
  assert.equal(loadConfig(makeRepo({ ".claude/plain.local.json": "{}" })).enabled, true);
});
```

Run: `npm test`
Expected: FAIL, module not found.

- [ ] **Step 2: Write the common words list**

`plugins/plain/scripts/data/common-words.json` holds the acronyms a junior developer or product manager knows without looking them up:

```json
["AI", "AM", "API", "APIs", "AWS", "CEO", "CI", "CLI", "CPU", "CSS", "CSV", "CTO", "DNS", "EU", "FAQ", "GB", "GPU", "HTML", "HTTP", "HTTPS", "ID", "IDs", "IDE", "JSON", "KB", "MB", "MIT", "OK", "OS", "PDF", "PM", "PR", "PRs", "QA", "QR", "RAM", "README", "SDK", "SMS", "SQL", "SSH", "TB", "UI", "UK", "URL", "URLs", "US", "USA", "USB", "UTC", "UX", "XML", "YAML"]
```

- [ ] **Step 3: Write the implementation**

`plugins/plain/scripts/lib/config.mjs`:

```js
// Reads a repository's plain settings and glossary. A repository opts in by
// having .claude/plain.json (shared) or .claude/plain.local.json (personal).
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_WATCH = ["docs/superpowers/specs", "docs/superpowers/plans", "openspec/changes"];

export function repoRoot(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export function parseGlossary(markdown) {
  const terms = [];
  let current = null;
  for (const line of markdown.split(/\r?\n/)) {
    const term = line.match(/^\*\*(.+?)\*\*:?\s*$/);
    if (term) {
      current = { term: term[1].trim(), avoid: [] };
      terms.push(current);
      continue;
    }
    const avoid = line.match(/^_Avoid_:\s*(.+)$/i);
    if (avoid && current) current.avoid.push(...avoid[1].split(",").map((s) => s.trim()).filter(Boolean));
  }
  return terms;
}

function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

export function loadConfig(cwd) {
  const root = repoRoot(cwd) ?? cwd;
  const shared = readJson(join(root, ".claude", "plain.json"));
  const personal = readJson(join(root, ".claude", "plain.local.json"));
  const defaults = JSON.parse(readFileSync(join(here, "..", "data", "common-words.json"), "utf8"));
  const glossary = [join(root, "GLOSSARY.md"), join(root, ".claude", "GLOSSARY.local.md")]
    .filter(existsSync)
    .flatMap((p) => parseGlossary(readFileSync(p, "utf8")));
  const common = new Set(defaults);
  const neverPublish = {};
  let watchFolders = null;
  let readerModel = null;
  for (const settings of [shared, personal]) {
    if (!settings) continue;
    for (const w of settings.commonWords ?? []) common.add(w);
    Object.assign(neverPublish, settings.neverPublish ?? {});
    if (settings.watchFolders) watchFolders = settings.watchFolders;
    if (settings.readerModel) readerModel = settings.readerModel;
  }
  return {
    root,
    enabled: Boolean(shared || personal),
    common,
    neverPublish,
    watchFolders: watchFolders ?? DEFAULT_WATCH,
    readerModel: readerModel ?? "sonnet",
    glossary,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/plain/scripts/lib/config.mjs plugins/plain/scripts/data/common-words.json plugins/plain/tests/config.test.mjs
git commit -m "plain: read the glossary and the shared and personal settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The writing rules

**Files:**
- Create: `plugins/plain/scripts/lib/rules.mjs`
- Test: `plugins/plain/tests/rules.test.mjs`

**Interfaces:**
- Consumes: `sentences` from `lib/text.mjs`. A config object shaped like `loadConfig`'s result (only `common`, `glossary` and `neverPublish` are read).
- Produces: `checkText(prose: string, config) => Array<{ rule, level, line, text, message }>`, sorted by position.
  - `rule` is one of `never-publish`, `planning-code`, `capitals`, `unseen-context`, `long-sentence`, `avoided-word`, `filler`.
  - `level` is `"hold"` or `"advice"`.

Acronyms and capitals used for emphasis share one rule, `capitals`, because both get the same fix: spell it out, explain it, or lowercase it. The spec lists them as two rows, but both are hold-level, so the outcome is the same.

- [ ] **Step 1: Write the failing tests**

`plugins/plain/tests/rules.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkText } from "../scripts/lib/rules.mjs";

const config = (over = {}) => ({ common: new Set(["API", "PR", "PRs", "OK", "S3"]), glossary: [], neverPublish: {}, ...over });
const run = (text, cfg = config()) => checkText(text, cfg).map((f) => `${f.rule}:${f.level}:${f.text}:${f.line}`);

test("the scanned pull request style is held", () => {
  assert.deepEqual(run("BLUF: A1 green. Resolves Q12 per D12.\nREADY for review."), [
    "capitals:hold:BLUF:1",
    "planning-code:hold:A1:1",
    "planning-code:hold:Q12:1",
    "planning-code:hold:D12:1",
    "capitals:hold:READY:2",
  ]);
});

test("an acronym spelled out at first use passes, and so do later uses", () => {
  assert.deepEqual(run("Ventricular septal defect (VSD) is rare. VSD needs follow-up."), []);
});

test("an acronym followed by its meaning passes", () => {
  assert.deepEqual(run("VSD (ventricular septal defect) is rare."), []);
});

test("an acronym explained only after its first use is held once", () => {
  assert.deepEqual(run("VSD is rare. Ventricular septal defect (VSD) needs care. VSD again."), ["capitals:hold:VSD:1"]);
});

test("common words, glossary terms and plurals pass", () => {
  assert.deepEqual(run("Two VSDs, the API and three PRs. OK. Files go to S3.", config({ glossary: [{ term: "VSD", avoid: [] }] })), []);
});

test("never-publish words are held even when defined", () => {
  const cfg = config({ neverPublish: { BLUF: "Put the summary first." } });
  assert.deepEqual(run("Bottom line up front (BLUF): it works.", cfg), ["never-publish:hold:BLUF:1"]);
});

test("references to things the reader can't see are held", () => {
  assert.deepEqual(run("As discussed, we ship Friday."), ["unseen-context:hold:As discussed:1"]);
});

test("sentences over 35 words are held, and 25 to 35 words get advice", () => {
  const words = (n) => Array.from({ length: n }, () => "word").join(" ") + ".";
  assert.deepEqual(run(words(36)).map((f) => f.split(":").slice(0, 2).join(":")), ["long-sentence:hold"]);
  assert.deepEqual(run(words(26)).map((f) => f.split(":").slice(0, 2).join(":")), ["long-sentence:advice"]);
  assert.deepEqual(run(words(24)), []);
});

test("words the glossary says to avoid get advice", () => {
  assert.deepEqual(run("Upload the clip.", config({ glossary: [{ term: "Recording", avoid: ["clip"] }] })), ["avoided-word:advice:clip:1"]);
});

test("filler words get advice", () => {
  assert.deepEqual(run("We leverage the cache."), ["filler:advice:leverage:1"]);
});

test("mixed case product names are not acronyms", () => {
  assert.deepEqual(run("TypeScript, GitHub, iOS and GraphQL are fine."), []);
});
```

Run: `npm test`
Expected: FAIL, module not found.

- [ ] **Step 2: Write the implementation**

`plugins/plain/scripts/lib/rules.mjs`:

```js
// The writing rules. Input is prose from text.mjs; output is a list of
// findings, each "hold" (must fix before posting) or "advice".
import { sentences } from "./text.mjs";

const CAPS = /\b[A-Z][A-Z0-9&]*[A-Z][A-Z0-9&]*s?\b/g;
const CODE = /\b[A-Z]{1,2}\d{1,3}[a-z]?\b|§\s*\d+(?:\.\d+)*/g;
const UNSEEN = ["as discussed", "as mentioned", "as agreed", "per the plan", "per our", "see above", "as above", "like last time", "as before", "the usual way", "from the call", "per the thread"];
const FILLER = ["leverage", "leverages", "leveraging", "robust", "seamless", "seamlessly", "delve", "utilize", "utilizes", "utilizing", "pivotal", "synergy", "cutting-edge", "game-changer", "holistic"];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const lineOf = (text, index) => text.slice(0, index).split("\n").length;
const lineStart = (text, line) => text.split("\n").slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);

function definedAtFirstUse(prose, tok, i) {
  const before = prose.slice(0, i);
  const after = prose.slice(i + tok.length);
  if (/\(\s*$/.test(before) && /^s?\s*\)/.test(after)) return true;
  return /^s?\s*\(\s*[a-z]/.test(after);
}

export function checkText(prose, config) {
  const found = [];
  const add = (index, rule, level, text, message) => found.push({ index, rule, level, line: lineOf(prose, index), text, message });
  const isAllowed = (tok) => {
    const base = tok.replace(/s$/, "");
    return [tok, base].some((t) => config.common.has(t) || config.glossary.some((g) => g.term === t));
  };
  const never = new Set(Object.keys(config.neverPublish));
  let m;

  for (const [tok, instead] of Object.entries(config.neverPublish)) {
    const re = new RegExp(`\\b${esc(tok)}\\b`, "g");
    while ((m = re.exec(prose))) add(m.index, "never-publish", "hold", tok, `Don't publish "${tok}". ${instead}`);
  }

  const codeAt = new Set();
  const code = new RegExp(CODE.source, "g");
  while ((m = code.exec(prose))) {
    const tok = m[0];
    codeAt.add(m.index);
    if (never.has(tok) || isAllowed(tok)) continue;
    add(m.index, "planning-code", "hold", tok, `"${tok}" looks like a planning code. Say what it means instead.`);
  }

  const caps = new RegExp(CAPS.source, "g");
  const seen = new Set();
  while ((m = caps.exec(prose))) {
    const tok = m[0];
    const base = tok.replace(/s$/, "");
    if (codeAt.has(m.index) || never.has(tok) || never.has(base) || isAllowed(tok) || seen.has(base)) continue;
    seen.add(base);
    if (definedAtFirstUse(prose, base, m.index)) continue;
    add(m.index, "capitals", "hold", tok, `"${tok}" isn't on the common list or in the glossary. Spell it out the first time, like "full name (${base})", or write it in lowercase if it's emphasis.`);
  }

  for (const phrase of UNSEEN) {
    const re = new RegExp(`\\b${esc(phrase)}\\b`, "gi");
    while ((m = re.exec(prose))) add(m.index, "unseen-context", "hold", m[0], `"${m[0]}" points at something the reader can't see. Put the needed facts in the text.`);
  }

  for (const s of sentences(prose)) {
    if (s.words > 35) add(lineStart(prose, s.line), "long-sentence", "hold", s.text.slice(0, 60), `A sentence here has ${s.words} words. Split it; aim for under 20.`);
    else if (s.words >= 25) add(lineStart(prose, s.line), "long-sentence", "advice", s.text.slice(0, 60), `A sentence here has ${s.words} words. Consider splitting it.`);
  }

  for (const g of config.glossary) {
    for (const word of g.avoid) {
      const re = new RegExp(`\\b${esc(word)}\\b`, "gi");
      while ((m = re.exec(prose))) add(m.index, "avoided-word", "advice", m[0], `The glossary prefers "${g.term}" over "${m[0]}".`);
    }
  }

  for (const word of FILLER) {
    const re = new RegExp(`\\b${esc(word)}\\b`, "gi");
    while ((m = re.exec(prose))) add(m.index, "filler", "advice", m[0], `"${m[0]}" is filler. Use a plainer word.`);
  }

  return found.sort((a, b) => a.index - b.index).map(({ index, ...f }) => f);
}
```

Filtering findings for commit message first lines happens in the hold (Task 10), not here.

- [ ] **Step 3: Run the tests**

Run: `npm test`
Expected: PASS. If the long-sentence test fails because a 26-word sentence is split, the cause is the split pattern in `text.mjs`, not the thresholds.

- [ ] **Step 4: Commit**

```bash
git add plugins/plain/scripts/lib/rules.mjs plugins/plain/tests/rules.test.mjs
git commit -m "plain: the writing rules

Holds unexplained acronyms, planning codes, capitals for emphasis,
references to unseen context and sentences over 35 words. Gives advice on
long sentences, avoided glossary words and filler.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The checker command

**Files:**
- Create: `plugins/plain/scripts/lib/version.mjs`
- Create: `plugins/plain/scripts/plain-check.mjs`
- Test: `plugins/plain/tests/check.test.mjs`

**Interfaces:**
- Consumes: `prepare` (Task 4), `loadConfig` (Task 5), `checkText` (Task 6).
- Produces:
  - `CHECKER_VERSION: string`, from `lib/version.mjs`.
  - `checkString(raw: string, name: string, cwd: string, config?)` returns `{ findings, held: boolean }`.
  - `formatFindings(findings): string`.
  - The command `node plain-check.mjs <file> [--json]` exits with 0 (passes), 1 (held) or 2 (file not found).

- [ ] **Step 1: Write the failing tests**

`plugins/plain/tests/check.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeRepo } from "../../../tests/helpers.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "plain-check.mjs");
const files = {
  ".claude/plain.json": "{}",
  "bad.md": "BLUF: A1 is READY.\n",
  "good.md": "This adds the map page. It loads and passes its tests.\n",
};

test("the checker holds problem text with exit 1 and passes clean text with exit 0", () => {
  const dir = makeRepo(files);
  const run = (f, ...extra) => spawnSync(process.execPath, [script, f, ...extra], { cwd: dir, encoding: "utf8" });
  const bad = run("bad.md");
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /Held: 3 problem/);
  const good = run("good.md");
  assert.equal(good.status, 0);
  assert.match(good.stdout, /^Passes/m);
  assert.equal(run("missing.md").status, 2);
});

test("--json prints the findings for scripts", () => {
  const dir = makeRepo(files);
  const out = spawnSync(process.execPath, [script, "bad.md", "--json"], { cwd: dir, encoding: "utf8" });
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.held, true);
  assert.deepEqual(parsed.findings.map((f) => f.text), ["BLUF", "A1", "READY"]);
});
```

Run: `npm test`
Expected: FAIL.

- [ ] **Step 2: Write the implementation**

`plugins/plain/scripts/lib/version.mjs`:

```js
// Bump this when a rule changes; stamps made by an older checker stop counting.
export const CHECKER_VERSION = "1";
```

`plugins/plain/scripts/plain-check.mjs`:

```js
#!/usr/bin/env node
// Checks a file against the plain writing rules.
// Usage: node plain-check.mjs <file> [--json]. Exit 0 passes, 1 held, 2 file not found.
import { readFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./lib/config.mjs";
import { prepare } from "./lib/text.mjs";
import { checkText } from "./lib/rules.mjs";

export function checkString(raw, name, cwd, config = loadConfig(cwd)) {
  const findings = checkText(prepare(raw, name), config);
  return { findings, held: findings.some((f) => f.level === "hold") };
}

export function formatFindings(findings) {
  return findings.map((f) => `line ${f.line}  ${f.level.padEnd(6)}  ${f.message}`).join("\n");
}

function main(argv) {
  const args = argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file || !existsSync(file)) {
    console.error(`plain-check: file not found: ${file ?? "(none given)"}`);
    return 2;
  }
  const { findings, held } = checkString(readFileSync(file, "utf8"), file, process.cwd());
  if (args.includes("--json")) {
    console.log(JSON.stringify({ file, held, findings }, null, 2));
  } else {
    if (findings.length) console.log(formatFindings(findings));
    const holds = findings.filter((f) => f.level === "hold").length;
    const advice = findings.length - holds;
    console.log(held ? `Held: ${holds} problem(s) to fix, ${advice} piece(s) of advice.` : `Passes: no problems to fix${advice ? `, ${advice} piece(s) of advice` : ""}.`);
  }
  return held ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv));
```

- [ ] **Step 3: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add plugins/plain/scripts/lib/version.mjs plugins/plain/scripts/plain-check.mjs plugins/plain/tests/check.test.mjs
git commit -m "plain: the checker command

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Pass stamps and the override log

**Files:**
- Create: `plugins/plain/scripts/plain-stamp.mjs`
- Test: `plugins/plain/tests/stamp.test.mjs`

**Interfaces:**
- Consumes: `CHECKER_VERSION` and `checkString` (Task 7).
- Produces:
  - `fingerprint(text): string`
  - `plainDir(cwd): string`. This is the git common folder plus `/plain`; outside git it falls back to `$XDG_CACHE_HOME/plain` or `~/.cache/plain`.
  - `writeStamp(cwd, text, verdict): string`
  - `hasStamp(cwd, text): boolean`
  - `logOverride(cwd, entry): void` and `logError(cwd, error): void`
  - The command `node plain-stamp.mjs write <file> --verdict <verdict.json>` exits 0 when stamped, 1 when refused. The command `node plain-stamp.mjs has <file>` exits 0 or 1.

- [ ] **Step 1: Write the failing tests**

`plugins/plain/tests/stamp.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeRepo, git } from "../../../tests/helpers.mjs";
import { writeStamp, hasStamp, plainDir, logOverride } from "../scripts/plain-stamp.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "plain-stamp.mjs");

test("a stamp matches only the exact same text, and every worktree shares it", () => {
  const dir = makeRepo({ "a.md": "x" });
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "start");
  writeStamp(dir, "Hello there.\n", { pass: true });
  assert.equal(hasStamp(dir, "Hello there."), true);
  assert.equal(hasStamp(dir, "Hello there!"), false);
  const worktree = join(dirname(dir), `${basename(dir)}-wt`);
  git(dir, "worktree", "add", "-q", worktree);
  assert.equal(hasStamp(worktree, "Hello there."), true);
});

test("outside git, stamps go to the cache folder", () => {
  const dir = mkdtempSync(join(tmpdir(), "plain-nogit-"));
  process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), "plain-cache-"));
  writeStamp(dir, "Some text.", { pass: true });
  assert.ok(plainDir(dir).startsWith(process.env.XDG_CACHE_HOME));
  assert.equal(hasStamp(dir, "Some text."), true);
});

test("overrides are logged with their reason", () => {
  const dir = makeRepo();
  logOverride(dir, { reason: "quoting a customer", tool: "Bash", command: "gh pr create" });
  assert.ok(existsSync(join(plainDir(dir), "overrides.log")));
});

test("the stamp command refuses text that fails the checker or the reader", () => {
  const dir = makeRepo({
    ".claude/plain.json": "{}",
    "bad.md": "BLUF works.\n",
    "good.md": "This adds the map page. It loads and passes its tests.\n",
    "fail.json": JSON.stringify({ pass: false, unclear_terms: ["Karen"] }),
    "pass.json": JSON.stringify({ pass: true, unclear_terms: [], missing_context: [] }),
  });
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8" });
  assert.equal(run("write", "bad.md", "--verdict", "pass.json").status, 1);
  assert.equal(run("write", "good.md", "--verdict", "fail.json").status, 1);
  assert.equal(run("has", "good.md").status, 1);
  assert.equal(run("write", "good.md", "--verdict", "pass.json").status, 0);
  assert.equal(run("has", "good.md").status, 0);
});
```

Run: `npm test`
Expected: FAIL.

- [ ] **Step 2: Write the implementation**

`plugins/plain/scripts/plain-stamp.mjs`:

```js
#!/usr/bin/env node
// Pass stamps: proof that an exact text passed the checker and the cold reader.
// Stored in the repository's shared git folder, so they are never committed
// and every worktree sees them.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { CHECKER_VERSION } from "./lib/version.mjs";
import { checkString } from "./plain-check.mjs";

export function fingerprint(text) {
  const normal = text.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  return createHash("sha256").update(normal).digest("hex");
}

export function plainDir(cwd) {
  try {
    const common = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return join(resolve(cwd, common), "plain");
  } catch {
    return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "plain");
  }
}

export function writeStamp(cwd, text, verdict) {
  const dir = join(plainDir(cwd), "stamps");
  mkdirSync(dir, { recursive: true });
  const fp = fingerprint(text);
  writeFileSync(join(dir, `${fp}.json`), JSON.stringify({ fingerprint: fp, checkerVersion: CHECKER_VERSION, reader: verdict, at: new Date().toISOString() }, null, 2));
  return fp;
}

export function hasStamp(cwd, text) {
  const path = join(plainDir(cwd), "stamps", `${fingerprint(text)}.json`);
  if (!existsSync(path)) return false;
  try {
    return JSON.parse(readFileSync(path, "utf8")).checkerVersion === CHECKER_VERSION;
  } catch {
    return false;
  }
}

function appendLog(cwd, name, entry) {
  const dir = plainDir(cwd);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, name), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
}

export const logOverride = (cwd, entry) => appendLog(cwd, "overrides.log", entry);
export const logError = (cwd, error) => appendLog(cwd, "errors.log", { error: String(error?.stack ?? error) });

function main(argv) {
  const [command, file, ...rest] = argv.slice(2);
  if (!file || !existsSync(file)) {
    console.error(`plain-stamp: file not found: ${file ?? "(none given)"}`);
    return 1;
  }
  const text = readFileSync(file, "utf8");
  if (command === "has") return hasStamp(process.cwd(), text) ? 0 : 1;
  if (command !== "write") {
    console.error("Usage: plain-stamp.mjs write <file> --verdict <verdict.json> | has <file>");
    return 1;
  }
  const verdictPath = rest[rest.indexOf("--verdict") + 1];
  if (!rest.includes("--verdict") || !verdictPath || !existsSync(verdictPath)) {
    console.error("plain-stamp: --verdict <file> is required (the cold reader's JSON output).");
    return 1;
  }
  if (checkString(text, file, process.cwd()).held) {
    console.error("plain-stamp: the checker still holds this text. Fix it first.");
    return 1;
  }
  const verdict = JSON.parse(readFileSync(verdictPath, "utf8"));
  if (verdict.pass !== true) {
    console.error("plain-stamp: the cold reader did not pass this text.");
    return 1;
  }
  console.log(`Stamped ${file} (${writeStamp(process.cwd(), text, verdict).slice(0, 12)}).`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv));
```

- [ ] **Step 3: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add plugins/plain/scripts/plain-stamp.mjs plugins/plain/tests/stamp.test.mjs
git commit -m "plain: pass stamps, the override log and the error log

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The cold reader

**Files:**
- Create: `plugins/plain/scripts/data/reader-prompt.md`
- Create: `plugins/plain/scripts/plain-read.mjs`
- Test: `plugins/plain/tests/read.test.mjs`

**Interfaces:**
- Consumes: `htmlToText` (Task 4), `loadConfig` (Task 5).
- Produces:
  - `buildArgs(model): string[]`
  - `parseVerdict(stdout)` returns `{ pass, unclear_terms, missing_context, restatement, ask }`, or `{ pass: false, error }`.
  - `coldRead(text, { model, run })` returns a verdict. Tests can swap in their own `run`.
  - The command `node plain-read.mjs <file> [--model m] [--json]` exits 0 (passes), 1 (fails) or 2 (error).

- [ ] **Step 1: Write the reader's instructions**

`plugins/plain/scripts/data/reader-prompt.md`:

```markdown
You are a careful first-time reader. You are a junior software developer or a product manager: smart, with some technical background. You know general terms such as pull request, test, database, app screen, deploy, API, URL and JSON. You know nothing about the project, team, company or conversation this text came from. You cannot open links, files or other documents, and you have no tools.

Read the text between <text> and </text>. Then reply with only a JSON object, no other words, in this shape:

{"unclear_terms": [], "missing_context": [], "restatement": "", "ask": ""}

- unclear_terms: every word, name, acronym or code you could not understand from the text itself. Include internal names of people, tools and projects that the text does not explain. Leave out general terms a junior developer would know.
- missing_context: every place where the text depends on something you cannot see, such as an earlier discussion, a plan, a numbered decision or another document.
- restatement: two plain sentences saying what you think the text says.
- ask: one sentence saying what you think the reader is asked to do. Write "Nothing" if no action is asked.

Do not guess what an unexplained term means. If you are unsure whether a term is general knowledge, list it.
```

- [ ] **Step 2: Write the failing tests**

`plugins/plain/tests/read.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { coldRead, parseVerdict } from "../scripts/plain-read.mjs";

const reply = (v) => ({ status: 0, stderr: "", stdout: JSON.stringify(v) });

test("the reader runs from an empty temporary folder with no settings, tools, skills or extra servers", () => {
  let seen;
  const verdict = coldRead("Hello.", {
    model: "sonnet",
    run: (o) => {
      seen = o;
      return reply({ unclear_terms: [], missing_context: [], restatement: "A greeting.", ask: "Nothing" });
    },
  });
  assert.equal(verdict.pass, true);
  assert.ok(seen.cwd.startsWith(tmpdir()));
  assert.equal(existsSync(seen.cwd), false, "the temporary folder is removed afterwards");
  for (const flag of ["-p", "--setting-sources", "--tools", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence", "--system-prompt", "--model"]) {
    assert.ok(seen.args.includes(flag), flag);
  }
  assert.equal(seen.args[seen.args.indexOf("--setting-sources") + 1], "local");
  assert.equal(seen.args[seen.args.indexOf("--tools") + 1], "");
  assert.match(seen.input, /<text>\nHello\.\n<\/text>/);
});

test("unclear terms or missing context fail", () => {
  assert.equal(parseVerdict(JSON.stringify({ unclear_terms: ["Karen"], missing_context: [], restatement: "x", ask: "y" })).pass, false);
  assert.equal(parseVerdict(JSON.stringify({ unclear_terms: [], missing_context: ["the plan"], restatement: "x", ask: "y" })).pass, false);
});

test("output that isn't the expected JSON is an error, never a pass", () => {
  for (const out of ["sorry, I can't", "{not json}", JSON.stringify({ unclear_terms: [] })]) {
    const v = parseVerdict(out);
    assert.equal(v.pass, false);
    assert.ok(v.error);
  }
});

test("a failed reader run is an error, never a pass", () => {
  assert.equal(coldRead("x", { run: () => ({ status: 1, stdout: "", stderr: "boom" }) }).pass, false);
});

test("live probe: the reader knows nothing about our projects", { skip: !process.env.PLAIN_LIVE }, () => {
  const v = coldRead("Karen approved the Atlas change, and Hermes is next.");
  assert.equal(v.pass, false, JSON.stringify(v));
  for (const name of ["Karen", "Atlas", "Hermes"]) {
    assert.ok(v.unclear_terms.some((t) => t.includes(name)), `${name} should be unclear: ${JSON.stringify(v)}`);
  }
});
```

Run: `npm test`
Expected: FAIL. The live probe shows as skipped.

- [ ] **Step 3: Write the implementation**

`plugins/plain/scripts/plain-read.mjs`:

```js
#!/usr/bin/env node
// The cold reader: a separate Claude call that knows nothing about the
// project. It runs from an empty temporary folder with no settings,
// plugins, skills, tools or extra servers, and reports what it couldn't follow.
// Usage: node plain-read.mjs <file> [--model m] [--json]. Exit 0 passes, 1 fails, 2 error.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { htmlToText } from "./lib/text.mjs";
import { loadConfig } from "./lib/config.mjs";

const here = dirname(fileURLToPath(import.meta.url));

export function buildArgs(model) {
  const prompt = readFileSync(join(here, "data", "reader-prompt.md"), "utf8");
  return [
    "-p",
    "--model", model,
    "--setting-sources", "local",
    "--tools", "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--output-format", "text",
    "--system-prompt", prompt,
  ];
}

export function parseVerdict(stdout) {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end < start) return { pass: false, error: "The reader did not return JSON." };
  let v;
  try {
    v = JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return { pass: false, error: "The reader's JSON could not be read." };
  }
  const ok = Array.isArray(v.unclear_terms) && Array.isArray(v.missing_context) && typeof v.restatement === "string" && typeof v.ask === "string";
  if (!ok) return { pass: false, error: "The reader's JSON is missing fields." };
  return {
    pass: v.unclear_terms.length === 0 && v.missing_context.length === 0,
    unclear_terms: v.unclear_terms,
    missing_context: v.missing_context,
    restatement: v.restatement,
    ask: v.ask,
  };
}

function defaultRun({ args, cwd, input }) {
  return spawnSync("claude", args, { cwd, input, encoding: "utf8", timeout: 180_000 });
}

export function coldRead(text, { model = "sonnet", run = defaultRun } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "plain-reader-"));
  try {
    const result = run({ args: buildArgs(model), cwd, input: `Read this text and report as instructed.\n\n<text>\n${text}\n</text>` });
    if (result.status !== 0) return { pass: false, error: `The reader stopped with status ${result.status}: ${String(result.stderr ?? "").slice(0, 300)}` };
    return parseVerdict(String(result.stdout ?? ""));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function main(argv) {
  const args = argv.slice(2);
  const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--model");
  if (!file || !existsSync(file)) {
    console.error(`plain-read: file not found: ${file ?? "(none given)"}`);
    return 2;
  }
  const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : loadConfig(process.cwd()).readerModel;
  const raw = readFileSync(file, "utf8");
  const verdict = coldRead(file.endsWith(".html") ? htmlToText(raw) : raw, { model });
  if (args.includes("--json")) {
    console.log(JSON.stringify(verdict, null, 2));
  } else if (verdict.error) {
    console.log(`Error: ${verdict.error}`);
  } else {
    console.log(verdict.pass ? "Passes: the reader followed everything." : "Fails: the reader couldn't follow everything.");
    if (verdict.unclear_terms.length) console.log(`Unclear terms: ${verdict.unclear_terms.join(", ")}`);
    if (verdict.missing_context.length) console.log(`Missing context: ${verdict.missing_context.join("; ")}`);
    console.log(`What the reader thinks it says: ${verdict.restatement}`);
    console.log(`What the reader thinks it's asked to do: ${verdict.ask}`);
  }
  return verdict.error ? 2 : verdict.pass ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv));
```

- [ ] **Step 4: Run the tests, then the live probe once**

Run: `npm test`
Expected: PASS, with the live probe skipped.

Run: `PLAIN_LIVE=1 node --test plugins/plain/tests/read.test.mjs`
Expected: PASS. This is the "starts blank" check from the spec, and it makes one small model call. **If it fails, stop and report the reader's output.** Don't change the flags or the probe to force a pass: a reader that knows our project would let unclear text through.

- [ ] **Step 5: Commit**

```bash
git add plugins/plain/scripts/plain-read.mjs plugins/plain/scripts/data/reader-prompt.md plugins/plain/tests/read.test.mjs
git commit -m "plain: the cold reader

A separate Claude call from an empty temporary folder, with no settings,
plugins, skills, tools or extra servers. The live probe confirmed it knows
nothing about our projects.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

If the live probe could not be run, remove the last sentence of the commit message.

---

### Task 10: The hold

**Files:**
- Create: `plugins/plain/scripts/plain-hold.mjs`
- Create: `plugins/plain/hooks/hooks.json`
- Test: `plugins/plain/tests/hold.test.mjs`

**Interfaces:**
- Consumes: `loadConfig` (Task 5), `checkString` (Task 7), `hasStamp`, `logOverride` and `logError` (Task 8).
- Produces:
  - `decide({ tool_name, tool_input, cwd })` returns `{ allow: boolean, messages: string[], override?: string }`.
  - Helpers `segments(cmd)`, `tokenize(segment)` and `extractHeredocs(cmd)`.
  - The hook command reads Claude Code's hook input as JSON on standard input. It exits 0 to allow, or 2 to hold, with the reason on standard error.

- [ ] **Step 1: Write the failing tests**

`plugins/plain/tests/hold.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeRepo, git } from "../../../tests/helpers.mjs";
import { decide } from "../scripts/plain-hold.mjs";
import { writeStamp, plainDir } from "../scripts/plain-stamp.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "plain-hold.mjs");
const GOOD = "This adds the map page. It loads and passes its tests.\n";
const repo = (extra = {}) => makeRepo({
  ".claude/plain.json": JSON.stringify({ neverPublish: { BLUF: "Put the summary first." } }),
  "good.md": GOOD,
  "bad.md": "BLUF: it works.\n",
  ...extra,
});
const bash = (dir, command) => decide({ tool_name: "Bash", tool_input: { command }, cwd: dir });
const text = (r) => r.messages.join("\n");

test("repositories without plain settings are never held", () => {
  const dir = makeRepo({ "bad.md": "BLUF" });
  assert.equal(bash(dir, "gh pr create --body-file bad.md").allow, true);
});

test("inline pull request bodies are held with an instruction to use a file", () => {
  const r = bash(repo(), 'gh pr create --title "Add the map page" --body "It works"');
  assert.equal(r.allow, false);
  assert.match(text(r), /Save it to a file/);
});

test("a body pulled in with $(cat file) or from standard input still counts as inline", () => {
  const dir = repo();
  assert.equal(bash(dir, 'gh pr create --body "$(cat good.md)"').allow, false);
  assert.equal(bash(dir, "gh pr create --body-file -").allow, false);
});

test("a body file that fails the checker is held, and the problems are listed", () => {
  const r = bash(repo(), 'gh pr create --title "Add the map page" --body-file bad.md');
  assert.equal(r.allow, false);
  assert.match(text(r), /BLUF/);
});

test("a clean body file needs a stamp, then goes ahead", () => {
  const dir = repo();
  const before = bash(dir, 'gh pr create --title "Add the map page" --body-file good.md');
  assert.equal(before.allow, false);
  assert.match(text(before), /Run \/plain/);
  writeStamp(dir, GOOD, { pass: true });
  assert.equal(bash(dir, 'gh pr create --title "Add the map page" --body-file good.md').allow, true);
});

test("titles with planning codes are held", () => {
  const dir = repo();
  writeStamp(dir, GOOD, { pass: true });
  const r = bash(dir, 'gh pr create --title "A1 skeleton" --body-file good.md');
  assert.equal(r.allow, false);
  assert.match(text(r), /A1/);
});

test("issues and comments are checked the same way", () => {
  const dir = repo();
  assert.equal(bash(dir, "gh issue create --title Map --body-file bad.md").allow, false);
  assert.equal(bash(dir, 'gh pr comment 12 --body "looks good"').allow, false);
});

test("gh api: file bodies, inline bodies and JSON input are checked; reads are not", () => {
  const dir = repo({ "pr.json": JSON.stringify({ body: "BLUF: x" }) });
  assert.equal(bash(dir, "gh api repos/o/r/issues/5/comments -F body=@bad.md").allow, false);
  assert.match(text(bash(dir, 'gh api repos/o/r/pulls -f title="Add map" -f body="inline"')), /Save it to a file/);
  assert.equal(bash(dir, "gh api repos/o/r/pulls/7 --method PATCH --input pr.json").allow, false);
  assert.equal(bash(dir, "gh api repos/o/r/pulls").allow, true);
});

test("Claude's usual heredoc commit message is read; codes in its first line are held", () => {
  const dir = repo();
  const commit = (first) => `git commit -m "$(cat <<'EOF'\n${first}\n\nBody text.\nEOF\n)"`;
  assert.equal(bash(dir, commit("feat: add the A1 skeleton")).allow, false);
  assert.equal(bash(dir, commit("feat: add the map skeleton")).allow, true);
});

test("a spec file in a commit must pass and be stamped", () => {
  const spec = "This plan adds a map page. It has tests.\n";
  const dir = repo({ "docs/superpowers/specs/map.md": spec });
  git(dir, "add", "docs");
  assert.equal(bash(dir, 'git commit -m "Add the map spec"').allow, false);
  writeStamp(dir, spec, { pass: true });
  assert.equal(bash(dir, 'git commit -m "Add the map spec"').allow, true);
});

test("page publishes are checked; asset uploads are not", () => {
  const dir = repo({ "page.html": "<style>:root{--BG:#FFF}</style><p>BLUF works</p>" });
  assert.equal(decide({ tool_name: "Artifact", tool_input: { file_path: join(dir, "page.html") }, cwd: dir }).allow, false);
  assert.equal(decide({ tool_name: "Artifact", tool_input: { file_path: join(dir, "page.html"), asset: true }, cwd: dir }).allow, true);
});

test("an override with a reason goes ahead and is logged; without a reason it is held", () => {
  const dir = repo();
  assert.equal(bash(dir, 'PLAIN_OVERRIDE="quoting a customer" gh pr create --body-file bad.md').allow, true);
  assert.match(readFileSync(join(plainDir(dir), "overrides.log"), "utf8"), /quoting a customer/);
  assert.equal(bash(dir, "PLAIN_OVERRIDE= gh pr create --body-file bad.md").allow, false);
});

test("the hook holds with exit 2 and explains why on standard error", () => {
  const dir = repo();
  const input = JSON.stringify({ tool_name: "Bash", tool_input: { command: 'gh pr create --body "x"' }, cwd: dir });
  const r = spawnSync(process.execPath, [script], { input, encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /plain held/);
});

test("unreadable hook input allows the action", () => {
  assert.equal(spawnSync(process.execPath, [script], { input: "not json", encoding: "utf8" }).status, 0);
});
```

Run: `npm test`
Expected: FAIL.

- [ ] **Step 2: Write the implementation**

`plugins/plain/scripts/plain-hold.mjs`:

```js
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
      for (const body of values(t, ["-b", "--body"])) checks.push({ type: "inline", label: "Body" });
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
```

`plugins/plain/hooks/hooks.json`:

```json
{
  "description": "plain: hold unclear text before it is posted to GitHub, published as a page, or committed as a spec or plan",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Artifact",
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/plain-hold.mjs\"", "timeout": 30 }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: Run the tests**

Run: `npm test`
Expected: PASS. A failing case shows exactly which posting form is handled wrong. Fix `classify`, not the test.

- [ ] **Step 4: Commit**

```bash
git add plugins/plain/scripts/plain-hold.mjs plugins/plain/hooks/hooks.json plugins/plain/tests/hold.test.mjs
git commit -m "plain: the hold before posting, publishing and committing specs

Runs only in repositories with plain settings. Reads gh pull request and
issue commands, gh api writes, page publishes and git commits, including
the heredoc form Claude uses for commit messages.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The skill and its reference files

**Files:**
- Create: `plugins/plain/skills/plain/SKILL.md`
- Create: `plugins/plain/skills/plain/rules.md`
- Create: `plugins/plain/skills/plain/pr-layout.md`
- Create: `plugins/plain/skills/plain/glossary-format.md`
- Modify: `README.md` (add a `plain` section)
- Test: `tests/marketplace.test.mjs`, plus an install check

- [ ] **Step 1: Write the failing test**

Append to `tests/marketplace.test.mjs`:

```js
test("the plain skill and its reference files exist", () => {
  const skill = readFileSync(join(root, "plugins", "plain", "skills", "plain", "SKILL.md"), "utf8");
  assert.match(skill, /^---\nname: plain\ndescription: .+\n---/);
  for (const f of ["rules.md", "pr-layout.md", "glossary-format.md"]) {
    assert.ok(existsSync(join(root, "plugins", "plain", "skills", "plain", f)), f);
  }
});
```

Run: `npm test`
Expected: FAIL.

- [ ] **Step 2: Write `SKILL.md`**

```markdown
---
name: plain
description: Write or rewrite text so a junior developer or product manager can understand it with no outside context. Use before posting a pull request, review, issue or comment to GitHub, before publishing a page, before committing a spec or plan, and when the owner says "plain" or that a message didn't make sense.
---

# plain

Everything we publish must make sense to a junior developer or a product manager who knows nothing about this project. Everything needed to follow the text is in the text. Links can point to more detail, but the text must make sense without them.

Read `rules.md` in this folder before writing. For a pull request description, also read `pr-layout.md`.

The scripts are in the plugin's `scripts` folder, two levels above this file. Below, SCRIPTS means `<this skill's folder>/../../scripts`.

## Write or fix a text

1. Put the text in a file. Pull request bodies, issue bodies and comments are always posted from a file (`--body-file`, or `-F body=@file` with `gh api`). The hold stops text written inline in a command.
2. Rewrite it by the rules.
3. Run the checker: `node SCRIPTS/plain-check.mjs <file>`. Fix every "hold" line. Consider each "advice" line.
4. Run the cold reader: `node SCRIPTS/plain-read.mjs <file> --json > "$TMPDIR/plain-verdict.json"`, then read the verdict.
5. For each unclear term or missing piece of context, explain it or replace it in the text, then go back to step 3. Compare the reader's restatement and ask with what you meant. If they differ, rewrite. After two rewrites that still fail, stop and show the owner the text and the reader's notes.
6. When both pass, record the stamp: `node SCRIPTS/plain-stamp.mjs write <file> --verdict "$TMPDIR/plain-verdict.json"`.
7. If you rewrote the owner's own draft, show the before and after.
8. Post or publish from the same file. Changing the file after stamping needs a new pass.

## Fix an existing pull request: `/plain 123`

1. Read it: `gh pr view 123 --json title,body,files`.
2. Write a new description into a file using `pr-layout.md`.
3. Follow "Write or fix a text".
4. Post it with `gh pr edit 123 --body-file <file>`, or with the method the repository's facts file says to use.

## Explain mode

When the owner says something didn't make sense, explain it again in chat following `rules.md`. Chat replies don't need the checker or a stamp.

## The glossary

When the cold reader flags the same project term more than once, add it to the repository's `GLOSSARY.md` (format in `glossary-format.md`). In onehearthealth, use `.claude/GLOSSARY.local.md`, which is personal and git-ignored.

## When the hold stops a post

The message says exactly what to fix. Fix the file, run this skill on it, then post again. For a deliberate exception, such as quoting a customer word for word, put `PLAIN_OVERRIDE="the reason"` in front of the command. Every override is logged.

## Turning it on in a repository

The hold only runs in repositories that have `.claude/plain.json` (shared, committed) or `.claude/plain.local.json` (personal, git-ignored). See `glossary-format.md`.
```

- [ ] **Step 3: Write the three reference files**

`rules.md`: the eleven writing rules and their sources, copied from section 5 of `docs/specs/2026-10-05-plain-design.md`. Start the file with the reader description from section 2 of the same document.

`pr-layout.md`: the pull request layout block and its two following paragraphs, copied from section 6.8 of the same document. Include the credit line.

`glossary-format.md`:

````markdown
# Glossary and settings formats

## GLOSSARY.md (one per repository, committed)

Uses Matt Pocock's format (MIT license). Each project term gets a one- or two-sentence definition, and the words to avoid:

```markdown
**Recording**:
Audio of the heart captured at one listening spot on the chest.
_Avoid_: clip, sample, track
```

Only terms specific to this project go here, not general programming terms. Matt Pocock's skills read the same file. In onehearthealth, use `.claude/GLOSSARY.local.md` instead, which is personal and git-ignored.

## .claude/plain.json (shared, committed) and .claude/plain.local.json (personal, git-ignored)

Either file turns plain on for the repository. Personal values win over shared ones. Word lists from both are combined.

```json
{
  "commonWords": ["S3"],
  "neverPublish": { "BLUF": "Put the summary first; no heading needed." },
  "watchFolders": ["docs/superpowers/specs", "docs/superpowers/plans", "openspec/changes"],
  "readerModel": "sonnet"
}
```

| Field | Meaning | Default |
|---|---|---|
| `commonWords` | Extra acronyms this repository's readers know, added to the built-in list | none |
| `neverPublish` | Shorthand that must never appear, with what to write instead | none |
| `watchFolders` | Folders whose `.md` and `.html` files must pass before a commit | specs, plans and OpenSpec changes |
| `readerModel` | The model the cold reader uses | `sonnet` |

Add `**/.claude/plain.local.json` and `**/.claude/GLOSSARY.local.md` to your personal git ignore file (`~/.config/git/ignore`).
````

- [ ] **Step 4: Add a README section**

Add to `README.md`, after the Matt Pocock section:

```markdown
## plain

Keeps everything we publish readable for a junior developer or product manager with no outside context. It has writing rules, a checker script, a blank cold reader and a hold before anything is posted to GitHub, published as a page, or committed as a spec or plan.

    claude plugin install plain@cstack

The hold does nothing until a repository opts in with `.claude/plain.json` (shared) or `.claude/plain.local.json` (personal). Details: `plugins/plain/skills/plain/glossary-format.md`.
```

- [ ] **Step 5: Run the tests and check the install**

Run: `npm test`
Expected: PASS.

Run:

```bash
T=$(mktemp -d); export CLAUDE_CONFIG_DIR="$T"
claude plugin marketplace add "$PWD" && claude plugin install plain@cstack
claude plugin details plain@cstack | sed -n '5,12p'
unset CLAUDE_CONFIG_DIR
```

Expected: "Skills (1) plain" and "Hooks (1) PreToolUse".

- [ ] **Step 6: Commit**

```bash
git add plugins/plain/skills README.md tests/marketplace.test.mjs
git commit -m "plain: the skill, the writing rules, the pull request layout and the file formats

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: First real use on our own documents

**Files:**
- Create: `.claude/plain.json` (cstack's own settings)
- Create: `GLOSSARY.md` (cstack's own glossary)
- Modify: `docs/specs/2026-10-05-program-plan.md`, `docs/specs/2026-10-05-plain-design.md`, and this plan file

- [ ] **Step 1: Turn plain on for cstack**

`.claude/plain.json`:

```json
{
  "neverPublish": { "BLUF": "Put the summary first; no heading needed." }
}
```

`GLOSSARY.md`, starting with these terms. Add more only for real project terms the checker or reader flags in Step 2:

```markdown
# cstack

A personal collection of Claude Code plugins and skills, shared across projects.

## Language

**cstack**:
This repository: a collection of Claude Code plugins that every project installs.

**Karen**:
Our automated reviewer agent. It checks what was actually built against what was claimed, and returns "ready" or "not ready".

**pstack**:
Lauren Tan's published set of Claude Code and Cursor skills. We point at four of them.

**T3 Code**:
A desktop app for running Claude Code sessions, used alongside the terminal.
```

- [ ] **Step 2: Check the two current documents**

Run:

```bash
node plugins/plain/scripts/plain-check.mjs docs/specs/2026-10-05-program-plan.md
node plugins/plain/scripts/plain-check.mjs docs/specs/2026-10-05-plain-design.md
```

Fix every hold by rewriting the text. Add a glossary entry or a common word only when the term is a real project term, or a term a junior developer knows. List each glossary or common-word addition in the commit message.

- [ ] **Step 3: Run the cold reader on both and stamp them**

```bash
for f in docs/specs/2026-10-05-program-plan.md docs/specs/2026-10-05-plain-design.md; do
  node plugins/plain/scripts/plain-read.mjs "$f" --json > "$TMPDIR/v.json"; cat "$TMPDIR/v.json"
done
```

Fix what the reader flags, at most two rounds per document. Then stamp each with `node plugins/plain/scripts/plain-stamp.mjs write <file> --verdict <its verdict file>`. If a document still fails after two rounds, don't stamp it. Report the reader's notes to the owner instead.

- [ ] **Step 4: Commit through the hold**

Install `plain` in this session's account only if the owner agrees. Otherwise run the hold by hand on the commit command to confirm it goes ahead:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"git commit -m \"Rewrite the plan documents in plain English\""},"cwd":"'"$PWD"'"}' | node plugins/plain/scripts/plain-hold.mjs; echo "exit $?"
```

Expected: `exit 0` once both documents are stamped and staged.

```bash
git add .claude/plain.json GLOSSARY.md docs
git commit -m "Rewrite the plan documents in plain English

Glossary and common-word additions: <list them here>.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Not in this plan

These come in later plans, in the order set by the one-plan document:

- **Step 1 quick wins outside cstack.** Each needs the owner's approval because it touches shared settings or other repositories:
  - `SG_AGENTIC_COMMIT_REVIEW=0` in shared settings
  - the router change, with its safeguards
  - plugin trims, facts files and short CLAUDE.md files
  - updating cstack and Matt Pocock's skills in both accounts
  - the one-minute teammate test
  - adding the two personal file names to the global git ignore, and removing its repeated lines
- **Turning `plain` on in precordia and smsMarketing,** seeding their glossaries, and the personal setup in onehearthealth. This comes with `cstack init` in the orchestrate core plan.
- **The "Plain English" reply style and the commit-message check for message bodies:** `plain` rollout step 6.
- **The orchestrate core plan** (meter, reminders, checkpoint and resume, repository snapshot, pace line, production guard, scoreboard, `cstack init`), then `verify`.
