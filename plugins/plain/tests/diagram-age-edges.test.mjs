// Edge cases for diagram-age that the locked acceptance tests (diagram-age.test.mjs) don't
// reach. Each one came from a reproduced defect:
// - --changes must hold a diagram that fails plain's diagram checker, and an .svg that has
//   no diagrams.json entry;
// - the date a picture "shows" is only what a reader sees: <text> and <tspan> words, never
//   comments, <title> or <desc>; two visible "Last checked" lines are unstamped;
// - --changes' "shown in design.md" ignores HTML comments;
// - a malformed diagrams.json is reported, never a crash;
// - an entry with a missing field or an impossible date is unstamped.
// The command is spawned with --today, as in the locked file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeRepo } from "../../../tests/helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "diagram-age.mjs");
const PASSING = readFileSync(join(here, "fixtures", "diagram", "pass-minimal.svg"), "utf8");
const TODAY = "2026-10-25";

const identity = {
  GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com",
};

// A small diagram that passes the checker. `lines` are the text elements added at the bottom,
// `extra` is raw markup added before the closing tag.
function diagram({ lines = [`Last checked against the spec on 25 October 2026.`], extra = "", red = false } = {}) {
  const texts = lines.map((l, i) => `  <text x="20" y="215" fill="#9aa5b6" font-size="15">${l}</text>\n`).join("");
  const svg = PASSING
    .replace('viewBox="0 0 400 200"', 'viewBox="0 0 640 240"')
    .replace('width="400" height="200"', 'width="640" height="240"')
    .replace("</svg>", `${extra}${texts}</svg>`);
  return red ? svg.replace('stroke="#6c788c"', 'stroke="#ff0000"') : svg;
}

const FULL = {
  file: "flow.svg",
  question: "How does a request move through the app?",
  depicts: ["src/app.mjs"],
  made: TODAY,
  lastValidated: TODAY,
};
const stamps = (...entries) => `${JSON.stringify({ diagrams: entries }, null, 2)}\n`;

function write(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}

