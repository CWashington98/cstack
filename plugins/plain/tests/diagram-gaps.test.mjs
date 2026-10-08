// Bad diagrams that used to pass, and edges that no test pinned down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeRepo } from "../../../tests/helpers.mjs";
import { loadConfig } from "../scripts/lib/config.mjs";
import { checkDiagram, checkSvg } from "../scripts/diagram-check.mjs";
import { blend, contrast } from "../scripts/lib/color.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const config = loadConfig(makeRepo({ ".claude/plain.json": "{}" }));
const check = (src, name = "t.svg") => checkDiagram(src, name, config);
const holds = (src, name) => check(src, name).filter((f) => f.level === "hold").map((f) => f.rule);
const BG = '<rect x="0" y="0" width="400" height="200" fill="#0b0f17"/>';
const doc = (body, { root = 'viewBox="0 0 400 200" role="img" aria-labelledby="t d"', title = "A small test diagram", desc = "One box that says hello.", bg = BG } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${root}>\n<title id="t">${title}</title>\n<desc id="d">${desc}</desc>\n${bg}\n${body}\n</svg>\n`;
const BOX = '<rect x="40" y="40" width="200" height="80" fill="#151b26" stroke="#6c788c" stroke-width="2"/>';
const words = (attrs = "", content = "Say hello") => `<text x="60" y="86" fill="#f2f5f9" font-size="18" ${attrs}>${content}</text>`;
const page = (svg, head = "", wrap = (s) => s) => `<!doctype html>\n<html><head><title>A page</title>${head}</head><body>\n<figure>\n${wrap(svg)}<figcaption>Notice the one box.</figcaption>\n</figure>\n</body></html>\n`;

test("the helper diagram passes, so every hold below comes from the one change", () => {
  assert.deepEqual(check(doc(BOX + words())), []);
});

// 1. A light background drawn after the dark one.
test("a light shape covering most of the canvas is held, after the first shape too", () => {
  assert.ok(holds(doc('<rect x="0" y="0" width="400" height="200" fill="#f2f5f9"/>' + BOX + words())).includes("background"));
  assert.ok(holds(doc('<circle cx="200" cy="100" r="190" fill="#f2f5f9"/>' + BOX + words())).includes("background"));
  assert.ok(holds(doc('<rect x="0" y="0" width="400" height="200" fill="#5ea8ff" fill-opacity="0.2"/>' + BOX + words())).includes("background"));
  assert.deepEqual(holds(doc('<rect x="10" y="10" width="380" height="180" fill="#202837"/>' + BOX + words())), []);
  assert.deepEqual(holds(doc('<rect x="0" y="0" width="190" height="200" fill="#f2f5f9"/>')).includes("background"), false, "under half the canvas is not a background");
});

// 2. Only allowed elements.
test("animation, nested diagrams and any element not on the allowed list are held", () => {
  for (const el of ['<set attributeName="fill" to="#ffffff"/>', '<animate attributeName="fill" to="#ffffff"/>', '<animateTransform attributeName="transform" type="scale" to="0.1"/>', '<animateMotion path="M0,0 L9,9"/>', "<blink/>"]) {
    assert.ok(holds(doc(BOX.replace("/>", `>${el}</rect>`) + words())).includes("unsupported"), el);
  }
  assert.ok(holds(doc(BOX + '<svg x="0" y="0" width="40" height="20" viewBox="0 0 400 200">' + words() + "</svg>" + words())).includes("unsupported"));
});

// 3. Page styles that reach into the diagram.
test("a page style sheet or style attribute that can change the diagram is held", () => {
  const svg = doc(BOX + words());
  assert.deepEqual(holds(page(svg), "p.html"), []);
  assert.deepEqual(holds(page(svg, "<style>body { background: #0b0f17; color: #f2f5f9; font-size: 17px } .diagram svg { display: block; margin: 0 }</style>"), "p.html"), []);
  assert.ok(holds(page(svg, "<style>.diagram svg text { fill: #0b0f17 !important; }</style>"), "p.html").includes("page-style"));
  assert.ok(holds(page(svg, "<style>figure { filter: invert(1) }</style>"), "p.html").includes("page-style"));
  assert.ok(holds(page(svg, "<style>svg { width: 100px }</style>"), "p.html").includes("page-style"));
  assert.ok(holds(page(svg, '<link rel="stylesheet" href="site.css">'), "p.html").includes("page-style"));
  assert.ok(holds(page(svg, "", (s) => `<div style="opacity: 0.2">${s}</div>`), "p.html").includes("page-style"));
});

test("on a page, words with no font size set inside the diagram are held, because they take the page's size", () => {
  const svg = doc(BOX + words().replace(' font-size="18"', ""));
  assert.deepEqual(holds(svg), []);
  assert.ok(holds(page(svg, "<style>body { font-size: 10px }</style>"), "p.html").includes("font-size"));
});

// 4. Words that can't be read.
test("a faint tspan after other words is held", () => {
  assert.ok(holds(doc(BOX + words("", 'Say <tspan fill-opacity="0.1">hello</tspan>'))).includes("text-contrast"));
  assert.ok(holds(doc(BOX + words("", 'Say <tspan opacity="0.1">hello</tspan>'))).includes("text-contrast"));
});

test("opacity written as a percent is read", () => {
  assert.ok(holds(doc(BOX + words('fill-opacity="10%"'))).includes("text-contrast"));
  assert.deepEqual(holds(doc(BOX + words('fill-opacity="100%"'))), []);
});

test("currentColor with no color set is held, and with a palette color it passes", () => {
  assert.ok(holds(doc(BOX + words().replace('fill="#f2f5f9"', 'fill="currentColor"'))).includes("palette"));
  assert.deepEqual(holds(doc(BOX + words('color="#f2f5f9"').replace('fill="#f2f5f9"', 'fill="currentColor"'))), []);
});

test("outlined words are held: no fill with a stroke, or any stroke on words", () => {
  assert.ok(holds(doc(BOX + words('stroke="#f2f5f9"').replace('fill="#f2f5f9"', 'fill="none"'))).includes("text-outline"));
  const tspan = holds(doc(BOX + words("", 'Say <tspan stroke="#123456">hello</tspan>')));
  assert.ok(tspan.includes("palette") && tspan.includes("text-outline"));
});

test("a thick light line behind words counts as what is behind them", () => {
  assert.ok(holds(doc(BOX + '<line x1="40" y1="80" x2="260" y2="80" stroke="#f2f5f9" stroke-width="30"/>' + words())).includes("text-contrast"));
  assert.deepEqual(holds(doc(BOX + '<line x1="40" y1="20" x2="260" y2="20" stroke="#f2f5f9" stroke-width="4"/>' + words())), []);
});

// 5. Words shrunk below the limit.
test("words shrunk by height alone, or by a style width on the diagram, are measured after shrinking", () => {
  assert.ok(holds(doc(BOX + words(), { root: 'viewBox="0 0 400 200" height="50" role="img" aria-labelledby="t d"' })).includes("font-size"));
  assert.ok(holds(doc(BOX + words(), { root: 'viewBox="0 0 400 200" style="width:100px" role="img" aria-labelledby="t d"' })).includes("font-size"));
  assert.ok(holds(doc(BOX + words(), { root: 'viewBox="0 0 400 200" width="50%" role="img" aria-labelledby="t d"' })).includes("canvas-size"));
});

test("only a group whose class or id is exactly the word legend allows 12 pixel words", () => {
  const legend = (attr) => doc(BOX + words() + `<g ${attr}><text x="40" y="180" fill="#9aa5b6" font-size="12">Gray edge: a step</text></g>`);
  assert.deepEqual(holds(legend('class="legend"')), []);
  assert.deepEqual(holds(legend('class="key legend"')), []);
  assert.deepEqual(holds(legend('id="legend"')), []);
  assert.ok(holds(legend('class="not-legend"')).includes("font-size"));
  assert.ok(holds(legend('id="legend-box"')).includes("font-size"));
});

test("font sizes in points, em, rem and percent are converted", () => {
  const sized = (v, parent = "") => doc(BOX + `<g ${parent}>` + words().replace('font-size="18"', `font-size="${v}"`) + "</g>");
  assert.ok(holds(sized("10pt")).includes("font-size"), "10pt is 13.3 pixels");
  assert.deepEqual(holds(sized("11pt")), [], "11pt is 14.7 pixels");
  assert.ok(holds(sized("0.6em", 'font-size="20"')).includes("font-size"), "0.6em of 20 is 12");
  assert.deepEqual(holds(sized("0.75em", 'font-size="20"')), []);
  assert.ok(holds(sized("65%", 'font-size="20"')).includes("font-size"));
  assert.deepEqual(holds(sized("75%", 'font-size="20"')), []);
  assert.ok(holds(sized("0.8rem")).includes("font-size"), "0.8rem is 12.8");
  assert.deepEqual(holds(sized("0.9rem")), []);
  assert.ok(holds(sized("large")).includes("font-size"), "a size that can't be read is held");
});

// 6. Pinning the edges.
function nearRatio(target, base = "#000000") {
  let below = null;
  let atOrAbove = null;
  for (let g = 0; g < 256; g++) {
    for (let r = 0; r < 256; r += 1) {
      const hex = "#" + [r, g, 128].map((v) => v.toString(16).padStart(2, "0")).join("");
      const c = contrast(hex, base);
      if (c < target && (!below || c > below.c)) below = { hex, c };
      if (c >= target && (!atOrAbove || c < atOrAbove.c)) atOrAbove = { hex, c };
    }
  }
  return { below, atOrAbove };
}
const edgePalette = (colors) => ({
  colors: { background: { hex: "#000000", kind: "surface" }, ...colors },
  font: { minSize: 14, legendMinSize: 12 },
});
const edgeDoc = (body) => doc(body, { bg: '<rect x="0" y="0" width="400" height="200" fill="#000000"/>' });
const edgeHolds = (palette, body) => checkSvg(edgeDoc(body), config, palette).filter((f) => f.level === "hold").map((f) => f.rule);

test("words just under 4.5 to 1 are held and words at 4.5 to 1 pass", () => {
  const { below, atOrAbove } = nearRatio(4.5);
  assert.ok(below.c > 4.49 && atOrAbove.c < 4.51, `${below.c} ${atOrAbove.c}`);
  const palette = edgePalette({ low: { hex: below.hex, kind: "text" }, ok: { hex: atOrAbove.hex, kind: "text" } });
  const label = (hex) => `<text x="40" y="100" fill="${hex}" font-size="18">Say hello</text>`;
  assert.ok(edgeHolds(palette, label(below.hex)).includes("text-contrast"));
  assert.deepEqual(edgeHolds(palette, label(atOrAbove.hex)), []);
});

test("a line just under 3 to 1 is held and a line at 3 to 1 passes", () => {
  const { below, atOrAbove } = nearRatio(3);
  assert.ok(below.c > 2.99 && atOrAbove.c < 3.01, `${below.c} ${atOrAbove.c}`);
  const palette = edgePalette({ text: { hex: "#ffffff", kind: "text" }, low: { hex: below.hex, kind: "line" }, ok: { hex: atOrAbove.hex, kind: "line" } });
  const body = (hex) => `<line x1="20" y1="160" x2="380" y2="160" stroke="${hex}" stroke-width="2"/><text x="40" y="100" fill="#ffffff" font-size="18">Say hello</text>`;
  assert.ok(edgeHolds(palette, body(below.hex)).includes("line-contrast"));
  assert.deepEqual(edgeHolds(palette, body(atOrAbove.hex)), []);
});

test("blending works at any transparency, not only half", () => {
  assert.equal(blend("#ffffff", 0.25, "#000000"), "#404040");
  assert.equal(blend("#ff0000", 0.2, "#0000ff"), "#3300cc");
  assert.equal(blend("#ffffff", 0, "#123456"), "#123456");
});

test("a see-through background is held", () => {
  assert.ok(holds(doc(BOX + words(), { bg: BG.replace("/>", ' fill-opacity="0.5"/>') })).includes("background"));
});

test("the background must start at the top left corner of the canvas", () => {
  assert.ok(holds(doc(BOX + words(), { bg: '<rect x="10" y="0" width="400" height="200" fill="#0b0f17"/>' })).includes("background"));
  assert.ok(holds(doc(BOX + words(), { bg: '<rect x="0" y="10" width="400" height="200" fill="#0b0f17"/>' })).includes("background"));
  assert.deepEqual(holds(doc(BOX + words(), { bg: '<rect x="-10" y="-10" width="420" height="220" fill="#0b0f17"/>' })), []);
});

test("an arrowhead too faint against what is behind the end of its line is held", () => {
  const arrow = (fill) => `<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${fill}"/></marker></defs>`;
  const line = '<line x1="250" y1="160" x2="380" y2="160" stroke="#6c788c" stroke-width="2" marker-end="url(#a)"/>';
  assert.ok(holds(doc(arrow("#202837") + BOX + words() + line)).includes("line-contrast"));
  assert.deepEqual(holds(doc(arrow("#6c788c") + BOX + words() + line)), []);
});

