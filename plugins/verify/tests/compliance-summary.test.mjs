import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { summarize } from "../scripts/lib/compliance.mjs";

const plainCheck = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "plain", "scripts", "plain-check.mjs");

function passesPlainCheck(text) {
  const file = join(mkdtempSync(join(tmpdir(), "summary-")), "summary.md");
  writeFileSync(file, text);
  const r = spawnSync("node", [plainCheck, file], { encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` };
}

const base = { change: "add-seat-limit", scenarios: [{ id: "a" }, { id: "b" }], counts: { ran: 2, expected: 2 }, holds: [], warnings: [], allowedEdits: [], held: false };

test("a proven summary and a skipped-breaks line read plainly", () => {
  const r = passesPlainCheck(summarize({ ...base, breaks: { skipped: true, reason: "the normal lane does not break changed lines", entries: [] } }));
  assert.ok(r.ok, r.out);
});

test("a held summary with a break nobody noticed reads plainly", () => {
  const hold = { check: "tests-exercise-their-code", file: "src/seats.ts", line: 1, why: 'Line 1 of src/seats.ts was broken (moved the number 10 to 11) and every test of seat-added-under-limit still passed. Add a test that checks this line, or write the reason on the line as "break-ok: <reason>".' };
  const text = summarize({ ...base, held: true, holds: [hold], breaks: { skipped: false, tried: 4, entries: [{ status: "covered" }, { status: "uncaught" }] } });
  const r = passesPlainCheck(text);
  assert.ok(r.ok, `${r.out}\n${text}`);
});
