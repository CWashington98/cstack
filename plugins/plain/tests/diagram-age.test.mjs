// Acceptance tests for diagram stamps and freshness: one per scenario in
// openspec/changes/add-spec-visuals/specs/plain/diagram-age/spec.md and the two
// every-change-has-a-dated-diagram scenarios in
// openspec/changes/add-spec-visuals/specs/rules/spec-format/spec.md, each named with its
// [scenario-id]. They were written before the feature and are locked: change them only
// in a commit with a "Spec-Change:" line.
//
// The command under test, run from inside a throwaway git repository:
//   node plugins/plain/scripts/diagram-age.mjs --today YYYY-MM-DD
//   node plugins/plain/scripts/diagram-age.mjs --today YYYY-MM-DD --validate <file.svg>
//   node plugins/plain/scripts/diagram-age.mjs --today YYYY-MM-DD --changes
// Assumptions the command must follow:
// - `--today YYYY-MM-DD` sets the date that ages are counted from, and the date that
//   --validate writes. Without it the command uses the real date.
// - With no path given it checks every folder named `diagrams` in the repository that
//   holds the current folder.
// - Each finding is one line that starts with its state word: unstamped, lagging, stale,
//   remove?, current or hold. Then the diagram's file name (a path from the repository
//   root is fine), then the reason.
// - diagrams.json is { "diagrams": [ { file, question, depicts, made, lastValidated } ] }.
// - Exit 1 when any diagram is unstamped, or, with --changes, when anything holds.
//   Exit 0 otherwise: lagging, stale and remove? never fail.
// - "After the lastValidated date" means on a later day. A commit on the validation day
//   itself doesn't make a diagram lagging.
// - --validate runs plain's diagram checker first. When it passes, it sets lastValidated
//   to today and rewrites the date at the end of the picture's "Last checked … on" line,
//   and changes nothing else. When it fails, it prints the checker's hold lines, exits 1
//   and leaves both files byte for byte as they were.
// - --changes checks each folder in openspec/changes, skipping `archive`. It holds a
//   change with no stamped diagram, and a diagram whose `diagrams/<name>.svg` path
//   design.md never mentions.
//
// The command is spawned, never imported, so a missing script fails each test by an
// assertion rather than stopping this file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeRepo } from "../../../tests/helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "diagram-age.mjs");
const PASSING = readFileSync(join(here, "fixtures", "diagram", "pass-minimal.svg"), "utf8");