test("a tspan's own color must be in the palette", () => {
  assert.ok(holds(doc(BOX + words("", 'Say <tspan fill="#123456">hello</tspan>'))).includes("palette"));
});

test("a shape with no fill draws black and is held", () => {
  assert.ok(holds(doc('<rect x="300" y="40" width="40" height="40"/>' + BOX + words())).includes("palette"));
});

test("a title or description of only spaces counts as missing", () => {
  assert.ok(holds(doc(BOX + words(), { title: "   " })).includes("title"));
  assert.ok(holds(doc(BOX + words(), { desc: "\n  " })).includes("desc"));
});

// 7. A background every renderer draws.
test("the background rect must use plain numbers, not percents", () => {
  assert.ok(holds(doc(BOX + words(), { bg: '<rect x="0" y="0" width="100%" height="100%" fill="#0b0f17"/>' })).includes("background"));
});

// 8. Acronyms in diagrams.
test("capital-letter words in a diagram are held even when plain's common list allows them", () => {
  for (const label of ["Every API request", "Second AI reviews", "Account ID", "Export as PDF"]) {
    assert.ok(holds(doc(BOX + words("", label))).includes("capitals"), label);
  }
});

test("a capital-letter word passes when the glossary has it or the diagram spells it out in visible words", () => {
  const glossary = { ...config, glossary: [{ term: "API", avoid: [] }] };
  assert.deepEqual(checkDiagram(doc(BOX + words("", "Every API request")), "t.svg", glossary).filter((f) => f.level === "hold"), []);
  const spelled = doc(BOX + words("", "Every API request") + '<text x="40" y="170" fill="#9aa5b6" font-size="14">Application programming interface (API)</text>');
  assert.deepEqual(holds(spelled), []);
  const hidden = doc(BOX + words("", "Every API request"), { desc: "Application programming interface (API) requests." });
  assert.ok(holds(hidden).includes("capitals"), "spelled out only in the hidden description");
});

