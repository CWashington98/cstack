# ZIP code is now an ordinary optional field owners add from the form builder, and every ZIP helps time texts

## What changed and why

**Before:** To ask customers for their ZIP code, an owner flipped a separate "Ask for ZIP code" switch, and the box always appeared under the phone number. A ZIP field the owner added themselves didn't help send texts at the right time of day.

**After:** ZIP code is one field the owner adds from the form's field list, like any other, and it appears wherever they put it. It is always optional, never blocks a signup, and is never part of the consent checkboxes. Every ZIP a customer gives helps time texts for where they live. The builder always says "Always optional. It never blocks a signup." The privacy page mentions ZIP whenever any of the business's forms asks for it.

## How it works

- **In the form builder:** the old switch is gone. ZIP code is in the field list, with fixed wording: "ZIP code (optional)" plus help text. A note says it is always optional, and a panel shows what customers will see. Once added, it leaves the add menu, so a form can have only one.
- **On the public form:** the field appears where the owner placed it, outside the consent checkboxes. A mistyped ZIP never blocks a signup; it is simply not saved.
- **When someone signs up:** a valid five-digit ZIP is saved to the contact and used to time texts for their area. Consent is never touched.
- **Privacy page:** it names ZIP whenever an active signup form asks for it.
- **A bug fixed on the way:** dragging fields to reorder them now saves the new order for every field.

## Proof it works

- **Tests written separately first:** 42 acceptance tests, one per scenario in the spec, were written by a separate agent before the build, failed on the old code, and all pass now. The usual test author, Codex, had run out of quota, so an Opus agent wrote them instead.
- **Full local check:** about 29,800 backend tests and 9,500 frontend tests pass, plus formatting, lint, type check and the production build.
- **Reviews:** Karen, our automated reviewer, found it ready. The security and compliance reviewer found two medium issues in the privacy sentence; both are fixed, with tests that failed first.
- **Live check: covered by the prototype only.** The prototype was clicked through and its screenshots compared before it was removed. Under the new standard, a screenshot of the real builder and public form would be added.

## Risk

- **Easy to undo:** mostly. A one-time data migration converts existing forms. It has not been run anywhere yet, and production has no forms that need it.
- **What it could affect:** every signup form's field list and save path, including forms built with the AI form helper, and the privacy page.

## Technical detail

- Spec: the change updates the forms ZIP field spec (38 scenarios). The owner approved it on 2 October as a high-risk change.
- The old `askZip` setting is no longer read or written. Its database field stays for now and will be deleted in a follow-up.
- The migration is `admin/migrations/zipFieldInBuilder.ts`. It can be run more than once safely.
- Follow-ups: add tests for draft, archived and membership forms on the privacy page; give `updateLegalContent` a clear "Form not found" error; delete the old `askZip` field.
