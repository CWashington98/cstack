# The dashboard no longer shows a murmur "confidence" that was just the probability repeated

## What changed and why

The dashboard's recording card showed the murmur probability, then a second line, "Confidence", with the same number. The heart-sound scoring service doesn't return a confidence at all. Our server copies the probability into that field, so the second line repeated the probability under a name that suggests a separate measure of certainty. On the dev environment it could even show a number left over from an earlier scoring run. This pull request removes that line. The probability, its color and its bar are unchanged, and so is the separate signal-quality confidence.

Crishon chose this on 4 October 2026, after trying a clickable prototype: change the dashboard only. The decision is recorded in the task list of the sync-v2 backend change, which reaches the dev branch with that work, not with this pull request. It changes a default rather than one of our guardrails, so it needs no new decision record.

## How it works

- The recording card no longer shows the murmur confidence line.
- The dashboard no longer fetches that field, since nothing reads it now.
- **Unchanged on purpose:** the stored field, the server code that fills it, the analytics snapshot, and the mobile app, which never showed it.
- **Also unchanged:** the machine-learning data export. The dashboard's two download buttons and the scheduled email still include the column.

## Proof it works

- **Failing first:** the new test failed on the old code because "72%" and "Confidence" each appeared twice.
- **Passing after:** all 1,640 dashboard tests pass. Type check and lint are clean.
- **Review:** Karen, our automated reviewer, made the test use a confidence different from the probability (0.31) and check that it appears nowhere. Putting the line back under another label makes the test fail.
- **Live check: missing.** Under the new standard this would also need a screenshot of the recording card on dev.

## Risk

- **Easy to undo:** yes, one display change.
- **What it could affect:** the recording card only. If the scoring service ever adds a real confidence, our client would drop it silently, because it keeps a fixed list of result fields. Showing one later means extending that list first.

## Technical detail

- Removed from `heart-recordings-section.tsx`, and from the patient query in `use-patient.ts`.
- The scoring service's interface description has three examples of audio-level results, at lines 1150, 1727 and 1945 of its JSON file, and none has a confidence field. All three are from the older hestia-v1 model; there is no example yet for the current pia model.
