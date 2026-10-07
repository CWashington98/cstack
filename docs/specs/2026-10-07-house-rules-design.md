# House rules: one shared set of development rules for every project

Status: design for the owner's review, 2026-10-07. Nothing here is built yet.

## 1. What this is

`house-rules` is a cstack plugin that gives every project the same core development rules, and checks them with git hooks. It brings in two things the owner asked for:

- **OpenSpec in every project,** with one shared block of rules in each project's OpenSpec settings. OpenSpec is the tool we use to write a spec for each change before building it.
- **The lessons smsMarketing learned the hard way,** such as a failing test before every fix and cheap continuous integration, so the other projects get them too.

It stays general. Each project keeps its own rules next to the shared ones, and nothing in the plugin names a project.

## 2. Where each project stands today

A read-only survey of the three main projects on 2026-10-07 found:

| | smsMarketing | precordia | onehearthealth |
|---|---|---|---|
| OpenSpec version | 1.13.0, pinned in `package.json` | 1.13.2, not pinned | 1.13.2, pinned in `openspec/.version` |
| OpenSpec schema (the list of documents each change needs) | its own copy, called `hermes`, which adds a prototype, an interview and an approval | the standard one | the standard one |
| Changes open / archived | 2 / 3 | 1 / 1 | 10 / 0, so finished changes aren't being archived |
| Failing test before a fix | written instructions only | an OpenSpec rule only | checked: a pull request fails if a `fix:` commit comes before a `test(red):` commit |
| Minimum age for new packages | 7 days, plus a check that the lockfile respects it | none | none |
| Mutation testing | local only | local only | local, and also in continuous integration |
| Continuous integration | format, lint, type check and build only; tests run locally | checks each change once; tests run there | tests run there, scoped to the folders changed |
| Hook that blocks `--no-verify` | none possible; written rule | the skip is documented as allowed | none possible; written rule |
| Blocking Claude Code hooks use exit code 2 | yes | yes | yes, or structured output |

Mutation testing makes small deliberate bugs in the code and checks that the tests catch them. A lockfile records the exact version of every installed package.

## 3. The shared rules

### 3.1 The OpenSpec rules block

Each project's `openspec/config.yaml` gets a block between two marker comments. The plugin writes and updates only what's between the markers. The project's own rules stay outside them, so smsMarketing keeps its extra documents and onehearthealth keeps its risk tiers.

The block holds the rules all three projects already share, plus the proof rules from the approved `verify` design:

| Document | Shared rule |
|---|---|
| Proposal | Who it's for; before and after, in plain words; what's out of scope; how it rolls out |
| Specs | Each scenario written as given, when, then, from the user's point of view; nothing left "to be decided"; each requirement says how it will be proved |
| Design | What existing code or product is reused, and why anything is built instead; what data changes; who is allowed to do what |
| Tasks | The first group writes failing tests; the last group checks the result live and records the proof |
| Building | Work in a separate worktree; watch each new test fail before writing the fix |
| Archiving | Archive a change once its pull request has merged |

OpenSpec stays on its standard schema everywhere except smsMarketing, which keeps its own. The OpenSpec version is pinned in each project, and `upkeep` reports new versions, respecting each project's minimum package age.

### 3.2 Checks in git hooks

These run in git hooks, so they work for everyone, whether or not they use Claude Code. Each one is a small script in the plugin that a project's existing hook setup calls: husky in smsMarketing and onehearthealth, and precordia's own installer.

| Check | When | What it stops |
|---|---|---|
| **Failing test before a fix** | before a push | A branch with a `fix:` commit and no earlier `test(red):` commit that adds or changes a test. This is onehearthealth's check, made general. |
| **Refactors don't change tests** | before a push | A `refactor:` commit that edits test files. A refactor must keep behavior the same, and unchanged tests passing is the proof. |
| **Minimum package age** | when the lockfile changes | A package version published less than 7 days ago. It reads the lockfile, so it also catches installs that skip the package manager's own age setting. |
| **Claude Code hooks block properly** | when a hook file changes | A blocking Claude Code hook that exits with code 1. Only code 2 blocks; code 1 lets the action go ahead. |
| **Gates read exit codes** | when a hook file changes | A gate that decides pass or fail by searching a command's printed output, which passes when the command never ran. |

Pre-commit checks must finish in under 5 seconds. Anything slower runs before a push or before a pull request.

### 3.3 Rules written down, not checked

Git can't stop these mechanically, so they go in each project's facts file:

- Don't skip hooks with `--no-verify`. If a hook fails for the wrong reason, fix the setup or ask the owner.
- Mutation testing runs locally, scoped to the changed files, never in continuous integration.
- Keep continuous integration cheap: format, lint, type check and build. The full test suite runs locally before a pull request.
- When an agent makes the same mistake twice, turn the lesson into a check, not another written rule.

### 3.4 Optional parts

These suit a project with one owner, or a custom pipeline. A project turns them on by name:

- **Risk zones:** each change is rated by the files it touches, and risky ones need more review.
- **Approval before code:** no application code until the owner approves the spec.
- **Review record:** a merge needs a recorded review tied to the pull request's current commit. This is the `pr-review` skill's job in the `verify` design.
- **Locked acceptance tests:** tests written by a separate author from the approved spec, which the builder can't edit.

## 4. What changes in each project

| Project | Changes |
|---|---|
| precordia | Rules block in `openspec/config.yaml`; pin OpenSpec; the five hook checks; 7-day minimum package age (Bun's `minimumReleaseAge` setting plus the lockfile check); the facts file says `--no-verify` is not for routine use |
| smsMarketing | Rules block alongside its own rules; the two commit checks; the hook and gate checks it already follows become shared scripts |
| onehearthealth | Rules block; its commit-order check is replaced by the shared one, which does the same job; minimum package age, if the team agrees. Its mutation testing in continuous integration stays as it is: that's the team's choice. |

Each project gets one pull request. For onehearthealth the pull request is how the teammates hear about it, so it explains every change in plain words and changes nothing they haven't seen.

## 5. Commit subjects

The two commit checks read the first word of each commit message. All projects would use:

- `test(red):` a test that fails, committed before the fix
- `fix:` the fix that makes it pass
- `refactor:` a change that keeps behavior the same
- `feat:`, `docs:`, `chore:` as now

onehearthealth already uses these. precordia mostly does. smsMarketing uses its own trailers, which the checks would read too.

## 6. How we know it works

- Each check has tests that build small real git repositories on the fly. A branch with a fix and no failing test is held. The same branch with the test first passes. A refactor that edits a test is held. A package published yesterday is held. A Claude Code hook that exits with code 1 is flagged.
- The rules block round-trips: writing it twice changes nothing, and the project's own rules outside the markers are never touched.
- After rollout, each project's next five pull requests pass the checks, or each failure is a real problem.

## 7. Decisions for the owner

1. **Commit subjects in every project** (section 5). Recommended: yes. Without them, the two commit checks can't work.
2. **Minimum package age in precordia and onehearthealth.** Recommended: 7 days in precordia now; offer it to onehearthealth in its pull request.
3. **onehearthealth's mutation testing in continuous integration.** Recommended: leave it. The "local only" rule came from precordia's costs, and it's the team's repository.
4. **precordia's documented `--no-verify` skip for the mutation gate.** Recommended: keep it, but name a reason each time, so the facts file can say "not for routine use".
5. **Which optional parts precordia turns on** (section 3.4). Recommended: review record only, through `pr-review`.
