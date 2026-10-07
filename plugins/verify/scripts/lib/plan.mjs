// Rules for specs and plans: every scenario says how it will be proved,
// and every plan item names its evidence (Task 3).
import { proseLines, HEADING } from "./markdown.mjs";

const SCENARIO = /^#{2,6}\s+Scenario:\s*(.*)$/;
const ITEM = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/;
const PROVED = /^\s*(?:[-*]\s+)?Proved by:/i;

export const hold = (line, message) => ({ line, level: "hold", message });

// A line plus the indented lines that continue it.
export function gather(lines, i) {
  const parts = [lines[i].text];
  for (let j = i + 1; j < lines.length; j++) {
    const t = lines[j].text;
    if (!t.trim() || HEADING.test(t) || /^\S/.test(t) || /^\s*[-*]\s/.test(t)) break;
    parts.push(t.trim());
  }
  return parts.join(" ");
}

export function checkScenarios(lines) {
  const findings = [];
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].text.match(SCENARIO);
    if (!m) continue;
    count++;
    const name = m[1].trim() || "(unnamed)";
    let end = lines.findIndex((l, j) => j > i && HEADING.test(l.text));
    if (end === -1) end = lines.length;
    const at = lines.slice(i + 1, end).findIndex((l) => PROVED.test(l.text));
    if (at === -1) {
      findings.push(hold(lines[i].line, `Scenario "${name}" has no "Proved by" line. Add one that names where it is checked, the evidence, and what passing looks like.`));
      continue;
    }
    const idx = i + 1 + at;
    const text = gather(lines, idx).replace(PROVED, "").trim();
    const where = text.split(";")[0].trim();
    const say = (msg) => findings.push(hold(lines[idx].line, `Scenario "${name}": the "Proved by" line ${msg}`));
    if (!where || /^evidence:/i.test(where)) say("does not say where it is checked: a test file, or live in which app and feature.");
    if (!/evidence:\s*\S/i.test(text)) say(`names no evidence. Add "evidence:" and what comes out: a recording, a screenshot, a read-back, a test result.`);
    if (!/pass when\s*\S/i.test(text)) say(`says no pass condition. Add "pass when" and the result you can observe.`);
  }
  return { findings, count };
}

export function checkFile(raw, { file, root, since } = {}) {
  const lines = proseLines(raw);
  const sc = checkScenarios(lines);
  const findings = [...sc.findings];
  if (!sc.count) findings.push(hold(1, `Found no scenarios, so there is nothing to check. A spec has "#### Scenario:" headings.`));
  findings.sort((a, b) => a.line - b.line);
  return { findings, scenarios: sc.count, items: 0, held: findings.some((f) => f.level === "hold") };
}

export { ITEM };
