// Rules for an app's verification skill: the sections an agent needs, the facts
// that drive it, and a feature map that matches its files.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { proseLines } from "./markdown.mjs";
import { checkFlowFile } from "./maestro.mjs";
import { checkPlaywrightFile } from "./playwright.mjs";

const SECTIONS = ["Start", "Health check", "Drive", "Evidence", "Clean up", "Helpers", "Feature map"];
const FEATURE_SECTIONS = ["Sub-features", "How to get to it", "Driving it", "Gotchas"];
const POSITIONS = [/\b(?:tap|click)(?:ped)?\s+at\s*\(?\s*\d+\s*,\s*\d+/i, /\bpoint:\s*["']?\d+%?\s*,\s*\d+%?/, /mouse\.click\(\s*\d/];

export const appHold = (file, line, message) => ({ file, line, level: "hold", message });

export function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function readFacts(skillDir, folder, repoRoot) {
  const file = join(skillDir, "facts.json");
  if (!existsSync(file)) return { facts: null, findings: [appHold(file, 0, "facts.json is missing. It holds the app's facts an agent drives by: start command, address or app ID, test flows.")] };
  let f;
  try { f = JSON.parse(readFileSync(file, "utf8")); } catch (e) { return { facts: null, findings: [appHold(file, 0, `facts.json is not valid JSON: ${e.message}`)] }; }
  const out = [];
  const need = (ok, msg) => { if (!ok) out.push(appHold(file, 0, msg)); };
  const app = folder.slice("verify-".length);
  need(f.app === app, `"app" must be "${app}" to match the folder.`);
  need(["web", "expo"].includes(f.surface), `"surface" must be "web" or "expo".`);
  need(typeof f.appRoot === "string" && existsSync(join(repoRoot, f.appRoot)), `"appRoot" must be a folder in the repository, got ${JSON.stringify(f.appRoot)}.`);
  for (const k of ["command", "ready", "stop"]) need(typeof f.start?.[k] === "string" && f.start[k].trim() !== "", `"start.${k}" is missing.`);
  if (f.surface === "web") need(/^https?:\/\//.test(f.web?.baseUrl ?? ""), `"web.baseUrl" must be the address the app answers on.`);
  if (f.surface === "expo") {
    need(typeof f.expo?.appId === "string" && f.expo.appId !== "", `"expo.appId" is missing.`);
    need(typeof f.expo?.appConfig === "string" && existsSync(join(repoRoot, f.expo.appConfig)), `"expo.appConfig" must point to the app's app.json or app.config file.`);
  }
  for (const r of f.replays ?? []) need(existsSync(join(repoRoot, r)), `replay "${r}" does not exist.`);
  return { facts: f, findings: out };
}

function sectionText(lines, title) {
  const start = lines.findIndex((l) => l.text.startsWith(`## ${title}`));
  if (start === -1) return "";
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l.text));
  return lines.slice(start + 1, end === -1 ? lines.length : end).map((l) => l.text).join("\n");
}

function checkFeatureFile(file) {
  const lines = proseLines(readFileSync(file, "utf8"));
  const out = [];
  if (!lines.some((l) => /^# \S/.test(l.text))) out.push(appHold(file, 1, "The feature file needs a title line (# Name)."));
  const h2 = lines.filter((l) => /^## /.test(l.text));
  const names = h2.map((l) => l.text.slice(3).trim());
  const inOrder = names.length === 4 && FEATURE_SECTIONS.every((p, i) => names[i].startsWith(p));
  if (!inOrder) out.push(appHold(file, h2[0]?.line ?? 1, `A feature file has exactly four sections, in order: ${FEATURE_SECTIONS.join(", ")}. Found: ${names.join(", ") || "none"}.`));
  if (!/^\s*[-*]\s+`[a-z0-9-]+`/m.test(sectionText(lines, "Sub-features"))) out.push(appHold(file, 0, "Sub-features must list short IDs in backticks, such as `play`."));
  return out;
}

function checkFeatureMap(skillDir) {
  const dir = join(skillDir, "features");
  const readme = join(dir, "README.md");
  if (!existsSync(readme)) return { findings: [appHold(readme, 0, "features/README.md is missing. It lists every feature and the shared preconditions.")], count: 0 };
  const text = readFileSync(readme, "utf8");
  const links = [...text.matchAll(/\]\(\.\/([^)#]+\.md)\)/g)].map((m) => m[1]);
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md");
  const out = [];
  if (!files.length) out.push(appHold(readme, 0, "The feature map has no feature files."));
  for (const l of new Set(links)) if (!files.includes(l)) out.push(appHold(readme, 0, `README links to ${l}, which does not exist.`));
  if (links.length !== new Set(links).size) out.push(appHold(readme, 0, "README lists a feature twice."));
  if (!/skipped entry point/i.test(text)) out.push(appHold(readme, 0, "README must state the rule: a skipped entry point is never reported as verified through another path."));
  for (const f of files) {
    if (!links.includes(f)) out.push(appHold(readme, 0, `${f} is not listed in README.`));
    out.push(...checkFeatureFile(join(dir, f)));
  }
  return { findings: out, count: files.length };
}

function checkPositions(file) {
  return readFileSync(file, "utf8").split(/\r?\n/).flatMap((t, i) =>
    POSITIONS.some((re) => re.test(t)) ? [appHold(file, i + 1, "names a screen position. Use a label, role, route or test ID; positions break when the layout changes.")] : []);
}

export function checkRepoSettings(repoRoot) {
  const file = join(repoRoot, ".claude", "verify.json");
  if (!existsSync(file)) return [];
  let s;
  try { s = JSON.parse(readFileSync(file, "utf8")); } catch (e) { return [appHold(file, 0, `not valid JSON: ${e.message}`)]; }
  const out = [];
  if (typeof s.integrationBranch !== "string" || !s.integrationBranch.trim()) out.push(appHold(file, 0, `"integrationBranch" must name the branch pull requests target, such as "main" or "staging".`));
  if (s.highRisk !== undefined && !(Array.isArray(s.highRisk) && s.highRisk.every((p) => typeof p === "string"))) out.push(appHold(file, 0, `"highRisk" must be a list of path patterns.`));
  return out;
}

const isYaml = (p) => /\.ya?ml$/.test(p);

// The iOS and Android app IDs an Expo config declares. app.json is read as JSON. An
// app.config.js or .ts can't be run here, so its IDs are read when written as plain text.
function configAppIds(cfgFile, label) {
  const raw = readFileSync(cfgFile, "utf8");
  if (/\.json$/i.test(cfgFile)) {
    let cfg;
    try { cfg = JSON.parse(raw); } catch (e) { return { problem: `${label} is not valid JSON: ${e.message}` }; }
    const expo = cfg.expo ?? cfg;
    return { ids: [expo.ios?.bundleIdentifier, expo.android?.package].filter(Boolean) };
  }
  const ids = ["bundleIdentifier", "package"].flatMap((k) => [...raw.matchAll(new RegExp(`["']?\\b${k}["']?\\s*:\\s*["'\`]([^"'\`$]+)["'\`]`, "g"))].map((m) => m[1]));
  if (!ids.length) return { problem: `can't find the app ID written as plain text in ${label}, so it can't be checked against facts.json. Write bundleIdentifier and package as plain strings there, or point "expo.appConfig" at an app.json that has them.` };
  return { ids };
}

export function checkReplays(f, repoRoot) {
  const findings = [];
  let count = 0;
  if (f.surface === "expo" && f.expo?.appConfig && existsSync(join(repoRoot, f.expo.appConfig))) {
    const cfgFile = join(repoRoot, f.expo.appConfig);
    const { ids, problem } = configAppIds(cfgFile, f.expo.appConfig);
    if (problem) findings.push(appHold(cfgFile, 0, problem));
    else if (ids.length && !ids.every((id) => id === f.expo.appId)) {
      findings.push(appHold(cfgFile, 0, `facts.json says the app ID is "${f.expo.appId}", but ${f.expo.appConfig} says ${ids.map((i) => `"${i}"`).join(" and ")}.`));
    }
  }
  if (f.surface === "expo" && f.expo?.flows) {
    const dir = join(repoRoot, f.expo.flows);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      findings.push(appHold(dir, 0, `"expo.flows" is set to ${f.expo.flows}, which is not a folder. Fix the path, or remove the field if the app has no Maestro flows.`));
    } else {
      for (const file of walk(dir).filter(isYaml)) {
        count++;
        findings.push(...checkFlowFile(file, f.expo.appId, f.expo.appConfig));
      }
    }
  }
  for (const r of f.replays ?? []) {
    const p = join(repoRoot, r);
    if (!existsSync(p)) continue;
    count++;
    findings.push(...(isYaml(p) ? checkFlowFile(p, f.expo?.appId, f.expo?.appConfig) : checkPlaywrightFile(p)));
  }
  return { findings, count };
}

export function checkAppSkill(skillDir, repoRoot) {
  const findings = [];
  const folder = basename(skillDir);
  if (!/^verify-[a-z0-9-]+$/.test(folder)) findings.push(appHold(skillDir, 0, `The folder must be named verify-<app>, got "${folder}".`));
  const skillFile = join(skillDir, "SKILL.md");
  if (!existsSync(skillFile)) return { findings: [...findings, appHold(skillFile, 0, "SKILL.md is missing.")], features: 0, flows: 0 };
  const raw = readFileSync(skillFile, "utf8").replace(/\r\n?/g, "\n");
  const fm = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fm || !new RegExp(`^name: ${folder}$`, "m").test(fm[1])) findings.push(appHold(skillFile, 1, `The frontmatter must say "name: ${folder}". Without it the skill never loads.`));
  if (!fm || !/^description: \S/m.test(fm[1])) findings.push(appHold(skillFile, 1, "The frontmatter needs a description naming the app, its surface and when to use the skill."));
  const h2 = proseLines(raw).filter((l) => /^## /.test(l.text)).map((l) => l.text.slice(3).trim());
  for (const s of SECTIONS) if (!h2.includes(s)) findings.push(appHold(skillFile, 0, `SKILL.md has no "## ${s}" section.`));
  const { facts, findings: factFindings } = readFacts(skillDir, folder, repoRoot);
  findings.push(...factFindings);
  const replays = facts ? checkReplays(facts, repoRoot) : { findings: [], count: 0 };
  findings.push(...replays.findings);
  const map = checkFeatureMap(skillDir);
  findings.push(...map.findings);
  for (const f of walk(skillDir).filter((p) => p.endsWith(".md"))) findings.push(...checkPositions(f));
  return { findings, features: map.count, flows: replays.count };
}
