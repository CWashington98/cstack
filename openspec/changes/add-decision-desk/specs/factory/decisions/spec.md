## ADDED Requirements

### Requirement: each-question-takes-a-fixed-path

`factory decide <question file>` SHALL route a question by the first step below that applies, and SHALL record which step applied.

1. **Answered before.** An earlier ruling, the project's `objectives.md`, or the change's spec answers it. The step applies when the question names one of these by ID or path and the cited text exists. The answer is applied and cited.
2. **Can't be undone.** The question's `touches` list matches the gate's `neverMerge` or `high` patterns, or the question is tagged `schema`, `sign-in`, `health-data`, `flag-on` or `new-dependency`. It is parked for the owner, and the builder's next action is a different slice.
3. **Can be checked.** The question names a command or test whose output settles it. The command runs, and its output is saved as the proof.
4. **Two blind opinions.** Everything else.

The question file is written by the builder. It holds:

- the question;
- `touches`, the paths it affects;
- tags;
- two to four options, each with its tradeoffs;
- the builder's pick and reasons;
- whether users would see the difference.

#### Scenario: earlier-ruling-applies

- **GIVEN** a ruling from an earlier change that says list pages show 25 rows
- **AND** a new question asking how many rows a new list shows, citing that ruling
- **WHEN** `factory decide` runs
- **THEN** it answers 25 and cites the ruling
- **AND** no second opinion is asked for
- **EXAMPLE:** Ruling `r-0007` says "List pages show 25 rows (owner, 2026-11-02)". The builder of the reminders list asks "25 or 50 rows?" and cites `r-0007`. The card reads "25, from ruling r-0007". No model is called.

#### Scenario: cant-be-undone-is-parked

- **GIVEN** a question whose `touches` includes `amplify/data/schema/patient.ts`, a high-zone path
- **WHEN** `factory decide` runs
- **THEN** it parks the question for the owner
- **AND** the builder's next action names a different slice, not a wait
- **EXAMPLE:** "Add a `deletedReason` field to patients?" touches the schema. The output reads `parked for owner: touches a high-zone path (amplify/data/schema/patient.ts). Next: start slice 3.2`. Tomorrow's digest lists it under "Waiting on you".

#### Scenario: checkable-question-is-proved

- **GIVEN** a question that names a command whose output settles it
- **WHEN** `factory decide` runs
- **THEN** it runs the command, records the answer with the output as proof, and asks for no opinions
- **EXAMPLE:** "Does an index on `contacts.by_org_phone` already exist?" names `grep -n by_org_phone convex/schema.ts`. The output shows line 88, so the card reads "Yes, it exists (proof: schema.ts line 88)".

### Requirement: second-opinion-is-blind-and-cross-family

**What the second model sees.** For a step-4 question, the script SHALL build the brief itself from the question file. The brief holds the question, the context paths and the options, in shuffled order, with neutral labels. It SHALL leave out the builder's pick, the builder's reasons and the builder's option order.

**Which model.** It SHALL use the Breaker route from `factory budget`: Codex when the route allows it, otherwise a fresh Opus run.

**Agreement.** It is decided when both picks name the same option.

**Disagreement.** The coordinator SHALL pick, with both sides' reasons in hand, and the decision SHALL be marked contested.

#### Scenario: brief-hides-the-builders-pick

- **GIVEN** a question file whose builder picked option A with reasons
- **WHEN** `factory decide` builds the second-opinion brief
- **THEN** the brief contains every option and no trace of which one the builder picked or why
- **EXAMPLE:** The builder picked "Hide deleted patients" because "less clutter". The brief lists "Option K: Show deleted patients greyed out" and "Option M: Hide deleted patients", in random order. The words "less clutter" and "builder" appear nowhere in it.

#### Scenario: agreement-decides

- **GIVEN** the builder and the second model both pick the same option
- **WHEN** `factory decide` finishes
- **THEN** the decision is final, marked agreed, and the builder continues
- **EXAMPLE:** "Paginate the reminders list at 25 or 50?" The builder picks 25 because it matches other lists. Codex also picks 25, saying the first load is faster. The card reads "25 rows, agreed by Sonnet and Codex".

#### Scenario: disagreement-is-contested

- **GIVEN** the builder and the second model pick different options
- **WHEN** `factory decide` finishes
- **THEN** the coordinator's pick is recorded, the decision is marked contested, and the builder continues with that pick
- **EXAMPLE:** The builder picks "Hide deleted patients". Codex picks "Show them greyed out, with a filter", saying audits need them visible. The coordinator picks "Hide" because the change is behind a flag and easy to reverse. The card is marked contested and goes first in the digest.

#### Scenario: low-codex-budget-uses-fresh-opus

