# Proposal: scenarios that guard existing behavior

## Why

The spec compliance check says every scenario's test must fail on the old code and pass on the new. That's right for new behavior, but wrong for a scenario that says some behavior must stay the same. A test for "this stays the same" passes on the old code by definition.

The first dry run on a real project hit this. Precordia's `seat-membership-integrity` change had 18 scenarios. 13 were proven. The other 5 were held only because they describe behavior the change must not alter, such as "invites within the same organization are unaffected". Their tests were correct; the rule was wrong.

## Who it's for

Anyone writing a spec whose change must leave some existing behavior alone, and the person approving it.

## Before / After

- **Before:** a "stays the same" scenario is always held, so writers either drop it from the spec or live with a false hold.
- **After:** the writer marks it as a guard. The check proves it a different way: its test passes before and after, and breaking the code it protects makes it fail.

## What Changes

- A scenario can start with a `**GUARDS**` line saying what must stay the same. You see it at approval.
- For a guard scenario, the check requires its test to pass on the old code and the new. It also breaks the code in the files its task touches, and requires at least one break to make the test fail. That proves the test really protects something.
- A guard whose test fails on the new code is held, because the change altered what it protects.
- Scenarios without the marker keep the fail-first rule: their test must fail on the old code and pass on the new.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runner/spec-compliance`: the fail-first rule applies to scenarios that aren't guards; guard scenarios get their own proof.

## Non-goals

- Guessing which scenarios are guards. The writer marks them, and you approve them.
- Breaking every line in a project. The breaks for a guard stay within the files its task touches, with a cap.

## Impact

- The compliance check in `verify`, its tests, and `docs/project-settings.md`.
- cstack's OpenSpec rules gain one line on how to mark a guard.
