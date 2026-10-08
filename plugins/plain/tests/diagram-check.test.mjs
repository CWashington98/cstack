import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeRepo } from "../../../tests/helpers.mjs";
import { loadConfig } from "../scripts/lib/config.mjs";
import { checkDiagram } from "../scripts/diagram-check.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures", "diagram");
const script = join(here, "..", "scripts", "diagram-check.mjs");
const settings = { neverPublish: { Bluebird: 'Say "the reminder service".' } };
const repo = makeRepo({ ".claude/plain.json": JSON.stringify(settings) });
const config = loadConfig(repo);
const check = (source, name = "test.svg") => checkDiagram(source, name, config);
const rules = (findings, level) => findings.filter((f) => f.level === level).map((f) => f.rule);
const fixture = (name) => readFileSync(join(fixtures, name), "utf8");

// Fixture names say what each one must produce: pass-*, hold-<rule>-*, advice-<rule>-*.
const RULES = ["background", "palette", "text-contrast", "line-contrast", "mark-contrast", "font-size", "title", "desc", "plain", "label-length", "unsupported", "no-text", "unreadable", "box-count", "color-alone", "label-overflow", "screen-reader"];
const ruleOf = (name) => RULES.filter((r) => name.startsWith(`hold-${r}`) || name.startsWith(`advice-${r}`)).sort((a, b) => b.length - a.length)[0];

for (const name of readdirSync(fixtures).filter((n) => n.endsWith(".svg")).sort()) {
  test(`fixture ${name}`, () => {
    const findings = check(fixture(name), name);
    const holds = rules(findings, "hold");
    if (name.startsWith("pass-")) {
      assert.deepEqual(findings.map((f) => `${f.rule}: ${f.message}`), []);
    } else if (name.startsWith("hold-")) {
      const rule = ruleOf(name);
      assert.ok(rule, `${name} names no known rule`);
      const want = rule === "plain" ? ["capitals", "planning-code", "never-publish"] : [rule];
      assert.ok(holds.some((h) => want.includes(h)), `${name} should hold for ${rule}; got ${JSON.stringify(findings)}`);
    } else {
      const rule = ruleOf(name);
      assert.deepEqual(holds, [], `${name} should only give advice; got ${JSON.stringify(findings)}`);
      assert.ok(rules(findings, "advice").includes(rule), `${name} should advise ${rule}; got ${JSON.stringify(findings)}`);
    }
  });
}

test("a finding points at the line of the element it is about", () => {
  const f = check(fixture("hold-palette-off-palette.svg")).find((x) => x.rule === "palette");
  assert.equal(f.line, 5);
  assert.match(f.message, /#3366ff/);
  assert.match(f.message, /blue \(#5ea8ff\)/, "it suggests the nearest palette color");
});

test("words on a box are measured against the box, not the canvas", () => {
  const f = check(fixture("hold-text-contrast.svg")).find((x) => x.rule === "text-contrast");
  assert.match(f.message, /Say hello/);
  assert.match(f.message, /2\.\d+ to 1/);
  assert.match(f.message, /blue/);
});

test("12 pixel words are allowed in a legend, and 13 pixel words are held outside one", () => {
  const legend = fixture("pass-legend-small-words.svg");
  assert.deepEqual(rules(check(legend), "hold"), []);
  const outside = legend.replace('<g class="legend">', "<g>").replace(/font-size="12"/g, 'font-size="13"');
  assert.ok(rules(check(outside), "hold").includes("font-size"));
});

test("a label of 7 to 12 words gets advice, and more than 12 is held", () => {
  const words = (n) => Array.from({ length: n }, () => "word").join(" ");
  const svg = (label) => fixture("pass-minimal.svg").replace("Say hello", label).replace('width="200"', 'width="390"').replace('x="40"', 'x="5"').replace('x="140"', 'x="200"').replace('font-size="18"', 'font-size="14"');
  assert.deepEqual(rules(check(svg(words(6))), "advice"), []);
  assert.deepEqual(rules(check(svg(words(7))), "advice"), ["label-length"]);
  assert.deepEqual(rules(check(svg(words(12))), "hold"), []);
  assert.deepEqual(rules(check(svg(words(13))), "hold"), ["label-length"]);
});

test("an acronym spelled out in the description, which most readers never see, still holds on the label", () => {
  const svg = fixture("hold-plain-acronym.svg").replace("One box that says hello.", "Revenue cycle management (RCM) is billing.");
  assert.ok(rules(check(svg), "hold").includes("capitals"));
  const spelled = fixture("hold-plain-acronym.svg").replace("Send to the RCM queue", "Billing (RCM) queue");
  assert.deepEqual(rules(check(spelled), "hold"), []);
});

test("a page checks every diagram in it and the words around them", () => {
  const svg = fixture("pass-minimal.svg");
  const bad = fixture("hold-text-contrast.svg");
  const page = `<!doctype html>\n<html><body>\n<figure>\n${svg}<figcaption>Notice the one box.</figcaption>\n</figure>\n<figure>\n${bad}<figcaption>The second one is READY.</figcaption>\n</figure>\n</body></html>\n`;
  const findings = check(page, "page.html");
  const contrast = findings.find((f) => f.rule === "text-contrast");
  assert.equal(contrast.line, page.split("\n").findIndex((l) => l.includes('fill="#5ea8ff"')) + 2);
  assert.ok(findings.some((f) => f.rule === "capitals" && f.text === "READY"));
});

test("the command passes with exit 0, holds with exit 1, and returns 2 for a missing file or a page with no diagram", () => {
  const dir = makeRepo({ ".claude/plain.json": JSON.stringify(settings), "empty.html": "<p>No picture here.</p>\n" });
  const run = (f, ...extra) => spawnSync(process.execPath, [script, f, ...extra], { cwd: dir, encoding: "utf8" });
  const good = run(join(fixtures, "pass-minimal.svg"));
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /^Passes/m);
  const bad = run(join(fixtures, "hold-text-contrast.svg"));
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /^line \d+  hold    /m);
  assert.match(bad.stdout, /Held: \d+ problem/);
  assert.equal(run("missing.svg").status, 2);
  assert.equal(run("empty.html").status, 2);
  const json = JSON.parse(run(join(fixtures, "advice-color-alone.svg"), "--json").stdout);
  assert.equal(json.held, false);
  assert.deepEqual(json.findings.map((f) => f.rule), ["color-alone"]);
});
