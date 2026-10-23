#!/usr/bin/env node
// Checks that a pull request which changes what users see has screenshots in its
// description. The paths users see and the accounts screenshots are required for come
// from .claude/verify.json ("userVisible", "screenshotsRequiredFor"); without them it does nothing.
// Usage: node screenshots.mjs --base <ref> --pr-body <description file> --author <account> [--head <ref>] [--json]
// Exit 0 passes, skipped or only a note, 1 held, 2 wrong use.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, UsageError } from "./lib/args.mjs";
import { git } from "./lib/compliance.mjs";
import { screenshotSettings, userVisibleFiles, screenshotVerdict } from "./lib/screenshots.mjs";
import { repoRoot } from "./verify-plan.mjs";

function main(argv) {
  let a, r;
  try {
    a = parseArgs(argv.slice(2), { flags: ["json"] });
    for (const name of ["base", "pr-body", "author"]) if (!a[name]) throw new UsageError(`needs --${name}`);
    const body = resolve(a["pr-body"]);
    if (!existsSync(body)) throw new UsageError(`description file not found: ${a["pr-body"]}`);
    const root = repoRoot(process.cwd());
    const settings = screenshotSettings(root);
    if (settings.problems.length) throw new UsageError(`fix .claude/verify.json: ${settings.problems.join(" ")}`);
    if (!settings.userVisible.length) r = { status: "skip", message: `No "userVisible" patterns in .claude/verify.json, so there is nothing to check.` };
    else {
      const changed = git(root, "diff", "--name-only", "--no-renames", `${a.base}...${a.head ?? "HEAD"}`).split("\n").filter(Boolean);
      const visible = userVisibleFiles(changed, settings.userVisible);
      r = { ...screenshotVerdict({ visible, body: readFileSync(body, "utf8"), author: a.author, requiredFor: settings.requiredFor }), visible };
    }
  } catch (e) {
    console.error(`screenshots: ${e instanceof UsageError ? e.message : (e.stderr?.toString().trim() || e.message)}`);
    return 2;
  }
  if (a.json) console.log(JSON.stringify(r, null, 2));
  else console.log({ skip: "Skipped: ", pass: "Passes: ", note: "note  ", hold: "hold  " }[r.status] + r.message);
  return r.status === "hold" ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv));
