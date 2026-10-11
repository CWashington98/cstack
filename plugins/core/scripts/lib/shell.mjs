// Reads a shell command the way the guard needs: split into the commands it
// runs, each split into words. It follows quotes, heredocs, $( ) and backticks.
// It is not a full shell parser. It aims to see every command a person would
// see when reading the line, and to err toward seeing too much.

// Pulls heredoc bodies out of the text so their lines aren't read as commands
// of the outer shell. Each body is replaced by a marker the caller can look up.
let heredocCount = 0;
export function extractHeredocs(cmd) {
  const heredocs = new Map();
  const keep = (body) => {
    const key = `__HEREDOC_${heredocCount++}__`;
    heredocs.set(key, body);
    return key;
  };
  const text = cmd.replace(/(?<![<\w)])<<-?(?!<)\s*(['"]?)(\w+)\1([^\n]*)\n([\s\S]*?)(?:\n[ \t]*\2[ \t]*(?=\n|$)|$)/g, (_m, _q, _tag, rest, body) => ` <<HEREDOC ${keep(body)}${rest}`);
  return { text, heredocs };
}

// The index just past the ) that closes the $( starting at i.
function closeSubst(s, i) {
  let depth = 0;
  let quote = null;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (quote) {
      if (c === "\\" && quote === '"') j++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "\\") j++;
    else if (c === "'" || c === '"') quote = c;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return j + 1;
  }
  return s.length;
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
    if (c === "'" && !quote) quote = "'";
    else if (c === '"') quote = quote === '"' ? null : '"';
    else if (c === "$" && cmd[i + 1] === "(" && cmd[i + 2] !== "(") {
      const end = closeSubst(cmd, i + 1);
      out.push(cmd.slice(i + 2, end - 1));
      i = end - 1;
    } else if (c === "`") {
      const end = cmd.indexOf("`", i + 1);
      if (end === -1) break;
      out.push(cmd.slice(i + 1, end));
      i = end;
    }
  }
  return out;
}

// Splits a line into the separate commands it runs: on ; & && || | newlines
// and parentheses, outside quotes. A $( ) or backtick pair stays inside the
// command it belongs to.
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
    if (c === "$" && cmd[i + 1] === "(" && quote !== "'") {
      const end = closeSubst(cmd, i + 1);
      cur += cmd.slice(i, end);
      i = end - 1;
      continue;
    }
    if (c === "`" && quote !== "'") {
      const end = cmd.indexOf("`", i + 1);
      const stop = end === -1 ? cmd.length : end + 1;
      cur += cmd.slice(i, stop);
      i = stop - 1;
      continue;
    }
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
      if ((c === "&" || c === "|" || c === ";") && cmd[i + 1] === c) i++;
      continue;
    }
    cur += c;
  }
  flush();
  return out;
}

// Splits one command into words, removing quotes. Redirections such as
// 2>/dev/null are dropped from the words, since they never change what runs;
// the files written with > or >> are kept in words.writes.
export function tokenize(segment) {
  const out = [];
  let cur = "";
  let quote = null;
  let started = false;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (c === "$" && segment[i + 1] === "(" && quote !== "'") {
      const end = closeSubst(segment, i + 1);
      cur += segment.slice(i, end);
      started = true;
      i = end - 1;
      continue;
    }
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
  words.writes = [];
  for (let i = 0; i < out.length; i++) {
    const w = out[i];
    if (w === "<<HEREDOC") {
      words.push(w, out[++i]);
      continue;
    }
    const alone = w.match(/^\d*(>>?|<)&?$|^&>>?$/);
    if (alone) {
      if (w.includes(">") && !w.endsWith("&") && out[i + 1]) words.writes.push(out[i + 1]);
      i++;
      continue;
    }
    const glued = w.match(/^\d*(>>?)(?!&)(\S+)$|^&>>?(\S+)$/);
    if (glued) {
      words.writes.push(glued[2] ?? glued[3]);
      continue;
    }
    if (/^\d*(>>?|<)&?\S/.test(w)) continue;
    words.push(w);
  }
  return words;
}
