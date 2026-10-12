# Run log: add-guard-scenarios

## 2026-10-11, task 1.1: acceptance tests

- Added `plugins/verify/tests/guard-scenarios.test.mjs`: five tests, one per new scenario, each named with its scenario ID.
- Red result: 5 tests, 0 passed, 5 failed, every one by an assertion (none crashed). The existing `spec-compliance.test.mjs` still passes 30 of 30.
- Example failure, guard-passes-before-and-after: "the change is proven" expected exit 0 but got 1, because today the check treats a test that passes on the starting commit as "doesn't depend on the change".
- Commit: see the git log entry "test(acceptance): guard scenarios".

## Rulings

- Ruling: the guarded code stays unchanged by the sample build, which only adds an unrelated file — a guard protects code the change must not alter — if wrong, the tests would not model a real guard.
- Ruling: tests read break counts and the cap as "<number> breaks" and the word "cap" in the report text, since the spec gives no fixed field — the exact wording is the implementation's — if wrong, the implementation must adjust its wording or the lock needs a Spec-Change line.
- Ruling: the break that was caught is checked as "flipped ..." or "moved the number ..." text, the wording the high-risk lane already uses — if the guard lane words it differently, that one assertion needs a Spec-Change line.
- Ruling: the cap test uses 40 conditions in the guarded file and a test that only checks an answer comes back, so it catches none — if wrong, the run still stays fast because each break runs one tiny test.
