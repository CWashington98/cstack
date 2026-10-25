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
  // A comment that starts right after an escaped character, as in x\ #', is
  // where the readers disagree: segments() reads the rest of the line as part
  // of the word, so a quote in it opens a quote, while this reader skips it. If
  // that rest holds a quote or a backtick, the guard can't tell what follows,
  // so the command is refused. `escaped` is where such a # would be.
  let escaped = -1;
  let disputed = false;
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
      if (cmd[i + 1] !== "\n") escaped = i + 2;
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
    // See the note above segments(): this reader leans toward "comment".
    else if (c === "#" && (i === 0 || /[ \t\n;&|()<>]/.test(cmd[i - 1]))) {
      const end = cmd.indexOf("\n", i);
      if (i === escaped && /["'`]/.test(cmd.slice(i, end === -1 ? cmd.length : end))) disputed = true;
      return end === -1 ? cmd.length : end;
    } else if (c === "(" && cmd[i + 1] === "(" && !top.brace) {
      stack.push({ quote: null, depth: 2, tick: false, arith: true });
      return i + 2;
    } else if (top.brace && c === "}") stack.pop();
    else if (stack.length > 1 && !top.tick && !top.brace && c === "(") top.depth++;
    else if (stack.length > 1 && !top.tick && !top.brace && c === ")" && --top.depth === 0) stack.pop();
    return i + 1;
  };
  const tagAt = (j) => {
    const top = stack[stack.length - 1];
    return top.quote || top.brace || top.arith ? null : heredocTag(cmd, j, top.tick);
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
  return { text: text + cmd.slice(from), heredocs, live, incomplete, unterminated, disputed };
}

// The tag after a << at i: its text, whether any of it was quoted (which makes
// the body plain text), and where it ends. Null when i starts no heredoc. The
// tag ends where the shell ends a word: at a space, tab, newline or one of
// < > | ; & ( ). Other characters, such as a carriage return, a no-break space
// or a backtick, are part of it, as they are for the shell. Inside a backtick
// pair, a backtick ends it too, which can only make it shorter than the
// shell's, so the body ends early and the lines after it are checked.
function heredocTag(cmd, i, inTick = false) {
  if (!cmd.startsWith("<<", i) || cmd[i + 2] === "<" || /[<)]/.test(cmd[i - 1] ?? "") || cmd.startsWith("<<HEREDOC __HEREDOC_", i)) return null;
  let j = i + 2;
  const dash = cmd[j] === "-";
  if (dash) j++;
  while (cmd[j] === " " || cmd[j] === "\t") j++;
  let tag = "";
  let quoted = false;
  while (j < cmd.length && !/[ \t\n<>|;&()]/.test(cmd[j]) && !(inTick && cmd[j] === "`")) {
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

// The index just past the ) that closes the $( starting at i. When the pair
// never closes, this returns s.length + 1: a caller that drops the closing )
// still keeps every character, and substitutions() marks its result unclosed.
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
  return s.length + 1;
}

// The text inside every $( ) and backtick pair outside single quotes. These run
// as commands of their own, even inside double quotes. In a heredoc's body,
// quotes are plain text, so pass { quotes: false }. When a $( ) pair never
// closes, often because a quote in a comment inside it opened a quote the
// shell doesn't see, the result has `unclosed` set: the guard can't tell where
// the commands after it start.
export function substitutions(cmd, { quotes = true } = {}) {
  const out = [];
  out.unclosed = false;
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
      if (end > cmd.length) out.unclosed = true;
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

// The first character outside quotes that a shell may read differently from
// the guard, or null. The shell's blanks are only space, tab and newline, so
// any other control character or space, such as a carriage return, a vertical
// tab, a no-break space, a line separator or a byte-order mark, can sit
// inside a word for the shell where a reader would see a break, or the other
// way round. Pass text whose heredoc bodies are already taken out.
const ODD = /[\p{Cc}\p{Cf}\p{Zs}\p{Zl}\p{Zp}]/u;
export function oddCharacter(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      continue;
    }
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote.at(-1)) quote = null;
      continue;
    }
    if (c === "\\") i++;
    else if (c === "$" && text[i + 1] === "'") {
      quote = "$'";
      i++;
      continue;
    } else if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    const ch = String.fromCodePoint(text.codePointAt(i) ?? 0);
    if (i < text.length && ch !== " " && ch !== "\t" && ch !== "\n" && ODD.test(ch)) return ch;
    if (ch.length > 1) i++;
  }
  return null;
}

