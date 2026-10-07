# Planning the proof

Decide how each piece of work will be proven before it is built. Write that down in the spec and the plan, so a reviewer can check the proof against what was promised.

## In specs: the "Proved by" line

Every scenario in a spec gets a "Proved by" line. It names three things:

- **where it is checked:** a test file, or live in which app, feature and sub-feature;
- **evidence:** what comes out of the check, such as a recording, a screenshot, a read-back or a test result;
- **pass when:** the result you can observe that means it works.

```markdown
#### Scenario: a rater plays a recording
- GIVEN a rater opens a patient with three recordings
- WHEN they press play on the first one
- THEN they hear the patient's real heart sound and see its waveform
- Proved by: live in the review app (feature `recordings`, sub-feature `play`);
  evidence: recording of the press and the waveform, plus a read-back that the
  audio request returned the stored file's bytes; pass when the bytes match the
  stored file and the waveform is drawn from them.
```

Write the pass condition as a property, such as "the bytes match the stored file", not as an exact value, such as "the address equals this text". See rule 6 in `proof-standard.md`.

## In plans: every item names its evidence

Every checkbox item in a plan ends with `Evidence:` and one or more of these, separated by semicolons:

| Kind | Written as | Holds when ticked |
|---|---|---|
| test | `test <file> "<test name>"` | the test file exists and contains that test name |
| file | `file <path>` | the file exists |
| screenshot | `screenshot <path>` | an image or video file exists |
| log | `log <file> "<text>"` | the file exists and contains the text |
| commit | `commit`, which becomes `commit <commit ID>` when ticked, or `commit <commit ID> in <repository path>` for another repository | the commit exists |
| run | `run <folder>` | an evidence run folder whose final status is set |
| link | `link <address>` | a full `https://` address, such as a pull request |

Paths are relative to the repository root, or start with `~/` for the home folder. Tick an item only when its evidence exists.

## Three proof boxes for each pull request

Every pull request section in a plan has three proof boxes:

- **Verify unit:** the tests, and the command that runs them.
- **Verify live:** the check on the running app. If the change has no user-facing behavior, write "none:" followed by the reason.
- **Verify performance:** only when speed or size could change.

Tests alone never verify a pull request that changes what a user sees or does.

## A done condition fixed before work starts

The plan has one "Done when:" line with a count, for example "Done when: all 12 tasks merged, each verified live or by unit test". It is written before work starts and never relaxed to declare victory. If the work can't reach it, the owner decides, and the decision is recorded.

## Small units that end in a checkable state

Each unit of work is small and ends in a state someone can check: one function and its tests, or one bug fix. Commit the failing test before the fix, so the history shows it failed first.

## Checking a spec or plan

Run the checker from this plugin:

    node <this skill's folder>/../../scripts/verify-plan.mjs <file>

It exits 0 when everything names its evidence, and 1 with a list of "hold" lines to fix. Once work has started, add `--since <the commit where the plan was approved>` so a changed done condition is caught.
