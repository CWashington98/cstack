#!/usr/bin/env node
import { readSettings } from "./lib/settings.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPrices, summarizeCodexSessions, summarizeTranscripts } from "./lib/tokens.mjs";

const args = process.argv.slice(2);
const [command] = args;
const here = dirname(fileURLToPath(import.meta.url));

function option(name, fallback) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
}

if (!["gate", "budget", "tokens"].includes(command)) {
  console.error("usage: factory <gate|budget|tokens>");
  process.exitCode = 2;
} else {
  try {
    if (command === "gate") readSettings();
    if (command === "tokens") {
      const days = Number(option("--days", "7"));
      const projectsDir = resolve(option("--projects-dir", join(process.env.HOME ?? "", ".claude-shared", "projects")));
      const codexDir = resolve(option("--codex-dir", join(process.env.HOME ?? "", ".codex", "sessions")));
      const prices = loadPrices(join(here, "..", "data", "prices.json"));
      console.log(JSON.stringify({ claude: summarizeTranscripts({ projectsDir, prices, days }), codex: summarizeCodexSessions(codexDir, { days }) }, null, 2));
    } else {
      console.error(`factory ${command} is not built yet`);
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
