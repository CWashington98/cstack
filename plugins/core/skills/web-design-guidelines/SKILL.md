---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

<!-- provenance: vendored 2026-07-05 from BetInsights/betinsights-frontend/.claude/skills/web-design-guidelines (symlinked to .agents/skills/web-design-guidelines); also existed in (byte-identical or whitespace-only variants): CodeHouseSolutions/InternalWork/smsMarketing, onehearthealth/mobileapp-v2, precordia, precordia/mvp; upstream origin: vercel-labs/web-interface-guidelines -->

## Project context
Read the repo's CLAUDE.md for commands and conventions. If `.claude/cstack.md` exists and has a `## web-design-guidelines` section, apply those overrides — they are per-repo facts (commands, paths, policies) that take precedence over generic guidance below.

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

## How It Works

1. Fetch the latest guidelines from the source URL below
2. Read the specified files (or prompt user for files/pattern)
3. Check against all rules in the fetched guidelines
4. Output findings in the terse `file:line` format

## Guidelines Source

Fetch fresh guidelines before each review:

```
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
```

Use WebFetch to retrieve the latest rules. The fetched content contains all the rules and output format instructions.

## Usage

When a user provides a file or pattern argument:
1. Fetch guidelines from the source URL above
2. Read the specified files
3. Apply all rules from the fetched guidelines
4. Output findings using the format specified in the guidelines

If no files specified, ask the user which files to review.
