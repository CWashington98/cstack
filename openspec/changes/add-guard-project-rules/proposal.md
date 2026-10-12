# Proposal: project rules for the guard

## Why

The guard is meant to work in any project, but its code names 24 tools, from Convex and Expo's app-store service to Terraform and Heroku. Most of them aren't used in the projects it runs in. Convex alone has its own selector decoding, its own list of reads and writes, and its own setting. Each tool rule looked reasonable when it was added, but together they make cstack carry one repository's tooling, which breaks cstack's rule that it ships mechanisms and each project brings its own facts.

## Who it's for

Anyone using cstack in any project, whatever its stack, and the owner, who maintains cstack.

## Before / After

- **Before:** the guard knows about specific tools in its own code, and a project can't add or change a rule for its tools without changing cstack.
- **After:** the guard keeps only rules every project needs. Each project lists rules for its own tools in its settings file, as data, and cstack ships copy-paste examples for common tools.

## What Changes

- **The guard keeps these rules for every project:**
  - protected branches, force pushes and tag pushes;
  - GitHub settings, secrets and merges that override the repository's rules;
  - recursive deletes outside the repository;
  - package publishes and releases;
  - any tool whose command is `deploy`;
  - the never list.

  It keeps reading through package scripts, shell scripts, heredocs and wrappers, and refusing what it can't read.
- **A new `guardRules` list in `.claude/verify.json`.** Each rule matches a shell command, or a tool call's name and input, and either refuses it or allows it, with a reason. The first matching rule wins. A rule can never allow what a rule from the list above refuses.
- **Encoded text is decoded before matching.** Text such as a base64 selector is decoded before the guard checks it against project rules and the never list, so a tool that hides its target inside encoded text is still checked.
- **Every rule that names a specific tool leaves the guard's code.** That covers Convex, Expo's app-store service (EAS), Vercel, Netlify, Firebase, Terraform, Pulumi, the AWS deployment kit (CDK), Wrangler, Fly, Railway, Helm, Heroku, Supabase, Drizzle, Nx, Lerna, Turbo, Fastlane, semantic-release, Changesets, gcloud, AWS and Docker. Where a tool needs a rule, it becomes a copy-paste example in `docs/guard-rules/`.
- **The `agentsMayReadProduction` setting is removed.** Production reads and writes become project rules.
- **The portability test fails on any third-party tool name in the guard's code,** not only on project names.

## Capabilities

### New Capabilities

- `guard/project-rules`: rules each project supplies for its own tools, and what the guard does for every project.

### Modified Capabilities

None. The guard has no spec yet.

## Non-goals

- Rewriting the guard's command reader. It is generic already.
- Shipping a rule set that is on by default. The examples are documentation; a project copies what it uses.
- Removing GitHub knowledge. cstack itself runs on GitHub, so its GitHub rules stay.

## Impact

- `plugins/core/scripts/guard.mjs` gets smaller, and the guard's tests move from tool rules to project rules.
- `docs/project-settings.md` documents `guardRules` and drops `agentsMayReadProduction`.
- A new folder, `docs/guard-rules/`, holds examples for common tools.
- Projects that depended on a removed built-in rule must copy its example. Only this owner's projects use cstack today, and their settings files are being written now.
