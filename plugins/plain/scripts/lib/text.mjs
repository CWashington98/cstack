// Turns Markdown or HTML into prose the rules can check. Ignored parts
// (code, links, quotes, comments, file names) are replaced without
// changing the number of lines, so findings point at the right line.

const FILE_NAME = /(?:[\w.-]+\/)*[\w.-]*\w\.(?:md|mdx|json|mjs|cjs|js|jsx|ts|tsx|py|sh|ya?ml|html|css|txt|toml|lock)\b/g;

export function stripIgnored(markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let fence = null;
  let inComment = false;
  for (let line of lines) {
    const fenceMark = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      if (fenceMark && fenceMark[1][0] === fence[0] && fenceMark[1].length >= fence.length) fence = null;
      out.push("");
      continue;
    }
    if (fenceMark) {
      fence = fenceMark[1];
      out.push("");
      continue;
    }
    if (inComment) {
      const end = line.indexOf("-->");
      if (end === -1) {
        out.push("");
        continue;
      }
      inComment = false;
      line = line.slice(end + 3);
    }
    line = line.replace(/<!--.*?-->/g, " ");
    const open = line.indexOf("<!--");
    if (open !== -1) {
      inComment = true;
      line = line.slice(0, open);
    }
    if (/^\s*>/.test(line)) {
      out.push("");
      continue;
    }
    out.push(
      line
        .replace(/`[^`]*`/g, "code")
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/<https?:\/\/[^>]+>/g, "link")
        .replace(/https?:\/\/\S+/g, "link")
        .replace(FILE_NAME, "file"),
    );
  }
  return out.join("\n");
}

export function htmlToText(html) {
  const blank = (match) => match.replace(/[^\n]/g, "");
  return html
    .replace(/\r\n?/g, "\n")
    .replace(/<(style|script|pre|code|svg)\b[\s\S]*?<\/\1>/gi, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/<\/(td|th|li|p|h[1-6]|div|dt|dd|caption|figcaption|tr|blockquote|section|header|footer)\s*>/gi, " \u241E ")
    .replace(/<[^>]+>/g, (tag) => (/\n/.test(tag) ? blank(tag) : " "))
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;|&#\d+;/gi, " ");
}

export function prepare(raw, name = "") {
  return stripIgnored(name.endsWith(".html") ? htmlToText(raw) : raw);
}

function splitSentences(chunk, line, out) {
  if (chunk.includes("\u241E")) {
    for (const part of chunk.split("\u241E")) splitSentences(part, line, out);
    return;
  }
  for (const piece of chunk.split(/(?<=[.!?][*_"'”’)]*)\s+(?=[*_]*["'“(]?[A-Za-z0-9])/)) {
    const text = piece.trim();
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words) out.push({ text, line, words });
  }
}

export function sentences(prose) {
  const result = [];
  let buffer = [];
  let start = 0;
  const flush = () => {
    if (buffer.length) splitSentences(buffer.join(" "), start, result);
    buffer = [];
  };
  prose.split("\n").forEach((raw, i) => {
    const line = i + 1;
    const t = raw.trim();
    if (!t) return flush();
    if (t.startsWith("|")) {
      flush();
      if (/^\|[\s:|-]+\|?$/.test(t)) return;
      for (const cell of t.split("|").map((c) => c.trim()).filter(Boolean)) splitSentences(cell, line, result);
      return;
    }
    if (/^(#{1,6}\s|[-*+]\s|\d+[.)]\s)/.test(t)) {
      flush();
      buffer = [t.replace(/^(#{1,6}|[-*+]|\d+[.)])\s+/, "")];
      start = line;
      return;
    }
    if (!buffer.length) start = line;
    buffer.push(t);
  });
  flush();
  return result;
}
