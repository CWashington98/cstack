# Pull request layout

Every pull request description uses one layout: Matt Pocock's `/pr` layout (Summary, Evidence, Merge Danger) with our add-ons on top. His three sections stay as he wrote them, so his skill and ours produce the same shape. The add-ons are a top block for the reviewer and a status line that ties the proof to a commit.

The top block also opens every review comment from the `verify` plugin's `pr-review` skill. So a reader sees the same three answers first everywhere: what to do, what the change does, and how risky it is to merge.

```markdown
**What you need to do:** one line for the reviewer: review and merge, answer
a question (say which), or check something by hand (say what).

**What this change does:** two to four plain sentences for someone who hasn't
seen the work: the problem, who had it, and what changes for them.

**Merge risk: low, medium or high.** One sentence on why. The Merge Danger
section below has the detail.

## Summary
<diagram, diff-sketch, or tree>

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

<optional: description>

**Blast Radius:** <one-word description>

<optional: potential ramifications of merge>

## Technical detail (optional)
For the reviewer: written for a junior developer.
```

## What is Pocock's and what we add

- **His, unchanged:** the `## Summary`, `## Evidence` and `## Merge Danger` headings, the Before / After pair, and the Door and Blast Radius lines. Write each the way his `/pr` skill says. Pick the smallest view for the Summary: pseudocode, a call tree, a component tree, a file tree, Mermaid, or a diff. Keep prose brief and use the project's own words.
- **Ours, on top:** the three labelled lines at the start, so a reviewer knows what to do before reading anything else. They use plain words. The Merge Danger section keeps his terms, so explain them the first time. A one-way door is a change you can't walk back, such as deleted data, a sent message or a published release. A two-way door is one you can.
- **Ours, inside Evidence:** the `Status:` line and the three Verify boxes. They follow the proof standard in the `verify` plugin's `verify` skill. The status names the commit it was checked on, so proof for an old commit can't pass for the current one.
- **Ours, at the end:** the optional technical detail.

## Evidence rules

Screenshots are the best proof when the change is visual. For screen changes the Before / After pair is a screenshot pair, placed next to the approved prototype when there is one. Test results come next: show the exact test that now fails and passes. Tests alone never verify a user-facing change.

A project may add its own sections after these (a checklist, a table of fields the change relies on). Keep the top block and the three sections above first and in this order.

Credit: the Summary, Evidence and Merge Danger sections are Matt Pocock's `/pr` skill (MIT license). That skill credits Dex Horthy's `show-me` skill for the menu of diagrams. The license for `show-me` is unclear, so we use its ideas, not its text.
