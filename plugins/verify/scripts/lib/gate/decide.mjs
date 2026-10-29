import { matchesAny } from "./zone.mjs";

const isOpenAI = (model) => /^(gpt|o\d|codex|chatgpt)/i.test(model ?? "");

// Needed facts. If one is undefined and nothing was reported missing, the gate still holds.
const REQUIRED = ["baseAllowed", "bottomOfStack", "conflict", "ciChanged", "unresolvedThreads", "checks", "codeLines"];

// Kinds: "fix" an agent can clear by changing the branch or running a step, "wait" for running checks,
// "owner" only the owner can clear and carries a question.
// Facts in, ready and reasons out. No input, output or merging happens here.
export function decideGate(facts, settings) {
  const reasons = [];
  const add = (kind, text, question) => reasons.push(question ? { kind, text, question } : { kind, text });
  const fix = (text) => add("fix", text);

  for (const m of facts.missing ?? []) fix(`can't read ${m.fact}: ${m.why}`);
  if (!facts.missing?.length) {
    for (const key of REQUIRED) if (facts[key] === undefined || facts[key] === null) fix(`can't read ${key}`);
  }

  if (facts.bottomOfStack === false) fix("not the bottom of its stack");
  else if (facts.baseAllowed === false) fix(`base ${facts.base} is not an allowed base`);
  if (facts.conflict === true) fix("conflicts with the current trunk");
  for (const path of facts.trunkTouched ?? []) fix(`trunk changed ${path} since this pull request branched`);
  if (facts.ciChanged === true) fix("trunk changed the CI configuration since this pull request branched");
  if (facts.fresh === false && facts.conflict !== true && !facts.trunkTouched?.length && facts.ciChanged !== true) fix("not fresh against trunk");
  if (facts.unresolvedThreads === true) fix("unresolved review threads");

  if (facts.checks === "pending") add("wait", "checks still running");
  else if (facts.checks === "red") fix(facts.failedChecks?.length ? `checks failing: ${facts.failedChecks.join(", ")}` : "checks failing");
  else if (facts.checks === "none") fix("no check results");
  else if (facts.checks !== undefined && facts.checks !== "green") fix(`checks in an unknown state: ${facts.checks}`);

  // Verdicts are required unless the project asks for them only on high-risk paths and this change touches none.
  // A verdict that exists always counts.
  const reviewsRequired = settings.reviews !== "highRisk" || (facts.changedFiles ?? []).some((p) => matchesAny(p, settings.highRisk));
  const verdicts = facts.verdicts ?? [];
  if (reviewsRequired) {
    const absent = [];
    if (!verdicts.some((v) => v.reviewer === "claims-auditor")) absent.push("claims-auditor");
    if (!verdicts.some((v) => v.reviewer === "codex" || v.reviewer === "claude-fallback")) absent.push("codex");
    if (absent.length) fix(`no review verdict for this change (missing: ${absent.join(", ")})`);
  }
  const asked = new Set();
  for (const v of verdicts) {
    if (String(v.verdict).toUpperCase() !== "READY") fix(`${v.reviewer} verdict is ${v.verdict}`);
    if (v.reviewer === "codex") {
      if (!v.model) fix("the Codex verdict doesn't say which model ran it");
      else if (!isOpenAI(v.model)) fix(`the Codex verdict didn't come from Codex (model: ${v.model})`);
    }
    // Open findings only the owner can settle. The validator drops findings it couldn't reproduce.
    for (const f of v.findings ?? []) {
      if (f.reproduced === false || !f.claim || asked.has(f.claim)) continue;
      if (f.kind === "spec-wrong") add("owner", `the spec looks wrong: ${f.claim}`, `The spec looks wrong here: ${f.claim.replace(/[.\s]+$/, "")}. Change the spec?`);
      else if (f.severity === "decide") add("owner", f.claim, f.claim);
      else continue;
      asked.add(f.claim);
    }
  }

  if (facts.runtimeChanged && facts.liveProof !== "verified live") fix("no live proof for this commit");
  if (facts.runtimeChanged && settings.flagsRequired && !/^Flag:[ \t]*\S/m.test(facts.description ?? "")) fix("new behavior must name its flag");
  if (facts.complianceChange) {
    if (!facts.compliance) fix(`no spec compliance report for ${facts.complianceChange} at this commit`);
    else if (!facts.compliance.ok) fix(`spec compliance report for ${facts.complianceChange} holds`);
  }

  if (facts.codeLines > settings.sizeLimit) {
    const mechanical = /^Mechanical:/m.test(facts.description ?? "") ? " (a Mechanical: line does not lift the limit in this version)" : "";
    fix(`${facts.codeLines} changed code lines, over the ${settings.sizeLimit} limit${mechanical}`);
  }

  const ready = reasons.length === 0;
  const output = ready ? "ready" : ["not ready", ...reasons.map((r) => `- ${r.kind}: ${r.text}${r.question ? ` (ask the owner: ${r.question})` : ""}`)].join("\n");
  return { ready, call: ready ? "ready" : "not-ready", head: facts.head ?? null, zone: facts.zone ?? null, reasons, exitCode: ready ? 0 : 1, output };
}
