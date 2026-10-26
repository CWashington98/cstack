#!/usr/bin/env node
import { readSettings } from "./lib/settings.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dollarsPerMergedPr, loadPrices, summarizeCodexSessions, summarizeTranscripts, workingDirectoryTotals } from "./lib/tokens.mjs";
import { readClaudeBudgets } from "./lib/budget.mjs";

const args = process.argv.slice(2);
const [command] = args;
const here = dirname(fileURLToPath(import.meta.url));

function option(name, fallback) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
}

function options(name) {
  return args.flatMap((value, index) => value === name && args[index + 1] ? [args[index + 1]] : []);
}

if (!["gate", "budget", "tokens"].includes(command)) {
  console.error("usage: factory <gate|budget|tokens>");
  process.exitCode = 2;
} else {
  try {
    if (command === "gate") readSettings();
    if (command === "budget") {
      const profileDirs = options("--claude-dir");
      console.log(JSON.stringify({ claude: readClaudeBudgets({ home: process.env.HOME ?? "", profileDirs }) }, null, 2));
    } else if (command === "tokens") {
      const days = Number(option("--days", "7"));
      const projectsDir = resolve(option("--projects-dir", join(process.env.HOME ?? "", ".claude-shared", "projects")));
      const codexDir = resolve(option("--codex-dir", join(process.env.HOME ?? "", ".codex", "sessions")));
      const prices = loadPrices(join(here, "..", "data", "prices.json"));
      const claude = summarizeTranscripts({ projectsDir, prices, days });
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const efficiency = options("--repo").map((repo) => dollarsPerMergedPr({ repo, projectTotals: workingDirectoryTotals(claude), since }));
      console.log(JSON.stringify({ claude, codex: summarizeCodexSessions(codexDir, { days }), efficiency }, null, 2));
    } else {
      console.error(`factory ${command} is not built yet`);
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
