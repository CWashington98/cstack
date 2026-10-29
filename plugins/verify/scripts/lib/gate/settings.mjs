import { readFileSync } from "node:fs";
import { join } from "node:path";

const SETTINGS_PATH = ".claude/verify.json";
const ALWAYS_NEVER_MERGE = [".github/**", "openspec/**", SETTINGS_PATH];
const DEFAULT_NOT_COUNTED = [
  "**/*.test.*",
  "**/__tests__/**",
  "**/*.lock",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
];

const unique = (values) => [...new Set(values)];

function strings(value, name, fallback = []) {
  const result = value ?? fallback;
  if (!Array.isArray(result) || result.some((item) => typeof item !== "string" || !item)) {
    throw new Error(`${name} must be a list of non-empty strings`);
  }
  return [...result];
}

function mergeModes(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("factory.merge must be an object");
  const result = { low: "shadow", standard: "shadow", high: "off", ...value };
  for (const [zone, mode] of Object.entries(result)) {
    if (!["low", "standard", "high"].includes(zone)) throw new Error(`factory.merge has an unknown zone: ${zone}`);
    if (mode !== "off" && mode !== "shadow") throw new Error("merging can't be switched on in this version");
  }
  return result;
}

export function normalizeSettings(factory = {}, project = {}) {
  if (!factory || typeof factory !== "object" || Array.isArray(factory)) throw new Error("factory settings must be an object");
  const integrationBranch = project.integrationBranch ?? "main";
  const zone = factory.zone ?? {};
  if (!zone || typeof zone !== "object" || Array.isArray(zone)) throw new Error("factory.zone must be an object");
  if (zone.command != null && (typeof zone.command !== "string" || !zone.command.trim())) {
    throw new Error("factory.zone.command must be a non-empty string or null");
  }
  const flagsRequired = factory.flagsRequired ?? false;
  if (typeof flagsRequired !== "boolean") throw new Error("factory.flagsRequired must be true or false");
  const sizeLimit = factory.sizeLimit ?? 400;
  if (!Number.isInteger(sizeLimit) || sizeLimit < 1) throw new Error("factory.sizeLimit must be a positive integer");

  return {
    allowedBases: strings(factory.allowedBases, "factory.allowedBases", [integrationBranch]),
    zone: {
      command: zone.command ?? null,
      high: strings(zone.high, "factory.zone.high"),
      standard: strings(zone.standard, "factory.zone.standard"),
      low: strings(zone.low, "factory.zone.low"),
    },
    neverMerge: unique([...strings(factory.neverMerge, "factory.neverMerge"), ...ALWAYS_NEVER_MERGE]),
    runtimeSurface: strings(factory.runtimeSurface, "factory.runtimeSurface"),
    flagsRequired,
    sizeLimit,
    notCounted: strings(factory.notCounted, "factory.notCounted", DEFAULT_NOT_COUNTED),
    merge: mergeModes(factory.merge),
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
