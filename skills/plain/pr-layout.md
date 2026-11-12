# Pull request layout

Every pull request description uses one layout: Matt Pocock's `/pr` layout (Summary, Evidence, Merge Danger) with a top block for the reviewer and a status line that ties the proof to a commit.

```markdown
**What you need to do:** one line for the reviewer: review and merge, answer
a question (say which), or check something by hand (say what).

**What this change does:** two to four plain sentences for someone who hasn't
seen the work: the problem, who had it, and what changes for them.

**Merge risk: low, medium or high.** One sentence on why. The Merge Danger
section below has the detail.

## Summary
<diagram, diff sketch, or tree>

## Evidence
Status: verified live, verified by tests, type check only, blocked or failed,
for commit <first 12 characters of the commit ID>.
- **Before:** <screenshot / output / failing test run>
  **After:** <screenshot / output / passing test run>
- [ ] Verify unit: the test command and its result.
- [ ] Verify live: the trigger and end state, as a screenshot pair or a recording,
      plus what was read back. Or "none: no user-facing behavior".
- [ ] Verify performance: only when speed or size could change.

## Merge Danger
**Door:** one-way or two-way

**Blast Radius:** <one-word description>

<optional: what could go wrong after merge>

## Technical detail (optional)
For the reviewer, written for a junior developer.
```

## Notes

- **Summary:** pick the smallest view that shows the change: pseudocode, a call tree, a component tree, a file tree, Mermaid, or a diff. Keep prose brief.
- **Merge Danger:** explain the terms the first time. A one-way door is a change you can't walk back, such as deleted data, a sent message or a published release. A two-way door is one you can.
- **Status:** follows the `verify` skill. It names the commit it was checked on, so proof for an old commit can't pass for the current one.
- **Evidence:** screenshots are the best proof when the change is visual. Test results come next: show the exact test that now fails and passes. Tests alone never verify a user-facing change.

A project may add its own sections after these. Keep the top block and the three sections first and in this order.

Credit: the Summary, Evidence and Merge Danger sections are Matt Pocock's `/pr` skill (MIT).
