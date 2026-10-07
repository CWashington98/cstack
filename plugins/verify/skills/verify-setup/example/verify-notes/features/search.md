# Search notes

A user finds notes by words in the title or body, opens a match, tells "no matches" apart from a search that failed, and clears the search.

## Sub-features

- `search-open` opens search from each entry point.
- `search-match` finds title and body matches without changing any note.
- `search-open-result` opens a match in the editor.
- `search-empty` shows a clear empty state when nothing matches.
- `search-clear` empties the search and brings back the recent notes.

## How to get to it (user view)

- The `Search` button in the toolbar.
- The `/` key, when focus is outside a text field.

## Driving it with Playwright

Preconditions:

- The health check has passed.
- The seed note `Quarterly plan` has the body text `Draft budget`.

- **Open from the toolbar.** Run `await page.getByRole("button", { name: "Search" }).click()`. A dialog named `Search notes` appears, with focus in its search box.
- **Open with the keyboard.** Close the dialog, then run `await page.keyboard.press("/")`. The same dialog appears, and no slash is typed.
- **Match a title.** Run `await page.getByRole("searchbox", { name: "Search notes" }).fill("quarterly")`, then wait for `page.getByRole("list", { name: "Search results" })`. It contains `Quarterly plan` and not `Grocery list`.
- **Match a body.** Fill the search box with `budget`. `Quarterly plan` stays in the results, with a short excerpt of the matching body text.
- **Open a match.** Run `await page.getByRole("link", { name: "Quarterly plan" }).click()`. The dialog closes and the editor heading reads `Quarterly plan`.
- **No matches.** Reopen search and fill it with `volcano`. Wait for `page.getByRole("status", { name: "No matching notes" })`.
- **Clear.** Run `await page.getByRole("button", { name: "Clear search" }).click()`. The search box is empty and the `Recent notes` region replaces the results.
- **Nothing changed.** Search is read only, so record the drive with `--side-effects "none: search only reads notes"`.

## Gotchas

- Pressing `/` while a text field has focus types a slash instead of opening search.
- Results update shortly after typing stops. Wait for the results list or the empty status, never a fixed pause.
- Archived notes are left out unless the user turns on `Include archived`.
- Opening a match changes the page. Reopen search before proving another search.
