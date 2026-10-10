---
name: upkeep
description: Check that every installed Claude Code plugin, pinned skill pointer and pinned tool is current, across every Claude account on this machine. Use monthly, when the owner asks whether skills are up to date, or when a session-start reminder says upkeep is due.
---

# upkeep

Reports what is out of date and prints the command that fixes each problem. It changes nothing except refreshing plugin catalogs.

## Run it

The script is in this plugin's `scripts` folder, two levels above this file:

    node <this skill's folder>/../../scripts/upkeep.mjs

It checks every Claude config folder in your home folder that has installed plugins (for example `~/.claude-work` and `~/.claude-personal`), and every repository listed in `~/.config/cstack/upkeep.json`:

```json
{ "repos": ["~/Source/precordia/mvp", "~/Source/onehearthealth/mobileapp-v2"] }
```

Add `--repo <path>` to check another repository once, `--no-refresh` to skip refreshing catalogs, and `--json` for machine-readable output.

## What it reports

1. Plugin catalogs not refreshed in over two weeks. Claude Code refreshes Anthropic's own catalogs automatically, but not others such as Expo's, so deprecations go unseen.
2. Installed plugins that are behind, deprecated, or no longer listed.
3. Project installs that still load an older version than the main install.
4. Pinned cstack pointers whose picked skills changed upstream, with a link to the changes.
5. Picked skills that no longer exist at their pinned commit. Run `node <this skill's folder>/../../scripts/check-pointers.mjs`; Claude Code reports a misspelled or moved pick as a successful install that loads nothing.
6. Skills copied into a repository that a plugin already provides.
7. Pinned tools with a newer release, such as OpenSpec.

## Then

Show the owner the report. Run only the fixes they approve, in each account the report names. For a changed pointer, read the linked changes before updating its pinned commit in `.claude-plugin/marketplace.json`. Copies inside a repository with teammates are a team decision, never removed silently.

In each repository that has app verification skills (`.claude/skills/verify-*/`), also offer `verify-upkeep`, which re-drives every feature live.
