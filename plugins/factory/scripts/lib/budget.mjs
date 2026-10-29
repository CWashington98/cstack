import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const HOUR = 60 * 60 * 1000;
const WEEK = 7 * 24 * HOUR;

const time = (value) => {
  if (value == null) return null;
  if (typeof value === "number") return value < 10_000_000_000 ? value * 1000 : value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function evaluateReading(reading, now = Date.now()) {
  const weeklyReset = time(reading.weeklyResetsAt);
  const fetchedAt = time(reading.fetchedAtMs);
  const stale = fetchedAt == null || now - fetchedAt > 12 * HOUR;
  const elapsed = weeklyReset == null ? null : WEEK - (weeklyReset - now);
  const elapsedFraction = elapsed == null ? null : Math.max(0, Math.min(1, elapsed / WEEK));
  const pace = elapsedFraction > 0 ? reading.weeklyPercent / (elapsedFraction * 100) : null;
  const hoursToReset = weeklyReset == null ? null : (weeklyReset - now) / HOUR;

  let mode = "normal";
  if (reading.weeklyPercent >= 90 || reading.fiveHourPercent >= 90) mode = "stop";
  else if (stale || (pace > 1.25 && hoursToReset > 24)) mode = "lean";
  return { ...reading, weeklyReset, fetchedAt, stale, pace, mode };
}

export function claudeReading(profileDir) {
  const file = join(profileDir, ".claude.json");
  const cached = JSON.parse(readFileSync(file, "utf8")).cachedUsageUtilization;
  const usage = cached?.utilization;
  if (!cached) return null;
  return {
    name: basename(profileDir),
    path: profileDir,
    weeklyPercent: Number(usage?.seven_day?.utilization ?? 0),
    fiveHourPercent: Number(usage?.five_hour?.utilization ?? 0),
    weeklyResetsAt: usage?.seven_day?.resets_at ?? null,
    fiveHourResetsAt: usage?.five_hour?.resets_at ?? null,
    fetchedAtMs: cached.fetchedAtMs,
  };
}

export function discoverClaudeAccounts(home) {
  if (!existsSync(home)) return [];
  return readdirSync(home, { withFileTypes: true }).filter((entry) => (
    entry.isDirectory() && entry.name.startsWith(".claude") && !entry.name.includes(".bak")
  )).flatMap((entry) => {
    const path = join(home, entry.name);
    try {
      const reading = claudeReading(path);
      return reading ? [{ name: entry.name, path, reading }] : [];
    } catch { return []; }
  });
}

export function readClaudeBudgets({ home, profileDirs = [], now = Date.now() }) {
  const accounts = profileDirs.length
    ? profileDirs.flatMap((path) => { try { const reading = claudeReading(resolve(path)); return reading ? [{ name: basename(path), path: resolve(path), reading }] : []; } catch { return []; } })
    : discoverClaudeAccounts(home);
  return accounts.map((account) => ({ ...account, ...evaluateReading(account.reading, now) }));
}

function jsonlFiles(root) {
  if (!root || !existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return jsonlFiles(path);
    return entry.isFile() && entry.name.endsWith(".jsonl") ? [path] : [];
  });
}

export function latestCodexReading(codexDir) {
  let latest = null;
  for (const file of jsonlFiles(codexDir)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.includes('"rate_limits"')) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const payload = entry.payload;
      const limits = payload?.type === "token_count" ? payload.rate_limits : null;
      const fetchedAtMs = time(entry.timestamp);
      if (!limits?.primary || !limits?.secondary || fetchedAtMs == null) continue;
      if (latest && latest.fetchedAtMs >= fetchedAtMs) continue;
      latest = {
        weeklyPercent: Number(limits.secondary.used_percent ?? 0),
        fiveHourPercent: Number(limits.primary.used_percent ?? 0),
        weeklyResetsAt: limits.secondary.resets_at,
        fiveHourResetsAt: limits.primary.resets_at,
        fetchedAtMs,
      };
    }
  }
  return latest;
}

export function routeBreaker(reading, now = Date.now()) {
  const opus = { low: "opus", standard: "opus", high: "opus" };
  if (!reading) return { models: opus, reason: "no Codex reading" };
  const evaluated = evaluateReading(reading, now);
  if (evaluated.stale) return { models: opus, reason: "Codex reading is stale" };
  if (reading.weeklyPercent >= 90 || reading.fiveHourPercent >= 90) {
    return { models: opus, reason: "Codex is at or above 90% of a limit" };
  }
  if (reading.weeklyPercent >= 70) {
    return {
      models: { low: "opus", standard: "codex", high: "codex" },
      reason: `Codex is at ${reading.weeklyPercent}% this week`,
    };
  }
  return {
    models: { low: "codex", standard: "codex", high: "codex" },
    reason: `Codex is at ${reading.weeklyPercent}% this week and ${reading.fiveHourPercent}% in five hours`,
  };
}
