# Design: project rules for the guard

## The setting

```json
{
  "guardRules": [
    { "match": "convex (data|logs|insights|function-spec|dashboard)\\b.*--prod", "action": "allow", "reason": "production reads are fine" },
    { "match": "convex\\b.*--prod", "action": "refuse", "reason": "production writes are the owner's" },
    { "tool": "mcp__.*convex.*", "match": "\"kind\":\"(prod|implicitProd)\"", "action": "refuse", "reason": "the Convex tool server pointed at production" }
  ]
}
```

`match` and `tool` are regular expressions, checked ignoring capital letters. For a shell command, `match` is tested against each command the guard reads out of the line, including commands inside package scripts and shell scripts. It is not tested against the raw line, so a mention in a commit message never matches. For a tool call, `match` is tested against the call's input as JSON text, plus its decoded text.

## Order of checks

1. Settings problems, such as an invalid file or invalid rules: refuse everything.
2. Core rules: refuse.
3. The never list: refuse.
4. Project rules, in order: the first match decides.
5. Nothing matched: allow.

So a project allow rule can only allow things the core rules and the never list don't refuse.

## Reuse

| Piece | Exists in | Extended or new |
|---|---|---|
| Reading commands out of a line, scripts and heredocs | `lib/shell.mjs`, guard.mjs | Reused unchanged |
| The never list, and matching tool-call input | guard.mjs | Extended to check decoded text |
| Convex selector decoding | guard.mjs | Replaced by generic base64 decoding |
| Tool-specific rules (24 tools) | guard.mjs | Removed; the ones worth keeping become examples |
| `agentsMayReadProduction` | guard.mjs, docs | Removed |

## Examples shipped

`docs/guard-rules/` holds one file per tool: database (Convex), mobile app store (EAS), web hosting (Vercel, Netlify), cloud (AWS, Terraform) and containers (Docker, Helm). Each is a short Markdown file with the JSON snippet and a table of sample commands and their expected results, which the examples test reads.

## Decisions

- **2026-10-12, owner:** cstack stays generic. Tool knowledge moves to project settings and examples (approved shape).
- **2026-10-12, owner:** Convex production reads are allowed and writes refused. This is now precordia's rules, written as the Convex example.
- **Lead:** git and GitHub stay in the core rules, because cstack itself runs on GitHub.
- **Lead:** the generic "a tool command whose subcommand is deploy" rule stays in the core, because it names no tool.

## Open questions (for the owner at approval)

1. **The "subcommand is deploy" core rule.** Keep it, or make it an example too? Recommended: keep. It names no tool and catches the most common way production changes.
