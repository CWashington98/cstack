// One review comment a person can read in two minutes, built from both reviewers' verdicts
// and a writer's plain-English text. The layout, numbering, groups, headline and technical
// detail come from this file; the writer only supplies short plain sentences, and a check
// makes sure it covered every confirmed finding and changed no verdict.

const short = (sha) => sha.slice(0, 12);
const WHO = { karen: "Karen", codex: "Codex", "claude-fallback": "the stand-in for Codex" };
const FULL = { karen: "Karen (Claude)", codex: "Codex (OpenAI)", "claude-fallback": "Stand-in for Codex (Claude)" };
// Severity words in the reviewers' reports, strictest first, and the group each lands in.
const RANK = { blocking: 0, decide: 1, note: 2 };
const GROUPS = [
  { key: "decide", heading: "Your decision" },
  { key: "blocking", heading: "Must fix before merge" },
  { key: "note", heading: "Worth fixing later" },
];
const RISK = ["low", "medium", "high"];
const LIMITS = { sentence: 30, title: 20, what_goes_wrong: 70, fix: 35, what_it_does: 80, why: 50, line: 35, option: 35 };

const end = (s) => (/[.?!:]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
// Code-looking text: a file name with an extension, a function call, or a common command.
const CODE = /\b[\w./-]+\.(?:m?js|cjs|jsx|tsx?|json|md|py|rb|go|css|html|ya?ml|sh)\b|\b\w+\(\)|\b(?:npm|npx|bun|bunx|yarn|pnpm|git|node|gh) [\w-]/;
const words = (s) => (s ?? "").trim().split(/\s+/).filter(Boolean).length;
const andList = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function confirmed({ karen, other }) {
  const all = new Map();
  for (const v of [karen, other]) for (const f of v.findings ?? []) all.set(f.id, { ...f, reviewer: v.reviewer });
  return all;
}

function groupOf(item, all) {
  const ranks = item.sources.map((id) => RANK[all.get(id)?.severity] ?? RANK.note);
  return GROUPS.find((g) => RANK[g.key] === Math.min(...ranks)).key;
}

// Returns a list of problems; empty means the writer's text can be rendered.
export function checkWriter(verdicts, w) {
  const { karen, other } = verdicts;
  const problems = [];
  const text = (name, value, limit, required = true) => {
    if (typeof value !== "string" || !value.trim()) { if (required) problems.push(`${name} is missing.`); return; }
    if (value.includes("`")) problems.push(`${name} has backticks. Keep code, file names and commands out of the plain text; the technical detail already shows them.`);
    else if (CODE.test(value)) problems.push(`${name} looks like code ("${value.match(CODE)[0]}"). Say what it means for a person instead; the technical detail already shows file names and commands.`);
    if (words(value) > limit) problems.push(`${name} has ${words(value)} words; keep it to ${limit} words.`);
    // The plain-English checker holds a sentence over 35 words; the template adds a few after some fields.
    const longest = Math.max(...value.split(/(?<=[.?!])\s+/).map(words));
    if (longest > LIMITS.sentence) problems.push(`${name} has a sentence of ${longest} words; split it so each sentence has at most ${LIMITS.sentence}.`);
  };
  text("what_it_does", w?.what_it_does, LIMITS.what_it_does);
  if (!RISK.includes(w?.merge_risk?.level)) problems.push("merge_risk.level must be low, medium or high.");
  text("merge_risk.why", w?.merge_risk?.why, LIMITS.why);
  for (const v of [karen, other]) {
    const theirs = v.merge_risk?.level;
    if (RISK.includes(theirs) && RISK.includes(w?.merge_risk?.level) && RISK.indexOf(w.merge_risk.level) < RISK.indexOf(theirs))
      problems.push(`${FULL[v.reviewer].split(" (")[0]} rated the merge risk ${theirs}; the comment can't rate it lower.`);
  }
  if (!Array.isArray(w?.checked) || !w.checked.length) problems.push("checked needs at least one line: what the reviewers ran or looked at, in plain results.");
  else w.checked.forEach((l, i) => text(`checked line ${i + 1}`, l, LIMITS.line));
  if (w?.not_checked !== undefined && !Array.isArray(w.not_checked)) problems.push("not_checked must be a list (empty when there's nothing to add).");
  else (w?.not_checked ?? []).forEach((l, i) => text(`not_checked line ${i + 1}`, l, LIMITS.line));

  const kIds = new Set((karen.findings ?? []).map((f) => f.id));
  for (const f of other.findings ?? []) if (kIds.has(f.id)) problems.push(`both reviewers used the finding id ${f.id}. Each reviewer numbers its own findings (karen-1, codex-1), so one can't hide the other. Fix the ids in the reports and record the verdicts again.`);
  const all = confirmed(verdicts);
  const seen = new Map();
  const items = Array.isArray(w?.items) ? w.items : (problems.push("items must be a list (empty when there are no findings)."), []);
  items.forEach((it, i) => {
    const n = `item ${i + 1}`;
    if (!it || typeof it !== "object" || Array.isArray(it)) { problems.push(`${n} must be an object with sources, a title and what goes wrong.`); return; }
    if (!Array.isArray(it.sources) || !it.sources.length) { problems.push(`${n} has no sources: list the finding ids it covers.`); return; }
    for (const id of it.sources) {
      const f = all.get(id);
      if (!f) problems.push(`${id} is not a finding from either reviewer.`);
      else if (f.reproduced !== true) problems.push(`${id} was not confirmed by the separate check, so it belongs only in the dropped list, not in an item.`);
      if (seen.has(id)) problems.push(`${id} is in more than one item.`);
      seen.set(id, i);
    }
    text(`${n} title`, it.title, LIMITS.title);
    text(`${n} what_goes_wrong`, it.what_goes_wrong, LIMITS.what_goes_wrong);
    if (!it.sources.every((id) => all.get(id)?.reproduced === true)) return;
    const decide = groupOf(it, all) === "decide";
    if (decide) {
      const opts = Array.isArray(it.options) ? it.options : [];
      if (opts.length < 2) problems.push(`${n} is a decision and needs at least two options.`);
      if (opts.filter((o) => o.recommended === true).length !== 1) problems.push(`${n} needs exactly one recommended option.`);
      opts.forEach((o, j) => { text(`${n} option ${j + 1} label`, o.label, 3); text(`${n} option ${j + 1} text`, o.text, LIMITS.option); });
    } else {
      if (it.options !== undefined) problems.push(`${n}: only a decision has options. Give a suggested fix instead.`);
      if (typeof it.fix !== "string" || !it.fix.trim()) problems.push(`${n} needs a suggested fix.`);
      else text(`${n} fix`, it.fix, LIMITS.fix);
    }
  });
  for (const [id, f] of all) if (f.reproduced === true && !seen.has(id)) problems.push(`${id} is not in any item. Every confirmed finding must appear once.`);
  // The headline must agree with the verdicts: a must-fix item exactly when a verdict is "not ready".
  const mustFix = items.some((it) => it && Array.isArray(it.sources) && it.sources.length && it.sources.every((id) => all.has(id)) && groupOf(it, all) === "blocking");
  for (const v of [karen, other]) {
    const name = FULL[v.reviewer].split(" (")[0];
    if (v.verdict === "not ready" && !mustFix) problems.push(`${name}'s verdict is not ready, but no item is a must-fix. The comment would say it can merge.`);
  }
  if (mustFix && karen.verdict === "ready" && other.verdict === "ready") problems.push("an item is a must-fix, but both verdicts are ready. Record the verdicts again from the checked findings.");
  return problems;
}

function sameChange(karen, other) {
  return karen.head === other.head || (karen.patchId && karen.patchId !== "empty" && karen.patchId === other.patchId);
}

export function renderReview({ karen, other, writer: w }) {
  if (!sameChange(karen, other)) throw new Error(`the two verdicts are for a different change (${short(karen.head)} and ${short(other.head)}). Review the same commit with both reviewers.`);
  const problems = checkWriter({ karen, other }, w);
  if (problems.length) throw new Error(problems.join("\n"));
  const all = confirmed({ karen, other });

  // Number items once, in group order, so a reply can say "fix 2".
  const grouped = GROUPS.map((g) => ({ ...g, items: w.items.filter((it) => groupOf(it, all) === g.key) }));
  let n = 0;
  for (const g of grouped) for (const it of g.items) it.n = ++n;
  const nums = (key) => grouped.find((g) => g.key === key).items.map((it) => it.n);
  const fix = nums("blocking");
  const decide = nums("decide");

  const headline = fix.length
    ? `not ready, ${plural(fix.length, "item")} to fix before merging`
    : decide.length ? `ready to merge, with ${plural(decide.length, "decision")} for you` : "ready to merge";
  let todo;
  if (fix.length) todo = `fix ${fix.length === 1 ? "item" : "items"} ${andList(fix.map(String))} before merging.${decide.length ? ` Then answer ${decide.length === 1 ? "item" : "items"} ${andList(decide.map(String))}.` : ""}`;
  else if (decide.length) todo = `answer ${decide.length === 1 ? "item" : "items"} ${andList(decide.map(String))}. Nothing has to be fixed before merging.`;
  else todo = "nothing. It can merge.";
  if (karen.verdict !== other.verdict) todo += ` The reviewers disagree: Karen says ${karen.verdict} and ${WHO[other.reviewer].replace(/^the /, "The ")} says ${other.verdict}. You decide.`;

  const sure = (it) => {
    const by = [...new Set(it.sources.map((id) => all.get(id).reviewer))];
    const who = by.length > 1 ? "Both reviewers found this" : `Found by ${WHO[by[0]]}`;
    return `${who.charAt(0).toUpperCase()}${who.slice(1)}, and the checking agent made it happen.`;
  };

  const out = [
    `<!-- verify-review head=${karen.head} patch-id=${karen.patchId} karen=${karen.verdict} other=${other.reviewer}:${other.verdict} -->`,
    `## Review: ${headline}`,
    "",
    `**What you need to do:** ${todo}`,
    "",
    `**What this change does:** ${w.what_it_does.trim()}`,
    "",
    `**Merge risk: ${w.merge_risk.level}.** ${w.merge_risk.why.trim()}`,
    "",
    `**Who reviewed it:** ${other.reviewer === "claude-fallback"
      ? "Karen, an AI reviewer that runs on Claude (made by Anthropic), and a second Claude reviewer standing in for Codex (OpenAI's AI reviewer), each read the change on their own."
      : "two AI reviewers from different companies each read the change on their own: Karen, which runs on Claude (made by Anthropic), and Codex (made by OpenAI)."} Then a third AI agent, called the checking agent here, ran the code to try to make each reported problem happen. It never saw the reviews, only the problems. The comment lists only the problems it could make happen.`,
  ];
  for (const g of grouped) {
    out.push("", `### ${g.heading}`, "");
    if (!g.items.length) { out.push("None."); continue; }
    g.items.forEach((it, i) => {
      if (i) out.push("");
      out.push(`**${it.n}. ${end(it.title)}** ${it.what_goes_wrong.trim()}`);
      if (g.key === "decide") {
        out.push(...it.options.map((o) => `- **${o.label.trim()}${o.recommended ? " (recommended)" : ""}:** ${o.text.trim()}`), "");
        out.push(sure(it));
      } else {
        out.push(`Suggested fix: ${it.fix.trim()} ${sure(it)}`);
      }
    });
  }
  out.push("", "### What the reviewers checked", "", ...w.checked.map((l) => `- ${l.trim()}`));
  const gaps = [...(w.not_checked ?? []).map((l) => l.trim())];
  if (other.reviewer === "claude-fallback") gaps.unshift("Codex could not run, so a second Claude reviewer stood in. This review has no opinion from a second AI company.");
  out.push("", "### What nobody checked", "", ...(gaps.length ? gaps : ["Nothing the reviewers know of."]).map((l) => `- ${l}`));

  // Technical detail: everything a developer needs to check the claims, closed by default.
  const where = (f) => (f.file ? `\`${f.file}${f.line ? `:${f.line}` : ""}\`. ` : "");
  const detail = ["", "<details><summary>Technical detail, for engineers</summary>", ""];
  for (const g of grouped) for (const it of g.items) {
    detail.push(`**Item ${it.n}.**`);
    for (const id of it.sources) {
      const f = all.get(id);
      detail.push(`- ${id}, from ${FULL[f.reviewer]}: ${where(f)}${end(f.claim)} Trigger: ${end(f.trigger ?? "not given")} Shown by: ${end(f.reproduction ?? "no notes recorded")}`);
    }
    detail.push("");
  }
  detail.push(`**Reviewers.** ${FULL[karen.reviewer]}: ${karen.verdict}. ${FULL[other.reviewer]}${other.model ? `, model ${other.model}` : ""}: ${other.verdict}.`);
  for (const v of [karen, other]) if (v.said && v.said !== v.verdict) detail.push(`${FULL[v.reviewer]} said "${v.said}"; only findings the checking agent confirmed count, so the verdict is "${v.verdict}".`);
  if (other.note) detail.push(`Why Codex could not run: ${other.note}`);
  detail.push("", `**Commit** \`${short(karen.head)}\`, change fingerprint \`${short(karen.patchId ?? "")}\`. A new commit clears this review, unless a rebase leaves the change identical.`, "");
  const dropped = [...all.values()].filter((f) => f.reproduced === false);
  if (dropped.length) detail.push("Dropped, because the checking agent could not make them happen:", ...dropped.map((f) => `- ${end(f.claim ?? "no claim recorded")} (${f.id}, from ${WHO[f.reviewer]}.) Checked: ${end(f.reproduction ?? "no notes recorded")}`));
  else detail.push("Dropped findings: none.");
  detail.push("</details>");
  return [...out, ...detail].join("\n") + "\n";
}
