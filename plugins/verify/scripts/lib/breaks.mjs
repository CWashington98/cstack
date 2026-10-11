// Breaking changed lines on purpose (the high-risk lane). Every condition and limit
// a change added is altered in turn in a throwaway checkout, the tests of the
// scenarios that own that file run, and the file is put back byte for byte.
// A break no test notices is a hold. Nothing here names a language or a test tool.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const COMMENT = /^\s*(?:\/\/|#|\*|\/\*|--|;)/;
const EXCUSE = /\bbreak-ok:\s*(\S.*)$/;

// The line with the inside of every quoted string blanked, so nothing in text is mistaken for code.
function mask(line) {
  return line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, (s) => s[0] + " ".repeat(s.length - 2) + s[0]);
}

const SWAPS = [
  [/===|!==|==|!=|>=|<=|(?<=\s)>(?=\s)|(?<=\s)<(?=\s)|&&|\|\||(?<=\s)(?:and|or)(?=\s)/g, {
    "===": "!==", "!==": "===", "==": "!=", "!=": "==", ">=": "<", "<=": ">", ">": "<=", "<": ">=",
    "&&": "||", "||": "&&", and: "or", or: "and",
  }],
];

// Every way to break one line: flip a comparison or a joining word, or move a whole number by one.
export function candidateBreaks(line) {
  if (COMMENT.test(line) || EXCUSE.test(line)) return [];
  const code = mask(line);
  const out = [];
  for (const [re, map] of SWAPS) {
    for (const m of code.matchAll(re)) {
      const to = map[m[0]];
      out.push({ kind: "flip", from: m[0], to, text: line.slice(0, m.index) + to + line.slice(m.index + m[0].length), what: `flipped "${m[0]}" to "${to}"` });
    }
  }
  for (const m of code.matchAll(/(?<![\w.$])\d+(?![\w.])/g)) {
    const n = Number(m[0]);
    for (const to of [n + 1, n - 1]) {
      out.push({ kind: "limit", from: m[0], to: String(to), text: line.slice(0, m.index) + to + line.slice(m.index + m[0].length), what: `moved the number ${m[0]} to ${to}` });
    }
  }
  return out;
}

// Added lines (numbered from 1 in the new file) of every file the change touched.
export function changedLines(root, base, keep = () => true) {
  const diff = execFileSync("git", ["diff", "--unified=0", "--no-renames", "--no-color", `${base}`, "HEAD"], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const files = new Map();
  let file = null;
  let at = 0;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+++ ")) { file = l === "+++ /dev/null" ? null : l.slice(6); if (file && !keep(file)) file = null; if (file) files.set(file, []); continue; }
    const h = l.match(/^@@ -\S+ \+(\d+)/);
    if (h) { at = Number(h[1]); continue; }
    if (file && l.startsWith("+") && !l.startsWith("+++")) { files.get(file).push({ line: at, text: l.slice(1) }); at++; }
  }
  return files;
}

// Uncommitted work would be missing from the checkout the breaks run in, so it is refused up front.
export function dirtyFiles(root) {
  const out = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: root, encoding: "utf8" });
  return out.split("\n").filter((l) => l && !l.slice(3).startsWith(".verify/"));
}

// deps: { withTree(fn), runScenario(tree, entry), owners(file) -> scenario entries, keep(file) }
export function runBreaks({ root, base, deps }) {
  const entries = [];
  const holds = [];
  const files = changedLines(root, base, deps.keep);
  const work = [];
  for (const [file, lines] of files) {
    const owners = deps.owners(file);
    for (const { line, text } of lines) {
      if (COMMENT.test(text)) continue;
      const excuse = text.match(EXCUSE);
      if (excuse) { entries.push({ file, line, status: "excused", reason: excuse[1].trim() }); continue; }
      for (const b of candidateBreaks(text)) work.push({ file, line, text, b, owners });
    }
  }
  const skippedFiles = new Set();
  deps.withTree((tree) => {
    for (const w of work) {
      if (!w.owners.length) {
        if (!skippedFiles.has(w.file)) { skippedFiles.add(w.file); entries.push({ file: w.file, status: "skipped", why: `No scenario's task touches ${w.file}, so there are no tests to try its breaks against.` }); }
        continue;
      }
      const path = join(tree, w.file);
      const original = readFileSync(path);
      const lines = original.toString("utf8").split("\n");
      if (lines[w.line - 1]?.replace(/\r$/, "") !== w.text.replace(/\r$/, "")) continue;
      lines[w.line - 1] = lines[w.line - 1].replace(w.text.replace(/\r$/, ""), w.b.text.replace(/\r$/, ""));
      let caught = null;
      try {
        writeFileSync(path, lines.join("\n"));
        for (const entry of w.owners) {
          const r = deps.runScenario(tree, entry);
          if (r.failed > 0 || r.exits.some((x) => x !== 0)) { caught = entry.id; break; }
        }
      } finally {
        writeFileSync(path, original);
      }
      const e = { file: w.file, line: w.line, break: w.b.what, status: caught ? "covered" : "uncaught", scenarios: w.owners.map((o) => o.id) };
      if (caught) e.caughtBy = caught;
      entries.push(e);
      if (!caught) {
        holds.push({ check: deps.check, file: w.file, line: w.line, break: w.b.what, scenarios: e.scenarios,
          why: `Line ${w.line} of ${w.file} was broken (${w.b.what}) and every test of ${e.scenarios.join(", ")} still passed. Add a test that checks this line, or write the reason on the line as "break-ok: <reason>".` });
      }
    }
  });
  return { entries, holds, tried: entries.filter((e) => e.status === "covered" || e.status === "uncaught").length };
}
