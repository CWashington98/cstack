import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeRepo } from "../../../tests/helpers.mjs";
import { checkAppSkill, checkRepoSettings } from "../scripts/lib/app-skill.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "check-app-skill.mjs");
const S = ".claude/skills/verify-web";

export const SKILL_MD = (name) => `---\nname: ${name}\ndescription: Drives the web app in a browser to prove its features work.\n---\n\n# ${name}\n\n` +
  ["Start", "Health check", "Drive", "Evidence", "Clean up", "Helpers", "Feature map"].map((s) => `## ${s}\n\nText.\n`).join("\n");
export const README = "# Map\n\nA skipped entry point is never reported as verified through another path.\n\n- [Search](./search.md)\n";
export const FEATURE = "# Search\n\nFinds notes.\n\n## Sub-features\n\n- `search-run` runs a search.\n\n## How to get to it (user view)\n\n- The search box.\n\n## Driving it with Playwright\n\nPreconditions: signed in.\n\n- **Search.** Type a word. Matching notes show.\n\n## Gotchas\n\n- None yet.\n";
const FACTS = { app: "web", surface: "web", appRoot: "apps/web", start: { command: "npm run dev", ready: "curl -sf http://localhost:3000", stop: "kill \"$(cat \"$RUN/server.pid\")\"" }, web: { baseUrl: "http://localhost:3000" } };

export function skill(overrides = {}, facts = FACTS) {
  const files = {
    "apps/web/package.json": "{}",
    [`${S}/SKILL.md`]: SKILL_MD("verify-web"),
    [`${S}/facts.json`]: JSON.stringify(facts),
    [`${S}/features/README.md`]: README,
    [`${S}/features/search.md`]: FEATURE,
    ...overrides,
  };
  const root = makeRepo(Object.fromEntries(Object.entries(files).filter(([, v]) => v !== null)));
  return { root, dir: join(root, S) };
}
const run = (overrides, facts) => { const { root, dir } = skill(overrides, facts); return checkAppSkill(dir, root); };
const text = (r) => r.findings.map((f) => f.message).join("\n");

test("a complete web app skill passes", () => {
  const r = run();
  assert.deepEqual(r.findings, []);
  assert.equal(r.features, 1);
});

test("the frontmatter must name the folder", () => {
  assert.match(text(run({ [`${S}/SKILL.md`]: SKILL_MD("verify-other") })), /must say "name: verify-web"/);
});

test("a missing section is held", () => {
  assert.match(text(run({ [`${S}/SKILL.md`]: SKILL_MD("verify-web").replace("## Health check", "## Doctor") })), /no "## Health check" section/);
});

test("facts.json must be complete", () => {
  assert.match(text(run({ [`${S}/facts.json`]: null })), /facts\.json is missing/);
  assert.match(text(run({}, { ...FACTS, app: "other" })), /"app" must be "web"/);
  assert.match(text(run({}, { ...FACTS, start: { command: "x", ready: "y" } })), /"start\.stop" is missing/);
  assert.match(text(run({}, { ...FACTS, appRoot: "apps/nowhere" })), /"appRoot" must be a folder/);
  assert.match(text(run({}, { ...FACTS, surface: "desktop" })), /"surface" must be "web" or "expo"/);
});

test("the feature map index must match its files", () => {
  assert.match(text(run({ [`${S}/features/README.md`]: README + "- [Export](./export.md)\n" })), /links to export\.md, which does not exist/);
  assert.match(text(run({ [`${S}/features/extra.md`]: FEATURE })), /extra\.md is not listed in README/);
  assert.match(text(run({ [`${S}/features/README.md`]: "# Map\n\n- [Search](./search.md)\n" })), /skipped entry point/);
});

test("a feature file needs its four sections in order, and short IDs", () => {
  const swapped = FEATURE.replace("## Gotchas", "## Zzz").replace("## Sub-features", "## Gotchas").replace("## Zzz", "## Sub-features");
  assert.match(text(run({ [`${S}/features/search.md`]: swapped })), /exactly four sections, in order/);
  assert.match(text(run({ [`${S}/features/search.md`]: FEATURE.replace("- `search-run` runs a search.", "- runs a search.") })), /short IDs in backticks/);
});

test("screen positions are held anywhere in the skill", () => {
  const f = FEATURE.replace("Type a word.", "Tap at (120, 340), then type a word.");
  assert.match(text(run({ [`${S}/features/search.md`]: f })), /screen position/);
});

test("the repository's verify settings must name the integration branch", () => {
  assert.match(checkRepoSettings(makeRepo({ ".claude/verify.json": "{}" })).map((f) => f.message).join(), /"integrationBranch" must name/);
  assert.deepEqual(checkRepoSettings(makeRepo({ ".claude/verify.json": '{"integrationBranch":"main"}' })), []);
  assert.deepEqual(checkRepoSettings(makeRepo()), []);
});

test("the command exits 0 on a pass, 1 on a hold and 2 on a missing folder", () => {
  const good = skill();
  assert.equal(spawnSync("node", [script, good.dir], { encoding: "utf8" }).status, 0);
  const bad = skill({ [`${S}/facts.json`]: null });
  assert.equal(spawnSync("node", [script, bad.dir], { encoding: "utf8" }).status, 1);
  assert.equal(spawnSync("node", [script, join(good.root, "nope")], { encoding: "utf8" }).status, 2);
});

const EXPO = { app: "phone", surface: "expo", appRoot: "apps/phone", start: { command: "npm run ios", ready: "curl -s localhost:8081/status", stop: "kill" }, expo: { appId: "com.example.app", appConfig: "apps/phone/app.json", flows: "apps/phone/maestro" } };
const P = ".claude/skills/verify-phone";
const expoSkill = (overrides = {}, facts = EXPO) => {
  const root = makeRepo(Object.fromEntries(Object.entries({
    "apps/phone/app.json": JSON.stringify({ expo: { ios: { bundleIdentifier: "com.example.app" }, android: { package: "com.example.app" } } }),
    "apps/phone/maestro/home.yaml": 'appId: com.example.app\n---\n- tapOn: "Go"\n- assertVisible: "Done"\n',
    [`${P}/SKILL.md`]: SKILL_MD("verify-phone"),
    [`${P}/facts.json`]: JSON.stringify(facts),
    [`${P}/features/README.md`]: README,
    [`${P}/features/search.md`]: FEATURE,
    ...overrides,
  }).filter(([, v]) => v !== null)));
  return checkAppSkill(join(root, P), root);
};

test("an Expo skill checks every flow against the real app ID", () => {
  assert.deepEqual(expoSkill().findings, []);
  assert.equal(expoSkill().flows, 1);
  const r = expoSkill({ "apps/phone/maestro/old.yaml": 'appId: com.example.old\n---\n- tapOn: "Go"\n- assertVisible: "Done"\n' });
  assert.match(text(r), /targets app ID "com\.example\.old"/);
});

test("facts.json's app ID must match app.json", () => {
  assert.match(text(expoSkill({}, { ...EXPO, expo: { ...EXPO.expo, appId: "com.example.old" } })), /facts\.json says the app ID is "com\.example\.old"/);
});

test("replays listed in facts.json are checked", () => {
  const r = run({ "e2e/play.spec.ts": "await page.waitForTimeout(500);\n" }, { ...FACTS, replays: ["e2e/play.spec.ts"] });
  assert.match(text(r), /waits a fixed time/);
  assert.equal(r.flows, 1);
});
