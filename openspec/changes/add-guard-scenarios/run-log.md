# Run log: add-guard-scenarios

## 2026-10-11, task 1.1: acceptance tests

- Added `plugins/verify/tests/guard-scenarios.test.mjs`: five tests, one per new scenario, each named with its scenario ID.
- Red result: 5 tests, 0 passed, 5 failed, every one by an assertion (none crashed). The existing `spec-compliance.test.mjs` still passes 30 of 30.
- Example failure, guard-passes-before-and-after: "the change is proven" expected exit 0 but got 1, because today the check treats a test that passes on the starting commit as "doesn't depend on the change".
- Commit: see the git log entry "test(acceptance): guard scenarios".

## Rulings

- Ruling: the guarded code stays unchanged by the sample build, which only adds an unrelated file — a guard protects code the change must not alter — if wrong, the tests would not model a real guard.
- Ruling: tests read break counts and the cap as "<number> breaks" and the word "cap" in the report text, since the spec gives no fixed field — the exact wording is the implementation's — if wrong, the implementation must adjust its wording or the lock needs a Spec-Change line.
- Ruling: the break that was caught is checked as "flipped ..." or "moved the number ..." text, the wording the high-risk lane already uses — if the guard lane words it differently, that one assertion needs a Spec-Change line.
- Ruling: the cap test uses 40 conditions in the guarded file and a test that only checks an answer comes back, so it catches none — if wrong, the run still stays fast because each break runs one tiny test.

## 2026-10-12, tasks 2.1 to 3.1 and the precordia dry run (4.1)

- Guard breaks use the committed latest commit in a temporary checkout, as the high-risk lane does. Uncommitted edits are not seen. The guard lane does not refuse a dirty folder, since it runs on every lane.
- Report wording: a guard that passes prints "Guard <id>: proven as a guard. Break N of the code it protects was noticed (...)". A guard that fails the break step holds with "doesn't protect the code its task names: N breaks were tried in <files>", plus "The cap of 30 was reached" when more breaks were left.
- Precordia result: 18 of 18 scenario tests ran; 17 proven, 4 of them as guards. platform-invite-unaffected is held: 30 breaks tried in admin/mutations.ts and corpus/panels.ts, none noticed. Task 4.1 is left unticked, because it asks for 18 of 18.

## Rulings (2026-10-12)

- Ruling: guard breaks are not limited to changed lines and run in file order, but past the cap of 30 they are spread evenly over all candidates — the spec fixes the cap but not the order, and file order never reached the end of a large file — if wrong, a different 30 are tried, and a guard may be proven or held by which 30 were picked.
- Ruling: the guard's files are the Touches of every task whose Covers names it, minus test files, markdown and openspec files — the spec says "the files that the scenario's covering task touches" — if wrong, a guard whose task lists only tests or docs holds with "no file".
- Ruling: a guard that fails on the starting or latest commit raises its hold under a new check name, guards-protect-what-they-name, and skips the fail-first judgment — a guard has no fail-first — if wrong, a reader grouping holds by check name sees a new name.
- Ruling: in the precordia clone, platform-invite-unaffected is covered by task 2.1, the only task touching admin/mutations.ts where invitePlatformAdmin lives — the clone's tasks have no Covers lines to follow — if wrong, the guard is proven against the wrong files.
- Ruling: the cap leaves platform-invite-unaffected held on precordia, and I did not tune the order until it passed — the test only checks that a row exists, and a break at line 471 of admin/mutations.ts (&& to ||) looks like one it would catch, but the cap's sample skipped it — if wrong, the owner reads a weak guard as a cap problem, or the reverse.

## 2026-10-12, guard break order and the finished dry run (4.1)

- Guard breaks now start with the code the guard's test calls: the identifiers in the test bodies (from the declaration carrying the scenario bracket to the next declaration) are matched to definitions in the guard's files, and breaks inside those definitions are tried first. The rest follow, spread evenly, at most 30 in all. The report says which caught break was in code the test calls.
- Precordia result: 18 of 18 scenario tests ran and 18 proven, 5 of them as guards. platform-invite-unaffected is caught at its second break (line 471 of admin/mutations.ts, `&&` to `||`). Task 4.1 is ticked.

## Rulings (2026-10-12, break order)

- Ruling: the earlier hold of platform-invite-unaffected was a false hold of the check, not a weak test — the lead flipped `existingUsers.length > 0 &&` to `||` at line 471 of admin/mutations.ts by hand and the guard's test failed, while the 30 evenly spread breaks had never tried that line — if wrong, the guard was proven by luck of the order.
- Ruling: the spec fixes the cap of 30 but not the order, so the order is changed without editing specs/ — if wrong, the order needs a Spec-Change line.
- Ruling: a definition is recognised by language-neutral patterns (`function name`, `def name`, `const name =`, `name:`, `name(...) {`) and runs to the line before the next line at the same or lower indentation — if wrong, a range is too short or too long, which only changes which breaks go first.
- Ruling: every identifier of four or more characters in a test body counts as a name the test calls, so a common word can pull extra code to the front — if wrong, the first breaks are less targeted, and the cap and the evenly spread rest still apply.

## Rulings (2026-10-12, carried-over scenarios)

- Ruling: the owner approved the carry-over addition, so the spec, design, proposal and tasks gained it and the approval fingerprint was recomputed — if wrong, the fingerprint must be rolled back to the earlier approval.
- Ruling: "same wording" compares each scenario's GIVEN, WHEN, THEN and AND lines by kind and trimmed text, in order — the owner's rule names those lines — if wrong, a reworded line could count as unchanged.
- Ruling: the self-check holds one scenario, passes-on-old-code-too, and I left the hold in place — this change reworded it ("not marked as a guard"), so by the approved rule it is new, and its test passes on the old code because it describes behavior that already existed — if wrong, the owner either restores the old wording (making it carried over) or marks the scenario as a guard.
- Ruling: the living specs are read from the working folder, not from the starting commit — the check already reads the project's specs that way for scenario IDs — if wrong, a change that edits openspec/specs itself could mark its own scenarios as carried over.
