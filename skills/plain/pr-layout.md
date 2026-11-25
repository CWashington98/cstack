# Pull request layout

Every pull request description opens with a plain-English **Executive Card + Scenario Table** that a non-engineer or business stakeholder can read cold in 15 seconds, followed by a hard divider (`---`) and engineering detail + proof below.

```markdown
**What you need to do:** one line for the reviewer: review and merge, answer
a question (say which), or check something by hand (say what).

| Who is affected | Live for users now? | Merge risk | Can we undo cleanly? |
| --- | --- | --- | --- |
| <people/role> | Yes / No (behind flag / not live yet) | Low / Medium / High | Yes, revert restores cleanly / caveat |

**What this change does:** two to four plain sentences for someone who hasn't
seen the work: the problem, who had it, and what changes for them. No file
paths, function names, or code jargon above the divider.

**Concrete examples:**

| Real-world scenario | Before | After |
| --- | --- | --- |
| <named role + situation> | <what went wrong> | <what happens now> |

**Merge risk: low, medium or high.** One sentence on blast radius, whether
reverting puts things back cleanly, and what area it touches.

---

## How it works
<diagram, diff sketch, file paths, function names, or short list of steps>

## Proof it works
Status: verified live, verified by tests, type check only, blocked or failed,
or docs only, for commit <first 12 characters of the commit ID>.
- **Screenshots / GIFs** (for anything a user sees) or `Proof not captured: <reason>`.
- **Before:** <screenshot / output / failing test run>
  **After:** <screenshot / output / passing test run>
- [ ] Verify unit: the test command and its result.
- [ ] Verify live: the trigger and end state, as a screenshot pair or a recording,
      plus what was read back. Or "none: no user-facing behavior".
- [ ] Verify performance: only when speed or size could change.

## Technical detail (optional)
For the reviewer, written for a junior developer.
```

## Notes

- **Plain English above `---`:** Everything before `## How it works` must be understandable by a business user coming in cold. Keep file paths (`.ts`, `.tsx`, `.mjs`, `apps/`, `scripts/`), function names, and internal acronyms below the divider.
- **Concrete examples:** Include at least one named real-world `Before` / `After` scenario so a reviewer switching contexts immediately sees what changes in practice. Omit only on `docs only` PRs.
- **How it works:** Pick the smallest view that shows the change: a short list of steps, pseudocode, call tree, file list, Mermaid diagram, or diff sketch.
- **Status:** Follows the `verify` skill and names the commit it was checked on, so proof for an old commit can't pass for the current one.
- **Proof attachments:** Screenshots or animated GIFs are the best proof when a change is visual. Tests alone never verify a user-facing change.

A project may add its own sections after `## Proof it works` (for example `## Repo checks`, `## Ground truth`, or `## Reviews`). Keep the plain-English top block, `## How it works`, and `## Proof it works` first and in this order.

Credit: adapted from Matt Pocock's `/pr` skill (MIT).
