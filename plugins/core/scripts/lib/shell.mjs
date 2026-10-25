// Reads a shell command the way the guard needs: split into the commands it
// runs, each split into words. It follows quotes, heredocs, $( ) and backticks.
// It is not a full shell parser. It aims to see every command a person would
// see when reading the line, and to err toward seeing too much.

// Pulls heredoc bodies out of the text so their lines aren't read as commands
// of the outer shell. Each body is replaced by a marker the caller can look up.
// A heredoc whose tag has no quotes is "live": the shell runs the $( ) and
// backtick commands in its body, so the caller checks them; those keys are in
// `live`. A << inside quotes is text, not a heredoc, unless it sits in a $( )
// or backtick pair, as in git commit -m "$(cat <<'EOF' ... )". A heredoc whose
// $( ) or backtick pair closes on its own first line has no body: the shell
// runs the lines after it as commands, so they stay in the text.
let heredocCount = 0;
export function extractHeredocs(cmd) {
  const heredocs = new Map();
  const live = new Set();
  // A << in arithmetic, (( )) or $(( )), or in a ${ } pattern is a shift or
  // text, not a heredoc, so those get a frame of their own.
  const stack = [{ quote: null, depth: 0, tick: false }];
  let incomplete = false;
  let unterminated = false;
  // A # right after an escaped character, or right after the ) that closes a
  // $( ) or $(( )) pair, is inside a word, so it starts no comment. This is
  // where such a # would be.
  let glued = -1;
  // Moves past the character at i, keeping track of quotes (including $'...'),
  // comments, $( ) pairs and backtick pairs.
  const step = (i) => {
    const top = stack[stack.length - 1];
    const c = cmd[i];
    if (top.quote === "'") {
      if (c === "'") top.quote = null;
      return i + 1;
    }
    if (c === "\\") {
      glued = i + 2;
      return i + 2;
    }
    if (top.quote === "$'") {
      if (c === "'") top.quote = null;
      return i + 1;
    }
    if (c === "$" && cmd[i + 1] === "(" && cmd[i + 2] === "(") {
      stack.push({ quote: null, depth: 2, tick: false, arith: true });
      return i + 3;
    }
    if (c === "$" && cmd[i + 1] === "(") {
      stack.push({ quote: null, depth: 1, tick: false });
      return i + 2;
    }
    if (c === "$" && cmd[i + 1] === "{") {
      stack.push({ quote: null, depth: 0, tick: false, brace: true });
      return i + 2;
    }
    if (c === "`") {
      if (top.tick && !top.quote) stack.pop();
      else stack.push({ quote: null, depth: 0, tick: true });
      return i + 1;
    }
    if (top.quote === '"') {
      if (c === '"') top.quote = null;
      return i + 1;
    }
    if (c === "$" && cmd[i + 1] === "'") {
      top.quote = "$'";
      return i + 2;
    }
    if (c === "'" || c === '"') top.quote = c;
    else if (c === "#" && i !== glued && (i === 0 || /[\s;&|()]/.test(cmd[i - 1]))) {
      const end = cmd.indexOf("\n", i);
      return end === -1 ? cmd.length : end;
    } else if (c === "(" && cmd[i + 1] === "(" && !top.brace) {
      stack.push({ quote: null, depth: 2, tick: false, arith: true });
      return i + 2;
    } else if (top.brace && c === "}") stack.pop();
    else if (stack.length > 1 && !top.tick && !top.brace && c === "(") top.depth++;
    else if (stack.length > 1 && !top.tick && !top.brace && c === ")" && --top.depth === 0) {
      stack.pop();
      glued = i + 1;
    }
    return i + 1;
  };
  const tagAt = (j) => {
    const top = stack[stack.length - 1];
    return top.quote || top.brace || top.arith ? null : heredocTag(cmd, j);
  };
  let text = "";
  let from = 0;
  let i = 0;
  while (i < cmd.length) {
    let op = tagAt(i);
    if (op) {
      // Read the rest of the line. It can hold more heredocs, whose bodies
      // follow one after another, and quotes or pairs it opens or closes.
      const saved = stack.map((x) => ({ ...x }));
      const level = stack.length;
      const tags = [];
      let line = "";
      let closed = false;
      let j = i;
      while (op || (j < cmd.length && cmd[j] !== "\n")) {
        if (op) {
          const key = `__HEREDOC_${heredocCount++}__`;
          tags.push({ ...op, key });
          line += ` <<HEREDOC ${key}`;
          j = op.end;
        } else {
          const next = step(j);
          line += cmd.slice(j, next);
          j = next;
          if (stack.length < level) closed = true;
        }
        op = j < cmd.length && cmd[j] !== "\n" ? tagAt(j) : null;
      }
      if (!closed && j < cmd.length) {
        let pos = j + 1;
        for (const t of tags) {
          let end = -1;
          let k = pos;
          while (k <= cmd.length) {
            const nl = cmd.indexOf("\n", k);
            const stop = nl === -1 ? cmd.length : nl;
            const row = cmd.slice(k, stop);
            if ((t.dash ? row.replace(/^\t+/, "") : row) === t.tag) {
              end = k;
              break;
            }
            if (nl === -1) break;
            k = nl + 1;
          }
          if (end === -1) unterminated = true;
          heredocs.set(t.key, end === -1 ? cmd.slice(pos) : cmd.slice(pos, Math.max(pos, end - 1)));
          if (!t.quoted) live.add(t.key);
          pos = end === -1 ? cmd.length + 1 : (cmd.indexOf("\n", end) === -1 ? cmd.length : cmd.indexOf("\n", end)) + 1;
        }
        text += cmd.slice(from, i) + line;
        from = i = Math.min(pos - 1, cmd.length);
        continue;
      }
      // A << with no body after it: the shell would wait for one.
      if (!closed) unterminated = true;
      stack.splice(0, stack.length, ...saved);
    }
    i = step(i);
  }
  // A valid command never ends inside a quote, a $( ) pair or a heredoc.
  if (stack.length > 1 || stack[0].quote) incomplete = true;
  return { text: text + cmd.slice(from), heredocs, live, incomplete, unterminated };
}

