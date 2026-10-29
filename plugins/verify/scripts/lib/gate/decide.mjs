import { matchesAny } from "./zone.mjs";

const REVIEWERS = ["claims-auditor", "codex"];
const isOpenAI = (model) => /^(gpt|o\d|codex|chatgpt)/i.test(model ?? "");

// Needed facts. If one is undefined and nothing was reported missing, the gate still holds.
const REQUIRED = ["baseAllowed", "bottomOfStack", "conflict", "ciChanged", "draft", "unresolvedThreads", "checks", "zone", "codeLines"];

// Facts in, call and reasons out. No input, output or merging happens here.
export function decideGate(facts, settings) {
  const reasons = [];
  const hold = (message, kind = "hold") => reasons.push({ kind, message });

  for (const m of facts.missing ?? []) hold(`can't read ${m.fact}: ${m.why}`);
  if (!facts.missing?.length) {
    for (const key of REQUIRED) if (facts[key] === undefined || facts[key] === null) hold(`can't read ${key}`);
  }

  if (facts.draft === true) hold("pull request is a draft");
  if (facts.bottomOfStack === false) hold("not the bottom of its stack");
  else if (facts.baseAllowed === false) hold(`base ${facts.base} is not an allowed base`);
  if (facts.conflict === true) hold("conflicts with the current trunk");
  for (const path of facts.trunkTouched ?? []) hold(`trunk changed ${path} since this pull request branched`);
  if (facts.ciChanged === true) hold("trunk changed the CI configuration since this pull request branched");
  if (facts.fresh === false && facts.conflict !== true && !facts.trunkTouched?.length && facts.ciChanged !== true) hold("not fresh against trunk");
  if (facts.unresolvedThreads === true) hold("unresolved review threads");

  if (facts.checks === "pending") hold("checks still running", "waiting");
  else if (facts.checks === "red") hold("checks failing");
  else if (facts.checks === "none") hold("no check results");
  else if (facts.checks !== undefined && facts.checks !== "green") hold(`checks in an unknown state: ${facts.checks}`);

  if (facts.zone != null) {
    const mode = settings.merge?.[facts.zone];
    if (mode !== "shadow") hold(`${facts.zone} zone (merge is ${mode ?? "not set"})`);
  }
  for (const path of (facts.changedFiles ?? []).filter((p) => matchesAny(p, settings.neverMerge))) hold(`${path} is a never-merge path`);

  const verdicts = facts.verdicts ?? [];
  const absent = REVIEWERS.filter((r) => !verdicts.some((v) => v.reviewer === r));
  if (absent.length) hold(`no review verdict for this change (missing: ${absent.join(", ")})`);
  for (const v of verdicts) {
    if (String(v.verdict).toUpperCase() !== "READY") hold(`${v.reviewer} verdict is ${v.verdict}`);
    if (v.reviewer === "codex") {
      if (!v.model) hold("the Codex verdict doesn't say which model ran it");
      else if (!isOpenAI(v.model)) hold(`the Codex verdict didn't come from Codex (model: ${v.model})`);
    }
  }

  if (facts.runtimeChanged && facts.liveProof !== "verified live") hold("no live proof for this commit");
  if (facts.runtimeChanged && settings.flagsRequired && !/^Flag:[ \t]*\S/m.test(facts.description ?? "")) hold("new behavior must name its flag");
  if (facts.complianceChange) {
    if (!facts.compliance) hold(`no spec compliance report for ${facts.complianceChange} at this commit`);
    else if (!facts.compliance.ok) hold(`spec compliance report for ${facts.complianceChange} holds`);
  }

  if (facts.codeLines > settings.sizeLimit) {
    const mechanical = /^Mechanical:/m.test(facts.description ?? "") ? " (a Mechanical: line does not lift the limit in this version)" : "";
    hold(`${facts.codeLines} changed code lines, over the ${settings.sizeLimit} limit${mechanical}`);
  }

  const call = reasons.length ? "would-hold" : "would-merge";
  const output = [`SHADOW ${call}`, ...reasons.map((r) => `- ${r.message}${r.kind === "waiting" ? " (waiting)" : ""}`)].join("\n");
  return { call, reasons, exitCode: reasons.length ? 1 : 0, output, merged: false };
}
