import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { coldRead, parseVerdict, buildArgs } from "../skills/cold-reader/scripts/cold-read.mjs";
import { READER_VERSION } from "../skills/cold-reader/scripts/version.mjs";

const skillDir = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "cold-reader");

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

test("the reader's instructions are the cold-reader skill's own file", () => {
  const args = buildArgs("sonnet");
  const prompt = args[args.indexOf("--system-prompt") + 1];
  assert.equal(prompt, readFileSync(join(skillDir, "reader-prompt.md"), "utf8"));
  assert.ok(existsSync(join(skillDir, "SKILL.md")));
});

test("every verdict records the reader version that made it", () => {
  assert.match(READER_VERSION, /^\d+$/);
  const v = coldRead("Hello.", { run: () => reply({ unclear_terms: [], missing_context: [], restatement: "A greeting.", ask: "Nothing" }) });
  assert.equal(v.readerVersion, READER_VERSION);
  assert.equal(parseVerdict(JSON.stringify({ unclear_terms: [], missing_context: [], restatement: "x", ask: "y" })).readerVersion, READER_VERSION);
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
