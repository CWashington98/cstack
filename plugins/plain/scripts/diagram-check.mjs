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
const UNSUPPORTED = new Set(["style", "script", "image", "foreignobject", "use", "switch", "textpath", "filter", "mask", "clippath", "pattern", "symbol", "lineargradient", "radialgradient", "iframe", "video", "audio", "canvas"]);
const NOT_PAINTED = new Set(["defs", "marker", "title", "desc", "metadata"]);
const SHAPES = new Set(["rect", "circle", "ellipse", "line", "polyline", "polygon", "path"]);
const short = (s, n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const words = (s) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const fmt = (r) => (Math.floor(r * 100) / 100).toFixed(2);

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

export function checkSvg(source, config, palette, firstLine = 1) {
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
  const width = root.attrs.width;
  const scale = hasVb && width && !String(width).includes("%") && num(width, 0) > 0 ? num(width) / canvas.w : 1;

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
  const paint = (value, node, prop, style, quiet = false) => {
    if (value === undefined) return undefined;
    const v = String(value).trim();
    const lower = v.toLowerCase();
    if (lower === "currentcolor") return paint(style.color, node, "color", style, quiet);
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
    if (UNSUPPORTED.has(tag)) {
      if (!unsupported.has(tag)) add(node.line, "unsupported", "hold", tag, `<${node.tag}> isn't supported. The checker can't see what it draws, so it can't prove the colors. The to-diagram skill's svg-subset.md lists what is allowed.`);
      unsupported.add(tag);
      return;
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
    const legend = ctx.legend || (tag === "g" && /\blegend\b/i.test(`${node.attrs.id ?? ""} ${node.attrs.class ?? ""}`));
    const next = { ...ctx, dx: ctx.dx + shift[0], dy: ctx.dy + shift[1], opacity: ctx.opacity * num(s.opacity, 1), size: size ?? ctx.size, legend };
    if (tag === "marker" && node.attrs.id) markers.set(node.attrs.id, node);
    if (NOT_PAINTED.has(tag) || ctx.defs) {
      for (const c of node.children) walk(c, style, { ...next, defs: true });
      return;
    }
    const hidden = style.visibility === "hidden" || next.opacity === 0;
    const alphaOf = (c, prop) => (c && typeof c === "object" ? c.alpha * num(style[`${prop}-opacity`], 1) * next.opacity : 0);
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
      item.stroke = stroke && typeof stroke === "object" && num(style["stroke-width"], 1) > 0 ? { hex: stroke.hex, alpha: alphaOf(stroke, "stroke") } : null;
      item.markers = ["marker-start", "marker-mid", "marker-end", "marker"].map((k) => s[k]?.match(/url\(\s*#([^)\s]+)\s*\)/)?.[1]).filter(Boolean);
      items.push(item);
    } else if (tag === "text" && !hidden) {
      items.push(textItem(node, style, next));
      return;
    }
    for (const c of node.children) walk(c, style, next);
  };

  const textItem = (node, style, ctx) => {
    const runs = [];
    let x = num(node.attrs.x) + ctx.dx;
    let y = num(node.attrs.y) + ctx.dy;
    let current = null;
    const visit = (el, st, opacity, size) => {
      for (const child of el.children) {
        if (child.text !== undefined) {
          if (!child.text.trim()) {
            if (current) current.text += " ";
            continue;
          }
          if (!current) {
            current = { x, y, style: st, opacity, size, text: "" };
            runs.push(current);
          }
          current.text += child.text;
        } else if (child.tag === "tspan") {
          const s = ownStyle(child);
          const st2 = { ...st };
          for (const k of INHERITED) if (s[k] !== undefined) st2[k] = s[k];
          for (const prop of ["fill", "color"]) if (s[prop] !== undefined) paint(s[prop], child, prop, st2);
          const size2 = fontSize(s["font-size"], size) ?? size;
          const moves = ["x", "y", "dx", "dy"].some((k) => child.attrs[k] !== undefined);
          if (child.attrs.x !== undefined) x = num(child.attrs.x) + ctx.dx;
          if (child.attrs.y !== undefined) y = num(child.attrs.y) + ctx.dy;
          const delta = (v) => (String(v ?? "").trim().endsWith("em") ? num(v) * size2 : num(v));
          x += delta(child.attrs.dx);
          y += delta(child.attrs.dy);
          if (moves || st2.fill !== st.fill || size2 !== size) current = null;
          visit(child, st2, opacity * num(s.opacity, 1), size2);
          current = null;
        }
      }
    };
    visit(node, style, ctx.opacity, ctx.size);
    for (const r of runs) {
      r.text = r.text.replace(/\s+/g, " ").trim();
      const fill = r.style.fill === undefined ? null : paint(r.style.fill, node, "fill", r.style, true);
      if (r.style.fill === undefined && !reported.has(node)) {
        reported.add(node);
        add(node.line, "palette", "hold", r.text, `Words "${short(r.text)}" have no fill, so they draw black. Set fill to text (${palette.colors.text.hex}).`);
      }
      r.fill = fill && typeof fill === "object" ? { hex: fill.hex, alpha: fill.alpha * num(r.style["fill-opacity"], 1) * r.opacity } : null;
      const bold = /^(bold|bolder|[6-9]00)$/.test(String(r.style["font-weight"] ?? ""));
      const w = r.text.length * r.size * (bold ? 0.6 : 0.55);
      const anchor = r.style["text-anchor"] ?? "start";
      r.left = anchor === "middle" ? r.x - w / 2 : anchor === "end" ? r.x - w : r.x;
      r.right = r.left + w;
      r.mid = /^(middle|central)$/.test(r.style["dominant-baseline"] ?? "") ? r.y : r.y - 0.35 * r.size;
    }
    const kept = runs.filter((r) => r.text);
    return { type: "text", node, line: node.line, legend: ctx.legend, runs: kept, label: textOf(node).replace(/\s+/g, " ").trim() };
  };

  walk(root, {}, { dx: 0, dy: 0, opacity: 1, size: 16, legend: false, defs: false });

  // What color shows at a point, from everything painted before `before`.
  const colorAt = (x, y, before) => {
    let c = bgHex;
    let top = null;
    for (let i = 0; i < before; i++) {
      const it = items[i];
      if (it.type !== "shape" || !it.fill || !contains(it, x, y)) continue;
      c = blend(it.fill.hex, it.fill.alpha, c);
      top = it;
    }
    return { hex: c, top };
  };

  // The background: the first shape, a rect of the background color over the whole canvas.
  const first = items[0];
  const backdrop = first?.kind === "rect" && first.geo.x <= canvas.x && first.geo.y <= canvas.y ? first : null;
  if (!backdrop) {
    add(first?.line ?? root.line, "background", "hold", "", `The diagram needs a dark background. Make the first shape <rect x="0" y="0" width="100%" height="100%" fill="${bgHex}"/>.`);
  } else {
    if (!backdrop.fill || backdrop.fill.hex !== bgHex || backdrop.fill.alpha < 1) {
      add(backdrop.line, "background", "hold", "", `The background is ${backdrop.fill ? nameOf(backdrop.fill.hex) : "empty"}. It must be background (${bgHex}) with no transparency, so the diagram is dark on any page.`);
    }
    if (backdrop.geo.x + backdrop.geo.w < canvas.x + canvas.w || backdrop.geo.y + backdrop.geo.h < canvas.y + canvas.h) {
      add(backdrop.line, "background", "hold", "", `The background rect doesn't cover the whole canvas (${canvas.w} by ${canvas.h}). Use width="100%" height="100%".`);
    }
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
        const behind = colorAt(px, r.mid, i).hex;
        const ratio = contrast(blend(r.fill.hex, r.fill.alpha, behind), behind);
        if (!worst || ratio < worst.ratio) worst = { ratio, behind, r };
      }
    }
    if (worst && worst.ratio < LIMITS.text) {
      add(it.line, "text-contrast", "hold", worst.r.text, `Words "${short(worst.r.text)}" are ${fmt(worst.ratio)} to 1 against ${nameOf(worst.behind)} behind them. Words need at least ${LIMITS.text} to 1. Use text or muted text on a surface, or background-colored words on an accent.`);
    }
    const allowed = it.legend ? legendSize : minSize;
    const smallest = Math.min(...it.runs.map((r) => r.size * scale));
    if (smallest < allowed - 1e-9) {
      const scaled = scale < 1 ? ` after the diagram is shrunk to its width of ${width} pixels` : "";
      add(it.line, "font-size", "hold", it.label, `Words "${short(it.label)}" are ${+smallest.toFixed(1)} pixels${scaled}. The smallest allowed is ${minSize} pixels, or ${legendSize} inside a legend.`);
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
          graphic(it, i, c.hex, c.alpha * num(st[`${prop}-opacity`], 1), ends, "arrowhead");
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
  const prose = parts.map((p) => p.text).join("\n\n");
  for (const f of checkText(prose, config)) {
    const part = parts[Math.floor((f.line - 1) / 2)];
    found.push({ ...f, line: part?.line ?? root.line });
  }

  return found;
}

export function checkDiagram(raw, name, config, palette = loadPalette()) {
  if (!/\.html?$/i.test(name)) return sortFindings(checkSvg(raw, config, palette));
  const found = [];
  let count = 0;
  for (const m of raw.matchAll(/<svg\b[\s\S]*?<\/svg\s*>/gi)) {
    count++;
    found.push(...checkSvg(m[0], config, palette, raw.slice(0, m.index).split("\n").length));
  }
  if (!count) return null;
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
