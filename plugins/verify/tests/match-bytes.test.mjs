import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { makeRepo } from "../../../tests/helpers.mjs";
import { matchBytes, fingerprint } from "../scripts/match-bytes.mjs";

const root = makeRepo({ "src/a.wav": "RIFF-a-bytes", "src/b.wav": "RIFF-b-bytes", "got/1.bin": "RIFF-a-bytes", "got/2.bin": "synthetic", "got/empty.bin": "" });
const p = (f) => join(root, f);

test("bodies that equal a stored file match", () => {
  const r = matchBytes({ sources: [p("src/a.wav"), p("src/b.wav")], bodies: [p("got/1.bin")] });
  assert.deepEqual(r.problems, []);
  assert.equal(r.rows[0].match, p("src/a.wav"));
});

test("a body that matches no stored file fails", () => {
  const r = matchBytes({ sources: [p("src/a.wav")], bodies: [p("got/1.bin"), p("got/2.bin")] });
  assert.match(r.problems.join("\n"), /matches no source file/);
  assert.equal(r.matched, 1);
});

test("an empty body or an empty comparison fails rather than passes", () => {
  assert.match(matchBytes({ sources: [p("src/a.wav")], bodies: [p("got/empty.bin")] }).problems.join(), /is empty/);
  assert.match(matchBytes({ sources: [p("src/a.wav")] }).problems.join(), /nothing to compare/);
  assert.match(matchBytes({ bodies: [p("got/1.bin")] }).problems.join(), /no source files/);
});

test("fingerprints computed in the browser can be compared directly", () => {
  const r = matchBytes({ sources: [p("src/b.wav")], hashes: [fingerprint(Buffer.from("RIFF-b-bytes")).toUpperCase()] });
  assert.deepEqual(r.problems, []);
});
