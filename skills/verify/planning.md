# Planning the proof

Decide how each piece of work will be proven before it is built. Write that down in the spec and the plan, so a reviewer can check the proof against what was promised.

## In specs: the "Proved by" line

Every scenario in a spec gets a "Proved by" line. It names three things:

- **where it is checked:** a test file, or live in which app and screen;
- **evidence:** what comes out of the check, such as a recording, a screenshot, a read-back or a test result;
- **pass when:** the result you can observe that means it works.

```markdown
#### Scenario: a customer downloads an invoice
- GIVEN a customer with three paid invoices
- WHEN they press download on the first one
- THEN they get that invoice's PDF
- Proved by: live in the web app (billing page);
  evidence: recording of the press, plus a read-back that the download
  returned the stored file's bytes; pass when the bytes match the stored file.
```

Write the pass condition as a property, such as "the bytes match the stored file", not as an exact value, such as "the address equals this text". See rule 6 in [proof-standard.md](proof-standard.md).

## In plans: every item names its evidence

Every checkbox item in a plan ends with `Evidence:` and one or more of these, separated by semicolons:

| Kind | Written as | Holds when ticked |
|---|---|---|
| test | `test <file> "<test name>"` | the test file exists and contains that test |
| file | `file <path>` | the file exists |
| screenshot | `screenshot <path>` | an image or video file exists |
| log | `log <file> "<text>"` | the file exists and contains the text |
| commit | `commit <commit ID>` | the commit exists |
| link | `link <address>` | a full `https://` address, such as a pull request |

Tick an item only when its evidence exists.

## Three proof boxes for each pull request

- **Verify unit:** the tests, and the command that runs them.
- **Verify live:** the check on the running app. If the change has no user-facing behavior, write "none:" followed by the reason.
- **Verify performance:** only when speed or size could change.

Tests alone never verify a pull request that changes what a user sees or does.

## A done condition fixed before work starts

The plan has one "Done when:" line with a count, for example "Done when: all 12 tasks merged, each verified live or by unit test". It is written before work starts and never relaxed to declare victory. If the work can't reach it, the user decides, and the decision is recorded.

## Small units that end in a checkable state

Each unit of work is small and ends in a state someone can check: one function and its tests, or one bug fix. Commit the failing test before the fix, so the history shows it failed first.
