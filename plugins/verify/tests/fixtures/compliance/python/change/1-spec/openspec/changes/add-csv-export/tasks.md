# Tasks

## 1. Acceptance tests, written first and failing

- [x] 1.1 Write one test per scenario in `specs/export/spec.md`. Verify every one fails on the current code by an assertion. Covers: all. Touches: tests/acceptance/**

## 2. The export

- [x] 2.1 Write a header row, then one row per order. Verify with the scenario test. Covers: export-has-header-row. Touches: exporter.py
- [x] 2.2 Refuse an export with no orders. Verify with the scenario test. Covers: export-empty-refused. Touches: exporter.py
