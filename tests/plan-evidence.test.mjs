import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { proseLines } from "../plugins/verify/scripts/lib/markdown.mjs";
import { parseEvidence, gather, ITEM } from "../plugins/verify/scripts/lib/plan.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const plans = join(root, "docs", "superpowers", "plans");
const PATH_KINDS = new Set(["test", "file", "screenshot", "log", "run"]);

const ignored = (path) => {
  try { execFileSync("git", ["check-ignore", "-q", path], { cwd: root }); return true; } catch { return false; }
};

// A ticked item's proof must survive a fresh clone: a file in an ignored folder exists only
// on the machine that ran the check. Paths starting with ~/ point at another checkout on purpose.
test("ticked plan items in this repository cite committed evidence, never ignored files", () => {
  const file = join(plans, "2026-10-07-verify-first-build.md");
  if (!existsSync(file)) return;
  const lines = proseLines(readFileSync(file, "utf8"));
  const bad = [];
  lines.forEach((l, i) => {
    const m = l.text.match(ITEM);
    if (!m || m[1] === " ") return;
    for (const ev of parseEvidence(gather(lines, i)) ?? []) {
      if (PATH_KINDS.has(ev.kind) && ev.target && !ev.target.startsWith("~") && ignored(ev.target)) bad.push(`line ${l.line}: ${ev.raw}`);
    }
  });
  assert.deepEqual(bad, []);
});
