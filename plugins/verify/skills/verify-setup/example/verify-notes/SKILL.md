---
name: verify-notes
description: Drives the Notes web app in a browser to prove its features work, with a health check, recorded evidence and read-backs of stored notes. Use it before saying any change to Notes works, and for any live check of creating or searching notes.
---

# Verify Notes

Notes is a web app for writing and searching short notes. This skill holds only its facts. The general steps for driving a web app are in the `drive-web` skill. The machine-readable facts are in `facts.json` next to this file.

## Start

Start a run first, so every file lands in the run folder:

```sh
RUN=$(node <plugin>/scripts/evidence.mjs start --app notes)
NOTES_DATA_DIR="$RUN/data" npm run seed --prefix apps/notes
(cd apps/notes && NOTES_DATA_DIR="$RUN/data" npm run dev -- --port 4173 > "$RUN/server.log" 2>&1 & echo $! > "$RUN/server.pid")
```

Here `<plugin>` is the folder of the installed `verify` plugin.

Ready when `curl -sf -o /dev/null http://127.0.0.1:4173/` succeeds. Check it every half second, for up to 60 seconds.

Stop with the `start.stop` command in `facts.json`.

## Health check

Run the general checks from `drive-web` first. Then the checks for Notes:

- The data folder is inside the run folder: `server.log` names `NOTES_DATA_DIR` as a path under `RUN`. A run against the default data folder would change someone's real notes.
- The seed notes exist: the read-back command for `Quarterly plan` prints one row.
- The app does not point at `notes.example.com`, the production address.

## Drive

Load the `drive-web` skill first. Then use these facts:

- Address: `http://127.0.0.1:4173`.
- Routes: `/` shows recent notes, `/notes/<id>` opens a note, `/all` lists every note.
- Handles: the toolbar buttons `New note` and `Search`, the `Title` and `Body` textboxes, the `Save note` and `Cancel` buttons, and the `Search notes` dialog.
- Keyboard: `n` opens a new note and `/` opens search, when focus is outside a text field.

## Evidence

Evidence goes in `.verify/runs/notes/`, one folder per run. Each drive saves a screenshot before the action and one after the end state, plus the read-back output. Name files `<sub-feature>-before.png`, `<sub-feature>-after.png` and `<sub-feature>-readback.txt`.

## Clean up

Stop the server with `start.stop`, and confirm port 4173 is free. The run's data folder lives inside the run folder, so no other clean-up is needed. Never delete the run folder.

## Helpers

- Seed the test notes: `NOTES_DATA_DIR="$RUN/data" npm run seed --prefix apps/notes`
- Read back a note: `sqlite3 "$RUN/data/notes.db" "select id, length(body) from notes where title = '<title>'"`

## Feature map

Read `features/README.md` before driving. It lists every feature and the rules for reporting what was and wasn't covered.
