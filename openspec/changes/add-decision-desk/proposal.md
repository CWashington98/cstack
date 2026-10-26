# Proposal: questions mid-work get answered without stopping the work, and the owner sees every answer later

## Why

Agents hit questions all the time while building. Should the list show 25 rows or 50? Should deleted patients be hidden or greyed out? Does this index already exist?

Today a question goes one of two ways:

- **It stops the work** until the owner answers.
- **The builder quietly picks something** and nobody notices.

Both are bad. The first makes the owner the bottleneck again. The second hides decisions the owner might want to change.

The owner's rule (2026-10-25):

1. A question should not block work if it is low risk, if it has a clear right answer, or if it can be reasoned out.
2. The builder must not make that judgment alone.
3. Every decision is shown to the owner afterwards, with examples, screenshots and tradeoffs. The owner can change it later.

## Who it's for

The owner, who wants work to keep moving and to review decisions in batches. Builders and coordinators, who need a fixed path for questions instead of guessing.

## Before / After

- **Before:** a builder unsure about 25 versus 50 rows either waits for the owner, or picks one and never mentions it.
- **After:** the builder writes the question with both options. A second model picks without seeing the builder's choice. Both chose 25, so it's decided and work goes on. The next morning's digest shows a card: "25 rows per page (two models agreed). Matches the other lists. Option B: 50, which means fewer page changes but a slower first load. Switch with one reply."

## What Changes

**`factory decide` follows a fixed path for each question.** It takes the first step that applies:

1. **Answered before.** A spec, an earlier ruling or a project rule already answers it. That answer is applied and cited.
2. **Can't be undone.** The question touches the never-merge list, a high-zone path, the schema, sign-in, or turning a feature on for users. It is parked for the owner, and the builder moves on to other work.
3. **Can be checked.** A test, a command or the code can settle it. The builder proves the answer, and the proof is saved.
4. **Otherwise, two blind opinions.**
   - The builder writes the options and its pick.
   - A second model picks from the same options, in shuffled order, without seeing the builder's pick or reasons. The second model is Codex when its budget allows, otherwise a fresh Opus.
   - **If they agree**, it is decided.
   - **If they disagree**, the coordinator picks with both sides' reasons in hand. The decision is marked contested.

**Every decision becomes a card** saved with the change. A card holds:

- the question and its options;
- the tradeoffs;
- the choice, and who agreed;
- a worked example;
- how to reverse it;
- screenshots of each option when users would see the difference.

**The morning digest shows the cards**, contested ones first. The owner replies with one of three answers:

- **keep:** the decision stands, and it becomes a ruling;
- **switch:** a follow-up slice to switch to another option is queued;
- **make it a rule:** the decision is proposed as a project rule.

**The gate holds a merge only for contested decisions,** until the owner has seen them. Agreed decisions never hold anything.

**A spec that piles up questions pauses.** Three contested decisions in one spec mean the spec is unclear. The coordinator stops starting new slices for it and asks the owner one question about the spec.

## Capabilities

### New Capabilities

- `factory/decisions`: the question path, cards, the digest and the owner's answers.

### Modified Capabilities

- `factory/gate`: holds a pull request with an unseen contested decision.

## Non-goals

- **Agents deciding questions that can't be undone.** Those are always parked for the owner.
- **A second opinion on things a rule or linter already settles,** such as naming and formatting. Rules answer those in step 1, at no extra cost.
- **Considered and rejected: one model reviewing its own choice.** It tends to agree with itself. The second opinion must not see the first.
- **Considered and rejected: blocking the work on every disagreement.** Building continues. Only the merge waits for one look from the owner.

## Impact

- **New in the `factory` plugin:**
  - `scripts/lib/decisions.mjs`;
  - the `decide` and `digest` subcommands;
  - a short brief for the second-opinion model.
- **The gate:** gains one rule.
- **Each change folder:** gains a `decisions/` folder of cards.
- **Rulings:** live in `<git common dir>/factory/rulings.jsonl`. The project's `objectives.md` holds the rules.
