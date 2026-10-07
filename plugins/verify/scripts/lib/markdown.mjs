// Markdown lines outside fenced code, with their original line numbers.
// A fence closes only on the same character, at least as long, with nothing after it,
// so a four-backtick fence can hold three-backtick examples.
export function proseLines(raw) {
  const out = [];
  let fence = null;
  raw.replace(/\r\n?/g, "\n").split("\n").forEach((text, i) => {
    const m = text.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (m && !fence) { fence = m[1]; return; }
    if (m && fence && m[1][0] === fence[0] && m[1].length >= fence.length && m[2].trim() === "") { fence = null; return; }
    if (!fence) out.push({ line: i + 1, text });
  });
  return out;
}

export const HEADING = /^#{1,6}\s/;
