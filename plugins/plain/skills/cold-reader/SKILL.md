---
name: cold-reader
description: Check whether a text makes sense to someone with no context. It gives the text to a blank reader that knows nothing about the project, and reports the terms and context the reader couldn't follow. Use it before posting a pull request description, issue or comment, or publishing a page. Use it on specs and plans a newcomer, junior developer or product manager will read. Use it when the owner says something "didn't make sense", and whenever the plain skill asks for the cold reader. Use it even when the text looks clear to you, because you already know the context and can't see what's missing.
---

# cold-reader

A blank reader for checking that a text stands on its own. It is a separate Claude call that starts with nothing: no project files, no memory, no settings, no tools. It reads the text and says what it couldn't follow. You can't do this check yourself, because you already know the project.

The script is `scripts/cold-read.mjs` in this skill's folder. Below, `READER` means that path.

## Run it

1. Put the text in a file. HTML files are turned into plain text first.
2. Run `node READER <file> --json > "$TMPDIR/cold-reader-verdict.json"`. It takes 10 to 40 seconds.
3. Read the verdict:
   - `unclear_terms`: words and names the text uses but never explains.
   - `missing_context`: places where the text depends on something the reader can't see, such as an earlier discussion or another pull request.
   - `restatement`: what the reader thinks the text says, in two sentences.
   - `ask`: what the reader thinks it is being asked to do.
   - `pass`: true when both lists are empty.
   - `readerVersion`: the version of these instructions that made the verdict.
4. Fix the text, not the reader. Explain each unclear term once where it first appears, or replace it. Add the missing context in a sentence. Then run the reader again.
5. Compare the restatement and the ask with what you meant. If they differ, the text is misleading even when it passes. Rewrite it.

The exit code is 0 when the text passes, 1 when it doesn't, and 2 when the reader failed to run. A reader that fails to run never counts as a pass.

The reader's model is Sonnet. A repository can choose another in `.claude/plain.json` with `"readerModel"`, or you can pass `--model`.

## What it reports, and what it leaves out

It reports only:

- a term the text never explains, when you need it to follow the change
- context needed to follow the change that the text doesn't give

It leaves out:

- a term the text already explains, even briefly
- code names in a section headed "Technical detail"
- more detail a curious reader might like but doesn't need

## How strict, by kind of text

- **Pull requests, issues, comments and pages** must pass.
- **Long specs and plans** get the reader's flags as advice. Fix what you can, but a flag doesn't stop them from being committed. They must still pass the plain checker. Posting or publishing the same text as a post or page needs a full pass.

The plain skill applies this rule when it records a pass stamp.

## Changing the reader

The reader's instructions are `reader-prompt.md` in this folder. They are maintained like code:

1. Change `reader-prompt.md`.
2. Raise `READER_VERSION` in `scripts/version.mjs`. Pass stamps made under an older version stop counting, so every text is read again under the new instructions.
3. Score the change against the test set: `PLAIN_LIVE=1 node scripts/score.mjs`. It must still catch the fair flags and drop the noise. See `README.md` for the test set and the last scores.
4. When the owner disagrees with a flag, add the text to `evals/evals.json` with that flag labeled fair or noise.