function repo(files) {
  const dir = realpathSync(makeRepo());
  write(dir, { "src/app.mjs": "export const app = 1;\n", ...files });
  const date = `${TODAY}T12:00:00+0000`;
  const env = { ...process.env, ...identity, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  execFileSync("git", ["add", "-A"], { cwd: dir, env });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-qm", "start"], { cwd: dir, env });
  return dir;
}

function diagramAge(dir, ...args) {
  const r = spawnSync(process.execPath, [script, "--today", TODAY, ...args], { cwd: dir, encoding: "utf8" });
  const out = `${r.stdout}${r.stderr}`;
  return { status: r.status, out, lines: out.split("\n") };
}

const read = (dir, path) => readFileSync(join(dir, path), "utf8");
const linesFor = (r, state, file) => r.lines.filter((l) => l.startsWith(`${state} `) && l.includes(file));

const DOCS = "docs/diagrams";
const SHOWN = "# Design\n\n![How it works](diagrams/flow.svg)\n";

// A change that follows every rule, plus extra files for the case under test.
function change(name, files = {}, design = SHOWN) {
  return {
    [`openspec/changes/${name}/design.md`]: design,
    [`openspec/changes/${name}/diagrams/flow.svg`]: diagram(),
    [`openspec/changes/${name}/diagrams/diagrams.json`]: stamps(FULL),
    ...Object.fromEntries(Object.entries(files).map(([k, v]) => [`openspec/changes/${name}/${k}`, v])),
  };
}

// ---- --changes ----

test("a change with a good diagram and no problems passes --changes", () => {
  const r = diagramAge(repo(change("add-thing")), "--changes");
  assert.equal(r.status, 0, r.out);
});

test("--changes holds a change whose diagram fails the checker, naming the file and the first reason", () => {
  const dir = repo(change("add-thing", { "diagrams/flow.svg": diagram({ red: true }) }));
  const r = diagramAge(dir, "--changes");
  const [line, ...more] = linesFor(r, "hold", "add-thing");
  assert.equal(more.length, 0, r.out);
  assert.match(line, /flow\.svg/);
  assert.match(line, /#ff0000.*isn't in the palette/, "gives the checker's reason");
  assert.equal(r.status, 1, r.out);
});

test("--changes holds an .svg in diagrams/ that has no diagrams.json entry", () => {
  const dir = repo(change("add-thing", {
    "diagrams/extra.svg": diagram(),
  }, `${SHOWN}\n![extra](diagrams/extra.svg)\n`));
  const r = diagramAge(dir, "--changes");
  const [line, ...more] = linesFor(r, "hold", "add-thing");
  assert.equal(more.length, 0, r.out);
  assert.match(line, /extra\.svg has no entry in diagrams\.json/);
  assert.equal(r.status, 1, r.out);
});

test("--changes does not count a diagram that design.md mentions only in an HTML comment", () => {
  const dir = repo(change("add-thing", {}, "# Design\n\n<!-- ![old](diagrams/flow.svg) -->\n\nWords only.\n"));
  const r = diagramAge(dir, "--changes");
  assert.match(linesFor(r, "hold", "add-thing").join("\n"), /flow\.svg isn't shown in design\.md/);
  assert.equal(r.status, 1, r.out);

  const multi = repo(change("add-thing", {}, "# Design\n\n<!--\nnotes\n![old](diagrams/flow.svg)\n-->\n![real](diagrams/flow.svg)\n"));
  assert.equal(diagramAge(multi, "--changes").status, 0, "a real mention beside a comment still counts");
});

test("--changes holds a change whose diagrams.json is not valid JSON, and does not crash", () => {
  const dir = repo(change("add-thing", { "diagrams/diagrams.json": "{ not json" }));
  const r = diagramAge(dir, "--changes");
  assert.match(linesFor(r, "hold", "add-thing").join("\n"), /diagrams\.json is not valid JSON/);
  assert.equal(r.status, 1, r.out);
});

// ---- the visible date ----

test("a date in a comment, <title> or <desc> is not the date the picture shows", () => {
  const hidden = diagram({
    lines: [],
    extra: '  <!-- Last checked on 25 October 2026 -->\n  <title>Last checked on 25 October 2026</title>\n  <desc>Last checked on 25 October 2026</desc>\n',
  });
  const dir = repo({ [`${DOCS}/flow.svg`]: hidden, [`${DOCS}/diagrams.json`]: stamps(FULL) });
  const r = diagramAge(dir);
  assert.match(linesFor(r, "unstamped", "flow.svg").join("\n"), /no "Last checked … on" date/, r.out);
  assert.equal(r.status, 1, r.out);

  const v = diagramAge(dir, "--validate", `${DOCS}/flow.svg`);
  assert.equal(v.status, 1, v.out);
  assert.equal(read(dir, `${DOCS}/flow.svg`), hidden, "the picture is unchanged");
});

test("a commented-out old date beside the real one does not disagree with diagrams.json", () => {
  const svg = diagram({ extra: "  <!-- Last checked on 1 September 2026 -->\n" });
  const dir = repo({ [`${DOCS}/flow.svg`]: svg, [`${DOCS}/diagrams.json`]: stamps(FULL) });
  const r = diagramAge(dir);
  assert.equal(linesFor(r, "current", "flow.svg").length, 1, r.out);
  assert.equal(r.status, 0, r.out);

  // --validate changes the visible date and leaves the comment alone.
  const v = diagramAge(dir, "--validate", `${DOCS}/flow.svg`);
  assert.equal(v.status, 0, v.out);
  assert.equal(read(dir, `${DOCS}/flow.svg`), svg, "same day, so the same bytes, comment untouched");
});

test("a date inside a <tspan> counts as visible", () => {
  const svg = diagram({ lines: ["<tspan>Last checked against the spec on 25 October 2026.</tspan>"] });
  const dir = repo({ [`${DOCS}/flow.svg`]: svg, [`${DOCS}/diagrams.json`]: stamps(FULL) });
  assert.equal(linesFor(diagramAge(dir), "current", "flow.svg").length, 1);
});

test("two visible Last checked lines are unstamped, and --validate refuses and changes nothing", () => {
  const svg = diagram({ lines: ["Last checked against the spec on 25 October 2026.", "Last checked against the code on 1 September 2026."] });
  const files = { [`${DOCS}/flow.svg`]: svg, [`${DOCS}/diagrams.json`]: stamps({ ...FULL, lastValidated: "2026-10-01" }) };
  const dir = repo(files);
  const r = diagramAge(dir);
  assert.match(linesFor(r, "unstamped", "flow.svg").join("\n"), /the picture shows 2 Last checked lines/, r.out);
  assert.equal(r.status, 1, r.out);

  const v = diagramAge(dir, "--validate", `${DOCS}/flow.svg`);
  assert.equal(v.status, 1, v.out);
  assert.match(v.out, /2 Last checked lines/);
  assert.equal(read(dir, `${DOCS}/flow.svg`), svg);
  assert.equal(read(dir, `${DOCS}/diagrams.json`), files[`${DOCS}/diagrams.json`]);
});

// ---- a malformed diagrams.json ----

for (const [label, content, reason] of [
  ["invalid JSON", "{ not json", /diagrams\.json is not valid JSON: /],
  ["diagrams that is not a list", '{ "diagrams": {} }', /diagrams\.json has no "diagrams" list/],
  ["a top-level null", "null", /diagrams\.json has no "diagrams" list/],
]) {
  test(`a diagrams.json with ${label} is reported for every .svg, and --validate refuses`, () => {
    const files = {
      [`${DOCS}/a.svg`]: diagram(),
      [`${DOCS}/b.svg`]: diagram(),
      [`${DOCS}/diagrams.json`]: content,
    };
    const dir = repo(files);
    const r = diagramAge(dir);
    for (const f of ["a.svg", "b.svg"]) {
      const [line, ...more] = linesFor(r, "unstamped", f);
      assert.equal(more.length, 0, r.out);
      assert.match(line, reason);
    }
    assert.ok(!/TypeError|at .*\.mjs/.test(r.out), `no stack trace:\n${r.out}`);
    assert.equal(r.status, 1, r.out);

    const v = diagramAge(dir, "--validate", `${DOCS}/a.svg`);
    assert.equal(v.status, 1, v.out);
    assert.match(v.out, reason);
    assert.ok(!/TypeError|at .*\.mjs/.test(v.out), `no stack trace:\n${v.out}`);
    assert.equal(read(dir, `${DOCS}/a.svg`), files[`${DOCS}/a.svg`]);
    assert.equal(read(dir, `${DOCS}/diagrams.json`), content);
  });
}

// ---- an incomplete or impossible entry ----

for (const field of ["file", "question", "depicts", "made", "lastValidated"]) {
  test(`an entry with no ${field} is unstamped, naming the field`, () => {
    const entry = { ...FULL };
    delete entry[field];
    // Without `file` the entry can only be matched by position, so the diagram has no usable entry.
    const dir = repo({ [`${DOCS}/flow.svg`]: diagram(), [`${DOCS}/diagrams.json`]: stamps(entry) });
    const r = diagramAge(dir);
    const [line] = linesFor(r, "unstamped", "flow.svg");
    assert.ok(line, r.out);
    if (field !== "file") assert.match(line, new RegExp(`"${field}"`));
    assert.equal(r.status, 1, r.out);
  });
}

test("an entry whose date is not a real calendar date is unstamped, naming the field", () => {
  for (const field of ["lastValidated", "made"]) {
    for (const bad of ["2026-02-31", "25 October 2026", "2026-13-01"]) {
      const dir = repo({ [`${DOCS}/flow.svg`]: diagram(), [`${DOCS}/diagrams.json`]: stamps({ ...FULL, [field]: bad }) });
      const r = diagramAge(dir);
      const [line] = linesFor(r, "unstamped", "flow.svg");
      assert.ok(line, `${field}=${bad}:\n${r.out}`);
      assert.match(line, new RegExp(`"${field}"`));
      assert.equal(r.status, 1, r.out);
    }
  }
});

test("--validate refuses an incomplete entry and changes nothing", () => {
  const entry = { ...FULL };
  delete entry.question;
  const files = { [`${DOCS}/flow.svg`]: diagram(), [`${DOCS}/diagrams.json`]: stamps(entry) };
  const dir = repo(files);
  const v = diagramAge(dir, "--validate", `${DOCS}/flow.svg`);
  assert.equal(v.status, 1, v.out);
  assert.match(v.out, /"question"/);
  assert.equal(read(dir, `${DOCS}/flow.svg`), files[`${DOCS}/flow.svg`]);
  assert.equal(read(dir, `${DOCS}/diagrams.json`), files[`${DOCS}/diagrams.json`]);
});
