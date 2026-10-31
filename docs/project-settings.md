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

## Settings for the ready check

`verify gate <pr>` (the script `plugins/verify/scripts/gate.mjs`) decides whether a pull request is ready for the owner to merge. It sorts every reason it isn't into `fix` (an agent can clear it), `wait` (checks still running) or `owner` (only the owner can, with a question). With `--apply` it also keeps the pull request a draft until it's ready, and puts the owner's question in the description's first line. It never merges. Its settings go in a `gate` block; all are optional.

| Field | What it holds |
|---|---|
| `gate.reviews` | `"always"` (the default): every pull request needs both review verdicts. `"highRisk"`: only changes that touch a `highRisk` path, or this settings file, need them. An empty `highRisk` list means every change needs them. |
| `gate.sizeLimit` | The most changed code lines a pull request may have, 400 by default. Moved files count once. |
| `gate.notCounted` | Path patterns left out of the size, such as tests and lock files. |
| `gate.allowedBases` | Branches a pull request may target. Leave it out to use `integrationBranch`. |
| `gate.zone` | The risk zone: `high`, `standard` and `low` path lists, or a `command` that prints the zone. |
| `gate.runtimeSurface` | Path patterns for code users run. |
| `gate.flagsRequired` | `true` when a change to `gate.runtimeSurface` must name its feature flag on a `Flag:` line in the description. |

The block used to be called `factory`. That name is still read, with a warning.

## Settings for the spec compliance check

The spec compliance check in `verify` proves a change does what its approved OpenSpec spec says. `verify:pr-review` runs it whenever a change has a folder under `openspec/changes/`. It needs only `tests.byName`; the rest are optional.

| Field | What it holds |
|---|---|
| `tests.byName` | The command that runs one scenario's tests by name. `{name}` is replaced with the bracket text the test's name carries, such as `[scenario-id]` or `[area/feature:requirement/scenario-id]`. If your test tool reads the name as a pattern, escape the opening bracket: `\{name}`. The command must print each test's name; some runners need a verbose reporter for that (for example vitest's `--reporter=verbose`). |
| `tests.all` | The command that runs every test. |
| `tests.acceptance` | Path patterns for the locked acceptance tests. |
| `tests.alwaysAllowed` | Path patterns the scope check never lists, such as documentation. |
| `tests.exclude` | Path patterns never read for test names, such as sample projects kept as test data. |
| `tests.namePattern` | A regular expression with one capture group, for a test tool that declares test names in an unusual way. |
| `tests.sharedFolders` | Folders the temporary copies of your code may use, such as installed dependencies. Nothing else is shared, so folders your build writes to stay untouched. |
| `executableSpecs` | Turns on executable specs: `tool`, `command` (with `{name}`) and an optional `assertion` pattern. |

Scenario IDs need at least one hyphen, such as `seat-added-under-limit`, so the check can tell them apart from other bracketed text.

### Guard scenarios

Some scenarios describe behavior that already works, which the change must leave alone. Such a test passes before the change, so the usual fail-first rule would hold it. Mark these scenarios as guards: make the first bullet of the scenario a line that starts with `**GUARDS**` and says what must stay the same.

```
#### Scenario: invite-same-org-unaffected

- **GUARDS** an invite to the same organization still works as before
- **WHEN** ...
- **THEN** ...
```

For a guard, the check asks for three things:

1. Its tests pass on the commit the change started from.
2. Its tests still pass on the latest commit. If they fail, the report says the change altered behavior the guard protects, and names the test.
3. Its tests notice a break. The check copies the code to a temporary folder. It takes the files that the scenario's covering task lists after `Touches:`. It changes one condition or limit at a time, such as `>=` to `<` or `18` to `19`, and stops at the first change that makes the guard's tests fail. It tries at most 30. If none is noticed, the report says how many were tried, and the change is held. If it stopped at 30, the report says the cap was reached.

The check never changes your working folder, and it puts every file back exactly. It runs on every lane, because it stops early. A guard's covering task must list the files it protects after `Touches:`, or there is nothing to break. Scenarios without the marker still have to fail first.

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
  repository, or of its history: the `.git` folder or anything inside it. Git's
  own leftovers may be deleted: `rebase-merge`, `rebase-apply`, `sequencer`,
  lock files, and hooks. When the working folder isn't a repository, only
  temporary folders count as safe;
- any command that uses an entry from `agentsNeverTouch`, including inside an env
  file it loads or a heredoc it feeds to a program. Commands that only mention a
  name, such as a search, a commit message or a pull request comment, are allowed;
- a recursive `rm` that Claude Code would stop and ask a person about, even in
  full-access mode. That is a `rm -r`, `-R`, `-rf` or `--recursive` whose path
  holds `$`, a backtick or a wildcard (`*`, `?`, `[`), or that is chained with
  other commands (`&&`, `;`, `|`, a loop, an `if`). Unattended workers have
  waited hours on that prompt. The guard says to run the delete as its own
  command with the path written out, then run the rest in a separate call.
  Only the command the agent sends counts: a script it runs can still use
  variables and wildcards in its own deletes. `git rm -r`, `grep -r "rm -rf"`
  and `echo rm -rf` are not deletes, and `rm -f a && echo ok` is not recursive.

It reads commands the way the shell runs them. It looks through:

- wrappers such as `npx` and `dotenvx run --`;
- shell blocks (`if`, `for`, `while`, `{ }`), `bash -c`, `eval`, `$( )` and
  heredocs. A `<<` inside quotes is text, not the start of a heredoc;
