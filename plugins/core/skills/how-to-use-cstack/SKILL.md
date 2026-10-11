---
name: how-to-use-cstack
description: Answer questions about how to use cstack and what cstack can do, and suggest the right cstack skill or command for what someone is trying to do. Use when someone asks "how do I use cstack", "what does cstack have for this", "is there a cstack way to…", or "which cstack skill fits this?". It only explains and suggests; it never starts anything.
---

# How to use cstack

cstack is a library of skills you use in every project, and a fixed way to use them together. You never need to remember its commands: ask in plain words, and you'll be pointed to the right one.

## How to answer

- **Suggest, then wait.** Name the one or two skills or commands that fit, say in a sentence what each does, and let the person choose. Never start a flow, a review or a build on your own because a request sounded like one.
- **Say what you worked out.** If you're guessing which change, file or app they mean, say your guess and ask when more than one fits.
- **Respect other tools.** People using cstack often have other plugins installed. If they already use another tool for a job and it's working, don't push cstack's. Mention cstack's only when it adds something.
- **Only offer what exists.** Suggest only what's under "Available now". Things under "Coming" are not built yet: describe them as coming, and never offer them as if they work.
- **Keep it short.** One line per suggestion, with the command they'd type.

## Available now

### Checking work is really done

| When someone wants to… | Suggest | What it does |
|---|---|---|
| Check whether finished work does what was claimed | `cstack:claims-auditor` (an agent) | Re-runs the tests and builds itself, checks each claim against the code, and says "ready" or "not ready" with a list of what's wrong |
| Review a pull request | `verify:pr-review` | Two independent reviews, from the claims auditor and Codex, tied to the exact commit and posted as one plain-English comment |
| Prove a change works, or plan how to prove it before building | `verify:verify` | The proof standard: every spec scenario and plan item names its evidence |
| Let agents run and use an app the way a person does | `verify:verify-setup` | Creates a verification skill for one app in the repository |
| Keep that app skill accurate over time | `verify:verify-upkeep` | Monthly: re-reads each feature's code and re-drives it live |
| Drive a web app and capture proof | `verify:drive-web` | Playwright, browser tools, screenshots and recordings |
| Drive a phone app built with Expo and capture proof | `verify:drive-expo` | Simulators, emulators and Maestro flows |

### Writing that people can follow

| When someone wants to… | Suggest | What it does |
|---|---|---|
| Write or fix a pull request, issue, spec or page so a newcomer can follow it | `plain:plain` | Rules and a checker for plain English, run before anything is posted |
| Test whether a text makes sense to someone with no context | `plain:cold-reader` | Gives the text to a blank reader and reports what confused it |
| Explain something with a diagram | `plain:to-diagram` | Builds a dark, accessible diagram with plain-English labels, and checks it |

### Code and setup

| When someone wants to… | Suggest | What it does |
|---|---|---|
| Clean AI-generated clutter out of a branch without changing behavior | `cstack:deslop` | Removes slop from the branch's changes |
| Set up a repository for agents: a rules file, expert agents and routing | `cstack:bootstrap-agents` | A guided setup that explores the repository first |
| Write a new skill | `cstack:write-a-skill` | Structure and layout for a skill |
| Check that installed plugins and pinned skills are current | `cstack:upkeep` | Reports what's out of date and the command that fixes each one |

### Running in the background

- **The guard** runs on its own. There's nothing to call. What it checks:
  - **Shell commands:** it refuses production deploys, releases, pushes to protected branches, recursive deletes outside the repository and temporary folders, and anything that uses an entry on the project's "never" list.
  - **Tool-server calls** (tools named `mcp__…`, such as a hosting or database tool): checked only against the "never" list. A tool that deploys to production without naming anything on that list isn't stopped.
  - **Claude's own file reads and edits:** not checked. If someone asks why a command was refused, point them to `docs/project-settings.md` in cstack, and to their project's `.claude/verify.json`.
- **Installing or updating cstack:** run this from the project's folder (in Claude Code, put `!` in front):
  `curl -fsSL https://raw.githubusercontent.com/CWashington98/cstack/main/install.sh | bash`
- **Picked outside skills** come with the install as pinned pointers: engineering principles and TypeScript practice, simpler code, terse replies, React and web design rules, Vercel deploys, Expo, and React Native. Suggest them by what they do. cstack doesn't copy them.

## Coming

These are planned and **not built yet**. If someone asks for what they'll do, say it's coming, and point them to what exists now: usually the proof standard to plan the work and the pull request review above.

- `cstack:start-change`: start any change, from an idea, a spec, or nothing. It picks a lane (small, normal or high-risk) and walks the fixed flow, with code checking each step's go criteria before the next.
- `cstack:continue-change`: pick an unfinished change back up. It says where the change stands, re-checks every step, and carries on from the first one that isn't done.
- `/cstack` on its own: shows what's unfinished in this repository and suggests the next command. It never starts anything.
- A one-line note when you open a repository that has an unfinished change, and nothing otherwise.
