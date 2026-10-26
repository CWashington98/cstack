#!/usr/bin/env node
import { readSettings } from "./lib/settings.mjs";

const [command] = process.argv.slice(2);

if (!["gate", "budget", "tokens"].includes(command)) {
  console.error("usage: factory <gate|budget|tokens>");
  process.exitCode = 2;
} else {
  try {
    if (command === "gate") readSettings();
    console.error(`factory ${command} is not built yet`);
    process.exitCode = 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
