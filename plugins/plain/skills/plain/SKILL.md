---
name: plain
description: Write or rewrite text so a junior developer or product manager can understand it with no outside context. Use it before posting a pull request, review, issue or comment to GitHub. Use it before publishing a page or committing a spec or plan. Use it when the owner says "plain" or that a message didn't make sense.
---

# plain

Everything we publish must make sense to a junior developer or a product manager who knows nothing about this project. Everything needed to follow the text is in the text. Links can point to more detail, but the text must make sense without them.

Read `rules.md` in this folder before writing. For a pull request description, also read `pr-layout.md`.

The scripts are in the plugin's `scripts` folder, two levels above this file. Below, `SCRIPTS` means `<this skill's folder>/../../scripts`.

## Write or fix a text

1. Put the text in a file. Pull request bodies, issue bodies and comments are always posted from a file (`--body-file`, or `-F body=@file` with `gh api`). The hold stops text written inline in a command.
2. Rewrite it by the rules.
3. Run the checker: `node SCRIPTS/plain-check.mjs <file>`. Fix every "hold" line. Consider each "advice" line.
4. Run the cold reader, a separate skill in this plugin (`../cold-reader/SKILL.md`): `node <this skill's folder>/../cold-reader/scripts/cold-read.mjs <file> --json > "$TMPDIR/plain-verdict.json"`, then read the verdict.
5. For each unclear term or missing piece of context, explain it or replace it in the text, then go back to step 3. Compare the reader's restatement and ask with what you meant. If they differ, rewrite. After two rewrites that still fail, stop and show the owner the text and the reader's notes. For a spec or plan in one of the repository's watched folders, the reader's flags are advice: fix what you can, then stamp.
6. When both pass (or, for a spec or plan, when the checker passes and the reader ran), record the stamp: `node SCRIPTS/plain-stamp.mjs write <file> --verdict "$TMPDIR/plain-verdict.json"`.
7. If you rewrote the owner's own draft, show the before and after.
8. Post or publish from the same file. Changing the file after stamping needs a new pass, and so does a new version of the cold reader.

## Fix an existing pull request: `/plain 123`

1. Read it: `gh pr view 123 --json title,body,files`.
2. Write a new description into a file using `pr-layout.md`.
3. Follow "Write or fix a text".
4. Post it with `gh pr edit 123 --body-file <file>`, or with the method the repository's facts file says to use.

## Explain mode

When the owner says something didn't make sense, explain it again in chat following `rules.md`. Chat replies don't need the checker or a stamp.

## The glossary

When the cold reader flags the same project term more than once, add it to the repository's `GLOSSARY.md` (format in `glossary-format.md`). In onehearthealth, use `.claude/GLOSSARY.local.md`, which is personal and git-ignored.

## When the hold stops a post

The message says exactly what to fix. Fix the file, run this skill on it, then post again. For a deliberate exception, such as quoting a customer word for word, put `PLAIN_OVERRIDE="the reason"` in front of the command. Every override is logged.

## Turning it on in a repository

The hold only runs in repositories that have `.claude/plain.json` (shared, committed) or `.claude/plain.local.json` (personal, git-ignored). See `glossary-format.md`.
