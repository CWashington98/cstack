import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

const emptyUsage = () => ({ inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, dollars: 0 });

function filesUnder(root) {
  if (!root || !existsSync(root)) return [];
  const found = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(path));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) found.push(path);
  }
  return found;
}

function records(file) {
  return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function assistantMessage(record) {
  const message = record?.message;
  if (record?.type !== "assistant" || !message?.id || !message?.usage) return null;
  return { record, message };
}

function usageOf(message) {
  const usage = message.usage ?? {};
  return {
    inputTokens: Number(usage.input_tokens ?? 0),
    outputTokens: Number(usage.output_tokens ?? 0),
    cacheWriteTokens: Number(usage.cache_creation_input_tokens ?? 0),
    cacheReadTokens: Number(usage.cache_read_input_tokens ?? 0),
  };
}

function add(target, usage) {
  for (const key of ["inputTokens", "outputTokens", "cacheWriteTokens", "cacheReadTokens"]) target[key] += usage[key];
}

function bucket(table, key) {
  return table[key] ??= { ...emptyUsage(), messageCount: 0 };
}

function price(usage, rates) {
  return (
    usage.inputTokens * rates.input +
    usage.outputTokens * rates.output +
    usage.cacheWriteTokens * rates.cacheWrite +
    usage.cacheReadTokens * rates.cacheRead
  ) / 1_000_000;
}

function mainTranscriptFor(file) {
  const marker = `${sep}subagents${sep}`;
  const index = file.indexOf(marker);
  if (index < 0) return null;
  return `${file.slice(0, index)}.jsonl`;
}

function projectName(projectsDir, file) {
  return relative(projectsDir, file).split(sep)[0] || "unknown";
}

export function summarizeTranscripts({ projectsDir, prices = {}, days = 7, now = Date.now() }) {
  const ratesByModel = prices.models ?? prices;
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const files = filesUnder(projectsDir).filter((file) => statSync(file).mtimeMs >= cutoff);
  const fileRecords = new Map(files.map((file) => [file, records(file)]));
  const harnessByFile = new Map();
  for (const [file, entries] of fileRecords) {
    harnessByFile.set(file, entries.find((entry) => entry.entrypoint)?.entrypoint ?? "unknown");
  }

  const result = {
    totals: emptyUsage(), messageCount: 0,
    byProject: {}, byModel: {}, byRole: { main: emptyUsage(), subagent: emptyUsage() }, byHarness: {},
    unpricedModels: [],
  };
  const seen = new Set();

  for (const [file, entries] of fileRecords) {
    const role = file.includes(`${sep}subagents${sep}`) ? "subagent" : "main";
    const main = mainTranscriptFor(file);
    const inheritedHarness = main ? harnessByFile.get(main) : null;
    for (const entry of entries) {
      const found = assistantMessage(entry);
      if (!found || seen.has(found.message.id)) continue;
      seen.add(found.message.id);
      const usage = usageOf(found.message);
      const model = found.message.model ?? "unknown";
      const harness = inheritedHarness ?? entry.entrypoint ?? harnessByFile.get(file) ?? "unknown";
      const project = projectName(projectsDir, file);
      const rates = ratesByModel[model];
      const dollars = rates ? price(usage, rates) : null;

      add(result.totals, usage); add(result.byRole[role], usage);
      for (const entryBucket of [bucket(result.byProject, project), bucket(result.byModel, model), bucket(result.byHarness, harness)]) {
        add(entryBucket, usage); entryBucket.messageCount += 1;
        if (dollars != null) entryBucket.dollars += dollars;
      }
      result.messageCount += 1;
      result.totals.dollars += dollars ?? 0;
      result.byModel[model].priced = Boolean(rates);
      if (!rates) result.byModel[model].dollars = null;
    }
  }

  for (const value of Object.values(result.byHarness)) {
    value.averageCacheWriteTokens = value.messageCount ? value.cacheWriteTokens / value.messageCount : 0;
    value.averageCacheReadTokens = value.messageCount ? value.cacheReadTokens / value.messageCount : 0;
  }
  result.unpricedModels = Object.entries(result.byModel).filter(([, value]) => !value.priced).map(([model]) => model);
  return result;
}

export function summarizeCodexSessions(codexDir, { days = 7, now = Date.now() } = {}) {
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const totals = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0 };
  for (const file of filesUnder(codexDir).filter((path) => statSync(path).mtimeMs >= cutoff)) {
    let newest = null;
    for (const entry of records(file)) {
      const info = entry?.payload?.info ?? entry?.info;
      const usage = info?.total_token_usage ?? info?.last_token_usage;
      if (entry?.type === "token_count" && usage) newest = usage;
    }
    if (!newest) continue;
    totals.inputTokens += Number(newest.input_tokens ?? 0);
    totals.outputTokens += Number(newest.output_tokens ?? 0);
    totals.cachedInputTokens += Number(newest.cached_input_tokens ?? 0);
    totals.reasoningOutputTokens += Number(newest.reasoning_output_tokens ?? 0);
  }
  return totals;
}

export function loadPrices(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}
