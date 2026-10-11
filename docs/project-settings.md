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

Entries in `agentsNeverTouch` and `agentsMayDeployTo` are matched as text inside
commands, ignoring capital letters. Use full names: an entry like `prod` would
refuse every command that contains those four letters. `verify` refuses entries
shorter than 3 characters there. `protectedBranches` holds exact branch names.

## The guard

The cstack plugin runs `plugins/core/scripts/guard.mjs` before every shell
command an agent sends. It refuses:

- deploys that change a live system (`convex deploy`, `vercel --prod`,
  `cdk deploy`, `terraform apply`, `gcloud run deploy`, `supabase db push`, and
  any other tool whose command is `deploy` or ends in `:deploy`), unless that deploy names a
  target from `agentsMayDeployTo`. The target must be named in the same command,
  in a variable or env file that feeds it, or in the command that ran the script
  the deploy sits in. A target named elsewhere in the line doesn't count;
- store submissions (`eas submit`, `--auto-submit`), production app builds,
  updates and channel changes, `eas deploy --prod`, EAS and GitHub workflows that
  deploy or release, package publishes, GitHub releases, and tag pushes
  (including a tag made earlier in the same command, or a name like `v1.2.0`);
- pushes to protected branches, `--force` and `+` pushes, and deleting protected
  branches. `--force-with-lease` to your own branch is allowed;
- changes to GitHub secrets, keys, rulesets, branch protection, access and
  repository settings, and `gh pr merge --admin`, which overrides the merge rules;
- `--prod` on a Convex command, except `convex dashboard --prod`, which only
  prints an address;
- recursive deletes outside the repository and temporary folders, of a whole
  repository, or of its history. When the working folder isn't a repository,
  only temporary folders count as safe;
- any command that uses an entry from `agentsNeverTouch`, including inside an env
  file it loads or a heredoc it feeds to a program. Commands that only mention a
  name, such as a search, a commit message or a pull request comment, are allowed.

It reads commands the way the shell runs them. It looks through:

- wrappers such as `npx` and `dotenvx run --`;
- shell blocks (`if`, `for`, `while`, `{ }`), `bash -c`, `eval`, `$( )` and heredocs;
- package scripts, with their pre and post scripts, in the right workspace, or
  in every workspace for `pnpm -r`, `--workspaces`, `yarn workspaces foreach`,
  `turbo run`, `nx` and `lerna run`;
- shell scripts, `source`, and scripts written and run in the same command.

It follows variables the command sets, so `tmp=$(mktemp -d) && rm -rf "$tmp"`
is allowed.

It does not refuse ordinary merges. Agents merge when the owner says so.

When it refuses, the agent is told to hand the owner the exact command to run
with `!` in front. Refusals and the guard's own errors are logged to
`guard-log.jsonl` in the `cstack` folder of your Claude configuration folder,
with secrets hidden.

If the settings file can't be read, the guard refuses every shell command until
it is fixed, because it can't see the "never" list. If the guard itself fails
while checking a command that looks guarded or names a "never" entry, it
refuses. Input that isn't a hook call at all is allowed and logged; Claude Code
always sends a hook call.

**Its limits:** it reads command text, the scripts that text runs and the env
files it loads. These can still get past it:

- commands started from inside a program: a Node or Python script, a Makefile
  recipe (only the target's name is read), a GitHub workflow's own steps;
- commands fed to a shell through a pipe, such as `echo ... | sh`;
- a workflow whose name and file don't show that it deploys;
- a script written with `echo` or `printf` and run in the same command (scripts
  written with a heredoc are read);
- a production target the project hasn't listed in `agentsNeverTouch`.

An allowed deploy target counts when it's named in the deploy's own command or
in any variable set earlier in the same command, even one that doesn't feed the
deploy.

It guards against mistakes, not against an agent working to get around it.

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
