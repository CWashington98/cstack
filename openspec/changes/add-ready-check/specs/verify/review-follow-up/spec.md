## ADDED Requirements

### Requirement: follow-up-starts-from-findings-and-diff

`review-prep.mjs --since <commit>` SHALL build the review packet from:

- the open findings (severity `blocking` or `decide`) of the verdicts for that commit, listed first;
- the diff from that commit to the new head;
- the full diff from the merge base, available to the reviewer but not the starting point.

The new verdict SHALL still be written for the exact new head. When `<commit>` is not an ancestor of the head, because the branch was rebased or rewritten, it SHALL build a full packet and say why.

The `pr-review` skill SHALL say, in one sentence: if this branch has a verdict for an earlier commit, run `review-prep.mjs` with `--since` that commit.

#### Scenario: follow-up-packet-has-findings-and-delta

- **GIVEN** verdicts for commit `aa11` with one blocking finding, and two new commits on top ending at `cc33`
- **WHEN** `review-prep.mjs --since aa11 --head cc33` runs
- **THEN** the packet lists the blocking finding first, and its starting diff is `aa11..cc33`
- **AND** the packet also holds the full diff from the merge base

#### Scenario: rewritten-branch-falls-back-to-full

- **GIVEN** verdicts for commit `aa11`, and the branch was rebased so `aa11` is no longer an ancestor of the head
- **WHEN** `review-prep.mjs --since aa11` runs
- **THEN** it builds a full review packet and prints that the earlier review can't be followed up
