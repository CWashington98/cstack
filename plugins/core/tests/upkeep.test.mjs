import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findProfiles, staleCatalogs, compareInstalled, duplicateInstalls, pointerChanges, repoCopies, formatReport } from "../scripts/upkeep.mjs";

const day = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-10-06T00:00:00Z");

test("profiles are the Claude config folders that have installed plugins, skipping backups", () => {
  const home = mkdtempSync(join(tmpdir(), "upkeep-home-"));
  for (const d of [".claude-work", ".claude-personal", ".claude-work.bak-2026-08-21", ".claude-shared"]) mkdirSync(join(home, d, "plugins"), { recursive: true });
  for (const d of [".claude-work", ".claude-personal", ".claude-work.bak-2026-08-21"]) writeFileSync(join(home, d, "plugins", "installed_plugins.json"), "{}");
  assert.deepEqual(findProfiles(home).map((p) => p.name), [".claude-personal", ".claude-work"]);
});

test("catalogs not refreshed for more than 14 days are flagged", () => {
  const markets = {
    official: { lastUpdated: "2026-10-06T00:00:00Z" },
    "expo-plugins": { lastUpdated: "2026-01-21T00:00:00Z" },
  };
  assert.deepEqual(staleCatalogs(markets, now).map((m) => [m.name, m.days]), [["expo-plugins", 258]]);
});

test("installed plugins are compared with the catalog by version or pinned commit, and deprecated ones are flagged", () => {
  const installed = {
    "superpowers@official": [{ version: "6.4.1", gitCommitSha: "5bf4e78aaaa" }],
    "matt@official": [{ version: "1.2.3", gitCommitSha: "6654f6b" }],
    "expo-app-design@expo-plugins": [{ version: "1.0.0" }],
    "gone@official": [{ version: "1.0.0" }],
  };
  const catalogs = {
    official: [
      { name: "superpowers", source: { source: "url", sha: "5bf4e78011075bcfc0dc295f0724994cd123ee71" } },
      { name: "matt", source: { source: "url", sha: "c55ee46073ed923f86ce59a5eb3b6d895095d1b7" } },
    ],
    "expo-plugins": [{ name: "expo-app-design", version: "1.0.0", description: "[Deprecated] Use the \"expo\" plugin instead." }],
  };
  const out = Object.fromEntries(compareInstalled(installed, catalogs).map((r) => [r.plugin, r.status]));
  assert.deepEqual(out, { "superpowers@official": "current", "matt@official": "behind", "expo-app-design@expo-plugins": "deprecated", "gone@official": "not in catalog" });
});

test("a project install at a different version from the main install is flagged, summarized per plugin", () => {
  const installed = {
    "vercel@official": [{ scope: "user", version: "0.50.0" }, { scope: "project", projectPath: "/p/bet", version: "0.48.0" }],
    "context7@official": [{ scope: "user", version: "d4226d0" }, ...Array.from({ length: 125 }, (_, i) => ({ scope: "project", projectPath: `/p/${i}`, version: i % 2 ? "old1" : "unknown" }))],
    "solo@official": [{ scope: "user", version: "1" }, { scope: "project", projectPath: "/p/x", version: "1" }],
  };
  assert.deepEqual(duplicateInstalls(installed).map((d) => [d.plugin, d.main, d.others, d.projects]), [
    ["vercel@official", "0.50.0", ["0.48.0"], 1],
    ["context7@official", "d4226d0", ["old1"], 62],
  ]);
});

test("a pinned pointer is flagged only when the author changed the skills we picked", async () => {
  const entries = [
    { name: "picks", source: { source: "git-subdir", url: "https://github.com/a/skills.git", path: "skills", sha: "aaa" }, skills: ["./tdd", "./pr"] },
    { name: "quiet", source: { source: "git-subdir", url: "https://github.com/b/skills.git", path: "skills", sha: "bbb" }, skills: ["./one"] },
    { name: "local", source: "./plugins/core" },
  ];
  const compare = async (repo) => (repo === "a/skills" ? { ahead: 5, files: ["skills/tdd/SKILL.md", "skills/other/SKILL.md", "README.md"] } : { ahead: 2, files: ["skills/two/SKILL.md"] });
  const out = await pointerChanges(entries, compare);
  assert.deepEqual(out.map((p) => [p.plugin, p.ahead, p.changed]), [["picks", 5, ["skills/tdd/SKILL.md"]]]);
});

test("skills copied into a repository that a plugin already provides are listed", () => {
  const repo = { path: "/r/ohh", skills: [{ name: "building-native-ui", changed: "2026-01-24" }, { name: "hipaa-check", changed: "2026-08-01" }] };
  const pluginSkills = new Map([["building-native-ui", "expo-app-design@expo-plugins"]]);
  assert.deepEqual(repoCopies([repo], pluginSkills), [{ repo: "/r/ohh", skill: "building-native-ui", plugin: "expo-app-design@expo-plugins", changed: "2026-01-24" }]);
});

test("the report says plainly when everything is current", () => {
  assert.match(formatReport({ profiles: [], stale: [], plugins: [], duplicates: [], pointers: [], copies: [], npm: [] }), /Everything is current/);
});

test("the report gives a fix command for each problem", () => {
  const text = formatReport({
    profiles: [{ name: ".claude-work" }],
    stale: [{ profile: ".claude-work", name: "expo-plugins", days: 258 }],
    plugins: [{ profile: ".claude-work", plugin: "expo-app-design@expo-plugins", status: "deprecated", installed: "1.0.0", latest: "1.0.0", note: "[Deprecated] Use the \"expo\" plugin instead." }],
    duplicates: [],
    pointers: [{ plugin: "picks", ahead: 5, changed: ["skills/tdd/SKILL.md"], compareUrl: "https://github.com/a/skills/compare/aaa...HEAD" }],
    copies: [],
    npm: [{ repo: "/r/sms", name: "@fission-ai/openspec", pinned: "1.13.0", latest: "1.14.1" }],
  });
  assert.match(text, /CLAUDE_CONFIG_DIR=~\/\.claude-work claude plugin marketplace update expo-plugins/);
  assert.match(text, /claude plugin uninstall expo-app-design@expo-plugins/);
  assert.match(text, /skills\/tdd\/SKILL\.md/);
  assert.match(text, /1\.13\.0.*1\.14\.1/);
});

test("long lists of changed files are shortened", () => {
  const text = formatReport({ profiles: [], stale: [], plugins: [], duplicates: [], copies: [], npm: [],
    pointers: [{ plugin: "whole", ahead: 9, changed: ["a", "b", "c", "d", "e", "f", "g"], compareUrl: "u" }] });
  assert.match(text, /changed: a, b, c, d, e and 2 more/);
});

