---
name: plain
description: Write or rewrite text so a junior developer or product manager understands it with no outside context. Use before posting a pull request, review, issue or comment, before publishing a page or committing a spec or plan, and when the user says "plain" or that a message didn't make sense.
---

# plain

Everything we publish must make sense to a junior developer or a product manager who knows nothing about this project. Everything needed to follow the text is in the text. Links can point to more detail, but the text must make sense without them.

## Who we write for

A junior developer or a product manager. They are smart and know what a pull request, a test, a database, an app screen and a deploy are. They know nothing about this project: its plans, its internal names, its business terms, or the conversation that produced the change.

Two promises to this reader:

- **Everything needed to understand the text is in the text.** Nobody should have to open another document or search for a term to follow it.
- **No term goes unexplained** unless a junior developer would know it without looking it up.

## The rules

1. **Start with the point.** The first sentence says what happened or what changed. The second says what you need from the reader, if anything.
2. **Attach the context.** Never rely on things the reader can't see: "as discussed", "per the plan", "like last time", question or decision numbers, or section numbers of other documents. Put the needed facts in the text.
3. **Spell out acronyms** the first time, unless every junior developer knows them (API, URL, CI). Never invent new ones.
4. **Introduce internal names once.** "Atlas, the zoomable map of the system".
5. **Explain domain terms once,** using the wording in the repository's glossary if it has one: "churn (customers who cancel in a month)".
6. **Use the glossary's preferred word.** If the glossary says "order" and to avoid "purchase", write "order".
7. **Keep sentences short.** Aim for under 20 words. Split anything over 30.
8. **Use everyday words and active voice.** "Use", not "utilize". "We removed the check", not "the check was removed".
9. **No capital letters for emphasis.** Use bold sparingly instead.
10. **Numbers say what they mean.** "4.4% of all usage", not "4.4%".
11. **Technical detail goes last,** in its own section, still written for a junior developer.
12. **Quote bad examples in code formatting,** like `BLUF` or `Q21`, so it's clear you're discussing the term, not using it.

## Write or fix a text

1. Rewrite the text by the rules.
2. Cold-read it. Start a fresh subagent with no context. Give it only the text, and ask it to restate the point in one sentence and list every term or reference it couldn't follow. Don't tell it what the text is meant to say.
3. Explain or replace everything it flagged. If its restatement differs from what you meant, rewrite. After two rewrites that still fail, stop and show the user the text and the reader's notes.
4. If you rewrote the user's own draft, show the before and after.
5. Post from a file (`--body-file`, or `-F body=@file` with `gh api`), so what you checked is what gets posted.

For a pull request description, use the layout in [pr-layout.md](pr-layout.md).

## Explain mode

When the user says something didn't make sense, explain it again in chat by these rules. Chat replies skip the cold read.

## Sources

Rules rewritten in our words from the US Federal Plain Language Guidelines (public domain), ideas from ASD-STE100 Simplified Technical English, the AI-writing patterns in Lauren Tan's `unslop` (MIT), and Matt Pocock's glossary format (MIT).
