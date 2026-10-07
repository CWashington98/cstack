# Pull request layout

Every pull request description uses one layout. It combines Matt Pocock's `/pr` skill with our rules. His version starts with a diagram and uses terms like "one-way door" and "blast radius"; ours starts with plain words and replaces those terms.

```markdown
## What changed and why
Two to four plain sentences: what is different for users or developers, and why.

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

## Risk
Easy to undo? Yes or no, and why.
What it could affect: screens, data, other code, other teams.

## Technical detail (optional)
For the reviewer: written for a junior developer.
```

Screenshots are the best proof when the change is visual. Test results come next. The status and the three boxes follow the proof standard in the `verify` plugin's `verify` skill. Tests alone never verify a user-facing change.

Credit: the layout's ideas come from Matt Pocock's `/pr` (MIT license), which credits Dex Horthy's `show-me` skill for the menu of diagrams. The license for `show-me` is unclear, so we use its ideas, not its text.
