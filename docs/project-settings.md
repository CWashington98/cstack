# The project settings file

Each project keeps its own facts in `.claude/verify.json`. cstack's skills and
its guard know nothing about any one project. Everything they need to know
about yours comes from this file. A copy with every field empty is in
[`templates/verify.example.json`](../templates/verify.example.json).

The file is usually committed, so teammates get the same protection. A project
where only you use cstack can keep it untracked (add it to `.gitignore`).
Worktrees without their own copy use the main checkout's.

## Fields

| Field | Required | What it holds | Who reads it |
|---|---|---|---|
| `integrationBranch` | Yes | The branch pull requests target, such as `main` or `staging`. Agents never push to it directly. | `pr-review`, `verify-upkeep`, the guard |
| `highRisk` | No | Path patterns for code where a mistake hurts most: customer data, sign-in, billing, results. Changes there get the deepest review. | `pr-review`, `verify` |
| `protectedBranches` | No | Branches agents never push to directly. Leave it out to use `main` and `master`. `integrationBranch` is always added. | The guard |
| `agentsMayDeployTo` | No | Deploy targets agents may use: a staging backend's name, a cloud sandbox profile. Leave it empty if agents never deploy. | The guard |
| `agentsNeverTouch` | No | Text agents must never use in a command: production backend names, production addresses, cloud profiles for production, or a whole command such as `bun run release:prod`. | The guard |

Entries in the three guard lists are matched as text inside commands, ignoring
capital letters. Use full names: an entry like `prod` would refuse every command
that contains those four letters. `verify` refuses entries shorter than 3 characters.

## The guard

The cstack plugin runs `plugins/core/scripts/guard.mjs` before every shell
command an agent sends. It refuses:

- deploys that change a live system (`convex deploy`, `vercel --prod`,
  `cdk deploy`, `terraform apply` and similar), unless the command names a
  target from `agentsMayDeployTo`. It reads `package.json` scripts and shell
  scripts, so `bun run deploy` is caught when the script deploys;
- store submissions, production app builds, package publishes and GitHub releases;
- pushes to protected branches, force pushes and deleting protected branches;
- changes to GitHub secrets, rulesets, branch protection and repository settings;
- recursive deletes outside the repository and temporary folders, or of a whole repository;
- any command that uses an entry from `agentsNeverTouch`. Commands that only
  mention a name, such as a search, a commit message or a pull request comment,
  are allowed.

It does not refuse merges. Agents merge when the owner says so, and the code
host's rules decide who may merge.

When it refuses, the agent is told to hand the owner the exact command to run
with `!` in front. Refusals and the guard's own errors are logged to
`guard-log.jsonl` in the `cstack` folder of your Claude configuration folder.

If the settings file can't be read, the guard refuses every shell command until
it is fixed, because it can't see the "never" list. If the guard itself fails
while checking a command that looks guarded, it refuses.

**Its limit:** it reads command text and the shell scripts that text runs. A
deploy started from inside a program, such as a Node or Python script that runs
other commands, can still get past it. It guards against mistakes, not against
an agent working to get around it.

## Example

A web app with a staging backend agents may deploy to:

```json
{
  "integrationBranch": "staging",
  "highRisk": ["src/billing/**", "src/auth/**"],
  "protectedBranches": ["main"],
  "agentsMayDeployTo": ["happy-otter-123"],
  "agentsNeverTouch": ["brave-lion-456", "app.example.com"]
}
```
