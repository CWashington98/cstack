---
name: to-page
description: Build a simple local HTML page for a person to read or decide on. The model writes a short JSON brief and a script builds the page, so no model writes HTML. Use it whenever the user asks for an HTML page, a page, a diagram, a visual, a decision page, a report or a comparison to look at. Use it when they say "put it in an HTML". Use it too whenever two or more decisions need the user's answer, instead of asking one at a time in chat. Pages are plain and fast to read, with answer buttons and a "Copy answers" button.
---

# to-page

Makes a page a person understands in one read: simple, visual and clear. Looks don't matter.

The model writes only a short brief. A script turns the brief into the page, so no model spends tokens on HTML, and nobody reads the HTML back.

The script is in the plugin's `scripts` folder, two levels above this file. Below, `SCRIPTS` means `<this skill's folder>/../../scripts`. `example.json` in this folder is a full brief to copy from.

## Steps

1. **Check the facts.** Every claim on the page is checked against the code, GitHub or the live system first. This is the part that needs a strong model.
2. **Write the brief** (format below). Run the `plain` rules over its words.
3. **Diagrams**, if any (see below).
4. **Render and open it:**

   ```bash
   node SCRIPTS/page-render.mjs <brief.json> <page.html> && open <page.html>
   ```

   It exits 1 and lists what is missing when a card is incomplete. Fix the brief and run it again.
5. **Cold-read the page.** Run `plain:cold-reader` on the page file; it must pass. The reader starts with no context, so it finds the terms and background you forgot to explain. Fix the brief, not the page, and render again.
6. When the person pastes their answers back, act on them.

**Where files go.** Outside the repository, unless the person asks otherwise: the project's notes folder if it has one, or the session's scratch folder. Keep one page per topic and update it in place. Open it as a local file in the browser.

**Cheaper models.** The brief is the expensive part, and it stays with the model that checked the facts. If a diagram needs drawing, hand only that to a smaller model (step 3).

**When the layout doesn't fit.** If the person wants a page the brief can't describe, hand the checked brief to one Sonnet agent to write the HTML. Tell it to keep every word of the brief, add nothing, and load nothing from the internet. Then cold-read the result (step 5).

## The brief

```json
{
  "title": "pnpm and CI: three decisions",
  "subtitle": "29 October 2026. Nothing below has started.",
  "intro": "Optional paragraph.",
  "sections": [
    {
      "kind": "decision",
      "title": "Close #1529?",
      "body": "**Background.** What exists today, and why this came up.\n\n- a bullet\n- a bullet",
      "table": { "caption": "Recent runs", "headers": ["Run", "Total"], "rows": [["123", "21 m 14 s"]] },
      "options": [
        { "label": "A. Split the job", "detail": "What happens, and what it costs.", "value": "A: split the job" },
        { "label": "B. Merge it" }
      ],
      "recommendation": "A, because it makes the checks faster.",
      "short": "A: split the job",
      "noAnswer": "Nothing merges."
    },
    { "kind": "info", "title": "How a release goes", "flow": ["Plan", { "label": "Build", "note": "about 2 days" }, { "label": "Release", "arrow": "after review" }] },
    { "kind": "info", "title": "What talks to what", "diagram": "systems.svg", "caption": "Notice that only the queue reaches the database." },
    { "kind": "fyi", "title": "Other items", "list": ["one", "two"] },
    { "kind": "close", "title": "You can close", "list": ["[#1514](https://github.com/o/r/pull/1514): merged"] }
  ]
}
```

- **`kind`**: `close`, `decision`, `info` or `fyi` (for your information). The page shows them in that order. Decisions are numbered.
- **At a glance**: with two or more decisions, a table at the top lists each one with its `short` answer (or its recommendation). Turn it off with `"glance": false`.
- **A decision** needs `options`, `recommendation` and `noAnswer`, or the script refuses the brief. An "Other" option is added unless `"noOther": true`.
- **Notes boxes** come with every `decision` and `fyi` card. Add one to any card with `"notes": "placeholder text"`.
- **Text** accepts `**bold**`, `` `code` ``, `[text](https://url)`, blank-line paragraphs and `- ` lists. Nothing else.
- **Copy answers** copies each answered card's title, context (the first paragraph of `body`, or `context`), options, choice and notes. The chat it is pasted into needs nothing else.

## Writing the cards

- Write for someone coming in cold. A decision says what exists today, why it came up, what each option costs or breaks, a recommendation, and what happens with no answer. Explain jargon. If it only matters for something not built yet, say so.
- Keep a card to one screen. Prefer a table, a flow or a diagram to a paragraph.
- Link every pull request and issue, with one line on what it does.

## Diagrams

Pick the simplest that shows it:

1. **Steps in a straight line:** `"flow"`. The script draws boxes and arrows in plain HTML. Nothing to draw, nothing to load.
2. **Rows and columns, before and after, or a comparison:** `"table"`.
3. **Anything with branches, groups or loops:** draw it with `plain:to-diagram`, which checks it. Then put the file name in `"diagram"`. The script embeds the image at its own width. To save tokens, give the drawing to a smaller model with one agent call, such as `model: "haiku"` (Sonnet if it has more than eight boxes):

   > Use the plain:to-diagram skill to draw `<path>.svg`. It answers: <one question>. Use exactly these labels: <list>. Show: <what connects to what>. Run its checker until it passes. Reply with the path only.

No diagram libraries loaded from the internet: the page works offline.