// Where a comment starts, the two readers lean opposite ways, each toward
// checking more. extractHeredocs() decides what is hidden as a heredoc's
// body, so it leans toward "comment": a # after a blank or an operator starts
// one, even right after an escaped character, and a << in a comment starts no
// heredoc. segments() decides what is dropped as a comment, so it leans toward
// "not a comment": a # right after an escaped character, as in x\ #, is part
// of the word. Wherever extractHeredocs() finds a heredoc, segments() sees no
// comment either, so a heredoc can't hide commands that a comment rule skipped.
// The shell's own reading can differ from both, for example inside backticks,
// where it turns \\ into \ before it reads the commands.

// Splits a line into the separate commands it runs: on ; & && || | newlines
// and parentheses, outside quotes. A $( ) or backtick pair stays inside the
// command it belongs to.
export function segments(cmd) {
  const out = [];
  let cur = "";
  let quote = null;
  // Where cur ended after its last escaped character. A # right after an
  // escaped character, as in x\ #, is part of the word, so it starts no
  // comment: this reader leans toward "not a comment" (see the note above).
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
    // As in extractHeredocs(), a # starts a comment only after a space, tab or
    // newline, after one of ; & | ( ) < >, or at the start.
    if (c === "#" && (cur === "" || (/[ \t\n<>&]$/.test(cur) && escapedEnd !== cur.length))) {
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
    if (c === " " || c === "\t" || c === "\n") {
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

// Reads an env file the way the programs that load one do, such as dotenvx,
// node --env-file and bun --env-file. Their comment rules are not the shell's:
// after an unquoted value, a # starts a comment even in the middle of a word,
// so KEY=a#b is a. A # line is a comment, and so is the rest of a line after a
// closed quote. Loaders disagree on some lines, so this returns two readings,
// each wrong only in the safe direction:
//   live  the KEY=value lines every loader reads as values, with their
//         comments removed. A deploy target counts only when it is here, so a
//         line some loader reads as a comment never allows a deploy.
//   kept  every line except the comments `skips` says this loader skips. A
//         "never" entry counts when it is here, so a line the loader may read
//         as a value is never dropped.
// `skips` is what the loader is known to skip, or null for a loader the guard
// hasn't checked, which keeps the whole file:
//   inline    the comment after a value
//   indented  a # line that starts after spaces or tabs, not only one that
//             starts in the first column
// A quote that doesn't close on its line may run on over later lines, and
// loaders disagree on where it ends and what follows it. From that line on,
// nothing more is live and every line is kept.
export function envFile(text, skips) {
  const live = [];
  const kept = [];
  let open = false;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (open) {
      kept.push(line);
      continue;
    }
    const value = envValue(line);
    if (value) live.push(value.text);
    if (skips && /^#/.test(skips.indented ? line.trimStart() : line)) continue;
    kept.push(skips?.inline && value ? value.text : line);
    // Some loaders read an indented # line as a variable, so its quotes count too.
    if (!value && !line.startsWith("#") && /["'`]/.test(line)) open = true;
  }
  return { live: live.join("\n"), kept: kept.join("\n") };
}

// KEY=value with its comment and quotes removed, when every loader reads the
// line the same way, or null. A quoted value counts only when it closes on its
// line with no backslash in it and nothing but a comment after it.
function envValue(line) {
  const m = line.match(/^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/);
  if (!m) return null;
  const [, key, rest] = m;
  const q = rest[0];
  if (q !== '"' && q !== "'" && q !== "`") return { text: `${key}=${rest.split("#")[0].trim()}` };
  const end = rest.indexOf(q, 1);
  if (end === -1 || rest.slice(0, end).includes("\\") || !/^\s*(#.*)?$/.test(rest.slice(end + 1))) return null;
  return { text: `${key}=${rest.slice(1, end)}` };
}