test("every template still passes after these rules", () => {
  for (const name of ["flow.svg", "timeline.svg", "groups.svg", "before-after.svg", "page.html"]) {
    const src = readFileSync(join(here, "..", "skills", "to-diagram", "templates", name), "utf8");
    assert.deepEqual(check(src, name).map((f) => `${f.rule}: ${f.message}`), [], name);
  }
});

// 10 to 13: found by the second reviewer.
test("a child of <text> other than a tspan, such as a textPath, is held, not skipped", () => {
  assert.ok(holds(doc(BOX + '<text x="60" y="86" fill="#f2f5f9" font-size="18"><textPath href="#p">Say hello</textPath></text>')).includes("unsupported"));
});

test("words with no visible fill are held, whether the fill is set on them or comes from a group", () => {
  assert.ok(holds(doc(BOX + words().replace('fill="#f2f5f9"', 'fill="none"'))).includes("text-fill"));
  assert.ok(holds(doc(BOX + words().replace('fill="#f2f5f9"', 'fill="transparent"'))).includes("text-fill"));
  assert.ok(holds(doc(BOX + '<g fill="none">' + words().replace(' fill="#f2f5f9"', "") + "</g>")).includes("text-fill"));
});

test("an arrowhead with no fill draws black and is held", () => {
  const arrow = '<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>';
  const line = '<line x1="250" y1="160" x2="380" y2="160" stroke="#6c788c" stroke-width="2" marker-end="url(#a)"/>';
  assert.ok(holds(doc(arrow + BOX + words() + line)).includes("palette"));
});

test("screen reader advice appears unless aria-labelledby names both the title's and the description's ids", () => {
  const advice = (root) => check(doc(BOX + words(), { root: `viewBox="0 0 400 200" role="img" ${root}` })).filter((f) => f.rule === "screen-reader").length;
  assert.equal(advice('aria-labelledby="t d"'), 0);
  assert.equal(advice('aria-labelledby="d t"'), 0);
  assert.equal(advice('aria-labelledby="t"'), 1, "only the title");
  assert.equal(advice('aria-labelledby="t missing"'), 1, "an id that doesn't exist");
  assert.equal(advice('aria-labelledby="t d missing"'), 1, "both, plus an id that doesn't exist");
  assert.equal(advice('aria-labelledby="x y"'), 1);
});
