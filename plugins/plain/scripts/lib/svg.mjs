// A small reader for the subset of SVG (Scalable Vector Graphics) the
// diagram checker allows. It turns markup into a tree of elements, each
// with its attributes and the line it starts on. The subset is described
// in skills/to-diagram/svg-subset.md.

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
    return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!doctype[^>]*>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/iy;
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export class SvgReadError extends Error {
  constructor(message, line) {
    super(message);
    this.line = line;
  }
}

// Reads `source` and returns the root element. `firstLine` is the line
// number of the first character, for markup taken from inside a page.
export function readSvg(source, firstLine = 1) {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") lineStarts.push(i + 1);
  const lineAt = (offset) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return firstLine + lo;
  };

  const top = { tag: "#document", attrs: {}, children: [], line: firstLine };
  const stack = [top];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < source.length) {
    const at = TOKEN.lastIndex;
    const m = TOKEN.exec(source);
    if (!m) throw new SvgReadError("This markup can't be read here. Check for a stray < or an attribute without quotes.", lineAt(at));
    const parent = stack[stack.length - 1];
    const [, cdata, closing, opening, attrText, selfClose, text] = m;
    if (text !== undefined || cdata !== undefined) {
      parent.children.push({ text: cdata ?? decode(text), line: lineAt(at) });
    } else if (closing) {
      if (parent.tag !== closing) {
        throw new SvgReadError(`</${closing}> closes an element that isn't open${parent.tag === "#document" ? "" : ` (<${parent.tag}> on line ${parent.line} is still open)`}.`, lineAt(at));
      }
      stack.pop();
    } else if (opening) {
      const attrs = {};
      for (const a of attrText.matchAll(ATTR)) attrs[a[1]] = decode(a[2] ?? a[3]);
      const node = { tag: opening, attrs, children: [], line: lineAt(at), parent };
      parent.children.push(node);
      if (!selfClose) stack.push(node);
    }
  }
  if (stack.length > 1) {
    const open = stack[stack.length - 1];
    throw new SvgReadError(`<${open.tag}> is never closed.`, open.line);
  }
  const root = top.children.find((c) => c.tag?.toLowerCase() === "svg");
  if (!root) throw new SvgReadError("There is no <svg> element.", firstLine);
  return root;
}

export const textOf = (node) => (node.text !== undefined ? node.text : node.children.map(textOf).join(""));

// Style properties come from attributes or from a style="" attribute; the
// style attribute wins, as in a browser.
export function ownStyle(node) {
  const out = { ...node.attrs };
  for (const decl of (node.attrs.style ?? "").split(";")) {
    const i = decl.indexOf(":");
    if (i > 0) out[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim();
  }
  return out;
}

export const num = (v, fallback = 0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

export function points(list) {
  const nums = (list ?? "").match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
  const out = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

// The end point of every path command, in absolute numbers. Curves are
// reduced to their end points, which is close enough to find what sits
// behind a line and where an arrow ends.
export function pathPoints(d) {
  const toks = (d ?? "").match(/[a-df-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const SKIP = { C: 4, S: 2, Q: 2, T: 0, A: 5, L: 0, M: 0 };
  const out = [];
  let i = 0;
  let cmd = null;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  const next = () => Number(toks[i++]);
  while (i < toks.length) {
    if (/[a-z]/i.test(toks[i])) cmd = toks[i++];
    if (!cmd) break;
    const C = cmd.toUpperCase();
    const rel = cmd !== C;
    if (C === "Z") {
      x = sx;
      y = sy;
      out.push([x, y]);
      cmd = null;
      continue;
    }
    if (C === "H") x = (rel ? x : 0) + next();
    else if (C === "V") y = (rel ? y : 0) + next();
    else {
      i += SKIP[C] ?? 0;
      const nx = next();
      const ny = next();
      x = (rel ? x : 0) + nx;
      y = (rel ? y : 0) + ny;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) break;
    if (C === "M") {
      sx = x;
      sy = y;
      cmd = rel ? "l" : "L";
    }
    out.push([x, y]);
  }
  return out;
}

// Every point that bounds a path: end points, curve control points, and for
// arcs the start and end points widened by the larger radius. The box around
// these always contains the drawn path.
export function pathExtent(d) {
  const toks = (d ?? "").match(/[a-df-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const out = [];
  let i = 0;
  let cmd = null;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  const next = () => Number(toks[i++]);
  const pt = (rel) => {
    const px = (rel ? x : 0) + next();
    const py = (rel ? y : 0) + next();
    return [px, py];
  };
  while (i < toks.length) {
    if (/[a-z]/i.test(toks[i])) cmd = toks[i++];
    if (!cmd) break;
    const C = cmd.toUpperCase();
    const rel = cmd !== C;
    let end;
    if (C === "Z") {
      [x, y] = [sx, sy];
      cmd = null;
      continue;
    } else if (C === "H") end = [(rel ? x : 0) + next(), y];
    else if (C === "V") end = [x, (rel ? y : 0) + next()];
    else if (C === "C") {
      out.push(pt(rel), pt(rel));
      end = pt(rel);
    } else if (C === "S" || C === "Q") {
      out.push(pt(rel));
      end = pt(rel);
    } else if (C === "A") {
      const r = Math.max(Math.abs(next()), Math.abs(next()));
      i += 3;
      end = pt(rel);
      for (const [px, py] of [[x, y], end]) out.push([px - r, py - r], [px + r, py + r]);
    } else end = pt(rel);
    if (!end.every(Number.isFinite)) break;
    [x, y] = end;
    if (C === "M") {
      [sx, sy] = end;
      cmd = rel ? "l" : "L";
    }
    out.push(end);
  }
  return out.filter((p) => p.every(Number.isFinite));
}
