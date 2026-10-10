import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkWriter, renderReview, extractItems } from "../scripts/lib/review-comment.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "verdict.mjs");
const HEAD = "a".repeat(40);
const PID = "b".repeat(40);

const finding = (id, over = {}) => ({
  id, claim: `claim ${id}`, file: "src/cart.js", line: 12, severity: "note", trigger: "add an item twice",
  how_to_reproduce: "npm test", impact: "the total is wrong", fix: "count each item once",
  done_when: "npm test -- cart passes, including the new removal test", touches: ["src/cart.js"],
  reproduced: true, reproduction: `ran npm test for ${id}; it failed`, ...over,
});
const record = (reviewer, findings = [], over = {}) => {
  const blocking = findings.some((f) => f.severity === "blocking" && f.reproduced);
  return { reviewer, model: null, note: null, head: HEAD, base: "origin/main", patchId: PID, said: blocking ? "not ready" : "ready", verdict: blocking ? "not ready" : "ready", summary: "s", findings, ...over };
};
const writer = (items = [], over = {}) => ({
  what_it_does: "People who add the same item twice were charged twice. This change counts each item once.",
  merge_risk: { level: "low", why: "It changes one calculation. Undoing the merge restores the old total exactly." },
  items,
  checked: ["Added the same item twice in a real browser: the total counted it once."],
  not_checked: [],
  ...over,
});
const item = (sources, over = {}) => ({ sources, title: "The total can still be wrong", what_goes_wrong: "A shopper who removes an item sees the old total.", fix: "Recount after a removal.", ...over });

