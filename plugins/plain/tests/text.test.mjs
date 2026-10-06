import { test } from "node:test";
import assert from "node:assert/strict";
import { stripIgnored, htmlToText, prepare, sentences } from "../scripts/lib/text.mjs";

test("code, links and quoted lines are removed, and the line count is kept", () => {
  const md = "Intro BLUF\n```\nconst SHA = 1\n```\nSee `READY` and [the pull request](https://x.y/Q21).\n> QUOTED LOG\nEnd";
  const out = stripIgnored(md).split("\n");
  assert.equal(out.length, 7);
  assert.equal(out[0], "Intro BLUF");
  assert.equal(out[1], "");
  assert.equal(out[2], "");
  assert.equal(out[4], "See code and the pull request.");
  assert.equal(out[5], "");
  assert.equal(out[6], "End");
});

test("file names and paths do not look like acronyms", () => {
  assert.equal(stripIgnored("Edit CLAUDE.md, GLOSSARY.md and .claude/plain.json now"), "Edit file, file and file now");
});

test("HTML pages lose styles, scripts and code, keep their text, and keep their line count", () => {
  const html = "<style>\n:root{--BG:#FFF}\n</style>\n<p>Hello &amp; welcome</p>\n<pre><code>READY\n</code></pre>\n<script>let SHA=1</script>";
  const out = htmlToText(html);
  assert.equal(out.split("\n").length, html.split("\n").length);
  assert.doesNotMatch(out, /BG|FFF|READY|SHA/);
  assert.match(out, /Hello & welcome/);
});

test("prepare uses the HTML path only for .html files", () => {
  assert.match(prepare("<p>A</p>", "page.html"), /^\s*A\s*$/);
  assert.equal(prepare("<p>A</p>", "notes.md"), "<p>A</p>");
});

test("sentences are split and counted; list items, table cells and headings stand alone", () => {
  const s = sentences("One two three. Four five.\n\n- item one\n| a b | c |\n|---|---|\n# Head");
  assert.deepEqual(
    s.map((x) => [x.text, x.line, x.words]),
    [["One two three.", 1, 3], ["Four five.", 1, 2], ["item one", 3, 2], ["a b", 4, 2], ["c", 4, 1], ["Head", 6, 1]],
  );
});

test("Windows line endings are handled", () => {
  assert.equal(stripIgnored("a\r\nb").split("\n").length, 2);
});
