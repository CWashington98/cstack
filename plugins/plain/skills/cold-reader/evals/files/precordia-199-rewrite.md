# Doctors who have a sign-in but never opened the labeling app are now told to sign in, instead of being promised an invite that never went out

## What changed and why

Some doctors already have a sign-in with Clerk, the service that handles our logins, but have never opened the labeling app, so the app has no record of them. Inviting them to a review panel failed, yet the admin console still promised an invite link. That is happening to real doctors in production this week. The console now says no email went out and tells the admin to ask the doctor to sign in, which seats them on the panel automatically. It also stops "viewer" accounts from being invited to panels, because viewers can't hold a seat.

This finishes the change that made panel seats configurable (pull request 197). That change was merged before the fixes from its third review were in.

## How it works

| Situation | What the admin sees now |
|---|---|
| Doctor has a sign-in but has never opened the app | The invite row says **Not sent**: "Has a sign-in but hasn't opened the app yet, so no invite email was sent. Tell them to sign in at (site)/sign-in; they're seated then." There is no "Seat now" button. |
| Admin tries to invite a viewer to a panel | Refused before anything is saved. Panel forms no longer offer the viewer role; the organization page still does. |
| An invite email really failed | "No invite email was sent" appears, and only in that case |
| Seating someone directly | The button names the role it gives, for example "Seat now as admin" |

## Proof it works

- **Tests:** 263 backend unit tests, 935 integration tests and 1,070 labeling app tests pass. Type check and lint are clean.
- **Tests that can fail:** every new test was shown failing first, or caught a deliberate break in the code it covers. Of 30 deliberate breaks, 28 were caught. One of the two that slipped through can't change behavior at today's limit of 10 people per panel; the other exposed a missing test, now added.
- **Review:** Karen, our automated reviewer, walked through the four real production doctors in this situation and found none left stuck. Her verdict was ready, with notes, all fixed since.
- **Live check: missing.** Under the new standard this pull request would also need a screenshot of a "Not sent" row and of the refused viewer invite.

## Risk

- **Easy to undo:** yes. It changes wording, one invite rule and one new optional field.
- **What it could affect:** invite rows in the admin console. Invites that failed before this change keep the old wording until they are sent again.

## Technical detail

- A new optional field, `emailErrorCode`, with the value `already-has-account`, is stored on both invitation tables. The panel and organization detail queries expose it as `clerkAccountExists`.
- The viewer refusal is the error `viewer-cannot-hold-seat`, raised in `inviteMember` and in "Seat now".
- New spec scenarios cover a doctor with only a Clerk sign-in, the no-email line, seating on an expired invite, and refused viewer invites.