const identity = {
  GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com",
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// "2026-10-25" -> "25 October 2026"
const inWords = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

// A small diagram that passes the checker, with the visible date line in muted words.
// `line` is the whole date line; `red` swaps a border for a red that isn't in the palette.
function diagram({ checked, line = `Last checked against the spec on ${inWords(checked)}.`, red = false }) {
  const svg = PASSING
    .replace('viewBox="0 0 400 200"', 'viewBox="0 0 640 240"')
    .replace('width="400" height="200"', 'width="640" height="240"')
    .replace("</svg>", `  <text x="20" y="215" fill="#9aa5b6" font-size="15">${line}</text>\n</svg>`);
  return red ? svg.replace('stroke="#6c788c"', 'stroke="#ff0000"') : svg;
}

const entry = (file, { depicts = ["src/app.mjs"], made, lastValidated }) => ({
  file,
  question: "How does a request move through the app?",
  depicts,
  made: made ?? lastValidated,
  lastValidated,
});
const stamps = (...entries) => `${JSON.stringify({ diagrams: entries }, null, 2)}\n`;

function write(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}

// Commits everything with author and committer dates set to `when`, an ISO date.
function commitAt(dir, when, message) {
  const date = `${when}T12:00:00+0000`;
  const env = { ...process.env, ...identity, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  execFileSync("git", ["add", "-A"], { cwd: dir, env });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-qm", message], { cwd: dir, env });
}

// A repository with `files` committed on `when`. plain is switched on with `settings`.
function repo(files, { when, settings = {} }) {
  const dir = realpathSync(makeRepo());
  write(dir, { ".claude/plain.json": `${JSON.stringify(settings)}\n`, "src/app.mjs": "export const app = 1;\n", ...files });
  commitAt(dir, when, "start");
  return dir;
}

function diagramAge(dir, today, ...args) {
  const r = spawnSync(process.execPath, [script, "--today", today, ...args], { cwd: dir, encoding: "utf8" });
  const out = `${r.stdout}${r.stderr}`;
  return { status: r.status, out, lines: out.split("\n") };
}

// The one line that starts with `state` and names `file`.
function lineFor(r, state, file) {
  const escaped = state.replace(/[?]/g, "\\?");
  const found = r.lines.filter((l) => new RegExp(`^${escaped}\\s`).test(l) && l.includes(file));
  assert.equal(found.length, 1, `expected one "${state}" line naming ${file}; got:\n${r.out}`);
  return found[0];
}

const read = (dir, path) => readFileSync(join(dir, path), "utf8");

// ---- diagrams-carry-a-stamp ----

test("[unlisted-diagram-is-unstamped] a diagram with no entry in diagrams.json is unstamped and exits 1", () => {
  const dir = repo({
    "docs/diagrams/flow.svg": diagram({ checked: "2026-10-18" }),
    "docs/diagrams/diagrams.json": stamps(),
  }, { when: "2026-10-18" });

  const r = diagramAge(dir, "2026-10-25");
  const line = lineFor(r, "unstamped", "flow.svg");
  assert.match(line, /docs\/diagrams\/flow\.svg/, "names the diagram by its path");
  assert.match(line, /no entry in diagrams\.json/);
  assert.equal(r.status, 1, r.out);
});

test("[visible-date-disagrees] a picture whose date differs from lastValidated is unstamped", () => {
  const dir = repo({
    "docs/diagrams/gate-flow.svg": diagram({ checked: "2026-09-01", line: "Last checked on 1 September 2026." }),
    "docs/diagrams/diagrams.json": stamps(entry("gate-flow.svg", { made: "2026-09-01", lastValidated: "2026-10-25" })),
  }, { when: "2026-10-25" });

  const r = diagramAge(dir, "2026-10-25");
  const line = lineFor(r, "unstamped", "gate-flow.svg");
  assert.match(line, /1 September 2026/, "says what the picture says");
  assert.match(line, /2026-10-25/, "says what diagrams.json says");
  assert.equal(r.status, 1, r.out);
});

// ---- freshness-is-reported ----

test("[depicted-file-changed-is-lagging] a depicted file changed after the last check is lagging, naming the date and the file", () => {
  const gate = "plugins/factory/scripts/lib/gate.mjs";
  const dir = repo({
    [gate]: "export const gate = 1;\n",
    "docs/diagrams/gate-flow.svg": diagram({ checked: "2026-10-25" }),
    "docs/diagrams/diagrams.json": stamps(entry("gate-flow.svg", { depicts: [gate], lastValidated: "2026-10-25" })),
  }, { when: "2026-10-25" });
  write(dir, { [gate]: "export const gate = 2;\n" });
  commitAt(dir, "2026-11-03", "change the gate");

  const r = diagramAge(dir, "2026-11-05");
  const line = lineFor(r, "lagging", "gate-flow.svg");
  assert.match(line, /gate\.mjs/, "names the changed file");
  assert.match(line, /3 November 2026|2026-11-03/, "names the date it changed");
  assert.match(line, /25 October 2026|2026-10-25/, "names the date it was last checked");
  assert.equal(r.status, 0, `lagging never fails:\n${r.out}`);
});

test("[unchecked-ninety-days-is-stale] a diagram last checked 100 days ago is stale; diagramMaxAgeDays moves the limit", () => {
  const files = {
    "docs/diagrams/onboarding-flow.svg": diagram({ checked: "2026-07-17" }),
    "docs/diagrams/diagrams.json": stamps(entry("onboarding-flow.svg", { lastValidated: "2026-07-17" })),
  };
  const dir = repo(files, { when: "2026-07-17" });
  const r = diagramAge(dir, "2026-10-25");
  assert.match(lineFor(r, "stale", "onboarding-flow.svg"), /100 days/);
  assert.equal(r.status, 0, `stale never fails:\n${r.out}`);

  // With the limit raised to 120 days in .claude/plain.json, 100 days is still current.
  const relaxed = repo(files, { when: "2026-07-17", settings: { diagramMaxAgeDays: 120 } });
  const later = diagramAge(relaxed, "2026-10-25");
  lineFor(later, "current", "onboarding-flow.svg");
  assert.equal(later.status, 0, later.out);
});

test("[unchecked-half-year-proposes-removal] a diagram last checked 200 days ago is remove?, and nothing is deleted", () => {
  const files = {
    "docs/diagrams/old-sync.svg": diagram({ checked: "2026-04-08" }),
    "docs/diagrams/diagrams.json": stamps(entry("old-sync.svg", { lastValidated: "2026-04-08" })),
  };
  const dir = repo(files, { when: "2026-04-08" });
  const r = diagramAge(dir, "2026-10-25");
  const line = lineFor(r, "remove?", "old-sync.svg");
  assert.match(line, /200 days/);
  assert.match(line, /delete/i, "tells a person they may delete it");
  assert.equal(r.status, 0, `remove? never fails:\n${r.out}`);
  assert.equal(read(dir, "docs/diagrams/old-sync.svg"), files["docs/diagrams/old-sync.svg"], "the diagram is still there, unchanged");
  assert.equal(read(dir, "docs/diagrams/diagrams.json"), files["docs/diagrams/diagrams.json"], "its entry is still there, unchanged");

  // With diagramRemoveAfterDays raised to 365, the same diagram is only stale.
  const relaxed = repo(files, { when: "2026-04-08", settings: { diagramRemoveAfterDays: 365 } });
  lineFor(diagramAge(relaxed, "2026-10-25"), "stale", "old-sync.svg");
});

test("[current-diagram-is-quiet] a diagram checked 10 days ago with no later change is current and exits 0", () => {
  const gate = "plugins/factory/scripts/lib/gate.mjs";
  // The commit that adds the diagram and the file it depicts is on the day it was checked.
  const dir = repo({
    [gate]: "export const gate = 1;\n",
    "docs/diagrams/gate-flow.svg": diagram({ checked: "2026-10-15" }),
    "docs/diagrams/diagrams.json": stamps(entry("gate-flow.svg", { depicts: [gate], lastValidated: "2026-10-15" })),
  }, { when: "2026-10-15" });

  const r = diagramAge(dir, "2026-10-25");
  assert.match(lineFor(r, "current", "gate-flow.svg"), /10 days/);
  for (const state of ["unstamped", "lagging", "stale", "remove?"]) {
    assert.ok(!r.lines.some((l) => l.startsWith(`${state} `)), `no "${state}" line expected:\n${r.out}`);
  }
  assert.equal(r.status, 0, r.out);
});

// ---- validating-updates-both-dates ----

test("[validate-updates-stamp-and-picture] --validate sets lastValidated and the picture's date to today, and never touches made", () => {
  const svgPath = "docs/diagrams/onboarding-flow.svg";
  const before = diagram({ checked: "2026-07-17", line: "Made 1 July 2026. Last checked against the code on 17 July 2026." });
  const dir = repo({
    [svgPath]: before,
    "docs/diagrams/diagrams.json": stamps(entry("onboarding-flow.svg", { made: "2026-07-01", lastValidated: "2026-07-17" })),
  }, { when: "2026-07-17" });
  lineFor(diagramAge(dir, "2026-10-25"), "stale", "onboarding-flow.svg");

  const v = diagramAge(dir, "2026-10-25", "--validate", svgPath);
  assert.equal(v.status, 0, v.out);
  const [stamp] = JSON.parse(read(dir, "docs/diagrams/diagrams.json")).diagrams;
  assert.equal(stamp.lastValidated, "2026-10-25");
  assert.equal(stamp.made, "2026-07-01", "made never changes");
  assert.equal(read(dir, svgPath), before.replace("17 July 2026", "25 October 2026"), "only the last-checked date in the picture changes");

  const next = diagramAge(dir, "2026-10-25");
  lineFor(next, "current", "onboarding-flow.svg");
  assert.equal(next.status, 0, next.out);
});

test("[validate-refuses-a-failing-diagram] --validate on a diagram that fails the checker exits 1 and changes neither file", () => {
  const svgPath = "docs/diagrams/onboarding-flow.svg";
  const files = {
    [svgPath]: diagram({ checked: "2026-07-17", red: true }),
    "docs/diagrams/diagrams.json": stamps(entry("onboarding-flow.svg", { made: "2026-07-01", lastValidated: "2026-07-17" })),
  };
  const dir = repo(files, { when: "2026-07-17" });

  const v = diagramAge(dir, "2026-10-25", "--validate", svgPath);
  assert.equal(v.status, 1, v.out);
  assert.match(v.out, /hold/, `prints the checker's hold lines:\n${v.out}`);
  assert.match(v.out, /#ff0000.*isn't in the palette/, `names the color that fails:\n${v.out}`);
  assert.equal(read(dir, svgPath), files[svgPath], "the picture is unchanged");
  assert.equal(read(dir, "docs/diagrams/diagrams.json"), files["docs/diagrams/diagrams.json"], "lastValidated keeps its old date");
});

// ---- every-change-has-a-dated-diagram (diagram-age --changes) ----

const CHANGE_DOCS = (name, design) => ({
  [`openspec/changes/${name}/proposal.md`]: "# Proposal\n\nAdd a thing.\n",
  [`openspec/changes/${name}/design.md`]: design,
  [`openspec/changes/${name}/tasks.md`]: "# Tasks\n\n- [ ] 1.1 Build the thing.\n",
  [`openspec/changes/${name}/specs/thing/spec.md`]: "## ADDED Requirements\n",
});

// A change that follows both rules: a stamped diagram that design.md shows.
const GOOD_CHANGE = {
  ...CHANGE_DOCS("add-good", "# Design\n\n![How the good thing works](diagrams/flow.svg)\n\nThe caption.\n"),
  "openspec/changes/add-good/diagrams/flow.svg": diagram({ checked: "2026-10-25" }),
  "openspec/changes/add-good/diagrams/diagrams.json": stamps(entry("flow.svg", { lastValidated: "2026-10-25" })),
};

// An archived change with no diagram, which --changes skips.
const ARCHIVED = CHANGE_DOCS("archive/2026-01-01-old-thing", "# Design\n\nNo picture.\n");

test("[change-without-diagram-holds] --changes holds a change folder with no diagrams/ folder, naming it", () => {
  const dir = repo({
    ...GOOD_CHANGE,
    ...ARCHIVED,
    ...CHANGE_DOCS("add-thing", "# Design\n\nHow the thing works, in words only.\n"),
  }, { when: "2026-10-25" });

  const r = diagramAge(dir, "2026-10-25", "--changes");
  const line = lineFor(r, "hold", "add-thing");
  assert.match(line, /add-thing has no diagram/);
  assert.match(line, /to-diagram/, "says how to fix it");
  assert.match(line, /diagrams\.json/, "says where to stamp it");
  assert.ok(!r.lines.some((l) => l.startsWith("hold") && l.includes("add-good")), `add-good follows both rules:\n${r.out}`);
  assert.ok(!r.out.includes("old-thing"), `archived changes are skipped:\n${r.out}`);
  assert.equal(r.status, 1, r.out);
});

test("[diagram-not-in-design-holds] --changes holds a stamped diagram that design.md never shows, naming it", () => {
  const dir = repo({
    ...GOOD_CHANGE,
    ...CHANGE_DOCS("add-thing", "# Design\n\nThe flow is drawn, but this page never shows it.\n"),
    "openspec/changes/add-thing/diagrams/flow.svg": diagram({ checked: "2026-10-25" }),
    "openspec/changes/add-thing/diagrams/diagrams.json": stamps(entry("flow.svg", { lastValidated: "2026-10-25" })),
  }, { when: "2026-10-25" });

  const r = diagramAge(dir, "2026-10-25", "--changes");
  const line = lineFor(r, "hold", "add-thing");
  assert.match(line, /add-thing: flow\.svg isn't shown in design\.md/);
  assert.ok(!r.lines.some((l) => l.startsWith("hold") && l.includes("add-good")), `add-good's design.md shows its diagram:\n${r.out}`);
  assert.equal(r.status, 1, r.out);
  assert.ok(existsSync(join(dir, "openspec/changes/add-thing/diagrams/flow.svg")));
});
