---
name: verify-setup
description: Create a verification skill for one app in this repository. With it, any agent can start the app, check it is the right build, drive its features the way a user does, and capture proof. Use it for /verify-setup <app>, when an app has no .claude/skills/verify-<app>/ folder, or when a change first touches an app that has none.
---

# Create an app's verification skill

Every app needs a scripted way to drive the real running app and prove its behavior: start it, use a feature the way a user would, and capture evidence. This skill writes that as a skill inside the project.

Below, `<plugin>` means this skill's folder followed by `/../..`, which is the plugin's root folder.

## 1. What you are making

A folder `.claude/skills/verify-<app>/`, committed to the project. Write it for an agent who has never seen the app and reads it cold, in the middle of a task.

It holds only this app's facts. How to drive a web app or an Expo app in general lives in the `drive-web` and `drive-expo` skills, and the app skill points to one of them. The folder `example/verify-notes/` next to this file is a complete example for a made-up notes app. Copy its layout.

If `.claude/skills/verify-<app>/` already exists, don't overwrite it. Offer the `verify-upkeep` skill instead, which repairs and updates an existing one.

## 2. Settings first

If `.claude/verify.json` is missing, create it with two fields:

- `integrationBranch`: the branch pull requests target. Read `git symbolic-ref refs/remotes/origin/HEAD` and the base branch of recent pull requests. Ask the owner if they disagree.
- `highRisk`: path patterns for code where a mistake hurts most: patient or customer data, results, recording, sync, sign-in, billing, consent and security. Propose them from the code and let the owner confirm.

Add `.verify/` to `.gitignore` if it is not there. Evidence runs go in that folder and must never be committed.

## 3. Interview the repository, not the owner

Answer these from the code before asking anyone anything:

- **Surface:** is the app a web app or an Expo app?
- **Start:** the documented dev command, its port, the environment files it reads, and any seed commands. Prefer the repository's own scripts and readme.
- **Drive:** how an agent can use it. Existing Playwright tests, Maestro flows, test accounts and fixtures come first.
- **Observe:** what evidence can be captured: screenshots, logs, and how to read back stored data with the backend's own command line tool.
- **Isolation:** whether two copies can run side by side, on different ports and data folders. If not, say so in the skill. Refusing to drive a shared copy beats corrupting someone's session.
- **Production:** which deployments and addresses are production, so the health check can refuse them.

Ask the owner only what the code can't answer, all in one batch with the AskUserQuestion tool. Production targets always need the owner's confirmation.

## 4. A broken base comes first

If the app doesn't build or start as it is, fix that or report it precisely before writing anything. A skill written against a broken base teaches wrong steps.

## 5. Write `facts.json`

Follow `facts-schema.md` in this skill's folder. Take IDs and addresses from the app's own files, such as `app.json`, `package.json` and environment examples. Never write them from memory.

## 6. Write `SKILL.md`

Give it frontmatter with `name: verify-<app>` and a description that names the app, its surface and when to use the skill. Without the frontmatter the skill never loads. Then write the seven sections from the example, each grounded in what step 3 found, with no placeholders left:

- **Start:** the exact start command, how to tell the app is ready, and how to stop it.
- **Health check:** only this app's own checks, on top of the guide's general ones. For example: the test account is signed in, the backend is not production, the seed data exists.
- **Drive:** starts with "Load the `drive-web` skill first" or "Load the `drive-expo` skill first". Then the real routes, screen labels and test handles from the code. Never screen positions.
- **Evidence:** the evidence folder, `.verify/runs/<app>/`, and what each piece must show.
- **Clean up:** stop only what this run started. Never delete the evidence.
- **Helpers:** exact commands only, never scripts with their own logic. Logic that every project needs belongs in this plugin, not in one project.
- **Feature map:** points to `features/README.md`.

## 7. Seed the feature map

Write `features/README.md` and one file for each of the top three to five user-facing features. Find them from routes, screens and existing tests.

The README lists every feature, the shared preconditions, and the rule that a skipped entry point is never reported as verified through another path.

Each feature file has a title line, one paragraph on what the user sees, and exactly four sections in this order:

1. **Sub-features:** short IDs in backticks, such as `play`, with one line each.
2. **How to get to it (user view):** every way a user reaches it.
3. **Driving it with Playwright** (or Maestro): preconditions, then each action paired with its exact command and the result to observe.
4. **Gotchas:** traps that can waste or spoil a run.

Describe what a user does and sees. Keep implementation details out.

## 8. Write test prompts for the app skill

Add `evals/evals.json` to the app skill, in skill-creator's shape. Include at least three prompts: driving one mapped feature; a health check that catches a stale server or one from another checkout; and a request for a feature the map doesn't list.

## 9. Check it

```sh
node <plugin>/scripts/check-app-skill.mjs .claude/skills/verify-<app>
```

A hold in the skill is fixed in the skill. A hold in the repository's own tests is a real finding: a flow aimed at the wrong app ID, a flow that never acts, a fixed pause. Report it to the owner with the exact lines. Fix those test files in a separate commit, and only with the owner's agreement. Never change product code here.

## 10. Prove it before handing it over

Run the new skill once, end to end, recorded with `evidence.mjs`:

1. start the app;
2. run the health check;
3. drive one mapped feature, with its trigger, end state and read-back;
4. clean up;
5. confirm the evidence survived:

```sh
node <plugin>/scripts/evidence.mjs check "$RUN" --full-run --head HEAD
```

Fix what fails. Run the clean-up after every failed attempt, so nothing is left running.

A generated skill that was never run is a draft, not a deliverable. If the run can't happen, for example because there is no simulator or a credential is missing, finish the run as "blocked". Name exactly what is missing, and report the skill as a draft.

## 11. Hand over

Commit the skill on a branch, for a pull request into the integration branch. Mention the `verify-upkeep` skill, which keeps the skill honest as the app changes.

Adapted from Lauren Tan's `create-verification-skill` (pstack, MIT license). See `THIRD_PARTY.md` in this plugin.
