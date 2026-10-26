// Locked acceptance tests for add-factory-gate. Change only with a Spec-Change commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let tokens = {};
try { tokens = await import(pathToFileURL(join(here, "..", "scripts", "lib", "tokens.mjs"))); }
catch (error) { if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error; }

function need(name) {
  assert.equal(typeof tokens[name], "function", `factory must export ${name}`);
  return tokens[name];
}

function assistant(id, { model = "claude-opus-4-1", input = 0, output = 0, cacheWrite = 0, cacheRead = 0, entrypoint = "cli" } = {}) {
  return JSON.stringify({
    type: "assistant", entrypoint,
    message: { id, model, usage: { input_tokens: input, output_tokens: output, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead } },
  });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "factory-tokens-"));
  const projectsDir = join(root, "projects"); mkdirSync(projectsDir);
  return { root, projectsDir };
}

function writeTranscript(projectsDir, relative, lines) {
  const file = join(projectsDir, relative); mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

const PRICES = {
  "claude-opus-4-1": { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
};

test("[repeated-message-counted-once] a repeated assistant message ID counts once", () => {
  const summarizeTranscripts = need("summarizeTranscripts");
  const { projectsDir } = fixture();
  const line = assistant("msg_01", { output: 1000 });
  writeTranscript(projectsDir, "project-a/chat.jsonl", [line, line, line]);
  const result = summarizeTranscripts({ projectsDir, prices: PRICES });
  assert.equal(result.totals.outputTokens, 1000);
  assert.equal(result.messageCount, 1);
});

test("[subagent-files-labelled] main and subagent transcript usage remain separate", () => {
  const summarizeTranscripts = need("summarizeTranscripts");
  const { projectsDir } = fixture();
  writeTranscript(projectsDir, "project-a/chat-1.jsonl", [assistant("main", { output: 50000 })]);
  writeTranscript(projectsDir, "project-a/chat-1/subagents/review.jsonl", [assistant("sub", { output: 20000 })]);
  const result = summarizeTranscripts({ projectsDir, prices: PRICES });
  assert.equal(result.byRole.main.outputTokens, 50000);
  assert.equal(result.byRole.subagent.outputTokens, 20000);
});

test("[harness-split-by-entrypoint] each harness gets totals and average cache tokens per message", () => {
  const summarizeTranscripts = need("summarizeTranscripts");
  const { projectsDir } = fixture();
  writeTranscript(projectsDir, "project-a/a.jsonl", Array.from({ length: 10 }, (_, i) => assistant(`cli-${i}`, { cacheWrite: 5000, entrypoint: "cli" })));
  writeTranscript(projectsDir, "project-a/b.jsonl", Array.from({ length: 10 }, (_, i) => assistant(`sdk-${i}`, { cacheWrite: 7000, entrypoint: "sdk-ts" })));
  const result = summarizeTranscripts({ projectsDir, prices: PRICES });
  assert.equal(result.byHarness.cli.averageCacheWriteTokens, 5000);
  assert.equal(result.byHarness["sdk-ts"].averageCacheWriteTokens, 7000);
});

test("[unknown-model-unpriced] an unknown model is counted without inventing a price", () => {
  const summarizeTranscripts = need("summarizeTranscripts");
  const { projectsDir } = fixture();
  writeTranscript(projectsDir, "project-a/chat.jsonl", [assistant("new-model", { model: "some-new-model", output: 5000 })]);
  const result = summarizeTranscripts({ projectsDir, prices: PRICES });
  assert.equal(result.byModel["some-new-model"].outputTokens, 5000);
  assert.equal(result.byModel["some-new-model"].priced, false);
  assert.equal(result.byModel["some-new-model"].dollars, null);
});

test("[dollars-per-merged-pr] repository and worktree usage is divided by merged pull requests", () => {
  const dollarsPerMergedPr = need("dollarsPerMergedPr");
  const { root } = fixture();
  const repo = join(root, "Source", "app"); mkdirSync(repo, { recursive: true });
  const bin = join(root, "bin"); mkdirSync(bin);
  const gh = join(bin, "gh");
  writeFileSync(gh, "#!/bin/sh\nprintf '[1,2,3,4]'\n"); chmodSync(gh, 0o755);
  const result = dollarsPerMergedPr({
    repo,
    projectTotals: [
      { path: repo, dollars: 90 },
      { path: join(root, "Source", "app-wt", "feature"), repository: repo, dollars: 30 },
    ],
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    since: "2026-10-20T00:00:00Z",
  });
  assert.equal(result.mergedPullRequests, 4);
  assert.equal(result.dollars, 120);
  assert.equal(result.dollarsPerMergedPullRequest, 30);
});