// The tag after a << at i: its text, whether any of it was quoted (which makes
// the body plain text), and where it ends. Null when i starts no heredoc.
function heredocTag(cmd, i) {
  if (!cmd.startsWith("<<", i) || cmd[i + 2] === "<" || /[<)]/.test(cmd[i - 1] ?? "") || cmd.startsWith("<<HEREDOC __HEREDOC_", i)) return null;
  let j = i + 2;
  const dash = cmd[j] === "-";
  if (dash) j++;
  while (cmd[j] === " " || cmd[j] === "\t") j++;
  let tag = "";
  let quoted = false;
  while (j < cmd.length && !/[\s<>|;&()`]/.test(cmd[j])) {
    const c = cmd[j];
    if (c === "$" && cmd[j + 1] === "'") {
      let k = j + 2;
      let text = "";
      while (k < cmd.length && cmd[k] !== "'") {
        if (cmd[k] === "\\") k++;
        text += cmd[k] ?? "";
        k++;
      }
      if (k >= cmd.length || text.includes("\n")) return null;
      tag += text;
      quoted = true;
      j = k + 1;
    } else if (c === "$" && cmd[j + 1] === '"') {
      j++;
    } else if (c === "'" || c === '"') {
      const close = cmd.indexOf(c, j + 1);
      if (close === -1 || cmd.slice(j + 1, close).includes("\n")) return null;
      tag += cmd.slice(j + 1, close);
      quoted = true;
      j = close + 1;
    } else if (c === "\\") {
      tag += cmd[j + 1] ?? "";
      quoted = true;
      j += 2;
    } else tag += cmd[j++];
  }
  return tag ? { tag, quoted, dash, end: j } : null;
}

// The index just past the ) that closes the $( starting at i.
function closeSubst(s, i) {
  let depth = 0;
  let quote = null;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (quote) {
      if (c === "\\" && quote !== "'") j++;
      else if (c === quote.at(-1)) quote = null;
      continue;
    }
    if (c === "\\") j++;
    else if (c === "$" && s[j + 1] === "'") quote = "$'", j++;
    else if (c === "'" || c === '"') quote = c;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return j + 1;
  }
  return s.length;
}

// The text inside every $( ) and backtick pair outside single quotes. These run
// as commands of their own, even inside double quotes. In a heredoc's body,
// quotes are plain text, so pass { quotes: false }.
export function substitutions(cmd, { quotes = true } = {}) {
  const out = [];
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote === "'" || quote === "$'") {
      if (c === "\\" && quote === "$'") i++;
      else if (c === "'") quote = null;
      continue;
    }
    if (c === "\\") {
      i++;
      continue;
    }
    if (!quotes) {
      // Quotes don't start or end anything here.
    } else if (c === "$" && cmd[i + 1] === "'" && !quote) {
      quote = "$'";
      i++;
    } else if (c === "'" && !quote) quote = "'";
    else if (c === '"') quote = quote === '"' ? null : '"';
    if (c === "$" && cmd[i + 1] === "(" && cmd[i + 2] !== "(") {
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
  // Where cur ended after its last escaped character. An escaped space is part
  // of a word, so a # after it starts no comment.
  let escapedEnd = -1;
  const flush = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = "";
    escapedEnd = -1;
  };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (c === "$" && cmd[i + 1] === "(" && quote !== "'" && quote !== "$'") {
      const end = closeSubst(cmd, i + 1);
      cur += cmd.slice(i, end);
      i = end - 1;
      continue;
    }
    if (c === "`" && quote !== "'" && quote !== "$'") {
      const end = cmd.indexOf("`", i + 1);
      const stop = end === -1 ? cmd.length : end + 1;
      cur += cmd.slice(i, stop);
      i = stop - 1;
      continue;
    }
    if (quote) {
      cur += c;
      if (c === "\\" && quote !== "'" && i + 1 < cmd.length) cur += cmd[++i];
      else if (c === quote.at(-1)) quote = null;
      continue;
    }
    if (c === "\\" && i + 1 < cmd.length) {
      if (cmd[i + 1] === "\n") i++;
      else {
        cur += c + cmd[++i];
        escapedEnd = cur.length;
      }
      continue;
    }
    if (c === "$" && cmd[i + 1] === "'") {
      quote = "$'";
      cur += cmd[i] + cmd[++i];
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      cur += c;
      continue;
    }
    if (c === "#" && (cur === "" || (/\s$/.test(cur) && escapedEnd !== cur.length))) {
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
// the files written with > or >> are kept in words.writes, and those written
// with >> also in words.appends.
export function tokenize(segment) {
  const out = [];
  let cur = "";
  let quote = null;
  let started = false;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (c === "$" && segment[i + 1] === "(" && quote !== "'" && quote !== "$'") {
      const end = closeSubst(segment, i + 1);
      cur += segment.slice(i, end);
      started = true;
      i = end - 1;
      continue;
    }
    if (quote) {
      if (c === "\\" && quote !== "'" && i + 1 < segment.length) cur += segment[++i];
      else if (c === quote.at(-1)) quote = null;
      else cur += c;
      continue;
    }
    if (c === "\\" && i + 1 < segment.length) {
      cur += segment[++i];
      started = true;
      continue;
    }
    if (c === "$" && segment[i + 1] === "'") {
      quote = "$'";
      started = true;
      i++;
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
  words.appends = new Set();
  for (let i = 0; i < out.length; i++) {
    const w = out[i];
    if (w === "<<HEREDOC") {
      words.push(w, out[++i]);
      continue;
    }
    const alone = w.match(/^\d*(>>?|<)&?$|^&>>?$/);
    if (alone) {
      if (w.includes(">") && !w.endsWith("&") && out[i + 1]) {
        words.writes.push(out[i + 1]);
        if (w.includes(">>")) words.appends.add(out[i + 1]);
      }
      i++;
      continue;
    }
    const glued = w.match(/^\d*(>>?)(?!&)(\S+)$|^&>>?(\S+)$/);
    if (glued) {
      words.writes.push(glued[2] ?? glued[3]);
      if (w.includes(">>")) words.appends.add(glued[2] ?? glued[3]);
      continue;
    }
    if (/^\d*(>>?|<)&?\S/.test(w)) continue;
    words.push(w);
  }
  return words;
}
