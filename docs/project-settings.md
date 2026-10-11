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
command an agent sends, and before every call it makes to a tool server. For
shell commands it refuses:

- deploys that change a live system, unless that deploy names a target from
  `agentsMayDeployTo`. Examples are `convex deploy`, `vercel --prod`,
  `cdk deploy`, `terraform apply`, `gcloud run deploy`, `supabase db push`,
  `drizzle-kit push`, `helm install` and `aws s3 sync --delete` into a bucket.
  An nx or Angular target named `deploy` counts, and so does any other tool
  whose command is `deploy`. `helm` dry runs and `helm plugin` commands are
  allowed. The target must be named in the same command, in a variable or env
  file that feeds it, or in the command that ran the script the deploy sits
  in. A target named elsewhere in the line doesn't count;
- app store releases: `eas submit`, `--auto-submit`, production app builds,
  updates and channel changes, `eas deploy --prod`, and Expo Application
  Services workflows that build for the stores or submit;
- package publishes, `nx release`, GitHub releases, and GitHub workflows that
  deploy or release;
- tag pushes, including a tag made earlier in the same command, a name like
  `v1.2.0`, and tag pushes in the scripts `npm version` runs;
- pushes to protected branches, `--force` and `+` pushes, and deleting protected
  branches. `--force-with-lease` to your own branch is allowed;
- changes to GitHub secrets, keys, rulesets, branch protection, access and
  repository settings, and `gh pr merge --admin`, which overrides the merge rules;
- `--prod` on a Convex command, except `convex dashboard --prod`, which only
  prints an address;
- recursive deletes outside the repository and temporary folders, of a whole
  repository, or of its history: the `.git` folder or anything inside it. When
  the working folder isn't a repository, only temporary folders count as safe;
- any command that uses an entry from `agentsNeverTouch`, including inside an env
  file it loads or a heredoc it feeds to a program. Commands that only mention a
  name, such as a search, a commit message or a pull request comment, are allowed.

It reads commands the way the shell runs them. It looks through:

- wrappers such as `npx` and `dotenvx run --`;
- shell blocks (`if`, `for`, `while`, `{ }`), `bash -c`, `eval`, `$( )` and
  heredocs. A `<<` inside quotes is text, not the start of a heredoc;
- package scripts, with their pre and post scripts, in the right workspace, or
  in every workspace for `pnpm -r`, `--workspaces`, `yarn workspaces foreach`,
  `turbo run`, `nx` and `lerna run`;
- shell scripts, `source`, and scripts written with a heredoc, `echo` or
  `printf` and run in the same command.

Some deploys are known only by a name: a make, just or turbo target, or a
package script the guard can't find. Such a name counts as a deploy when it
holds deploy, release, publish, submit or promote. A name that ends in a word
that only reads about it, such as notes, check or dry-run, doesn't count. So
`make release` is refused and `make release-notes` is allowed.

It follows variables the command sets, so `tmp=$(mktemp -d) && rm -rf "$tmp"`
is allowed. Test, lint and format tools never count as deploys, so
`npx vitest run deploy` is allowed, and so is any command with `--help`.

Each package script is checked once per command. Some commands are too big to
check in time, and these are refused rather than let through:

- scripts nested more than 8 levels deep;
- more scripts than the guard can check in time;
- moving into more than 200 different folders with `cd` or `git -C`. Each new
  folder costs the guard about 8 ms, because it asks git which repository the
  folder belongs to.

It does not refuse ordinary merges. Agents merge when the owner says so.

### Tool servers

A tool server gives an agent tools that aren't shell commands, such as a
hosting or database tool. Its tools have names that start with `mcp__`, and
some of them can reach a production system. The guard refuses any call to a
tool server whose input uses an entry from `agentsNeverTouch`, ignoring capital
letters. A call that only searches for the name is refused too, because the
guard can't tell what a tool does with its input. The deploy, push and delete
rules above don't apply to these calls.

The tools that read and edit files are not checked, so an agent can still write
a file that mentions a production name.

### Refusals, the log and failures

When it refuses, the agent is told to hand the owner the exact command to run
with `!` in front. For a tool-server call, it hands over the tool's name and
its input instead.
Refusals and the guard's own errors are logged to `guard-log.jsonl` in the
`cstack` folder of your Claude configuration folder. Secrets are hidden first.
These are:

- values of variables and fields named like keys, tokens and passwords;
- `Bearer` and `Basic` values, and key, auth and cookie headers;
- the password in `curl -u` and in addresses such as
  `postgres://user:password@host`;
- text fed in with `<<<`.

If the settings file can't be read, the guard refuses every shell command and
every tool-server call until it is fixed, because it can't see the "never"
list. If the guard itself fails while checking a shell command that holds any
word its rules refuse, or names a "never" entry, it refuses. For a tool-server
call, only a "never" entry counts.

### Its limits

It reads command text, the scripts that text runs and the env files it loads.
It guards against mistakes, not against an agent working to get around it.
These can still get past it, each for the reason given:

- Commands started from inside a program: a Node or Python script, a Makefile
  recipe, or a GitHub workflow's own steps. The guard reads shell text, not
  other languages. For a Makefile, only the target's name is read.
- Commands fed to a shell through a pipe, such as `echo ... | sh`, and scripts
  written through a pipe, such as `echo ... | tee run.sh`. The guard doesn't
  carry text from one command into the next.
- A workflow whose name and file don't show that it deploys, and
  `gh run rerun`, which names a run by its number. Telling which workflow that
  run belongs to would mean asking GitHub, and the guard makes no network calls.
- `docker push` and `kubectl apply`. These often point at a local setup, and
  refusing them would block everyday local work.
- nx targets defined in `project.json`, which are judged by their name only.
  The guard reads package scripts, not nx's own project files.
- `aws s3 sync` without `--delete`, `aws s3 cp` and `aws s3 rm`. Only a sync
  that deletes files in a bucket is refused, as the clearest sign of a site
  being replaced.
- An allowed deploy target named in any variable set earlier in the same
  command. It counts for every deploy after it, even one the variable doesn't
  feed, because the guard doesn't track which variables each deploy reads.
- A tool-server call that reaches production without naming it, such as a tool
  whose default target is production. List the exact text each tool uses for
  production in `agentsNeverTouch`.
- Built-in tools other than the shell, such as fetching a web page. Only shell
  commands and tool-server calls are checked.
- A production target the project hasn't listed in `agentsNeverTouch`.
- Hook input that isn't valid JSON. It is allowed and logged, not refused.
  Claude Code always sends valid JSON, so this happens only when someone runs
  the script by hand.

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
