# Writing rules

## Who we write for

**A junior developer or a product manager.** They are smart and have some technical background. They know what a pull request, a test, a database, an app screen and a deploy are. They know nothing about this project: its plans, its internal names, its medical or business terms, or the conversation that produced the change.

Two promises to this reader:

- **Everything needed to understand the text is in the text.** Nobody should have to open another document or search for a term to follow it. Links are welcome as extras, never as required reading.
- **No term goes unexplained** unless a junior developer would know it without looking it up.

This applies to every section, including technical detail.

## The rules

1. **Start with the point.** The first sentence says what happened or what changed. The second says what you need from the reader, if anything.
2. **Attach the context.** Never rely on things the reader can't see: "as discussed", "per the plan", "like last time", question or decision numbers, or section numbers of other documents. Put the needed facts in the text itself. A link can point to more detail, but the text must make sense without it.
3. **Spell out acronyms.** Use an acronym only if it's on the common list, or if you spell it out the first time: "ventricular septal defect (VSD)". Never invent new ones.
4. **Introduce internal names once.** "Karen, our automated code reviewer". "Atlas, the zoomable map of the system".
5. **Explain domain terms once,** using the wording in the repository's `GLOSSARY.md`: "aortic stenosis (a narrowing of the heart's main valve)".
6. **Use the glossary's preferred word.** If the glossary says to call it an "order" and to avoid "purchase", write "order".
7. **Keep sentences short.** Aim for under 20 words. Split anything over 30.
8. **Use everyday words and active voice.** "Use", not "utilize". "We removed the check", not "the check was removed".
9. **No capital letters for emphasis.** Use bold sparingly instead.
10. **Numbers say what they mean.** "4.4% of all usage", not "4.4%".
11. **Technical detail goes last,** in its own section. It is written for a junior developer: standard terms are fine, anything else is explained.

Sources:
- the US Federal Plain Language Guidelines (public domain)
- ideas from ASD-STE100 Simplified Technical English (the standard Matt Pocock's `wait-what` skill uses)
- the AI-writing patterns in poteto's `unslop` skill (MIT license)
- Matt Pocock's glossary format (MIT license)

Rules are rewritten in our words, with credit.
