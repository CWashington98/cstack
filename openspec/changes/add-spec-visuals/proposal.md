# Proposal: every spec comes with worked examples and a dated diagram

## Why

GIVEN / WHEN / THEN says what must happen in general terms. A reader new to the project still has to imagine a real case to understand it. Specs also have no pictures. When someone does draw one, nothing records when it was last true. A diagram can quietly fall behind the code it describes and keep misleading people for months.

The owner asked for three things on 2026-10-25:

1. Worked examples for every scenario, written so a cold reader can follow them.
2. A diagram with every spec.
3. A date on every diagram, so a diagram that has fallen behind, or hasn't been checked in months, shows up and can be fixed or removed.

## Who it's for

Anyone who reads a spec without having written it: the owner approving it, a junior developer building it, a reviewer checking it, an agent starting a fresh session.

## Before / After

- **Before:** "GIVEN a pull request into an allowed base…" and no picture. Nobody knows whether an old diagram is still right.
- **After:** "Example: #412 goes into `dev`, changes `src/Badge.tsx` by 180 lines…", plus a diagram stamped "last checked 25 October 2026". A checker lists any diagram whose subject changed after that date, and any diagram that hasn't been checked in 90 days.

## What Changes

- **Examples.** cstack's OpenSpec rules require every scenario to end with an `**EXAMPLE:**` bullet. It uses concrete names, numbers and the exact output. `verify-plan` holds a new scenario without one, and only advises on scenarios written before this rule.
- **Diagrams.** cstack's OpenSpec rules require every change to have at least one diagram in its `diagrams/` folder. The diagram is drawn with `plain`'s `to-diagram` skill, passes its checker, and appears in `design.md` with a caption.
- **Stamps.** Each diagram folder holds `diagrams.json`. It lists each diagram with:
  - the question it answers;
  - the files it depicts;
  - the date it was made;
  - the date it was last validated.

  The diagram itself shows the same last-validated date in visible words.
- **A checker, `plain`'s `diagram-age`.** It reads every `diagrams.json` in the repository and reports each diagram as one of:
  - **current**;
  - **lagging:** a file it depicts changed after it was last validated;
  - **stale:** not validated in 90 days;
  - **remove?:** not validated in 180 days;
  - **unstamped:** no entry, or the entry and the picture disagree.
- **`diagram-age --validate <file>`** updates the date after a person or agent has re-checked the picture against what it depicts. It refuses when the diagram doesn't pass `to-diagram`'s checker.

## Capabilities

### New Capabilities

- `rules/spec-format`: examples and diagrams are required in specs and changes.
- `plain/diagram-age`: stamps and the freshness check.

### Modified Capabilities

None.

## Non-goals

- **Redrawing old diagrams automatically.** The checker only says which ones to look at.
- **Deleting diagrams.** It proposes removal. A person removes them.
- **Considered and rejected: dating by commit only.** A commit ID in the picture fails the plain-English rules, and a date is what a reader can judge at a glance. `diagrams.json` can still hold the commit for tools.

## Impact

- `openspec/config.yaml` (cstack's rules, which it also ships to projects).
- `plugins/verify/scripts/lib/plan.mjs`.
- New `plugins/plain/scripts/diagram-age.mjs`.
- The `to-diagram` skill's text.
- `docs/project-settings.md`, which gains the `diagramMaxAgeDays` and `diagramRemoveAfterDays` settings in `.claude/plain.json`.
