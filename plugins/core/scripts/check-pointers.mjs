#!/usr/bin/env node
// Checks that every skill a marketplace pointer picks has a SKILL.md at its pinned commit.
// Claude Code reports a misspelled pick as a successful install that loads nothing, so this is the only way to catch it.
// Usage: node check-pointers.mjs [path/to/marketplace.json]   (needs the gh command, signed in)
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

export const isLive = (env = process.env) => env.CSTACK_LIVE === "1";

export async function githubTree(repo, sha) {
  const out = execFileSync("gh", ["api", `repos/${repo}/git/trees/${sha}?recursive=1`, "--jq", ".tree[].path"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  return new Set(out.split("\n").filter(Boolean));
}

export async function missingSkills(market, fetchTree) {
  const missing = [];
  for (const p of market.plugins) {
    const s = p.source;
    if (typeof s !== "object" || s.source !== "git-subdir") continue;
    const repo = s.url.replace("https://github.com/", "").replace(/\.git$/, "");
    let paths, reason;
    try { paths = await fetchTree(repo, s.sha); } catch (e) { reason = String(e.message ?? e).trim(); }
    for (const pick of p.skills) {
      const skill = pick.replace(/^\.\//, "");
      const expected = `${s.path}/${skill}/SKILL.md`;
      if (reason) missing.push({ plugin: p.name, skill, expected, reason });
      else if (!paths.has(expected)) missing.push({ plugin: p.name, skill, expected });
    }
  }
  return missing;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".claude-plugin", "marketplace.json");
  const market = JSON.parse(readFileSync(file, "utf8"));
  const missing = await missingSkills(market, githubTree);
  const picked = market.plugins.filter((p) => p.source?.source === "git-subdir").reduce((n, p) => n + p.skills.length, 0);
  for (const m of missing) console.log(`missing  ${m.plugin}: ${m.expected}${m.reason ? ` (${m.reason})` : ""}`);
  console.log(missing.length ? `${missing.length} of ${picked} picked skills are missing.` : `All ${picked} picked skills exist at their pinned commits.`);
  process.exit(missing.length ? 1 : 0);
}
