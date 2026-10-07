# fix(labeling): #197 round 3 — Clerk-only invitees told to sign in, viewer panel invites refused, honest 'not sent'

A follow-up to #197 (configurable seats per panel), which was merged into `staging` before the third review's fixes landed. This PR carries only those fixes: 18 files, exactly the three round-3 commits. Merged on top of current `staging` (68ec306); the squash of #197 matched the branch tree exactly, so the merge took the branch's side throughout.

## Why

The third Karen gate on #197 came back NOT READY. Its blocker is real on prod this week. Some doctors have a Clerk login but have never opened the app, so they have no users row.
- A panel invite to them fails at Clerk ("already exists").
- There is nobody for Seat now to seat.
- The console promised an invite link that was never sent.

What actually works is telling them to sign in, so the product now says so.

## What

- **Clerk-only invitees.**
  - `clerk/invitations.send` records a structured `emailErrorCode: "already-has-account"` on that refusal only. Any later outcome and any re-queue clear it. It is an optional field on both invitation tables.
  - `panelDetail` exposes it as `clerkAccountExists`.
  - The row reads **Not sent**, and: "Has a sign-in but hasn't opened the app yet, so no invite email was sent. Tell them to sign in at <origin>/sign-in; they're seated then." There is no Seat now.
  - The `no-account` refusal no longer promises a link.
- **Viewer panel invites are refused** as `viewer-cannot-hold-seat`:
  - by `inviteMember`, before anything is written;
  - by Seat now, for legacy rows.

  Viewer is no longer offered in the panel forms; the org page keeps it.
- **"No invite email was sent" only when it's true:** the line shows only when `emailStatus === "failed"`.
- **Seat now names the role it grants** ("Seat now as admin").
- **Hardening and tests:**
  - LIMIT+1 account boundary, and `capped ||` in the ambiguity check.
  - A two-org member is seated in the invite's org.
  - Disjointness rollback leaves no membership.
- **Docs:**
  - Spec scenarios: `sign-in-seats-clerk-only-account`, `seat-now-no-email-claim-only-when-failed`, `seat-now-on-expired-invite-with-room`, `viewer-panel-invite-refused` and `legacy-viewer-panel-invite`.
  - design.md: Seat now on an expired invite is a deliberate exception to J1.
  - HANDOFF §8 and the test plan updated.
  - A corrected comment on the panels/seating import cycle.

## Verification

- **Gates, on the final tree:**
  - backend unit 263/263, integration 935/935;
  - labeling-app 1070/1070;
  - typecheck and lint clean in both packages;
  - `isolation-checks.sh` passes;
  - `bun run format:check` green repo-wide;
  - `openspec validate configurable-panel-seats --strict` valid.
- **Mutation testing:** every new test was shown red first, or killed by a targeted mutant. The one survivor, the `capped ||` guard, is equivalent at the current cap of 10.
- **Karen final gate (on 0a4f9e8): READY with notes.**
  - Her gate counts match, and 28 of 30 targeted mutants were killed: one survivor is equivalent, the other was a test gap since closed.
  - Her walkthrough of the four real prod doctors (Clerk-only ×2, an account with no membership, no account) shows no one stuck.
- **Her notes, closed after the gate:**
  - The expired Clerk-only copy no longer promises a Resend that a full panel would refuse.
  - `orgDetail` exposes `clerkAccountExists`, so the org page shows such invites as "Not sent" with the sign-in line.
  - A platform-row `emailErrorCode` clear is pinned by a test.
  - HANDOFF §8 explains rows written before this change.
  - The merge-duplicated comment in `corpus/seating.ts` is removed.
  - Every new test was shown to fail against a mutant of the code it covers.

## Prod note

Existing invites that failed before this code carry no `emailErrorCode`, so they still read "seat them instead" until re-sent. Today's re-invites will be new rows, so they get the code.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

