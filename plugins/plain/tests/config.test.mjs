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
