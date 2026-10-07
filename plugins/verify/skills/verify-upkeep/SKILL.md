---
name: verify-upkeep
description: Monthly pass that keeps an app's verification skill honest. It reads each feature's code and re-drives every feature live, even when the code looks unchanged. It sorts each problem into document drift, broken tooling or a broken product, and ships at most one pull request of proven fixes to the skill. Use it for /verify-upkeep, monthly alongside cstack's upkeep, or when a live check fails in a way that suggests the skill is out of date.
---

# Keep an app's verification skill honest

A feature map goes stale the moment the app changes. This skill is the upkeep loop for a verification skill made by `verify-setup`, or any app skill in `.claude/skills/verify-<app>/` with a feature map. The unit of rigor is the feature: cover every feature file from the code, and drive every feature live.

Below, `<plugin>` means this skill's folder followed by `/../..`, which is the plugin's root folder.

## 1. Outcomes

End with exactly one of these, and say which:

- **clean:** every feature was covered from the code and live, and there is nothing to ship. No branch, no pull request.
- **changed:** one pull request of proven corrections to the skill.
- **blocked:** coverage couldn't finish, or a fix couldn't ship safely. Say exactly what blocked it.

## 2. Edit scope

Edit only the app skill's own folder: its `SKILL.md`, `facts.json` and `features/`. Never edit product code during upkeep. When the map describes something the app no longer does, it is either drift (fix the map) or a broken product (report it). Never hide a broken product by changing the map.

## 3. Find the target

Look for `.claude/skills/verify-*/` folders. If there are several, ask which one, or do each in turn. If there are none, stop and point to `verify-setup`. Don't invent a target.

## 4. Index check

```sh
node <plugin>/scripts/check-app-skill.mjs .claude/skills/verify-<app>
```

Fix holds in the skill. Report holds in the repository's own tests to the owner, with the exact lines.

## 5. Read the code, one feature at a time, in parallel

Launch one read-only agent per feature file, all at once (the Agent tool, `subagent_type` set to `Explore`). Each one:

- explains how the feature works, from the code;
- flags likely drift, with file and line;
- returns one recipe for checking the feature live.

These agents never drive the app and never edit files.

## 6. Reconcile

Make sure every feature file has a summary back. Merge the recipes into as few app states as practical. Spot-check the drift they cite; don't re-prove claims that came back clean.

Then look for user-facing changes missing from the map:

```sh
git log --since="<last upkeep date>" --name-only -- <appRoot>
```

Name a concrete file before calling a feature missing.

## 7. Live pass, even when the code looks unchanged

Start one evidence run and follow the app skill and its driving guide (`drive-web` or `drive-expo`):

```sh
RUN=$(node <plugin>/scripts/evidence.mjs start --app <app>)
```

Drive every feature at least once. Hold three rules the whole time, whatever fails:

1. Run a health check before the first drive, and again after anything surprising. A health check that fails because the skill drifted is drift: fix it in the skill and retry once, before calling the pass blocked.
2. Evidence survives every clean-up.
3. Nothing the run started outlives it.

A feature that can't be reached is recorded as unreachable, with a note naming the missing prerequisite and the route tried:

```sh
node <plugin>/scripts/evidence.mjs add "$RUN" --kind unreachable --feature <id> --fail --note "<prerequisite>; tried <route>"
```

If the map doesn't mention that prerequisite, that is drift too.

Finish by checking coverage. This fails if any mapped feature was neither driven nor reported unreachable:

```sh
node <plugin>/scripts/evidence.mjs check "$RUN" --full-run --head HEAD --cover .claude/skills/verify-<app>/features
```

## 8. Sort each problem

- **The document drifted:** the description of what a user does or sees is wrong or missing. Fix the skill.
- **The tooling broke:** a command, label or handle no longer works, but the feature does. Fix the skill, then drive that feature live again before shipping.
- **The product broke:** the app really doesn't do what it should. Report it to the owner. Keep it out of the pull request, and change no product code.

## 9. Ship or stop

- **Changed:** one pull request into the `integrationBranch` from `.claude/verify.json`. Re-read every changed file first. The description must pass the `plain` checker and cite the evidence run. Review it with `pr-review`.
- **Clean or blocked:** no pull request. Report the outcome and the coverage count, such as "covered 5 of 5 features".

## 10. Run notes

Keep short notes in the scratch directory: features covered, unreachable prerequisites, drift found, and the outcome. Don't commit them.

Adapted from Lauren Tan's `maintain-verification-skill` (pstack, MIT license). See `THIRD_PARTY.md` in this plugin.