- **GIVEN** `factory budget` routes the Breaker to Opus for this zone
- **WHEN** a step-4 question needs a second opinion
- **THEN** a fresh Opus run, with none of the builder's context, gives the second opinion, and the card names it
- **EXAMPLE:** Codex is at 93% for the week. The card for "25 or 50 rows?" reads "agreed by Sonnet (builder) and a fresh Opus (Codex budget low)".

### Requirement: every-decision-is-a-complete-card

Each decision SHALL be saved as `decisions/<id>.md` in the change folder, with fixed headings:

- the question;
- the options with tradeoffs;
- the choice;
- how it was decided: the step, and the models with their picks;
- a worked example of what the choice means for a user or a caller;
- how to reverse it, and roughly what that costs;
- the pull requests it affects.

When the question says users would see the difference, the card SHALL link a screenshot of each option, taken by the Behavior lane or the prototype. `factory decide` SHALL refuse to save a card that is missing any of these.

#### Scenario: visible-choice-needs-screenshots

- **GIVEN** a question marked "users would see the difference", with screenshots for only one of its two options
- **WHEN** `factory decide` tries to save the card
- **THEN** it refuses and names the option without a screenshot
- **EXAMPLE:** "Greyed out or hidden?" has `hidden.png` but no greyed-out screenshot. The output reads `card refused: option "Show deleted patients greyed out" needs a screenshot because users would see the difference`.

#### Scenario: card-without-reversal-refused

- **GIVEN** a card with no "how to reverse" section
- **WHEN** `factory decide` tries to save it
- **THEN** it refuses and says which heading is missing
- **EXAMPLE:** The card for "25 or 50 rows?" has everything except "How to reverse". The output reads `card refused: missing "How to reverse" (say what to change and roughly how big that change is)`.

### Requirement: the-owner-answers-later

**The digest.** `factory digest` SHALL show the cards since the last digest in this order:

1. contested;
2. parked for the owner;
3. agreed decisions users would see;
4. everything else, collapsed.

Each card SHALL show its options side by side, with screenshots when it has them.

**The owner's answers.** The owner answers a card with one of three replies:

- `keep <id>` records a ruling that later questions can cite.
- `switch <id> <option>` queues a follow-up slice that changes the decision to that option, with the card's reversal section as its brief.
- `rule <id>` drafts an addition to `objectives.md` as its own pull request. That pull request changes the factory's rules, so the owner reviews it.

#### Scenario: digest-puts-contested-first

- **GIVEN** one contested, one parked and five agreed decisions since yesterday
- **WHEN** `factory digest` runs
- **THEN** the contested card is first, the parked one second, and the agreed ones after
- **EXAMPLE:** Tuesday's digest opens with "Hide or grey out deleted patients (contested)", then "Add deletedReason to the schema? (waiting on you)", then five agreed cards. The three cards users wouldn't notice are collapsed.

#### Scenario: switch-queues-a-follow-up

- **GIVEN** an agreed decision "25 rows per page"
- **WHEN** the owner answers `switch d-0012 B`
- **THEN** a follow-up slice is added to the change's plan, carrying option B and the card's reversal notes
- **AND** the card shows it was switched, by whom and when
- **EXAMPLE:** The owner replies `switch d-0012 B` on Wednesday. `units.tsv` gains a slice "Show 50 rows on the reminders list (switches d-0012)". The card now reads "Switched to B by the owner on 2026-11-04".

#### Scenario: keep-becomes-a-ruling

- **GIVEN** an agreed decision "25 rows per page"
- **WHEN** the owner answers `keep d-0012`
- **THEN** a ruling is recorded that later questions can cite
- **EXAMPLE:** After `keep d-0012`, `rulings.jsonl` gains `r-0007: List pages show 25 rows (owner, 2026-11-02, from d-0012)`. The next list question cites `r-0007` and is answered in step 1.

### Requirement: too-many-disagreements-pause-the-spec

When a change has three or more contested decisions the owner hasn't answered, `factory decide` SHALL tell the coordinator to start no new slices for that change. It SHALL park one question for the owner asking which part of the spec is unclear. Slices already running carry on.

#### Scenario: third-contest-pauses-the-change

- **GIVEN** a change with two unanswered contested decisions
- **WHEN** a third decision comes back contested
- **THEN** the coordinator is told to start no new slices for that change
- **AND** one question for the owner is parked, naming all three decisions
- **EXAMPLE:** The reminders change has contests about deleted patients, snooze length and the empty state. The third one parks "The reminders spec leaves three choices open (d-0014, d-0016, d-0017). Which part should the spec settle?" Slice 2.3 keeps running, and 2.4 doesn't start.
