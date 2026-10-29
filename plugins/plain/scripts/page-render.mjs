#!/usr/bin/env node
// Renders a to-page brief (JSON) into one standalone HTML page. No model, no network.
// Usage: node page-render.mjs <brief.json> <page.html>
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const KINDS = ["close", "decision", "info", "fyi"];
const LABELS = { close: "You can close", decision: "Decision", info: "Note", fyi: "FYI" };

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Inline markup: `code`, **bold**, [text](https://url). Everything else is escaped.
export const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');

// Blank lines split paragraphs; a paragraph of "- " lines becomes a list.
const prose = (s) =>
  !s
    ? ""
    : String(s)
        .trim()
        .split(/\n\s*\n/)
        .map((para) => {
          const lines = para.split("\n");
          if (lines.every((l) => l.trim().startsWith("- "))) return `<ul>${lines.map((l) => `<li>${inline(l.trim().slice(2))}</li>`).join("")}</ul>`;
          return `<p>${inline(lines.join(" "))}</p>`;
        })
        .join("\n");

const isNumber = (c) => /^[-+~]?[\d.,]+\s?(%|[a-zA-Z]{0,3})$|^\d+\s?m\s\d+\s?s$/.test(String(c).trim());

const table = (t) => {
  if (!t) return "";
  const head = t.headers.map((h) => `<th>${inline(h)}</th>`).join("");
  const rows = t.rows.map((r) => `<tr>${r.map((c) => `<td${isNumber(c) ? ' class="n"' : ""}>${inline(c)}</td>`).join("")}</tr>`).join("");
  return `${t.caption ? `<p class="muted">${inline(t.caption)}</p>` : ""}<div class="scroll"><table><tr>${head}</tr>${rows}</table></div>`;
};

// A straight line of steps: boxes joined by arrows, wrapping on narrow screens.
// A step is a string or { label, note, arrow } where arrow labels the arrow into it.
const flow = (steps) => {
  if (!steps) return "";
  const parts = steps.map((s, i) => {
    const step = typeof s === "string" ? { label: s } : s;
    const arrow = i === 0 ? "" : `<div class="arrow">${step.arrow ? `<small>${inline(step.arrow)}</small>` : ""}<span aria-hidden="true">→</span></div>`;
    return `${arrow}<div class="step"><b>${inline(step.label)}</b>${step.note ? `<small>${inline(step.note)}</small>` : ""}</div>`;
  });
  return `<div class="flow" role="list">${parts.join("")}</div>`;
};

export function renderPage(brief, { readFragment = () => null } = {}) {
  const errors = [];
  const sections = brief.sections ?? [];
  if (!brief.title) errors.push("the brief needs a title");
  let decisionNo = 0;
  let hasInputs = false;

  const card = (c, i) => {
    const kind = c.kind ?? "info";
    const where = `section ${i + 1} ("${c.title ?? ""}")`;
    if (!KINDS.includes(kind)) errors.push(`${where}: kind must be one of ${KINDS.join(", ")}`);
    if (!c.title) errors.push(`${where}: missing title`);
    if (kind === "decision") {
      if (!c.options?.length) errors.push(`${where}: a decision needs options`);
      if (!c.recommendation) errors.push(`${where}: a decision needs a recommendation`);
      if (!c.noAnswer) errors.push(`${where}: a decision needs noAnswer`);
    }
    const label = c.tag ?? (kind === "decision" ? `Decision ${++decisionNo}` : LABELS[kind] ?? kind);
    const parts = [`<span class="tag">${esc(label)}</span>`, `<h2>${inline(c.title ?? "")}</h2>`, prose(c.body), flow(c.flow), table(c.table)];
    if (c.list) parts.push(`<ul>${c.list.map((l) => `<li>${inline(l)}</li>`).join("")}</ul>`);
    if (c.diagram) {
      const svg = readFragment(c.diagram);
      if (svg == null) errors.push(`${where}: diagram file not found: ${c.diagram}`);
      else parts.push(`<figure><div class="diagram">${svg}</div>${c.caption ? `<figcaption>${inline(c.caption)}</figcaption>` : ""}</figure>`);
    }
    if (c.options?.length) {
      hasInputs = true;
      const opts = [...c.options, ...(c.noOther ? [] : [{ label: "Other (write in notes)", value: "other" }])];
      parts.push(
        opts
          .map((o) => `<label class="opt"><input type="radio" name="q${i}" value="${esc(o.value ?? o.label)}"> <b>${inline(o.label)}</b>${o.detail ? `<small>${inline(o.detail)}</small>` : ""}</label>`)
          .join(""),
      );
    }
    if (c.recommendation) parts.push(`<div class="rec"><b>Recommendation:</b> ${inline(c.recommendation)}</div>`);
    if (c.noAnswer) parts.push(`<p class="muted"><b>With no answer:</b> ${inline(c.noAnswer)}</p>`);
    if (kind === "decision" || kind === "fyi" || c.notes) {
      hasInputs = true;
      parts.push(`<textarea placeholder="${esc(c.notes ?? "Notes")}"></textarea>`);
    }
    const context = (c.context ?? String(c.body ?? "").split(/\n\s*\n/)[0]).replace(/\s+/g, " ").slice(0, 400);
    return `<section class="card ${esc(kind)}" data-title="${esc(c.title ?? "")}" data-context="${esc(context)}">${parts.filter(Boolean).join("\n")}</section>`;
  };

  // Things to close first, then decisions, then notes, then FYIs; brief order within each.
  const ordered = sections.map((c, i) => ({ c, i })).sort((a, b) => KINDS.indexOf(a.c.kind ?? "info") - KINDS.indexOf(b.c.kind ?? "info") || a.i - b.i);
  const cards = ordered.map(({ c, i }) => card(c, i)).join("\n");
  const decisions = ordered.filter(({ c }) => c.kind === "decision").map(({ c }) => c);
  const glance =
    decisions.length > 1 && brief.glance !== false
      ? `<section class="card glance"><span class="tag">At a glance</span>${table({ headers: ["#", "Decision", "Recommended"], rows: decisions.map((c, n) => [String(n + 1), c.title, c.short ?? c.recommendation ?? ""]) })}</section>`
      : "";
  if (errors.length) return { errors };

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(brief.title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>${inline(brief.title)}</h1>
${brief.subtitle ? `<p class="sub">${inline(brief.subtitle)}</p>` : ""}
${prose(brief.intro)}
${glance}
${cards}
</main>
${hasInputs ? COPY.replace("__TITLE__", JSON.stringify(`${brief.title}: answers`)) : ""}
</body>
</html>
`;
  return { html, errors: [] };
}

const CSS = `
:root { --bg:#f7f7f5; --card:#fff; --ink:#1d1d1f; --muted:#5f6368; --line:#d9d9d6; --accent:#1a5fb4; --rec:#e8f1e4; --rec-ink:#2b5d1f; --close:#fff6e0; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#141416; --card:#1e1e21; --ink:#ececec; --muted:#a0a0a8; --line:#34343a; --accent:#78aeff; --rec:#1f2e1b; --rec-ink:#a6d99a; --close:#2c2614; } }
:root[data-theme="dark"] { --bg:#141416; --card:#1e1e21; --ink:#ececec; --muted:#a0a0a8; --line:#34343a; --accent:#78aeff; --rec:#1f2e1b; --rec-ink:#a6d99a; --close:#2c2614; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.55 -apple-system, system-ui, sans-serif; }
main { max-width:880px; margin:0 auto; padding:24px 16px 120px; }
h1 { font-size:1.6rem; margin:0 0 4px; }
h2 { font-size:1.15rem; margin:0 0 8px; }
.sub, .muted, figcaption { color:var(--muted); }
.sub { margin:0 0 24px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:18px 20px; margin:0 0 18px; }
.card.close { background:var(--close); }
.tag { display:inline-block; font-size:.75rem; font-weight:600; color:var(--accent); text-transform:uppercase; letter-spacing:.04em; margin-bottom:6px; }
.rec { background:var(--rec); color:var(--rec-ink); border-radius:6px; padding:8px 12px; margin:10px 0; }
label.opt { display:block; border:1px solid var(--line); border-radius:8px; padding:10px 12px; margin:8px 0; cursor:pointer; }
label.opt:has(input:checked) { border-color:var(--accent); outline:1px solid var(--accent); }
label.opt input { margin-right:8px; }
.opt small, .step small { display:block; color:var(--muted); }
.opt small { margin-left:24px; }
textarea { width:100%; min-height:60px; margin-top:8px; padding:8px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--ink); font:inherit; }
.scroll, .diagram { overflow-x:auto; }
.diagram > svg { display:block; }
figure { margin:12px 0; }
table { border-collapse:collapse; width:100%; font-size:.9rem; margin:8px 0; }
th, td { text-align:left; padding:4px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
td.n { text-align:right; font-variant-numeric:tabular-nums; }
.flow { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin:12px 0; }
.step { border:1px solid var(--accent); border-radius:8px; padding:8px 12px; min-width:120px; max-width:220px; }
.arrow { display:flex; flex-direction:column; align-items:center; color:var(--muted); font-size:1.3rem; line-height:1; }
.arrow small { font-size:.75rem; }
.bar { position:fixed; bottom:0; left:0; right:0; background:var(--card); border-top:1px solid var(--line); padding:12px 16px; text-align:center; }
#ok { margin-left:10px; color:var(--muted); }
button { background:var(--accent); color:#fff; border:0; border-radius:8px; padding:10px 22px; font:inherit; font-weight:600; cursor:pointer; }
a { color:var(--accent); }
ul { padding-left:20px; }
`;

// Copies every answered card with its context, options, choice and notes, so the chat it is pasted into needs nothing else.
const COPY = `<div class="bar"><button id="copy">Copy answers</button><span id="ok"></span></div>
<script>
document.getElementById("copy").onclick = async () => {
  const out = [__TITLE__];
  document.querySelectorAll(".card[data-title]").forEach((c) => {
    const radios = [...c.querySelectorAll("input[type=radio]")];
    const pick = radios.find((r) => r.checked);
    const ta = c.querySelector("textarea");
    const note = ta ? ta.value.trim() : "";
    if (!radios.length && !note) return;
    out.push("", c.dataset.title, "Context: " + c.dataset.context);
    if (radios.length) out.push("Options: " + radios.map((r) => r.value).join(" | "), "Choice: " + (pick ? pick.value : "no answer"));
    if (note) out.push("Notes: " + note);
  });
  const text = out.join("\\n");
  try { await navigator.clipboard.writeText(text); }
  catch { const t = document.createElement("textarea"); t.value = text; document.body.append(t); t.select(); document.execCommand("copy"); t.remove(); }
  document.getElementById("ok").textContent = "Copied";
};
</script>`;

function main(argv) {
  const [briefPath, outPath] = argv.slice(2);
  if (!briefPath || !outPath) {
    console.error("usage: node page-render.mjs <brief.json> <page.html>");
    return 2;
  }
  const dir = dirname(resolve(briefPath));
  const readFragment = (file) => {
    try {
      return readFileSync(resolve(dir, file), "utf8");
    } catch {
      return null;
    }
  };
  const { html, errors } = renderPage(JSON.parse(readFileSync(briefPath, "utf8")), { readFragment });
  if (errors.length) {
    console.error(`brief errors:\n- ${errors.join("\n- ")}`);
    return 1;
  }
  writeFileSync(outPath, html);
  console.log(`wrote ${outPath}`);
  return 0;
}

// Compare real paths: the plugin cache or a skills folder may be reached through a symlink.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exit(main(process.argv));
