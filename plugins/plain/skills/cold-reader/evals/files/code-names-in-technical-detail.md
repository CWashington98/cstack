# Sign-up errors now say which field is wrong

## What changed and why

When someone mistyped their email address on the sign-up page, the page said only "Something went wrong". It now names the field and says how to fix it, for example "Enter an email address with an @ sign in it".

## Proof it works

New tests type a bad email address and a short password, and check the message shown for each. All tests pass.

## Technical detail

- The messages come from `fieldErrorMessage` in `signup-errors.ts`.
- The error code `invalid-email` replaces `generic-failure`.
