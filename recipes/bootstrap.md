# Bootstrap — standing up the stack on a new project

Zero → agent-ready in under an hour. This is the transplant guide: what installs in one
command, what you stamp from templates, and the doctrine that makes it hold together.

## 1. Day one — the installs

```bash
# This marketplace:
claude plugin marketplace add CWashington98/cstack
claude plugin install cstack@cstack          # core skills + the karen agent
claude plugin install ui-ux-pro-max@cstack   # externals — only where wanted

# Companion plugins from Anthropic's official marketplace (built in — no setup):
claude plugin install superpowers@claude-plugins-official   # discipline layer: skill-first, brainstorm-first, verify-before-done
claude plugin install code-review@claude-plugins-official   # diff/PR review at variable effort
claude plugin install context7@claude-plugins-official      # live library docs — stops stale-training-data answers
claude plugin install typescript-lsp@claude-plugins-official

# Per-stack, enable per-project as relevant (all official marketplace):
#   vercel · convex · posthog · stripe · playwright · frontend-design

# Cross-model second opinion: OpenAI's "codex" plugin (openai-codex marketplace,
# install via /plugin) — needs the Codex CLI + a ChatGPT login. Cheapest
# independent check that exists: a different model has different blind spots.

# Anything else from the open skills registry (browse at skills.sh):
npx skills add <skill-name>
```

## 2. Stamp the templates

- `templates/CLAUDE.md.template` → `<project>/CLAUDE.md` — the constitution. Fill in the
  non-negotiables, source-of-truth table, validate-before-done commands, and routing table.
- `templates/cstack.md.template` → `<project>/.claude/cstack.md` — per-repo factual deltas
  for the skills ("change what a skill KNOWS, not what it DOES").
- The **karen** agent ships with the plugin — invoke after any agent claims "done":
  independent re-run of the gates, scope check, explicit READY / NOT READY.

## 3. Enforcement hooks — the fool-proof layer

Two laws before any code: **gates read exit codes, never pattern-match output** (text-matching
gates get gamed — a grep-for-"passed" hook once silently passed when tests never ran), and
**bypass flags are banned** (`--no-verify` never; if a hook is wrong, fix the hook).

`.claude/settings.json` starter:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "if": "Bash(git push*)",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/pre-push",
            "timeout": 300
          },
          {
            "type": "command",
            "if": "Bash(gh pr create*)",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/preflight",
            "timeout": 900
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/format-on-save.sh",
            "timeout": 30
          },
          {
            "type": "command",
            "command": "cd $CLAUDE_PROJECT_DIR && npx tsc --noEmit",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

The hook scripts are plain shell: run the project's real commands, `exit 1` on any failure.
`pre-push` runs lint + typecheck + the FULL test suites (subset runners can't be airtight);
`preflight` adds a production build. Mirror the same checks in Husky pre-push so human
pushes hit the identical wall. Layer in ratchets as they earn their place: mutation testing
on money/consent-critical code, an accessibility-contrast test, lockfile guards,
a supply-chain quarantine (`pnpm` `minimum-release-age` + `pnpm dlx` over `npx`).

## 4. Then, in order (each added when the pain shows up, not before)

1. **Binding decisions** — ADRs (+ product decision records), an auto-generated digest,
   a check-decisions step before domain work. Agents extend decisions instead of relitigating.
2. **Worktree-per-actor** — main is merge-target only; every agent gets an isolated worktree.
3. **Domain expert agents** — start with 2–3 (your billing/compliance/frontend equivalents)
   mapped to file patterns in CLAUDE.md's routing table.
4. **Night Shift** — a scheduled overnight agent (launchd/cron) that validates main, picks ONE
   job, and produces exactly one reviewable artifact. It never merges.
5. **Adversarial campaigns** — periodic full-codebase security/quality sweeps: scan → findings
   DB → cross-model revalidation → wave remediation where every fix is red-proven
   (revert it, watch the test fail).

## 5. The doctrine

- **Exit codes, not vibes.** Every gate checks a process exit code.
- **Independent verification.** The actor that did the work never certifies it.
- **Written, binding decisions.** If it isn't a decision record, every new session relitigates it.
- **Reproduce first.** No fix without a failing test that demonstrates the bug.
- **Ratchets, not audits.** Gates that only tighten, running every push.
- **Ground truth over docs.** For money/vendor/auth state: query production, then compare to docs.
- **Risk routes, not size.** Three lines of billing goes to an expert; fifty lines of CSS doesn't.
