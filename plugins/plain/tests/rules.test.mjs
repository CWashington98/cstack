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
