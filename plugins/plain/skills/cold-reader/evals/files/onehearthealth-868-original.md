# fix(dashboard): stop showing a murmur 'confidence' that is the probability copied

## In plain English

The dashboard's recording card showed the murmur probability, then a second line, "Confidence", with the same number. The scoring service's documented results carry no confidence. Our server copies the probability into that field, so the second line repeated the probability under a name that suggests a separate measure of certainty. On dev a re-score also keeps the previous run's value next to the new probability, so the line could even show a stale number. This PR removes that line. The probability, its color and its bar are unchanged, and so is the signal quality confidence.

Decision: Crishon, 4 Oct 2026, option C, dashboard only, after a clickable prototype (link to the decision page removed). It is recorded in `openspec/changes/sync-protocol-v2-backend/tasks.md` (3.3, D3) on #849's branch (`3895d156d`), so it reaches dev with that stack, not with this PR. It's a default, not a guardrail, so per ADR-0010 there's no new ADR.

## What changes

- `apps/dashboard-web/components/heart-recordings-section.tsx`: the murmur confidence block is removed.
- `apps/dashboard-web/hooks/use-patient.ts`: the patient query no longer fetches `murmurConfidence`, which nothing reads now.
- Not changed, on purpose: the stored `murmurConfidence` field, the server writers (which keep copying), the ML raw-data CSV (the dashboard's two download buttons and the scheduled email still carry the column), the analytics snapshot and the mobile app (which never showed it). The decision covers the recording card only.

## Proof

- RED `ad9048c1a`: 2 failed, 17 passed. "72%" appeared twice (probability and the copied confidence), and "Confidence" appeared twice (signal quality and murmur).
- GREEN `728bd63c2`: the dashboard's whole vitest suite passes, 104 files / 1640 tests. `tsc --noEmit` and eslint are clean.
- Karen's review (`af97e36f5`): the test now uses a confidence unlike the probability (0.31) and asserts it appears nowhere. With the line put back under another label and format, the test fails.

## Rests on

The scoring service's API spec has three audio-level result examples (`One_Heart_API_spec.json` lines 1150, 1727, 1945), and none has a confidence key. All three are the older hestia-v1 model; the spec has no example for the current pia model. Our client keeps only a fixed list of result keys (`extractAnalysisResult`), so a new confidence key would be dropped without anyone noticing. Showing a real confidence later would need that list extended first.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

