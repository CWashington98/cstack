# Notes feature map

This folder is the maintained source for proving what Notes does for its users. Read this index before driving the app, then use the matching feature file as the recipe.

## Shared preconditions

- Notes runs at `http://127.0.0.1:4173`, started by this run, with its data folder inside the run folder.
- The seed notes `Quarterly plan` and `Grocery list` exist.
- The health check in `SKILL.md` has passed.
- Never drive a copy of Notes that this run didn't start.

## Driving rules

- Start every recipe from the seeded state, unless its preconditions say otherwise.
- Find elements by role and accessible name, never by position on the screen.
- Treat every command as literal. Keep quoted names unchanged.
- After a change, read the stored value back with the read-back command.

## Proof and what to report

- Capture the action and the state it caused, not only the final screen.
- Proof of a change includes a second view of the stored value.
- Record the sub-feature ID and the entry point used with every piece of evidence.
- Report a path you couldn't reach with the command you tried and what was missing.
- A skipped entry point is never reported as verified through another path.

## What each feature file holds

A title line, one paragraph on what the user sees, then exactly four sections in this order: Sub-features, How to get to it (user view), Driving it with Playwright, and Gotchas. Implementation details stay out.

## Features

- [Create a note](./create-note.md): creating from the toolbar and the keyboard, saving, cancelling, and the note still being there after reopening it.
- [Search notes](./search.md): searching from the toolbar and the keyboard, matches by title and body, the empty state, and clearing.
