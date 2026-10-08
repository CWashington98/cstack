import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { contrast, blend, parseColor, simulate, deltaE } from "../scripts/lib/color.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const palette = JSON.parse(readFileSync(join(here, "..", "skills", "to-diagram", "palette.json"), "utf8"));
const colors = Object.entries(palette.colors);
const surfaces = colors.filter(([, c]) => c.kind === "surface");
const ofKind = (...kinds) => colors.filter(([, c]) => kinds.includes(c.kind));

test("contrast follows the published formula: black on white is 21 to 1, and a color on itself is 1 to 1", () => {
  assert.equal(contrast("#000000", "#ffffff"), 21);
  assert.equal(contrast("#777777", "#777777"), 1);
  assert.equal(Math.round(contrast("#767676", "#ffffff") * 100) / 100, 4.54);
});

test("colors are read from hex, short hex, hex with transparency and rgb()", () => {
  assert.deepEqual(parseColor("#ABC"), { hex: "#aabbcc", alpha: 1 });
  assert.deepEqual(parseColor("#11223380"), { hex: "#112233", alpha: 128 / 255 });
  assert.deepEqual(parseColor("rgb(255, 0, 16)"), { hex: "#ff0010", alpha: 1 });
  assert.deepEqual(parseColor("rgba(255,0,16,0.5)"), { hex: "#ff0010", alpha: 0.5 });
  assert.equal(parseColor("none"), "none");
  assert.equal(parseColor("tomato"), null);
});

test("a half-transparent color blends halfway toward what is behind it", () => {
  assert.equal(blend("#ffffff", 0.5, "#000000"), "#808080");
  assert.equal(blend("#123456", 1, "#000000"), "#123456");
});

test("the palette is dark: the background is darker than every other color", () => {
  const bg = palette.colors.background;
  assert.equal(bg.kind, "surface");
  for (const [name, c] of colors) {
    if (name === "background") continue;
    assert.ok(contrast(c.hex, "#000000") >= contrast(bg.hex, "#000000"), `${name} is darker than the background`);
  }
  assert.ok(contrast(bg.hex, "#000000") < 1.5, "the background is near black");
});

test("every color that may be used for words reaches 4.5 to 1 on every surface", () => {
  for (const [name, c] of colors.filter(([, c]) => c.text)) {
    for (const [s, sc] of surfaces) {
      const ratio = contrast(c.hex, sc.hex);
      assert.ok(ratio >= 4.5, `${name} on ${s} is ${ratio.toFixed(2)} to 1`);
    }
  }
  assert.ok(palette.colors.text.text && palette.colors.muted.text, "text and muted text are allowed for words");
});

test("every border and accent color reaches 3 to 1 on every surface, for lines, arrows and box edges", () => {
  const marks = ofKind("line", "accent");
  assert.ok(marks.length >= 7, "a border plus about six accents");
  for (const [name, c] of marks) {
    for (const [s, sc] of surfaces) {
      const ratio = contrast(c.hex, sc.hex);
      assert.ok(ratio >= 3, `${name} on ${s} is ${ratio.toFixed(2)} to 1`);
    }
  }
});

test("the good and bad pair stays easy to tell apart for the two common kinds of red-green color blindness", () => {
  const [good, bad] = palette.goodBad.map((n) => palette.colors[n].hex);
  for (const kind of ["protanopia", "deuteranopia"]) {
    const d = deltaE(simulate(good, kind), simulate(bad, kind));
    assert.ok(d >= 40, `good and bad differ by only ${d.toFixed(1)} under ${kind}`);
  }
});

test("simulated color blindness leaves gray alone and merges red with green", () => {
  assert.ok(deltaE(simulate("#808080", "deuteranopia"), "#808080") < 2);
  const red = palette.colors.red.hex;
  const green = palette.colors.green.hex;
  const normal = deltaE(red, green);
  const seen = deltaE(simulate(red, "deuteranopia"), simulate(green, "deuteranopia"));
  assert.ok(seen < normal / 2, "red and green look much closer to someone with deuteranopia");
});
