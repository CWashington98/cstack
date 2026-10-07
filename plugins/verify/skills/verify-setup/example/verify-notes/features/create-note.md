# Create a note

A user saves a titled note from the browser, cancels an unfinished draft, and finds the saved note again from the note list.

## Sub-features

- `create-open` opens a blank editor from each entry point.
- `create-save` stores a title and a body.
- `create-cancel` throws away an unfinished draft.

## How to get to it (user view)

- The `New note` button in the toolbar.
- The `n` key, when focus is outside a text field.

## Driving it with Playwright

Preconditions:

- The health check has passed.
- No note is titled `Release checklist`.

- **Open the editor.** Choose `New note`. Run `await page.getByRole("button", { name: "New note" }).click()`. A form named `Note editor` appears, with focus in the `Title` textbox.
- **Open with the keyboard.** Close the editor, then press `n`. Run `await page.keyboard.press("n")`. The same form appears, and no `n` is typed anywhere.
- **Enter the content.** Run `await page.getByRole("textbox", { name: "Title" }).fill("Release checklist")` and `await page.getByRole("textbox", { name: "Body" }).fill("Tag and publish")`. The `Save note` button becomes enabled.
- **Save.** Run `await page.getByRole("button", { name: "Save note" }).click()`, then `await page.getByRole("status", { name: "Note saved" }).waitFor()`. The heading reads `Release checklist`.
- **Read it back.** Run `sqlite3 "$RUN/data/notes.db" "select id, length(body) from notes where title = 'Release checklist'"`. It prints one row with a body length of 15.
- **Reopen it.** Run `await page.getByRole("link", { name: "All notes" }).click()` and `await page.getByRole("link", { name: "Release checklist" }).click()`. The editor shows both saved values.
- **Cancel a draft.** Open a new note, fill the title with `Discard me`, and run `await page.getByRole("button", { name: "Cancel" }).click()`. The note list returns, and `await page.getByRole("link", { name: "Discard me" }).count()` is 0. The read-back for `Discard me` prints no rows.

## Gotchas

- Pressing `n` while a textbox has focus types the letter instead of opening an editor.
- Titles are trimmed when saved. Check the shown title, not the text you typed.
- The `Note saved` status alone is not proof. Reopen the note and read it back.
