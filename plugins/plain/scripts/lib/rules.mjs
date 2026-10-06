// The writing rules. Input is prose from text.mjs; output is a list of
// findings, each "hold" (must fix before posting) or "advice".
import { sentences } from "./text.mjs";

const CAPS = /\b[A-Z][A-Z0-9&]*[A-Z][A-Z0-9&]*s?\b/g;
const CODE = /\b[A-Z]{1,2}\d{1,3}[a-z]?\b|§\s*\d+(?:\.\d+)*/g;
const UNSEEN = ["as discussed", "as mentioned", "as agreed", "per the plan", "per our", "see above", "as above", "like last time", "as before", "the usual way", "from the call", "per the thread"];
const FILLER = ["leverage", "leverages", "leveraging", "robust", "seamless", "seamlessly", "delve", "utilize", "utilizes", "utilizing", "pivotal", "synergy", "cutting-edge", "game-changer", "holistic"];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const lineOf = (text, index) => text.slice(0, index).split("\n").length;
const lineStart = (text, line) => text.split("\n").slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);

function definedAtFirstUse(prose, tok, i) {
  const before = prose.slice(0, i);
  const after = prose.slice(i + tok.length);
  if (/\(\s*$/.test(before) && /^s?\s*\)/.test(after)) return true;
  return /^s?\s*\(\s*[a-z]/.test(after);
}

export function checkText(prose, config) {
  const found = [];
  const add = (index, rule, level, text, message) => found.push({ index, rule, level, line: lineOf(prose, index), text, message });
  const isAllowed = (tok) => {
    const base = tok.replace(/s$/, "");
    return [tok, base].some((t) => config.common.has(t) || config.glossary.some((g) => g.term === t));
  };
  const never = new Set(Object.keys(config.neverPublish));
  let m;

  for (const [tok, instead] of Object.entries(config.neverPublish)) {
    const re = new RegExp(`\\b${esc(tok)}\\b`, "g");
    while ((m = re.exec(prose))) add(m.index, "never-publish", "hold", tok, `Don't publish "${tok}". ${instead}`);
  }

  const codeAt = new Set();
  const code = new RegExp(CODE.source, "g");
  while ((m = code.exec(prose))) {
    const tok = m[0];
    codeAt.add(m.index);
    if (never.has(tok) || isAllowed(tok)) continue;
    add(m.index, "planning-code", "hold", tok, `"${tok}" looks like a planning code. Say what it means instead.`);
  }

  const caps = new RegExp(CAPS.source, "g");
  const seen = new Set();
  while ((m = caps.exec(prose))) {
    const tok = m[0];
    const base = tok.replace(/s$/, "");
    if (codeAt.has(m.index) || never.has(tok) || never.has(base) || isAllowed(tok) || seen.has(base)) continue;
    seen.add(base);
    if (definedAtFirstUse(prose, base, m.index)) continue;
    add(m.index, "capitals", "hold", tok, `"${tok}" isn't on the common list or in the glossary. Spell it out the first time, like "full name (${base})", or write it in lowercase if it's emphasis.`);
  }

  for (const phrase of UNSEEN) {
    const re = new RegExp(`\\b${esc(phrase)}\\b`, "gi");
    while ((m = re.exec(prose))) add(m.index, "unseen-context", "hold", m[0], `"${m[0]}" points at something the reader can't see. Put the needed facts in the text.`);
  }

  for (const s of sentences(prose)) {
    if (s.words > 35) add(lineStart(prose, s.line), "long-sentence", "hold", s.text.slice(0, 60), `A sentence here has ${s.words} words. Split it; aim for under 20.`);
    else if (s.words >= 25) add(lineStart(prose, s.line), "long-sentence", "advice", s.text.slice(0, 60), `A sentence here has ${s.words} words. Consider splitting it.`);
  }

  for (const g of config.glossary) {
    for (const word of g.avoid) {
      const re = new RegExp(`\\b${esc(word)}\\b`, "gi");
      while ((m = re.exec(prose))) add(m.index, "avoided-word", "advice", m[0], `The glossary prefers "${g.term}" over "${m[0]}".`);
    }
  }

  for (const word of FILLER) {
    const re = new RegExp(`\\b${esc(word)}\\b`, "gi");
    while ((m = re.exec(prose))) add(m.index, "filler", "advice", m[0], `"${m[0]}" is filler. Use a plainer word.`);
  }

  return found.sort((a, b) => a.index - b.index).map(({ index, ...f }) => f);
}
