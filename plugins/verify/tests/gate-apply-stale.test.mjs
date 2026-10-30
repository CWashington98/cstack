// A guard beyond the pr-open scenarios: a draft never keeps an old "review and merge" line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { withoutFirstLine, LEAD } from "../scripts/lib/gate/apply.mjs";

test("going back to draft drops an old 'What you need to do' line and keeps the rest", () => {
  assert.equal(withoutFirstLine(`${LEAD} review and merge.\n\n## What changed\nA fix.\n`), "## What changed\nA fix.\n");
});

test("a description without that line is left as it is", () => {
  assert.equal(withoutFirstLine("## What changed\nA fix.\n"), "## What changed\nA fix.\n");
});
