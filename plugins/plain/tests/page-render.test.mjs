import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderPage, inline } from "../scripts/page-render.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "page-render.mjs");
const example = join(here, "..", "skills", "to-page", "example.json");
const decision = (title, extra = {}) => ({ kind: "decision", title, options: [{ label: "Yes" }], recommendation: "Yes.", noAnswer: "Nothing.", ...extra });

test("the example brief renders", () => {
  const { html, errors } = renderPage(JSON.parse(readFileSync(example, "utf8")));
  assert.deepEqual(errors, []);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /Copy answers/);
  assert.match(html, /At a glance/);
});

test("a decision without options, a recommendation or a no-answer line is refused", () => {
  const { html, errors } = renderPage({ title: "t", sections: [{ kind: "decision", title: "x" }] });
  assert.equal(html, undefined);
  assert.equal(errors.length, 3);
  assert.match(errors.join(" "), /options/);
  assert.match(errors.join(" "), /recommendation/);
  assert.match(errors.join(" "), /noAnswer/);
});

test("an unknown kind and a missing title are refused", () => {
  const { errors } = renderPage({ sections: [{ kind: "poll" }] });
  assert.ok(errors.some((e) => /brief needs a title/.test(e)));
  assert.ok(errors.some((e) => /kind must be one of/.test(e)));
  assert.ok(errors.some((e) => /missing title/.test(e)));
});

test("cards are ordered close, decision, info, fyi, and decisions are numbered to match the glance table", () => {
  const { html } = renderPage({
    title: "t",
    sections: [{ kind: "fyi", title: "F" }, decision("D1"), { kind: "info", title: "I" }, { kind: "close", title: "C" }, decision("D2")],
  });
  const order = [...html.matchAll(/<section class="card (\w+)" data-title="([^"]+)"/g)].map((m) => m[2]);
  assert.deepEqual(order, ["C", "D1", "D2", "I", "F"]);
  assert.match(html, /Decision 1<\/span>\n<h2>D1/);
  assert.match(html, /Decision 2<\/span>\n<h2>D2/);
});

test("the glance table appears only with two or more decisions, and can be turned off", () => {
  assert.doesNotMatch(renderPage({ title: "t", sections: [decision("D")] }).html, /At a glance/);
  assert.doesNotMatch(renderPage({ title: "t", glance: false, sections: [decision("A"), decision("B")] }).html, /At a glance/);
});

test("an Other option is added unless noOther is set", () => {
  assert.match(renderPage({ title: "t", sections: [decision("D")] }).html, /value="other"/);
  assert.doesNotMatch(renderPage({ title: "t", sections: [decision("D", { noOther: true })] }).html, /value="other"/);
});

test("a page with nothing to answer has no copy button", () => {
  assert.doesNotMatch(renderPage({ title: "t", sections: [{ kind: "info", title: "I", body: "b" }] }).html, /Copy answers/);
});

test("text is escaped; only code, bold and https links become markup", () => {
  assert.equal(inline('<script>x</script> `a<b>` **bold** [l](https://e.com) [j](javascript:alert(1))'), '&lt;script&gt;x&lt;/script&gt; <code>a&lt;b&gt;</code> <b>bold</b> <a href="https://e.com">l</a> [j](javascript:alert(1))');
});

test("a flow draws one box per step, with the arrow label on the arrow into its step", () => {
  const { html } = renderPage({ title: "t", sections: [{ title: "F", flow: ["A", { label: "B", note: "n", arrow: "sends" }] }] });
  assert.equal(html.match(/class="step"/g).length, 2);
  assert.equal(html.match(/class="arrow"/g).length, 1);
  assert.match(html, /<small>sends<\/small><span aria-hidden="true">→<\/span><\/div><div class="step"><b>B<\/b><small>n<\/small>/);
});

test("a diagram is embedded from its file, and a missing file is refused", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><title>x</title></svg>';
  const ok = renderPage({ title: "t", sections: [{ title: "D", diagram: "a.svg", caption: "Notice" }] }, { readFragment: (f) => (f === "a.svg" ? svg : null) });
  assert.ok(ok.html.includes(`<div class="diagram">${svg}</div><figcaption>Notice</figcaption>`));
  const missing = renderPage({ title: "t", sections: [{ title: "D", diagram: "b.svg" }] }, { readFragment: () => null });
  assert.match(missing.errors[0], /diagram file not found: b.svg/);
});

test("the page loads nothing from the internet", () => {
  const { html } = renderPage(JSON.parse(readFileSync(example, "utf8")));
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/);
});

test("the command line writes the page, reads diagrams beside the brief, and exits 1 on a bad brief", () => {
  const dir = mkdtempSync(join(tmpdir(), "to-page-"));
  writeFileSync(join(dir, "d.svg"), "<svg><title>d</title></svg>");
  writeFileSync(join(dir, "good.json"), JSON.stringify({ title: "t", sections: [{ title: "D", diagram: "d.svg" }] }));
  writeFileSync(join(dir, "bad.json"), JSON.stringify({ title: "t", sections: [{ kind: "decision", title: "x" }] }));
  const good = spawnSync(process.execPath, [script, join(dir, "good.json"), join(dir, "good.html")], { encoding: "utf8" });
  assert.equal(good.status, 0, good.stderr);
  assert.match(readFileSync(join(dir, "good.html"), "utf8"), /<svg><title>d<\/title><\/svg>/);
  const bad = spawnSync(process.execPath, [script, join(dir, "bad.json"), join(dir, "bad.html")], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /a decision needs options/);
  assert.equal(spawnSync(process.execPath, [script], { encoding: "utf8" }).status, 2);
});

test("the command line still runs when the script is reached through a symlink", () => {
  const dir = mkdtempSync(join(tmpdir(), "to-page-link-"));
  symlinkSync(dirname(script), join(dir, "scripts"));
  writeFileSync(join(dir, "b.json"), JSON.stringify({ title: "t", sections: [] }));
  const run = spawnSync(process.execPath, [join(dir, "scripts", "page-render.mjs"), join(dir, "b.json"), join(dir, "b.html")], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /wrote/);
  assert.match(readFileSync(join(dir, "b.html"), "utf8"), /<title>t<\/title>/);
});