- the `$( )` and backtick commands inside a heredoc whose tag has no quotes,
  such as `<<EOF`, because the shell runs them. A heredoc with a quoted tag,
  such as `<<'EOF'`, is plain text, so a commit message or pull request body
  written that way may mention any command;
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

- scripts nested more than 8 levels deep, unless the owner lists the script
  (see "Deep scripts the owner lists" below);
- more scripts than the guard can check in time;
- moving into more than 200 different folders with `cd` or `git -C`, not
  counting the folder the command starts in. Each new folder costs the guard
  about 8 ms, because it asks git which repository the folder belongs to.

It does not refuse ordinary merges. Agents merge when the owner says so.

### Deep scripts the owner lists

Some projects have a self-test or setup script that runs scripts that run more
scripts. The guard refuses anything nested past 8 levels, so no agent could run
it. The owner can list such a script, and the guard then stops reading it below
8 levels instead of refusing.

**The list is a file in your own Claude configuration folder, never in a
repository.** It is `cstack/deep-scripts.json` inside the folder named by
`CLAUDE_CONFIG_DIR` (`~/.claude` when that is not set), next to the guard log
`cstack/guard-log.jsonl`. The guard reads no such list from `.claude/verify.json`
or from anywhere else inside a repository, so nothing an agent changes in a
repository can widen it. The file maps a repository to the script paths:

```json
{
  "repos": {
    "/Users/you/Source/smsMarketing": [
      "scripts/preflight.sh",
      "scripts/__tests__/preflight*.test.sh",
      "scripts/preflight-fixture-suites.sh"
    ]
  }
}
```

- **Which repository.** The key is the real path of the repository's main
  checkout, the folder that holds its `.git` folder. Every worktree of the
  repository, wherever it is, shares that one entry. A repository's address on
  the network is not used, because anyone working in the repository can change
  it with one git command, and the main checkout's path they cannot change
  without moving the repository. The cost: the key differs from one machine to
  the next, so each machine's file has its own entry. A key may begin with `~/`.
- **Which scripts.** Each entry is a path from the repository root, written
  exactly or with a simple glob: `*` and `?` stay inside one folder name, and `**`
  also crosses folders. The guard follows links first, so a link counts only if
  what it points at is listed. `bash`, `sh`, `./`, `source` and a package script
  that runs the file all count. An entry that is absolute, holds `..`, names a
  folder or has no letter or digit is ignored.
- **It lifts one refusal.** Inside a listed script, what nests deeper than 8
  levels is not read, and not refused. Everything the guard reads within those 8
  levels is judged by every other rule as always: production deploys, "never"
  names, protected branches, `--no-verify`, deletes and the rest. The command
  that starts the script is judged too. A script that isn't listed gets today's
  refusal message.
- **Fails closed.** If the file is missing, can't be read, isn't in this format,
  or has no entry for the repository, nothing is listed and the guard refuses
  deep scripts as before. An unreadable file (as opposed to a missing one) is
  also written to the guard log. Set `CSTACK_GUARD_DEEP_SCRIPTS` to the path of a
  different file to have the guard read that one instead, as `CSTACK_GUARD_LOG`
  does for the log.

What it can't promise: the guard doesn't read below 8 levels inside a listed
script, so a listed script is trusted code. An agent can still edit a listed
script, or create a new file that a glob in the list matches, and run it. Both
are ordinary changes to the repository and go through review, so keep entries
exact and use a glob only for a folder the team reviews. The guard does not
protect the file itself from an agent that writes to your configuration folder:
it does not check file edits, and a shell command that writes there is judged by
the same rules as any other. Keep the file where only you edit it.

### Tool servers

A tool server gives an agent tools that aren't shell commands, such as a
hosting or database tool. Its tools have names that start with `mcp__`, and
some of them can reach a production system. The guard refuses any call to a
tool server whose input uses an entry from `agentsNeverTouch`, ignoring capital
letters. A call that only searches for the name is refused too, because the
guard can't tell what a tool does with its input. The deploy, push and delete
rules above don't apply to these calls.

The Convex tool server names a deployment with a "deployment selector": a
kind, a colon, then the details in base64, so the deployment's name never
appears as plain text. The guard decodes every such selector in a tool call's
input. It refuses one that points at production: the kinds `prod` and
`implicitProd`, or a selector such as `prod` or `team:project:prod`. Selectors
for your own development deployment, a preview or a named deployment are
allowed, and the decoded details are also checked against `agentsNeverTouch`.

On production, the guard allows only the Convex tools that read: `status`,
`tables`, `data`, `functionSpec`, `logs`, `insights` and `runOneoffQuery`. It
refuses every other tool, including `run`, the `env` tools and any tool it
doesn't know. In the shell, `convex data`, `logs`, `function-spec`, `dashboard`
and `insights` may use `--prod`; `run`, `env`, `deploy`, `import`, `export` and
anything unknown may not. Set `agentsMayReadProduction` to `false` to refuse
the reads as well. The `agentsNeverTouch` list still applies to reads.

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
call, a "never" entry or a production Convex selector counts.

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
- A tool-server call that reaches production without naming it. One example
  is a Convex tool server whose own settings point at production, such as a
  production deploy key in its environment. Its selectors still say "your own
  deployment". Another is a Convex selector that names production by a custom
  reference. The guard can't see what these resolve to. For other tool
  servers, only the "never" list applies: list the exact text each tool uses
  for production in `agentsNeverTouch`.
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
