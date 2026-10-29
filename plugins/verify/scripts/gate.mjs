#!/usr/bin/env node
// The ready check. Decides whether a pull request is ready for the owner to merge; it never merges.
// Usage: node gate.mjs <pull request number> [--json]
//   Prints "ready", or "not ready" and each reason. --json prints {ready, head, zone, reasons: [{kind, text, question?}]}.
//   Reason kinds: fix (an agent can clear it), wait (checks running), owner (only the owner can; carries a question).
// Exit 0 ready, 1 not ready, 2 wrong use.
import { pathToFileURL } from "node:url";
import { parseArgs } from "./lib/args.mjs";
import { readSettings } from "./lib/gate/settings.mjs";
import { collectFacts } from "./lib/gate/facts.mjs";
import { decideGate } from "./lib/gate/decide.mjs";
import { writeRecord } from "./lib/gate/record.mjs";

function main(args) {
  try {
    const { _: [pr, ...extra], json } = parseArgs(args, { flags: ["json"] });
    if (!/^\d+$/.test(pr ?? "") || extra.length) {
      console.error("usage: verify gate <pull request number> [--json]");
      return 2;
    }
    const settings = readSettings();
    const facts = collectFacts({ cwd: process.cwd(), pr, settings });
    let result = decideGate(facts, settings);
    // The record is written before the call is printed. If it can't be written, the call is a hold.
    if (facts.head) {
      const record = () => writeRecord(process.cwd(), { pr: facts.pr, head: facts.head, patchId: facts.patchId, zone: facts.zone, call: result.call, reasons: result.reasons });
      try { record(); } catch (error) {
        facts.missing.push({ fact: "ledger", why: `could not record the call (${error.message})` });
        result = decideGate(facts, settings);
      }
    } else console.error("no record written: the head commit is unknown");
    console.log(json ? JSON.stringify({ ready: result.ready, head: result.head, zone: result.zone, reasons: result.reasons }, null, 2) : result.output);
    return result.exitCode;
  } catch (error) {
    console.error(error.message);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
