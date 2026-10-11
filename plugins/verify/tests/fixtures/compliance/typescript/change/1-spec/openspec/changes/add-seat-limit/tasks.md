# Tasks

## 1. Acceptance tests, written first and failing

- [x] 1.1 Write one test per scenario in `specs/seats/spec.md`. Verify every one fails on the current code by an assertion. Covers: all. Touches: test/acceptance/**

## 2. The seat limit

- [x] 2.1 Add a seat when the team is under its limit, and refuse it at the limit. Verify with the scenario tests. Covers: seat-added-under-limit, seat-refused-at-limit. Touches: src/seats.ts
- [x] 2.2 Show how many seats are left. Verify with the scenario test. Covers: seats-left-shown. Touches: src/seats.ts