test("a clean review says ready and that nothing needs doing", () => {
  const md = renderReview({ claimsAuditor: record("claims-auditor"), other: record("codex"), writer: writer() });
  assert.match(md, /^<!-- verify-review head=a{40} patch-id=b{40} claims-auditor=ready other=codex:ready -->/);
  assert.match(md, /## Review: ready to merge\n/);
  assert.match(md, /\*\*What you need to do:\*\* nothing\. It can merge\./);
  assert.match(md, /### Your decision\n\nNone\./);
  assert.match(md, /### Must fix before merge\n\nNone\./);
  assert.match(md, /### Worth fixing later\n\nNone\./);
  assert.match(md, /\*\*Merge risk: low\.\*\* It changes one calculation/);
  assert.match(md, /### What nobody checked\n\n- Nothing the reviewers know of\./);
  assert.match(md, /\*\*Who reviewed it:\*\* two AI reviewers from different companies.*the claims auditor, which runs on Claude \(made by Anthropic\), and Codex \(made by OpenAI\).*the checking agent/);
});

test("titles end in a full stop so they don't run into the next sentence", () => {
  const claimsAuditor = record("claims-auditor", [finding("claims-auditor-1")]);
  const md = renderReview({ claimsAuditor, other: record("codex"), writer: writer([item(["claims-auditor-1"], { title: "The total is stale" })]) });
  assert.match(md, /\*\*1\. The total is stale\.\*\* A shopper/);
});

test("findings are grouped, numbered once in order, and the strictest source sets the group", () => {
  const claimsAuditor = record("claims-auditor", [finding("claims-auditor-1", { severity: "blocking" }), finding("claims-auditor-2", { severity: "decide" }), finding("claims-auditor-3")]);
  const codex = record("codex", [finding("codex-1"), finding("codex-2")]);
  const w = writer([
    item(["claims-auditor-3"], { title: "Later thing" }),
    item(["claims-auditor-1", "codex-1"], { title: "Blocking thing" }),
    item(["claims-auditor-2"], { title: "Decision thing", fix: undefined, options: [{ label: "A", text: "Tighten it.", recommended: true }, { label: "B", text: "Leave it.", recommended: false }] }),
    item(["codex-2"], { title: "Second later thing" }),
  ]);
  const md = renderReview({ claimsAuditor, other: codex, writer: w });
  const order = ["1. Decision thing", "2. Blocking thing", "3. Later thing", "4. Second later thing"].map((t) => md.indexOf(`**${t}`));
  assert.ok(order.every((i) => i > 0) && order.every((v, i) => i === 0 || v > order[i - 1]), md);
  assert.match(md, /## Review: not ready, 1 item to fix before merging/);
  assert.match(md, /\*\*What you need to do:\*\* fix item 2 before merging\. Then answer item 1\./);
  assert.match(md, /\*\*A \(recommended\):\*\* Tighten it\./);
  assert.match(md, /Both reviewers found this, and the checking agent made it happen\./);
  assert.match(md, /Found by the claims auditor, and the checking agent made it happen\./);
});

test("a decision with nothing to fix says so in the headline", () => {
  const claimsAuditor = record("claims-auditor", [finding("claims-auditor-1", { severity: "decide" })]);
  const w = writer([item(["claims-auditor-1"], { fix: undefined, options: [{ label: "A", text: "x", recommended: true }, { label: "B", text: "y", recommended: false }] })]);
  const md = renderReview({ claimsAuditor, other: record("codex"), writer: w });
  assert.match(md, /## Review: ready to merge, with 1 decision for you/);
  assert.match(md, /answer item 1\. Nothing has to be fixed before merging\./);
});

test("the writer must cover every confirmed finding exactly once, and nothing else", () => {
  const claimsAuditor = record("claims-auditor", [finding("claims-auditor-1"), finding("claims-auditor-2", { reproduced: false, reproduction: "could not see it" })]);
  const codex = record("codex", [finding("codex-1")]);
  const problems = (items) => checkWriter({ claimsAuditor, other: codex }, writer(items)).join("\n");
  assert.match(problems([item(["claims-auditor-1"])]), /codex-1 is not in any item/);
  assert.match(problems([item(["claims-auditor-1", "codex-1"]), item(["codex-1"])]), /codex-1 is in more than one item/);
  assert.match(problems([item(["claims-auditor-1", "codex-1", "claims-auditor-2"])]), /claims-auditor-2 was not confirmed/);
  assert.match(problems([item(["claims-auditor-1", "codex-1", "claims-auditor-9"])]), /claims-auditor-9 is not a finding/);
  assert.match(problems([item(["claims-auditor-1", "codex-1"]), item([])]), /item 2 has no sources/);
  assert.equal(problems([item(["claims-auditor-1", "codex-1"])]), "");
});

test("decisions need options with exactly one recommended; other items need a fix and no options", () => {
  const claimsAuditor = record("claims-auditor", [finding("claims-auditor-1", { severity: "decide" }), finding("claims-auditor-2")]);
  const opts = (r1, r2) => [{ label: "A", text: "x", recommended: r1 }, { label: "B", text: "y", recommended: r2 }];
  const run = (i1, i2) => checkWriter({ claimsAuditor, other: record("codex") }, writer([i1, i2])).join("\n");
  assert.match(run(item(["claims-auditor-1"], { options: opts(false, false) }), item(["claims-auditor-2"])), /exactly one recommended option/);
  assert.match(run(item(["claims-auditor-1"], { options: [opts(true)[0]] }), item(["claims-auditor-2"])), /at least two options/);
  assert.match(run(item(["claims-auditor-1"], { options: opts(true, false) }), item(["claims-auditor-2"], { fix: "" })), /item 2 needs a suggested fix/);
  assert.match(run(item(["claims-auditor-1"], { options: opts(true, false) }), item(["claims-auditor-2"], { options: opts(true, false) })), /only a decision has options/);
});

test("the writer's text stays short and plain, with code kept in the technical detail", () => {
  const claimsAuditor = record("claims-auditor", [finding("claims-auditor-1")]);
  const run = (over, itemOver = {}) => checkWriter({ claimsAuditor, other: record("codex") }, writer([item(["claims-auditor-1"], itemOver)], over)).join("\n");
  assert.match(run({}, { what_goes_wrong: "The `total()` function double counts." }), /backticks/);
  assert.match(run({}, { what_goes_wrong: "Word word word word word word word word word word. ".repeat(8) }), /what_goes_wrong.*70 words/);
  assert.match(run({ what_it_does: "" }), /what_it_does is missing/);
  assert.match(run({ checked: [] }), /checked needs at least one line/);
  assert.match(run({ merge_risk: { level: "tiny", why: "x" } }), /merge_risk\.level must be low, medium or high/);
});

test("merge risk can't be lower than any reviewer's", () => {
  const claimsAuditor = record("claims-auditor", [], { merge_risk: { level: "high", why: "changes sign-in" } });
  assert.match(checkWriter({ claimsAuditor, other: record("codex") }, writer()).join(), /Claims auditor rated the merge risk high/);
});

test("a fallback reviewer is named, and the missing second opinion is listed as unchecked", () => {
  const other = record("claude-fallback", [], { note: "Codex hit its usage limit", model: "sonnet" });
  const md = renderReview({ claimsAuditor: record("claims-auditor"), other, writer: writer() });
  assert.match(md, /other=claude-fallback:ready/);
  assert.match(md, /Codex could not run, so a second Claude reviewer stood in\. This review has no opinion from a second AI company\./);
  assert.match(md, /Why Codex could not run: Codex hit its usage limit/);
  assert.doesNotMatch(md, /Nothing the reviewers know of/);
});

test("when the reviewers disagree, the owner is told to decide", () => {
  const claimsAuditor = record("claims-auditor", [finding("claims-auditor-1", { severity: "blocking" })]);
  const md = renderReview({ claimsAuditor, other: record("codex"), writer: writer([item(["claims-auditor-1"])]) });
  assert.match(md, /The reviewers disagree: the claims auditor says not ready and Codex says ready\. You decide\./);
});

test("the technical detail keeps file, line, proof, verdicts, commit and dropped findings, closed by default", () => {
  const claimsAuditor = record("claims-auditor", [finding("claims-auditor-1"), finding("claims-auditor-2", { reproduced: false, reproduction: "could not see it" })]);
  const md = renderReview({ claimsAuditor, other: record("codex"), writer: writer([item(["claims-auditor-1"])]) });
  const detail = md.slice(md.indexOf("<details>"));
  assert.ok(md.indexOf("<details>") > md.indexOf("### What nobody checked"));
  assert.match(detail, /<summary>Technical detail, for engineers<\/summary>/);
  assert.match(detail, /`src\/cart\.js:12`/);
  assert.match(detail, /ran npm test for claims-auditor-1; it failed/);
  assert.match(detail, /Claims auditor \(Claude\): ready/);
  assert.match(detail, /Codex \(OpenAI\): ready/);
  assert.match(detail, /`aaaaaaaaaaaa`/);
  assert.match(detail, /A new commit clears this review/);
  assert.match(detail, /Dropped, because the checking agent could not make them happen:\n- claim claims-auditor-2\./);
});

test("rendering refuses a writer that fails the check, and verdicts for different changes", () => {
  const claimsAuditor = record("claims-auditor", [finding("claims-auditor-1")]);
  assert.throws(() => renderReview({ claimsAuditor, other: record("codex"), writer: writer() }), /claims-auditor-1 is not in any item/);
  assert.throws(() => renderReview({ claimsAuditor: record("claims-auditor"), other: record("codex", [], { head: "c".repeat(40), patchId: "d".repeat(40) }), writer: writer() }), /different change/);
});

test("the review command prints the comment, or the problems and exit 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "review-"));
  const put = (name, v) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(v)); return p; };
  const k = put("k.json", record("claims-auditor", [finding("claims-auditor-1")]));
  const o = put("o.json", record("codex"));
  const ok = spawnSync(process.execPath, [script, "review", "--claims-auditor", k, "--other", o, "--writer", put("w.json", writer([item(["claims-auditor-1"])]))], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /## Review: ready to merge/);
  const bad = spawnSync(process.execPath, [script, "review", "--claims-auditor", k, "--other", o, "--writer", put("w2.json", writer())], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /hold  claims-auditor-1 is not in any item/);
});

test("a realistic comment passes the plain-English checker", () => {
  const plainCheck = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "plain", "scripts", "plain-check.mjs");
  const claimsAuditor = record("claims-auditor", [finding("claims-auditor-1", { severity: "decide" }), finding("claims-auditor-2")], { merge_risk: { level: "low", why: "screen only" } });
  const codex = record("claude-fallback", [finding("codex-1"), finding("codex-2", { reproduced: false, reproduction: "the total was right" })], { note: "Codex hit its usage limit", model: "sonnet" });
  const w = writer([
    item(["claims-auditor-1"], { title: "Should a second discount be allowed on the same item?", what_goes_wrong: "The spec allows it today, but then a shopper can pay less than the store's lowest price. No test covers it.", fix: undefined, options: [{ label: "A", text: "Allow one discount per item. About ten lines.", recommended: true }, { label: "B", text: "Keep both, and decide later.", recommended: false }] }),
    item(["claims-auditor-2", "codex-1"], { title: "Removing an item leaves the old total on screen", what_goes_wrong: "A shopper who removes an item still sees the old total until they reload the page. They pay the right amount, but the screen is wrong.", fix: "Recount the total after every removal." }),
  ]);
  const dir = mkdtempSync(join(tmpdir(), "review-plain-"));
  const file = join(dir, "comment.md");
  writeFileSync(file, renderReview({ claimsAuditor, other: codex, writer: w }));
  const r = spawnSync(process.execPath, [plainCheck, file], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("both reports using the same finding id is refused, so no finding can hide another", () => {
  const claimsAuditor = record("claims-auditor", [finding("1", { severity: "blocking" })]);
  const codex = record("codex", [finding("1")]);
  assert.match(checkWriter({ claimsAuditor, other: codex }, writer([item(["1"])])).join(), /both reviewers used the finding id 1/);
});

test("the comment can't say ready while a verdict says not ready, or the reverse", () => {
  const claimsAuditor = record("claims-auditor", [finding("claims-auditor-1")], { verdict: "not ready" });
  assert.match(checkWriter({ claimsAuditor, other: record("codex") }, writer([item(["claims-auditor-1"])])).join(), /Claims auditor's verdict is not ready, but no item is a must-fix/);
});

test("a dropped finding with no notes still renders", () => {
  const claimsAuditor = record("claims-auditor", [finding("claims-auditor-1", { reproduced: false, reproduction: undefined })]);
  assert.match(renderReview({ claimsAuditor, other: record("codex"), writer: writer() }), /claim claims-auditor-1\. \(claims-auditor-1, from the claims auditor\.\) Checked: no notes recorded\./);
});

test("an item that isn't an object is a problem, not a crash", () => {
  assert.match(checkWriter({ claimsAuditor: record("claims-auditor"), other: record("codex") }, writer([null])).join(), /item 1 must be an object/);
});

test("file names, function calls and commands are refused in the plain text even without backticks", () => {
  const claimsAuditor = record("claims-auditor", [finding("claims-auditor-1")]);
  const run = (txt) => checkWriter({ claimsAuditor, other: record("codex") }, writer([item(["claims-auditor-1"], { what_goes_wrong: txt })])).join();
  assert.match(run("It breaks in src/cart.js."), /looks like code/);
  assert.match(run("It calls total() too early."), /looks like code/);
  assert.match(run("Ran npm test and it failed."), /looks like code/);
  assert.equal(run("A shopper sees the old total."), "");
});

test("a decision finding accepted by the recorder, two recommended options refused, two items listed with 'and'", () => {
  const claimsAuditor = record("claims-auditor", [finding("claims-auditor-1", { severity: "blocking" }), finding("claims-auditor-2", { severity: "blocking" }), finding("claims-auditor-3", { severity: "decide" })], { verdict: "not ready" });
  const opts = [{ label: "A", text: "x", recommended: true }, { label: "B", text: "y", recommended: true }];
  assert.match(checkWriter({ claimsAuditor, other: record("codex") }, writer([item(["claims-auditor-1"]), item(["claims-auditor-2"]), item(["claims-auditor-3"], { fix: undefined, options: opts })])).join(), /exactly one recommended option/);
  opts[1].recommended = false;
  const md = renderReview({ claimsAuditor, other: record("codex"), writer: writer([item(["claims-auditor-1"]), item(["claims-auditor-2"]), item(["claims-auditor-3"], { fix: undefined, options: opts })]) });
  assert.match(md, /fix items 2 and 3 before merging\. Then answer item 1\./);
});

test("word limits allow the limit and refuse one word more", () => {
  const claimsAuditor = record("claims-auditor", [finding("claims-auditor-1")]);
  const run = (n) => checkWriter({ claimsAuditor, other: record("codex") }, writer([item(["claims-auditor-1"], { what_goes_wrong: Array.from({ length: n }, (_, i) => (i % 10 === 9 ? "word." : "word")).join(" ") })])).join();
  assert.equal(run(70), "");
  assert.match(run(71), /70 words/);
});

test("two empty changes on different commits are not the same change", () => {
  const a = record("claims-auditor", [], { patchId: "empty" });
  const b = record("codex", [], { patchId: "empty", head: "c".repeat(40) });
  assert.throws(() => renderReview({ claimsAuditor: a, other: b, writer: writer() }), /different change/);
});

test("a reviewer whose own verdict differs from the confirmed one is explained in the detail", () => {
  const claimsAuditor = record("claims-auditor", [], { said: "not ready" });
  assert.match(renderReview({ claimsAuditor, other: record("codex"), writer: writer() }), /Claims auditor \(Claude\) said "not ready"; only findings the checking agent confirmed count/);
});

test("a sentence longer than the plain-English checker allows is refused", () => {
  const claimsAuditor = record("claims-auditor", [finding("claims-auditor-1")]);
  const long = "Add tests for the question rating, two recommended options, a two item list, each word limit, empty changes, and the note shown when the verdict a reviewer gave differs from the one its own checked problems give.";
  const run = (fix) => checkWriter({ claimsAuditor, other: record("codex") }, writer([item(["claims-auditor-1"], { fix })])).join();
  assert.match(run(long), /a sentence of 37 words; split it so each sentence has at most 30/);
  assert.equal(run("Add tests for each check. Start with the question rating."), "");
});

test("each item carries a work packet an agent can pick up on its own", () => {
  const claimsAuditor = record("claims-auditor", [finding("claims-auditor-1", { severity: "blocking", touches: ["src/cart.js", "src/cart.test.js"] }), finding("claims-auditor-2")]);
  const codex = record("codex", [finding("codex-1", { touches: ["src/total.js"], done_when: "The total test passes" })]);
  const md = renderReview({ claimsAuditor, other: codex, writer: writer([item(["claims-auditor-1", "codex-1"]), item(["claims-auditor-2"], { after: ["claims-auditor-1"] })]) });
  const detail = md.slice(md.indexOf("<details>"));
  assert.match(detail, /\*\*Item 1, must fix: The total can still be wrong\.\*\*/);
  assert.match(detail, /- Files: `src\/cart\.js`, `src\/cart\.test\.js`, `src\/total\.js`/);
  assert.match(detail, /- Show the problem: `npm test`/);
  assert.match(detail, /- Done when: npm test -- cart passes, including the new removal test\. The total test passes\./);
  assert.match(detail, /- Suggested fix: Recount after a removal\./);
  assert.match(detail, /- Do after: none/);
  assert.match(detail, /\*\*Item 2, worth fixing later:[^\n]*\n(?:- [^\n]*\n)*- Do after: item 1/);
});

test("the packets round-trip through a hidden machine-readable block", () => {
  const claimsAuditor = record("claims-auditor", [finding("claims-auditor-1", { severity: "blocking", claim: "breaks on -->" }), finding("claims-auditor-2", { severity: "decide" })]);
  const opts = [{ label: "A", text: "x", recommended: true }, { label: "B", text: "y", recommended: false }];
  const md = renderReview({ claimsAuditor, other: record("codex"), writer: writer([item(["claims-auditor-1"]), item(["claims-auditor-2"], { fix: undefined, options: opts })]) });
  const items = extractItems(md);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => [i.n, i.group]), [[1, "decide"], [2, "must fix"]]);
  assert.equal(items[1].sources[0].claim, "breaks on -->");
  assert.deepEqual(items[1].files, ["src/cart.js"]);
  assert.equal(items[0].options.length, 2);
  assert.equal(items[1].head, "a".repeat(40));
  const block = md.slice(md.indexOf("<!-- verify-review-items")).trimEnd();
  assert.equal(block.indexOf("-->"), block.length - 3, "nothing inside the hidden block can close it early");
});

test("an item can only wait for findings in other items, and never for itself", () => {
  const claimsAuditor = record("claims-auditor", [finding("claims-auditor-1"), finding("claims-auditor-2")]);
  const run = (after) => checkWriter({ claimsAuditor, other: record("codex") }, writer([item(["claims-auditor-1"]), item(["claims-auditor-2"], { after })])).join();
  assert.match(run(["claims-auditor-9"]), /item 2 waits for claims-auditor-9, which is not a confirmed finding/);
  assert.match(run(["claims-auditor-2"]), /item 2 can't wait for itself/);
  assert.equal(run(["claims-auditor-1"]), "");
});

test("the items command prints the packets as JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "items-"));
  const md = renderReview({ claimsAuditor: record("claims-auditor", [finding("claims-auditor-1")]), other: record("codex"), writer: writer([item(["claims-auditor-1"])]) });
  const f = join(dir, "comment.md"); writeFileSync(f, md);
  const r = spawnSync(process.execPath, [script, "items", f], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout)[0].title, "The total can still be wrong.");
});

// The claims auditor used to be called karen; its verdicts saved before the rename say
// reviewer "karen" and must still make a review comment that uses the new name.
test("an old verdict saved under the name karen renders as the claims auditor's", () => {
  const old = record("karen", [finding("karen-1", { severity: "blocking" })]);
  const md = renderReview({ claimsAuditor: old, other: record("codex"), writer: writer([item(["karen-1"])]) });
  assert.match(md, /claims-auditor=not ready/);
  assert.match(md, /Found by the claims auditor, and the checking agent made it happen\./);
  assert.match(md, /Claims auditor \(Claude\): not ready/);
  assert.doesNotMatch(md, /Karen|undefined/);
  assert.equal(extractItems(md)[0].sources[0].reviewer, "claims-auditor");
});

test("the review command takes the claims auditor's verdict with --claims-auditor", () => {
  const dir = mkdtempSync(join(tmpdir(), "review-"));
  const put = (name, v) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(v)); return p; };
  const args = (flag) => [script, "review", flag, put("k.json", record("karen")), "--other", put("o.json", record("codex")), "--writer", put("w.json", writer())];
  const ok = spawnSync(process.execPath, args("--claims-auditor"), { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /## Review: ready to merge/);
  assert.equal(spawnSync(process.execPath, args("--karen"), { encoding: "utf8" }).status, 2);
});
