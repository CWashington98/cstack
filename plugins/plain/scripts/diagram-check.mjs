#!/usr/bin/env node
// Checks a diagram against the to-diagram rules: dark background, palette
// colors only, readable contrast, readable sizes, a title and description
// for screen readers, and plain-English labels.
// Usage: node diagram-check.mjs <file.svg|file.html> [--json].
// Exit 0 passes, 1 held, 2 for a missing file or a page with no diagram.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "./lib/config.mjs";
import { prepare } from "./lib/text.mjs";
import { checkText } from "./lib/rules.mjs";
import { parseColor, contrast, blend, nearestColor } from "./lib/color.mjs";
import { readSvg, SvgReadError, textOf, ownStyle, num, points, pathPoints } from "./lib/svg.mjs";
import { formatFindings } from "./plain-check.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const PALETTE_PATH = join(here, "..", "skills", "to-diagram", "palette.json");
export const loadPalette = () => JSON.parse(readFileSync(PALETTE_PATH, "utf8"));

export const LIMITS = { text: 4.5, graphic: 3, adviseWords: 6, holdWords: 12, boxes: 12 };
const INHERITED = ["fill", "stroke", "fill-opacity", "stroke-opacity", "stroke-width", "font-size", "font-weight", "color", "text-anchor", "dominant-baseline", "visibility"];
// Every element the checker can read. Anything else is held, because it could
// draw or change colors the checker never sees (animation, style sheets,
// embedded pictures, nested diagrams).
const ALLOWED = new Set(["svg", "title", "desc", "metadata", "defs", "marker", "g", "a", "rect", "circle", "ellipse", "line", "polyline", "polygon", "path", "text", "tspan"]);
const EFFECTS = ["filter", "mask", "clip-path", "mix-blend-mode"];
const NOT_PAINTED = new Set(["defs", "marker", "title", "desc", "metadata"]);
const SHAPES = new Set(["rect", "circle", "ellipse", "line", "polyline", "polygon", "path"]);
const short = (s, n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const words = (s) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const fmt = (r) => (Math.floor(r * 100) / 100).toFixed(2);
const isLegend = (node) => [node.attrs.id, node.attrs.class].some((v) => (v ?? "").split(/\s+/).includes("legend"));

// Opacity as a number from 0 to 1. Accepts "0.4" and "40%".
export function opacityOf(value, fallback = 1) {
  if (value === undefined) return fallback;
  const v = String(value).trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, v.endsWith("%") ? n / 100 : n));
}

// The segments a shape's edge is drawn along, for finding what is behind words.
function edges(item) {
  const g = item.geo;
  let pts;
  if (item.kind === "rect") pts = [[g.x, g.y], [g.x + g.w, g.y], [g.x + g.w, g.y + g.h], [g.x, g.y + g.h], [g.x, g.y]];
  else if (item.kind === "circle" || item.kind === "ellipse") {
    pts = Array.from({ length: 33 }, (_, k) => [g.cx + g.rx * Math.cos((k * Math.PI) / 16), g.cy + g.ry * Math.sin((k * Math.PI) / 16)]);
  } else pts = item.kind === "polygon" && g.pts.length ? [...g.pts, g.pts[0]] : g.pts;
  return pts.slice(1).map((p, k) => [pts[k], p]);
}

function nearSegment([[x1, y1], [x2, y2]], x, y, reach) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len)) : 0;
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) <= reach;
}

// How much of the canvas a shape covers, from 0 to 1.
function coverage(item, canvas) {
  const b = bounds(item);
  const w = Math.max(0, Math.min(b.x + b.w, canvas.x + canvas.w) - Math.max(b.x, canvas.x));
  const h = Math.max(0, Math.min(b.y + b.h, canvas.y + canvas.h) - Math.max(b.y, canvas.y));
  let area = w * h;
  if (item.kind === "circle" || item.kind === "ellipse") area *= Math.PI / 4;
  else if (item.kind !== "rect") {
    const p = item.geo.pts;
    const shoelace = Math.abs(p.reduce((sum, [x, y], k) => sum + x * p[(k + 1) % p.length][1] - p[(k + 1) % p.length][0] * y, 0)) / 2;
    area = Math.min(area, shoelace);
  }
  return area / (canvas.w * canvas.h);
}

// A length in pixels, or null for any other unit (percent, em and so on).
function pixels(value) {
  const m = String(value ?? "").trim().match(/^(-?[\d.]+)\s*(px)?$/i);
  return m ? parseFloat(m[1]) : null;
}

