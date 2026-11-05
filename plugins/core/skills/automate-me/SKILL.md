---
name: automate-me
description: Turns how the owner works into the personal rules that Claude Code and Codex both load. It mines only the messages the owner typed (not agent briefs, tool output or subagent runs) from both tools' history, keeps patterns that repeat, and proposes a diff to the rules for the owner to approve. Use when the owner says "automate me", "update my rules from how I work", or "capture my working style".
disable-model-invocation: true
---

<!-- provenance: adapted 2026-11-05 from Lauren Tan's automate-me (pstack, MIT): https://github.com/cursor/plugins/tree/main/pstack/skills/automate-me. Rewritten for Claude Code and Codex; the output is the owner's rules files, not a separate mode skill. -->

# Automate me

The result is a reviewed diff to the owner's own rules: the user-level files each tool loads on every turn. It never touches a repository's `AGENTS.md` or `CLAUDE.md`; those are team rules with their own review.

## Where the rules live

- **Claude Code:** `$CLAUDE_CONFIG_DIR/CLAUDE.md` (default `~/.claude/CLAUDE.md`). Follow symlinks and `@path` imports to the real files.
- **Codex:** `$CODEX_HOME/AGENTS.md` (default `~/.codex/AGENTS.md`), one per Codex home. Codex does not follow `@path` imports.
- **The layout to aim for:** one core file of rules for any tool, which each Codex `AGENTS.md` links to and `CLAUDE.md` imports. Rules that name something only Claude Code has (a Claude tool, agent type, skill or hook) go in a Claude-only section of `CLAUDE.md`, after the import. If the owner's files aren't laid out this way, propose the split first and wait for a yes.

## Flow

1. **Scope.** On a first run, mine the last four weeks. On a repeat run, mine only what came after the core file last changed. Ask which projects to mine (AskUserQuestion, multiSelect), offering the projects with the most sessions. Never mine every project by default.
2. **Collect** with the script, two folders above this file:

       node <this skill's folder>/../../scripts/human-turns.mjs --since <YYYY-MM-DD> \
         --project <path part> --claude <config dir>/projects --codex <Codex home> \
         --marker "<brief marker>" --out "$(mktemp -d)/turns"

   - Repeat `--project`, `--claude` and `--codex` as needed. Folders linked to each other are read once.
   - **Brief markers** are text found only in briefs agents write for other agents. Good first markers: any line the owner's rules require at the end of every worker brief, and the opening phrases of the owner's subagent and delegation briefs.
   - The script prints counts only. Read them, then look at how the 20 longest kept messages open: `jq -r '"\(.text|length)\t\(.text[0:80]|gsub("\n";" "))"' <out>/turns.jsonl | sort -rn | head -20`. If agent briefs are still there, add a marker and run it again.
   - Tell the owner the counts and the markers you used.

3. **Mine.** Start one subagent per `slice-<n>.jsonl`, all at once, on a capable model (never Haiku). Give each:
   - the slice's path;
   - the current rules text, so it reports only what's new or what contradicts a rule;
   - the signals list below;
   - these rules:
     - Report each pattern as one line: the rule in the imperative, its category, and its evidence as `session@date` pointers.
     - Never quote or paraphrase what was said. Patient, customer and private data must not leave the slice file.
     - Skip text that reads like one agent briefing another.

   Signals to look for:
   - corrections to replies (length, tone, format)
   - when to act and when to ask
   - how work gets delegated
   - what counts as done and how it's proved
   - code and writing rules
   - git, pull request and review habits
   - how skills get used and fixed

4. **Cross-check.** Keep a pattern only when it shows up in two or more slices. A correction the owner repeated outweighs a one-off request. When a pattern contradicts an existing rule, show both, and never overwrite silently.
5. **Ask.** Put the strongest new rules to the owner in up to four AskUserQuestion questions, multiSelect, each option with a concrete example (not a quote). End with one open question for anything the mining missed.
6. **Draft** the approved rules as a diff to the core file, or to the Claude-only section. Each rule gets one imperative line, and only if it differs from what agents do anyway. Link other skills by name instead of restating them. Run the `plain` skill over the new lines if it's installed. Show the diff, back up each file it touches next to the original with today's date, and write only after the owner says yes.
7. **Prove it.** In an empty folder, start a fresh Claude Code session (`claude -p`, prompt on stdin) and a fresh Codex session for each Codex home (`codex exec --skip-git-repo-check -s read-only`). Ask each to quote one new rule word for word.
   - Word the question neutrally. Codex labels the owner's rules "AGENTS.md instructions", so asking for "global, not repository" rules makes it answer NONE.
   - Codex must not be able to quote a Claude-only rule.
   - Show the owner the answers.
8. **Clean up.** Delete the output folder. It holds the owner's raw messages.

## When not to use

- One narrow workflow, such as how the owner writes commit messages: write a regular skill instead.
- Rules for one project: change that repository's `AGENTS.md` through its own review.
