// Reads a shell command the way the guard needs: split into the commands it
// runs, each split into words. It follows quotes, heredocs, $( ) and backticks.
// It is not a full shell parser. It aims to see every command a person would
// see when reading the line, and to err toward seeing too much.

// Pulls heredoc bodies out of the text so their lines aren't read as commands
// of the outer shell. Each body is replaced by a marker the caller can look up.
export function extractHeredocs(cmd) {
  const heredocs = new Map();
  let n = 0;
  const keep = (body) => {
    const key = `__HEREDOC_${n++}__`;
    heredocs.set(key, body);
    return key;
  };
  const text = cmd.replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$)/g, (_m, _q, _tag, rest, body) => ` <<HEREDOC ${keep(body)}${rest}`);
  return { text, heredocs };
}

// The text inside every $( ) and backtick pair outside single quotes. These run
// as commands of their own, even inside double quotes.
export function substitutions(cmd) {
  const out = [];
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      continue;
    }
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "'" && !quote) {
      quote = "'";
      continue;
    }
    if (c === '"') {
      quote = quote === '"' ? null : '"';
      continue;
    }
    if (c === "$" && cmd[i + 1] === "(" && cmd[i + 2] !== "(") {
      let depth = 1;
      let j = i + 2;
      for (; j < cmd.length && depth; j++) {
        if (cmd[j] === "(") depth++;
        else if (cmd[j] === ")") depth--;
      }
      out.push(cmd.slice(i + 2, j - 1));
      i = j - 1;
      continue;
    }
    if (c === "`") {
      const end = cmd.indexOf("`", i + 1);
      if (end === -1) break;
      out.push(cmd.slice(i + 1, end));
      i = end;
    }
  }
  return out;
}

// Splits a line into the separate commands it runs: on ; & && || | newlines
// and parentheses, outside quotes.
export function segments(cmd) {
  const out = [];
  let cur = "";
  let quote = null;
  const flush = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = "";
  };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      cur += c;
      if (c === "\\" && quote === '"' && i + 1 < cmd.length) cur += cmd[++i];
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "\\" && i + 1 < cmd.length) {
      if (cmd[i + 1] === "\n") i++;
      else cur += c + cmd[++i];
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      cur += c;
      continue;
    }
    if (c === "#" && (cur === "" || /\s$/.test(cur))) {
      while (i < cmd.length && cmd[i] !== "\n") i++;
      flush();
      continue;
    }
    if (c === ";" || c === "\n" || c === "|" || c === "(" || c === ")" || (c === "&" && cmd[i - 1] !== ">" && cmd[i + 1] !== ">")) {
      flush();
      if ((c === "&" || c === "|") && cmd[i + 1] === c) i++;
      continue;
    }
    cur += c;
  }
  flush();
  return out;
}

// Splits one command into words, removing quotes. Redirections such as
// 2>/dev/null or > out.txt are dropped, since they never change what runs.
export function tokenize(segment) {
  const out = [];
  let cur = "";
  let quote = null;
  let started = false;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < segment.length) cur += segment[++i];
      else cur += c;
      continue;
    }
    if (c === "\\" && i + 1 < segment.length) {
      cur += segment[++i];
      started = true;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      started = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (started) out.push(cur);
      cur = "";
      started = false;
      continue;
    }
    cur += c;
    started = true;
  }
  if (started) out.push(cur);
  const words = [];
  for (let i = 0; i < out.length; i++) {
    const w = out[i];
    if (w === "<<HEREDOC") {
      words.push(w, out[++i]);
      continue;
    }
    if (/^\d*(>>?|<)&?$|^&>>?$/.test(w)) {
      i++;
      continue;
    }
    if (/^\d*(>>?|<)&?\S|^&>>?\S/.test(w)) continue;
    words.push(w);
  }
  return words;
}
