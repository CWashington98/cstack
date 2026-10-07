// Markdown lines outside fenced code, with their original line numbers.
// A fence closes only on the same character, at least as long, with nothing after it,
// so a four-backtick fence can hold three-backtick examples.
function scan(raw) {
  const out = [];
  let fence = null;
  let openedAt = 0;
  raw.replace(/\r\n?/g, "\n").split("\n").forEach((text, i) => {
    const m = text.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (m && !fence) { fence = m[1]; openedAt = i + 1; return; }
    if (m && fence && m[1][0] === fence[0] && m[1].length >= fence.length && m[2].trim() === "") { fence = null; return; }
    if (!fence) out.push({ line: i + 1, text });
  });
  return { lines: out, unclosed: fence ? openedAt : null };
}

export const proseLines = (raw) => scan(raw).lines;

// The line of a code fence that is never closed, or null. Everything after it is hidden.
export const unclosedFence = (raw) => scan(raw).unclosed;

export const HEADING = /^#{1,6}\s/;
