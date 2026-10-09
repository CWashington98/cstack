# Pull request layout

Every pull request description uses one layout. Its top block also opens every review comment from the `verify` plugin's `pr-review` skill. So a reader sees the same three answers first everywhere: what to do, what the change does, and how risky it is to merge. It combines Matt Pocock's `/pr` skill with our rules. His version starts with a diagram and uses terms like "one-way door" and "blast radius"; ours starts with plain words and replaces those terms.

```markdown
**What you need to do:** one line for the reviewer: review and merge, answer
a question (say which), or check something by hand (say what).

**What this change does:** two to four plain sentences for someone who hasn't
seen the work: the problem, who had it, and what changes for them.

**Merge risk: low, medium or high.** Whether undoing the merge puts things back
exactly, and what it touches: saved data, server code, sign-in, other teams,
or only the screen.

## How it works
One small picture: a short list of steps, a before-and-after sketch,
a file list, or a diagram. Names in it are explained in the text above.

## Proof it works
Status: verified live, verified by tests, type check only, blocked or failed,
for commit <first 12 characters of the commit ID>.
- [ ] Verify unit: the test command and its result.
- [ ] Verify live: the trigger and end state, as a screenshot pair or a recording,
      plus what was read back. Or "none: no user-facing behavior".
- [ ] Verify performance: only when speed or size could change.
Before: screenshot, failing test or old output.
After: screenshot, passing test or new output.
For screen changes, screenshots sit next to the approved prototype.

## Technical detail (optional)
For the reviewer: written for a junior developer.
```

Screenshots are the best proof when the change is visual. Test results come next. The status and the three boxes follow the proof standard in the `verify` plugin's `verify` skill. Tests alone never verify a user-facing change.

Credit: the layout's ideas come from Matt Pocock's `/pr` (MIT license), which credits Dex Horthy's `show-me` skill for the menu of diagrams. The license for `show-me` is unclear, so we use its ideas, not its text.
