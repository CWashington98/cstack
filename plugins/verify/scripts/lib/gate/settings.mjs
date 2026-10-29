import { readFileSync } from "node:fs";
import { join } from "node:path";

const SETTINGS_PATH = ".claude/verify.json";
const DEFAULT_NOT_COUNTED = [
  "**/*.test.*",
  "**/__tests__/**",
  "**/*.lock",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
];

function strings(value, name, fallback = []) {
  const result = value ?? fallback;
  if (!Array.isArray(result) || result.some((item) => typeof item !== "string" || !item)) {
    throw new Error(`${name} must be a list of non-empty strings`);
  }
  return [...result];
}

export function normalizeSettings(gate = {}, project = {}) {
  if (!gate || typeof gate !== "object" || Array.isArray(gate)) throw new Error("gate settings must be an object");
  const integrationBranch = project.integrationBranch ?? "main";
  const zone = gate.zone ?? {};
  if (!zone || typeof zone !== "object" || Array.isArray(zone)) throw new Error("gate.zone must be an object");
  if (zone.command != null && (typeof zone.command !== "string" || !zone.command.trim())) {
    throw new Error("gate.zone.command must be a non-empty string or null");
  }
  const flagsRequired = gate.flagsRequired ?? false;
  if (typeof flagsRequired !== "boolean") throw new Error("gate.flagsRequired must be true or false");
  const sizeLimit = gate.sizeLimit ?? 400;
  if (!Number.isInteger(sizeLimit) || sizeLimit < 1) throw new Error("gate.sizeLimit must be a positive integer");

  const reviews = gate.reviews ?? "always";
  if (reviews !== "always" && reviews !== "highRisk") throw new Error('gate.reviews must be "always" or "highRisk"');

  return {
    allowedBases: strings(gate.allowedBases, "gate.allowedBases", [integrationBranch]),
    zone: {
      command: zone.command ?? null,
      high: strings(zone.high, "gate.zone.high"),
      standard: strings(zone.standard, "gate.zone.standard"),
      low: strings(zone.low, "gate.zone.low"),
    },
    runtimeSurface: strings(gate.runtimeSurface, "gate.runtimeSurface"),
    flagsRequired,
    sizeLimit,
    notCounted: strings(gate.notCounted, "gate.notCounted", DEFAULT_NOT_COUNTED),
    reviews,
    // The risk list is shared with the review step, so it sits at the top of the file, not in the gate block.
    highRisk: strings(project.highRisk, "highRisk"),
  };
}

export function readSettings(cwd = process.cwd()) {
  const file = join(cwd, SETTINGS_PATH);
  let project;
  try { project = JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`could not read ${SETTINGS_PATH}: ${error.message}`); }
  // The block used to be called "factory". It is still read when there is no "gate" block.
  if (project.gate === undefined && project.factory !== undefined) console.error('warning: the "factory" block in .claude/verify.json is renamed "gate". Rename it; the old name will stop being read.');
  return normalizeSettings(project.gate ?? project.factory ?? {}, project);
}
