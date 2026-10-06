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
