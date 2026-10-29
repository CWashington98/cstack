## ADDED Requirements

### Requirement: follow-up-starts-from-findings-and-diff

When a pull request has review verdicts for an earlier commit on the same branch, `review-prep.mjs --follow-up` SHALL build the review packet from:

- the open findings of the newest earlier verdicts (severity `blocking` or `decide`), listed with their claims;
- the diff from that earlier reviewed commit to the new head;
- the full diff from the merge base, available to the reviewer but not the starting point.

Reviewers may read beyond the new diff. The new verdict SHALL still be written for the exact new head, and SHALL list each earlier open finding as `fixed`, `still open` or `no longer applies`.

When the earlier reviewed commit is not an ancestor of the new head (the branch was rebased or rewritten), `--follow-up` SHALL fall back to a full review and say why.

#### Scenario: follow-up-packet-has-findings-and-delta

- **GIVEN** verdicts for commit `aa11` with one blocking finding, and two new commits on top ending at `cc33`
- **WHEN** `review-prep.mjs --follow-up --head cc33` runs
- **THEN** the packet lists the blocking finding, and its starting diff is `aa11..cc33`
- **AND** the packet also holds the full diff from the merge base

#### Scenario: rewritten-branch-falls-back-to-full

- **GIVEN** verdicts for commit `aa11`, and the branch was rebased so `aa11` is no longer an ancestor of the head
- **WHEN** `review-prep.mjs --follow-up` runs
- **THEN** it builds a full review packet and prints that the earlier review can't be followed up

#### Scenario: follow-up-verdict-accounts-for-earlier-findings

- **GIVEN** a follow-up packet listing two earlier open findings
- **WHEN** a follow-up verdict is written that lists only one of them
- **THEN** `verdict.mjs write` refuses it and names the finding left out
