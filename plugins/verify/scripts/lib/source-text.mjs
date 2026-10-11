// Reading source text without being fooled by strings and comments: which strings
// name a test, and which lines are really code. One small scanner serves both, so
// sample code quoted inside a string is never mistaken for the real thing.

// Words that open a test or a group of tests, and words that may follow them, as in
// `test.skip(` or `describe.only(`.
const DECLARE = new Set(["test", "it", "describe", "suite", "context", "specify"]);
const MODIFIERS = new Set(["skip", "only", "todo", "concurrent", "serial", "fails", "failing"]);

const WORD = /[A-Za-z_$][\w$]*/y;

// Splits text into words, punctuation and strings. Also returns `code`: the same text
// with the inside of every string and comment blanked out, line for line, so a line can be
// tested for what the code on it does.
export function scan(text) {
  const n = text.length;
  const chars = text.split("");
  const tokens = [];
  const starts = [0];
  for (let k = 0; k < n; k++) if (text[k] === "\n") starts.push(k + 1);
  const lineOf = (index) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= index) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  const blank = (a, b) => { for (let k = a; k < b; k++) if (chars[k] !== "\n" && chars[k] !== "\r") chars[k] = " "; };
  let i = 0;

  const lineEnd = (from) => { const e = text.indexOf("\n", from); return e === -1 ? n : e; };
  const prevSignificant = (from) => { for (let k = from - 1; k >= 0; k--) if (!/\s/.test(text[k])) return text[k]; return ""; };
  const atLineStart = (from) => { for (let k = from - 1; k >= 0 && text[k] !== "\n"; k--) if (!/\s/.test(text[k])) return false; return true; };

  // A regular expression written in code can hold quote marks; step over it whole.
  const regexEnd = (from) => {
    let inClass = false;
    for (let k = from + 1; k < n && text[k] !== "\n"; k++) {
      if (text[k] === "\\") k++;
      else if (text[k] === "[") inClass = true;
      else if (text[k] === "]") inClass = false;
      else if (text[k] === "/" && !inClass) return k + 1;
    }
    return -1;
  };

  function quoted(quote) {
    const triple = text.startsWith(quote.repeat(3), i);
    const start = i;
    i += triple ? 3 : 1;
    const bodyStart = i;
    let end = -1;
    while (i < n) {
      if (text[i] === "\\") { i += 2; continue; }
      if (triple ? text.startsWith(quote.repeat(3), i) : text[i] === quote) { end = i; i += triple ? 3 : 1; break; }
      if (!triple && text[i] === "\n") break;
      i++;
    }
    const bodyEnd = end === -1 ? Math.min(i, n) : end;
    tokens.push({ type: "str", value: text.slice(bodyStart, bodyEnd), index: start, line: lineOf(start), triple });
    blank(bodyStart, bodyEnd);
  }

  function template() {
    const start = i;
    i++;
    const bodyStart = i;
    let end = n;
    while (i < n) {
      if (text[i] === "\\") { i += 2; continue; }
      if (text[i] === "`") { end = i; i++; break; }
      if (text[i] === "$" && text[i + 1] === "{") { i += 2; code(true); continue; }
      i++;
    }
    tokens.push({ type: "str", value: text.slice(bodyStart, Math.min(end, n)), index: start, line: lineOf(start), triple: false });
    blank(bodyStart, Math.min(end, n));
  }

  function code(inTemplate) {
    let depth = 0;
    while (i < n) {
      const c = text[i];
      if (c === "/" && text[i + 1] === "/") { const e = lineEnd(i); blank(i, e); i = e; continue; }
      if (c === "/" && text[i + 1] === "*") { const e = text.indexOf("*/", i + 2); const stop = e === -1 ? n : e + 2; blank(i, stop); i = stop; continue; }
      if (c === "#" && text[i + 1] !== "[" && (i === 0 || /\s/.test(text[i - 1])) && atLineStart(i)) { const e = lineEnd(i); blank(i, e); i = e; continue; }
      if (c === "\"" || c === "'") { quoted(c); continue; }
      if (c === "`") { template(); continue; }
      if (c === "/" && (prevSignificant(i) === "" || "(,=:[!&|?{};".includes(prevSignificant(i)))) {
        const e = regexEnd(i);
        if (e !== -1) { i = e; continue; }
      }
      if (c === "{") depth++;
      if (c === "}") { if (inTemplate && depth === 0) { i++; return; } depth--; }
      WORD.lastIndex = i;
      const w = WORD.exec(text);
      if (w) { tokens.push({ type: "word", value: w[0], index: i, line: lineOf(i) }); i += w[0].length; continue; }
      if (!/\s/.test(c)) tokens.push({ type: "punct", value: c, index: i, line: lineOf(i) });
      i++;
    }
  }

  code(false);
  return { tokens, code: chars.join("").split(/\r?\n/) };
}

const unescape = (s) => s.replace(/\\(["'`\\])/g, "$1");

// The strings that name a test: the first string of a call such as test(, it.skip( or
// describe.only(, and the first string inside a function named test..., which is how a
// description is written in a language that puts it just under the definition line.
export function testNames(text) {
  const { tokens } = scan(text);
  const names = [];
  const at = (k) => tokens[k] ?? {};
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type !== "word") continue;
    if (t.value === "def" && /^test/i.test(at(k + 1).value ?? "") && at(k + 2).value === "(") {
      let depth = 0;
      let j = k + 2;
      for (; j < tokens.length; j++) {
        if (tokens[j].value === "(" && tokens[j].type === "punct") depth++;
        else if (tokens[j].value === ")" && tokens[j].type === "punct" && --depth === 0) break;
      }
      for (j++; j < tokens.length && !(tokens[j].type === "punct" && tokens[j].value === ":"); j++);
      if (at(j + 1).type === "str") names.push(at(j + 1));
      k = j;
      continue;
    }
    const chain = [t.value];
    let j = k;
    while (at(j + 1).value === "." && at(j + 1).type === "punct" && at(j + 2).type === "word") { chain.push(tokens[j + 2].value); j += 2; }
    let last = chain.length - 1;
    while (last >= 0 && MODIFIERS.has(chain[last]) && !DECLARE.has(chain[last])) last--;
    if (last >= 0 && DECLARE.has(chain[last]) && at(j + 1).value === "(" && at(j + 1).type === "punct" && at(j + 2).type === "str") {
      names.push(at(j + 2));
    }
    k = j;
  }
  return names.map((s) => ({ name: unescape(s.triple ? s.value.trim().split(/\r?\n/)[0] : s.value).trim(), line: s.line }));
}

// The same text with strings and comments blanked, one entry per line (starting at line 1).
export const codeLines = (text) => scan(text).code;