function fontSize(value, parent) {
  if (value === undefined) return parent;
  const m = String(value).trim().match(/^(-?[\d.]+)\s*(px|pt|em|rem|%)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = (m[2] ?? "px").toLowerCase();
  return { px: n, pt: (n * 4) / 3, em: n * parent, rem: n * 16, "%": (n / 100) * parent }[unit];
}

function translateOf(value) {
  if (value === undefined) return [0, 0];
  const parts = [...value.matchAll(/\s*translate\(\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+))?\s*\)\s*/g)];
  if (!parts.length || parts.map((p) => p[0]).join("").trim() !== value.trim()) return null;
  return parts.reduce(([x, y], p) => [x + parseFloat(p[1]), y + num(p[2])], [0, 0]);
}

function inPolygon(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function bounds(item) {
  const g = item.geo;
  if (item.kind === "rect") return { x: g.x, y: g.y, w: g.w, h: g.h };
  if (item.kind === "circle" || item.kind === "ellipse") return { x: g.cx - g.rx, y: g.cy - g.ry, w: 2 * g.rx, h: 2 * g.ry };
  const xs = g.pts.map((p) => p[0]);
  const ys = g.pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
const center = (item) => {
  const b = bounds(item);
  return [b.x + b.w / 2, b.y + b.h / 2];
};

function contains(item, x, y) {
  const g = item.geo;
  if (item.kind === "rect") return x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h;
  if (item.kind === "circle" || item.kind === "ellipse") return g.rx > 0 && g.ry > 0 && ((x - g.cx) / g.rx) ** 2 + ((y - g.cy) / g.ry) ** 2 <= 1;
  if (item.kind === "line" || g.pts.length < 3) return false;
  return inPolygon(g.pts, x, y);
}

function geometry(tag, a, dx, dy) {
  const shift = (pts) => pts.map(([x, y]) => [x + dx, y + dy]);
  switch (tag) {
    case "rect": {
      const full = (v, size) => (String(v).trim().endsWith("%") ? (num(v) / 100) * size : num(v));
      return { x: num(a.x) + dx, y: num(a.y) + dy, wRaw: a.width, hRaw: a.height, full, w: num(a.width), h: num(a.height) };
    }
    case "circle":
      return { cx: num(a.cx) + dx, cy: num(a.cy) + dy, rx: num(a.r), ry: num(a.r) };
    case "ellipse":
      return { cx: num(a.cx) + dx, cy: num(a.cy) + dy, rx: num(a.rx), ry: num(a.ry) };
    case "line":
      return { pts: shift([[num(a.x1), num(a.y1)], [num(a.x2), num(a.y2)]]) };
    case "polyline":
    case "polygon":
      return { pts: shift(points(a.points)) };
    default:
      return { pts: shift(pathPoints(a.d)) };
  }
}

export function checkSvg(source, config, palette, firstLine = 1, onPage = false) {
  const found = [];
  const add = (line, rule, level, text, message) => found.push({ line, rule, level, text, message });
  let root;
  try {
    root = readSvg(source, firstLine);
  } catch (error) {
    if (!(error instanceof SvgReadError)) throw error;
    add(error.line, "unreadable", "hold", "", `The diagram can't be read: ${error.message}`);
    return found;
  }

  const byHex = new Map(Object.entries(palette.colors).map(([name, c]) => [c.hex.toLowerCase(), { name, ...c }]));
  const bgHex = palette.colors.background.hex.toLowerCase();
  const nameOf = (hex) => (byHex.has(hex) ? `${byHex.get(hex).name} (${hex})` : `${hex}, a blend`);
  const nearest = (hex) => {
    const pick = nearestColor(hex, [...byHex.keys()]);
    return [pick, byHex.get(pick)];
  };

  // The canvas, and how much the picture is scaled when shown at its width.
  const vbNums = (root.attrs.viewBox ?? "").trim().split(/[\s,]+/).map(Number);
  const hasVb = vbNums.length === 4 && vbNums.every(Number.isFinite);
  const canvas = hasVb
    ? { x: vbNums[0], y: vbNums[1], w: vbNums[2], h: vbNums[3] }
    : { x: 0, y: 0, w: num(root.attrs.width, NaN), h: num(root.attrs.height, NaN) };
  if (!Number.isFinite(canvas.w) || !Number.isFinite(canvas.h)) add(root.line, "unreadable", "hold", "", 'The <svg> needs a viewBox, such as viewBox="0 0 960 540", so its size is known.');
  // A width or height on the <svg> (an attribute, or a style rule, which wins)
  // shrinks or grows everything, words included.
  const rootStyle = ownStyle(root);
  const shown = {};
  for (const side of ["width", "height"]) {
    const v = rootStyle[side];
    if (v === undefined || v === "auto") continue;
    const px = pixels(v);
    if (px === null || px <= 0) add(root.line, "canvas-size", "hold", v, `${side}="${v}" on the <svg> can't be checked. Give it in pixels or leave it out, so the checker knows how big the words show.`);
    else shown[side] = px;
  }
  const scales = hasVb ? [shown.width && shown.width / canvas.w, shown.height && shown.height / canvas.h].filter(Boolean) : [];
  const scale = scales.length ? Math.min(...scales) : 1;
  const width = shown.width ?? (shown.height ? `${shown.height} high` : "");

  // Title and description, as the first children of the <svg>.
  for (const tag of ["title", "desc"]) {
    const el = root.children.find((c) => c.tag === tag);
    if (!el || !textOf(el).trim()) {
      const what = tag === "title" ? "a <title> (a short name for the diagram)" : "a <desc> (one or two sentences saying what the diagram shows)";
      add(root.line, tag, "hold", "", `The diagram needs ${what}. Screen readers read it aloud in place of the picture.`);
    }
  }
  if (root.attrs.role !== "img" || !root.attrs["aria-labelledby"]) {
    add(root.line, "screen-reader", "advice", "", 'Add role="img" and aria-labelledby="<title id> <desc id>" to the <svg>, so screen readers announce the title and description.');
  }

  // Walk the tree in paint order. Colors are checked where they are written,
  // so a group's color is reported once, not once per child.
  const items = [];
  const markers = new Map();
  const reported = new Set();
  const unsupported = new Set();
  // `quiet` is true where a color is used rather than written, so a color
  // written once on a group is reported once. currentColor is reported where
  // it is used, because a child may set the color.
  const paint = (value, node, prop, style, quiet = false) => {
    if (value === undefined) return undefined;
    const v = String(value).trim();
    const lower = v.toLowerCase();
    if (lower === "currentcolor") {
      if (style.color !== undefined) return paint(style.color, node, "color", style, true);
      if (!quiet) return "bad";
      const key = `${node.line}:currentcolor`;
      if (!reported.has(key)) add(node.line, "palette", "hold", v, `${prop}="currentColor" takes the color setting, and none is set, so a page could make it any color. Use a palette hex code.`);
      reported.add(key);
      return "bad";
    }
    if (lower === "context-stroke" || lower === "context-fill") return lower;
    if (lower.startsWith("url(")) {
      if (!quiet && !reported.has(node)) add(node.line, "palette", "hold", v, `${prop}="${v}" points at a gradient or pattern. Use one flat palette color.`);
      reported.add(node);
      return "bad";
    }
    const c = parseColor(v);
    if (c === "none") return null;
    if (!c || !byHex.has(c.hex)) {
      const key = `${node.line}:${prop}:${v}`;
      if (!quiet && !reported.has(key)) {
        reported.add(key);
        const near = c ? nearest(c.hex) : null;
        const tip = near ? ` The nearest palette color is ${near[1].name} (${near[0]}).` : " Write it as a palette hex code.";
        add(node.line, "palette", "hold", v, `${prop} "${v}" isn't in the palette.${tip}`);
      }
      return "bad";
    }
    return c;
  };
  const walk = (node, inherited, ctx) => {
    if (node.text !== undefined) return;
    const tag = node.tag.toLowerCase();
    const s = ownStyle(node);
    if (!ALLOWED.has(tag) || (tag === "svg" && node !== root)) {
      if (!unsupported.has(tag)) add(node.line, "unsupported", "hold", tag, `<${node.tag}> isn't supported. The checker can't see what it draws or changes, so it can't prove the colors or sizes. The to-diagram skill's svg-subset.md lists what is allowed.`);
      unsupported.add(tag);
      return;
    }
    for (const effect of EFFECTS) {
      if (s[effect] !== undefined && s[effect] !== "none") add(node.line, "unsupported", "hold", effect, `${effect} isn't supported. It changes how things look in ways the checker can't measure.`);
    }
    const style = { ...inherited };
    for (const k of INHERITED) if (s[k] !== undefined) style[k] = s[k];
    for (const prop of ["fill", "stroke", "color"]) if (s[prop] !== undefined) paint(s[prop], node, prop, style);
    if (s.display === "none") return;
    let shift = translateOf(s.transform);
    if (!shift) {
      add(node.line, "unsupported", "hold", s.transform, `transform="${s.transform}" isn't supported. Place things with x and y, or move a group with translate(x, y) only. The rest is checked as if it weren't moved.`);
      shift = [0, 0];
    }
    const size = fontSize(s["font-size"], ctx.size);
    if (size === null) add(node.line, "font-size", "hold", s["font-size"], `font-size "${s["font-size"]}" can't be read. Write it in pixels, such as font-size="16".`);
    const legend = ctx.legend || (tag === "g" && isLegend(node));
    const next = { ...ctx, dx: ctx.dx + shift[0], dy: ctx.dy + shift[1], opacity: ctx.opacity * opacityOf(s.opacity), size: size ?? ctx.size, sizeSet: ctx.sizeSet || (s["font-size"] !== undefined && size !== null), legend };
    if (tag === "marker" && node.attrs.id) markers.set(node.attrs.id, node);
    if (NOT_PAINTED.has(tag) || ctx.defs) {
      for (const c of node.children) walk(c, style, { ...next, defs: true });
      return;
    }
    const hidden = style.visibility === "hidden" || next.opacity === 0;
    const alphaOf = (c, prop) => (c && typeof c === "object" ? c.alpha * opacityOf(style[`${prop}-opacity`]) * next.opacity : 0);
    if (SHAPES.has(tag) && !hidden) {
      let fill = style.fill === undefined ? { hex: "#000000", alpha: 1, unset: true } : paint(style.fill, node, "fill", style, true);
      if (fill?.unset && (tag === "line" || tag === "polyline")) fill = null;
      if (fill?.unset) add(node.line, "palette", "hold", tag, `This <${tag}> has no fill, so it draws black. Set fill to a palette color or to "none".`);
      const stroke = paint(style.stroke, node, "stroke", style, true);
      const item = { type: "shape", kind: tag, node, line: node.line, legend, geo: geometry(tag, node.attrs, next.dx, next.dy) };
      if (tag === "rect") {
        item.geo.w = item.geo.full(item.geo.wRaw, canvas.w);
        item.geo.h = item.geo.full(item.geo.hRaw, canvas.h);
      }
      item.fill = fill && typeof fill === "object" && !fill.unset ? { hex: fill.hex, alpha: alphaOf(fill, "fill") } : null;
      item.strokeWidth = num(style["stroke-width"], 1);
      item.stroke = stroke && typeof stroke === "object" && item.strokeWidth > 0 ? { hex: stroke.hex, alpha: alphaOf(stroke, "stroke") } : null;
      item.markers = ["marker-start", "marker-mid", "marker-end", "marker"].map((k) => s[k]?.match(/url\(\s*#([^)\s]+)\s*\)/)?.[1]).filter(Boolean);
      items.push(item);
    } else if (tag === "text" && !hidden) {
      items.push(textItem(node, style, next));
      return;
    }
    for (const c of node.children) walk(c, style, next);
  };

  // Words become runs: one per stretch of text with its own color, opacity
  // and size, so a faint tspan can't hide behind its neighbors. Runs on one
  // line share the line's position and width, and each run is measured
  // against the whole line.
  const textItem = (node, style, ctx) => {
    const runs = [];
    let x = num(node.attrs.x) + ctx.dx;
    let y = num(node.attrs.y) + ctx.dy;
    let line = 0;
    let current = null;
    const visit = (el, st, opacity, size, sizeSet) => {
      for (const child of el.children) {
        if (child.text !== undefined) {
          if (!child.text.trim()) {
            if (current) current.text += " ";
            continue;
          }
          if (!current) {
            current = { x, y, line, style: st, opacity, size, sizeSet, node: el, text: "" };
            runs.push(current);
          }
          current.text += child.text;
        } else if (child.tag === "tspan") {
          const s = ownStyle(child);
          const st2 = { ...st };
          for (const k of INHERITED) if (s[k] !== undefined) st2[k] = s[k];
          for (const prop of ["fill", "stroke", "color"]) if (s[prop] !== undefined) paint(s[prop], child, prop, st2);
          const size2 = fontSize(s["font-size"], size);
          if (size2 === null) add(child.line, "font-size", "hold", s["font-size"], `font-size "${s["font-size"]}" can't be read. Write it in pixels, such as font-size="16".`);
          const moves = ["x", "y", "dx", "dy"].some((k) => child.attrs[k] !== undefined);
          if (child.attrs.x !== undefined) x = num(child.attrs.x) + ctx.dx;
          if (child.attrs.y !== undefined) y = num(child.attrs.y) + ctx.dy;
          const delta = (v) => (String(v ?? "").trim().endsWith("em") ? num(v) * (size2 ?? size) : num(v));
          x += delta(child.attrs.dx);
          y += delta(child.attrs.dy);
          if (moves) line++;
          current = null;
          visit(child, st2, opacity * opacityOf(s.opacity), size2 ?? size, sizeSet || s["font-size"] !== undefined);
          current = null;
        } else if (child.tag) {
          walk(child, st, ctx);
        }
      }
    };
    visit(node, style, ctx.opacity, ctx.size, ctx.sizeSet);
    const kept = runs.filter((r) => (r.text = r.text.replace(/\s+/g, " ")).trim());
    for (const r of kept) {
      const fill = r.style.fill === undefined ? null : paint(r.style.fill, r.node, "fill", r.style, true);
      if (r.style.fill === undefined && !reported.has(node)) {
        reported.add(node);
        add(node.line, "palette", "hold", r.text.trim(), `Words "${short(r.text.trim())}" have no fill, so they draw black. Set fill to text (${palette.colors.text.hex}).`);
      }
      const outlined = (r.style.stroke !== undefined && parseColor(r.style.stroke) !== "none") || (fill === null && r.style.fill !== undefined);
      if (outlined && !reported.has(`${node.line}:outline`)) {
        reported.add(`${node.line}:outline`);
        add(node.line, "text-outline", "hold", r.text.trim(), `Words "${short(r.text.trim())}" are drawn as outlines. Give words a solid palette fill and no stroke, so the checker can measure them.`);
      }
      r.fill = fill && typeof fill === "object" ? { hex: fill.hex, alpha: fill.alpha * opacityOf(r.style["fill-opacity"]) * r.opacity } : null;
      r.bold = /^(bold|bolder|[6-9]00)$/.test(String(r.style["font-weight"] ?? ""));
    }
    const lines = new Map();
    for (const r of kept) {
      if (!lines.has(r.line)) lines.set(r.line, []);
      lines.get(r.line).push(r);
    }
    for (const group of lines.values()) {
      const head = group[0];
      const text = group.map((r) => r.text).join("").trim();
      const w = group.reduce((sum, r, k) => sum + (k === 0 ? r.text.trimStart() : k === group.length - 1 ? r.text.trimEnd() : r.text).length * r.size * (r.bold ? 0.6 : 0.55), 0);
      const anchor = head.style["text-anchor"] ?? "start";
      const left = anchor === "middle" ? head.x - w / 2 : anchor === "end" ? head.x - w : head.x;
      const mid = /^(middle|central)$/.test(head.style["dominant-baseline"] ?? "") ? head.y : head.y - 0.35 * head.size;
      for (const r of group) Object.assign(r, { left, right: left + w, mid, lineText: text });
    }
    for (const r of kept) r.text = r.text.trim();
    return { type: "text", node, line: node.line, legend: ctx.legend, runs: kept, label: textOf(node).replace(/\s+/g, " ").trim() };
  };

  walk(root, {}, { dx: 0, dy: 0, opacity: 1, size: 16, sizeSet: false, legend: false, defs: false });

  // What color shows at a point, from everything painted before `before`:
  // fills that cover the point and, for words, edges and lines drawn across
  // it. Lines and marks are measured against fills only, because a line that
  // meets a box edge or another line is a join, not a background. `top` is the
  // last filled shape under the point, the box the point sits in.
  for (const it of items) if (it.type === "shape" && it.stroke) it.edges = edges(it);
  const colorAt = (x, y, before, strokes = false) => {
    let c = bgHex;
    let top = null;
    for (let i = 0; i < before; i++) {
      const it = items[i];
      if (it.type !== "shape") continue;
      if (it.fill && contains(it, x, y)) {
        c = blend(it.fill.hex, it.fill.alpha, c);
        top = it;
      }
      if (strokes && it.stroke && it.edges.some((e) => nearSegment(e, x, y, it.strokeWidth / 2))) c = blend(it.stroke.hex, it.stroke.alpha, c);
    }
    return { hex: c, top };
  };

  // The background: the first shape, a rect of the background color over the whole canvas.
  const first = items[0];
  const backdrop = first?.kind === "rect" && first.geo.x <= canvas.x && first.geo.y <= canvas.y ? first : null;
  const wanted = `<rect x="${canvas.x}" y="${canvas.y}" width="${canvas.w}" height="${canvas.h}" fill="${bgHex}"/>`;
  if (!backdrop) {
    add(first?.line ?? root.line, "background", "hold", "", `The diagram needs a dark background. Make the first shape ${wanted}.`);
  } else {
    const a = backdrop.node.attrs;
    if ([a.x ?? "0", a.y ?? "0", a.width, a.height].some((v) => pixels(v) === null)) {
      add(backdrop.line, "background", "hold", "", `Give the background rect plain numbers, as in ${wanted}. Some image tools draw a rect sized in percent as white.`);
    }
    if (!backdrop.fill || backdrop.fill.hex !== bgHex || backdrop.fill.alpha < 1) {
      add(backdrop.line, "background", "hold", "", `The background is ${backdrop.fill ? nameOf(backdrop.fill.hex) : "empty"}. It must be background (${bgHex}) with no transparency, so the diagram is dark on any page.`);
    }
    if (backdrop.geo.x + backdrop.geo.w < canvas.x + canvas.w || backdrop.geo.y + backdrop.geo.h < canvas.y + canvas.h) {
      add(backdrop.line, "background", "hold", "", `The background rect doesn't cover the whole canvas (${canvas.w} by ${canvas.h}). Use ${wanted}.`);
    }
  }
  // Nothing else may turn most of the picture light.
  for (const it of items) {
    if (it.type !== "shape" || it === backdrop || !it.fill || byHex.get(it.fill.hex)?.kind === "surface") continue;
    const share = coverage(it, canvas);
    if (share >= 0.5) add(it.line, "background", "hold", it.kind, `This <${it.kind}> covers ${Math.round(share * 100)}% of the diagram in ${nameOf(it.fill.hex)}, which makes it a light or colored background. Large areas must be background, surface or raised.`);
  }

  const texts = items.map((it, i) => ({ it, i })).filter(({ it }) => it.type === "text" && it.runs.length);
  if (!texts.length) add(root.line, "no-text", "hold", "", "The diagram has no words. Labels must be real <text> elements, never shapes or text turned into outlines, so screen readers and search can read them.");

  // Words: contrast against what is behind them, and size.
  const minSize = palette.font.minSize;
  const legendSize = palette.font.legendMinSize;
  const boxes = new Map();
  for (const { it, i } of texts) {
    let worst = null;
    for (const r of it.runs) {
      if (!r.fill) continue;
      for (const px of [r.left + 1, (r.left + r.right) / 2, r.right - 1]) {
        const behind = colorAt(px, r.mid, i, true).hex;
        const ratio = contrast(blend(r.fill.hex, r.fill.alpha, behind), behind);
        if (!worst || ratio < worst.ratio) worst = { ratio, behind, r };
      }
    }
    if (worst && worst.ratio < LIMITS.text) {
      add(it.line, "text-contrast", "hold", worst.r.text, `Words "${short(worst.r.text)}" are ${fmt(worst.ratio)} to 1 against ${nameOf(worst.behind)} behind them. Words need at least ${LIMITS.text} to 1. Use text or muted text on a surface, or background-colored words on an accent.`);
    }
    if (onPage && it.runs.some((r) => !r.sizeSet)) {
      add(it.line, "font-size", "hold", it.label, `Words "${short(it.label)}" have no font size set inside the diagram, so on a page they take the page's size. Set font-size on the words or a group around them.`);
    }
    const allowed = it.legend ? legendSize : minSize;
    const smallest = Math.min(...it.runs.map((r) => r.size * scale));
    if (smallest < allowed - 1e-9) {
      const scaled = scale < 1 ? ` after the diagram is shrunk to ${width} pixels` : "";
      add(it.line, "font-size", "hold", it.label, `Words "${short(it.label)}" are ${+smallest.toFixed(1)} pixels${scaled}. The smallest allowed is ${minSize} pixels, or ${legendSize} inside a legend.`);
    }
    if (it.runs.some((r) => r.left < canvas.x - 2 || r.right > canvas.x + canvas.w + 2)) {
      add(it.line, "label-overflow", "advice", it.label, `Words "${short(it.label)}" may run past the edge of the diagram and be cut off. Move them in or shorten them.`);
    }
    const first = it.runs[0];
    const { top } = colorAt((first.left + first.right) / 2, first.mid, i);
    if (top && top !== backdrop) {
      if (!boxes.has(top)) boxes.set(top, []);
      boxes.get(top).push(it);
    }
  }

  // Lines, arrows, box edges and small marks: 3 to 1 against what is behind them.
  const graphic = (it, i, hex, alpha, samples, what) => {
    let worst = null;
    for (const [x, y, own] of samples) {
      const behind = own ?? colorAt(x, y, i).hex;
      const ratio = contrast(blend(hex, alpha, behind), behind);
      if (!worst || ratio < worst.ratio) worst = { ratio, behind };
    }
    if (worst && worst.ratio < LIMITS.graphic) {
      add(it.line, what === "mark" ? "mark-contrast" : "line-contrast", "hold", it.kind, `This ${what} is ${fmt(worst.ratio)} to 1 against ${nameOf(worst.behind)} behind it. Lines, arrows, box edges and marks need at least ${LIMITS.graphic} to 1.`);
    }
  };
  const accentsUsed = new Set();
  items.forEach((it, i) => {
    if (it.type !== "shape" || it === backdrop) return;
    for (const c of [it.fill, it.stroke]) if (c && byHex.get(c.hex)?.kind === "accent" && !it.legend) accentsUsed.add(byHex.get(c.hex).name);
    const closed = it.fill && it.kind !== "line";
    if (it.stroke) {
      if (closed) {
        // A filled shape with an edge stands out if either its edge or its fill
        // reaches 3 to 1 against what is around it.
        const [cx, cy] = center(it);
        const outer = colorAt(cx, cy, i).hex;
        const fillRatio = contrast(blend(it.fill.hex, it.fill.alpha, outer), outer);
        if (fillRatio < LIMITS.graphic) graphic(it, i, it.stroke.hex, it.stroke.alpha, [[cx, cy, outer]], it.kind === "rect" ? "box edge" : "outline");
      } else if (["rect", "circle", "ellipse"].includes(it.kind)) {
        const [cx, cy] = center(it);
        graphic(it, i, it.stroke.hex, it.stroke.alpha, [[cx, cy]], "outline");
      } else {
        const pts = it.geo.pts;
        const samples = pts.flatMap((p, k) => (k ? [[(p[0] + pts[k - 1][0]) / 2, (p[1] + pts[k - 1][1]) / 2], p] : [p]));
        graphic(it, i, it.stroke.hex, it.stroke.alpha, samples, "line");
      }
    } else if (it.fill && byHex.get(it.fill.hex)?.kind !== "surface" && !boxes.has(it)) {
      const [cx, cy] = center(it);
      graphic(it, i, it.fill.hex, it.fill.alpha, [[cx, cy]], "mark");
    }
    for (const id of it.markers) {
      const marker = markers.get(id);
      const ends = it.geo.pts ? [it.geo.pts[0], it.geo.pts[it.geo.pts.length - 1]].filter(Boolean) : [center(it)];
      const shapes = [];
      const collect = (n, inherited) => {
        if (n.text !== undefined) return;
        const st = { ...inherited, ...Object.fromEntries(INHERITED.filter((k) => ownStyle(n)[k] !== undefined).map((k) => [k, ownStyle(n)[k]])) };
        if (SHAPES.has(n.tag)) shapes.push(st);
        n.children.forEach((c) => collect(c, st));
      };
      if (marker) collect(marker, {});
      for (const st of shapes) {
        for (const prop of ["fill", "stroke"]) {
          let v = st[prop] ?? (prop === "fill" ? "#000000" : "none");
          if (/^context-(stroke|fill)$/i.test(v)) {
            const src = /stroke/i.test(v) ? it.stroke : it.fill;
            if (!src) continue;
            v = src.hex;
          }
          const c = parseColor(v);
          if (!c || c === "none" || !byHex.has(c.hex)) continue;
          graphic(it, i, c.hex, c.alpha * opacityOf(st[`${prop}-opacity`]), ends, "arrowhead");
        }
      }
    }
  });

  // Box labels: short, and inside their box.
  for (const [box, labels] of boxes) {
    const label = labels.map((t) => t.label).join(" ");
    const n = words(label);
    if (n > LIMITS.holdWords) add(labels[0].line, "label-length", "hold", label, `This box has ${n} words ("${short(label)}"). That is a sentence, not a label. Keep it to ${LIMITS.adviseWords} words or fewer and move the rest to the caption.`);
    else if (n > LIMITS.adviseWords) add(labels[0].line, "label-length", "advice", label, `This box has ${n} words ("${short(label)}"). Aim for ${LIMITS.adviseWords} or fewer, and put detail in the caption.`);
    if (box.kind === "rect") {
      for (const t of labels) {
        if (t.runs.some((r) => r.left < box.geo.x - 2 || r.right > box.geo.x + box.geo.w + 2)) {
          add(t.line, "label-overflow", "advice", t.label, `Words "${short(t.label)}" may be wider than their box. Shorten the label, split it over two lines, or widen the box.`);
        }
      }
    }
  }
  if (boxes.size > LIMITS.boxes) add(root.line, "box-count", "advice", "", `The diagram has ${boxes.size} labeled boxes. Above about ${LIMITS.boxes}, readers lose the thread. Split it into two diagrams.`);

  const hasLegend = items.some((it) => it.legend);
  if (accentsUsed.size >= 2 && !hasLegend) {
    add(root.line, "color-alone", "advice", "", `Shapes use ${accentsUsed.size} accent colors (${[...accentsUsed].join(", ")}) and there is no legend. If the colors mean something, add a legend (a group with class="legend") or say the meaning in the labels, so it doesn't rest on color alone.`);
  }

  // Plain English: visible words first, in reading order, then the title and
  // description. An acronym spelled out only in the hidden description still
  // holds on the label, because most readers never see the description.
  const parts = texts.map(({ it }) => ({ line: it.line, text: it.label }));
  for (const tag of ["title", "desc"]) {
    const el = root.children.find((c) => c.tag === tag);
    if (el) parts.push({ line: el.line, text: textOf(el).replace(/\s+/g, " ").trim() });
  }
  // Diagrams have no room to explain, so capital-letter words are held even
  // when plain's common list allows them in prose. One passes if the glossary
  // has it, or if the diagram's visible words spell it out somewhere.
  const visible = parts.slice(0, texts.length).map((p) => p.text).join("\n");
  const spelled = new Set();
  for (const m of visible.matchAll(/[a-z][\w\s,'-]*\(\s*([A-Z][A-Z0-9&]*[A-Z])s?\s*\)|\b([A-Z][A-Z0-9&]*[A-Z])s?\s*\(\s*[a-z]/g)) spelled.add(m[1] ?? m[2]);
  const prose = parts.map((p) => p.text).join("\n\n");
  for (const f of checkText(prose, { ...config, common: spelled })) {
    const part = parts[Math.floor((f.line - 1) / 2)];
    found.push({ ...f, line: part?.line ?? root.line });
  }

  return found;
}

// Page styles that can change a diagram the checker can't see. Any of these,
// anywhere on the page, can reach the diagram through an ancestor.
const PAGE_RISKY = new Set(["fill", "stroke", "fill-opacity", "stroke-opacity", "stroke-width", "paint-order", "opacity", "filter", "backdrop-filter", "mix-blend-mode", "transform", "scale", "rotate", "zoom", "mask", "clip-path", "-webkit-text-stroke", "-webkit-text-stroke-color", "-webkit-text-stroke-width", "-webkit-text-fill-color"]);
// What a page may set on the diagram itself or on anything inside it.
const PAGE_SAFE_ON_DIAGRAM = /^(display|margin(-\w+)?)$/;
const SVG_NAMES = [...ALLOWED].filter((n) => !["a", "title", "desc", "metadata"].includes(n)).join("|");

function checkPageStyles(raw, svgs) {
  const found = [];
  const lineAt = (i) => raw.slice(0, i).split("\n").length;
  const outside = svgs.reduce((acc, m) => acc.slice(0, m.index) + m[0].replace(/[^\n]/g, " ") + acc.slice(m.index + m[0].length), raw);
  const hold = (index, text, message) => found.push({ line: lineAt(index), rule: "page-style", level: "hold", text, message });
  const names = new Set();
  for (const m of svgs) {
    for (const a of m[0].matchAll(/\b(id|class)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      for (const n of (a[2] ?? a[3]).split(/\s+/).filter(Boolean)) names.add(`${a[1] === "id" ? "#" : "."}${n}`);
    }
  }
  const targets = (selector) =>
    /\*/.test(selector) ||
    new RegExp(`(^|[\\s>+~,(])(${SVG_NAMES})(?=$|[\\s>+~,.#:\\[)])`, "i").test(selector) ||
    [...names].some((n) => new RegExp(`${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(selector));
  for (const m of outside.matchAll(/<link\b[^>]*\brel\s*=\s*["']?stylesheet[^>]*>/gi)) {
    hold(m.index, "link", "The page loads a style sheet the checker can't read, and it could change the diagram. Put the page's styles in the page.");
  }
  for (const block of outside.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    const start = block.index + block[0].indexOf(block[1]);
    const css = block[1].replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
    for (const imp of css.matchAll(/@import\b[^;]*;?/g)) hold(start + imp.index, "@import", "The page imports a style sheet the checker can't read, and it could change the diagram.");
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].trim();
      if (selector.startsWith("@")) continue;
      const onDiagram = targets(selector);
      for (const decl of rule[2].split(";")) {
        const prop = decl.split(":")[0].trim().toLowerCase();
        if (!prop) continue;
        if (PAGE_RISKY.has(prop) || (onDiagram && !PAGE_SAFE_ON_DIAGRAM.test(prop))) {
          hold(start + rule.index, `${selector} { ${prop} }`, `The page style "${selector} { ${decl.trim()} }" can change how the diagram looks, and the checker can't see that. Remove it, or style only things outside the diagram.`);
        }
      }
    }
  }
  for (const attr of outside.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    for (const decl of (attr[1] ?? attr[2]).split(";")) {
      const prop = decl.split(":")[0].trim().toLowerCase();
      if (PAGE_RISKY.has(prop)) hold(attr.index, prop, `The page's style="${decl.trim()}" can change how the diagram looks, and the checker can't see that. Remove it.`);
    }
  }
  return found;
}

export function checkDiagram(raw, name, config, palette = loadPalette()) {
  if (!/\.html?$/i.test(name)) return sortFindings(checkSvg(raw, config, palette));
  const svgs = [...raw.matchAll(/<svg\b[\s\S]*?<\/svg\s*>/gi)];
  if (!svgs.length) return null;
  const found = [];
  for (const m of svgs) found.push(...checkSvg(m[0], config, palette, raw.slice(0, m.index).split("\n").length, true));
  found.push(...checkPageStyles(raw, svgs));
  found.push(...checkText(prepare(raw, name), config));
  return sortFindings(found);
}

const sortFindings = (f) => f.sort((a, b) => a.line - b.line);

function main(argv) {
  const args = argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file || !existsSync(file)) {
    console.error(`diagram-check: file not found: ${file ?? "(none given)"}`);
    return 2;
  }
  if (!/\.(svg|html?)$/i.test(file)) {
    console.error(`diagram-check: give an .svg file or an .html page with an <svg> in it, not ${file}`);
    return 2;
  }
  const findings = checkDiagram(readFileSync(file, "utf8"), file, loadConfig(process.cwd()));
  if (!findings) {
    console.error(`diagram-check: no <svg> diagram found in ${file}`);
    return 2;
  }
  const held = findings.some((f) => f.level === "hold");
  if (args.includes("--json")) {
    console.log(JSON.stringify({ file, held, findings }, null, 2));
  } else {
    if (findings.length) console.log(formatFindings(findings));
    const holds = findings.filter((f) => f.level === "hold").length;
    const advice = findings.length - holds;
    console.log(held ? `Held: ${holds} problem(s) to fix, ${advice} piece(s) of advice.` : `Passes: no problems to fix${advice ? `, ${advice} piece(s) of advice` : ""}.`);
  }
  return held ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv));
