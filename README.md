# cstack

The Claude Code skills Crishon uses every day, in every project. The aim is to make any repository AI-native: agents prove their work, an independent checker reviews it, everything published reads plainly, and a guard stops the moves only a person should make.

Each project keeps its own facts in its own `.claude/` folder, so these skills stay generic. The pieces were chosen by real use: [LATER.md](LATER.md) lists what was cut or parked, and why.

## Skills

| Skill | Say | What it does |
|---|---|---|
| `verify` | "prove it", "verify" | The proof standard: plan the proof before building, then show evidence a person can check without taking the agent's word for it. |
| `pr-review` | "review this PR" | Two independent verdicts (the claims auditor and Codex), tied to the exact commit, posted as one plain-English comment. |
| `claims-auditor` (agent) | "is this really done?" | Re-runs the tests and build itself, checks the scope against the claim, and says ready or not ready. |
| `drive-web`, `drive-expo` | (read by `verify`) | How to drive a web or Expo app the way a user does, and capture proof. |
| `verify-setup`, `verify-upkeep` | "/verify-setup <app>" | Give one app a verification skill, and keep it honest each month. |
| `plain` | "plain" | Rewrite text so a junior developer or product manager understands it with no outside context. |
| `cold-reader` | "cold read this" | A blank reader reports the terms and context it couldn't follow. |
| `to-diagram` | "diagram", "draw" | A dark, accessible diagram in plain English, proved by a checker. |
| `owner-page` | "put it in a page" | A simple local page to read or decide on. A script builds it from a short brief. |
| `bootstrap-agents` | "set up agents for this repo" | Writes a repository's CLAUDE.md, 2–3 expert agents and hook skeletons. A prep skill will replace it. |
| `upkeep` | "are my skills current?" | Checks installed plugins and pinned pointers are current. Reports only. |

Two pieces run on their own:

- **The guard**, before every shell command and tool-server call. It refuses production deploys, store submissions, package publishes, pushes to protected branches, force pushes, GitHub settings changes, deletes outside the repository, and anything on the project's "never" list.
- **The plain hold**, before text is posted to GitHub, published as a page or committed as a spec. It holds text that isn't plain. A repository opts in with `.claude/plain.json`.

The merge gate is a script, not a skill: `node <verify plugin>/scripts/gate.mjs <PR number>` says whether a pull request can merge, and sorts every reason into fix, wait or owner. The owner merges.

**Coming next:** a prep skill that gets a codebase ready for AI-native development. It will set up the commands, the proof, OpenSpec planning (`plugins/core/skills/bootstrap-agents/openspec-config.yaml` holds the rules), and checks that make the mistakes agents keep repeating impossible.

## Borrowed skills

Pinned pointers to other people's repositories, never copies. Where each came from is in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

| Pointer | What it gives you | Installed |
|---|---|---|
| `pstack-picks` | Lauren Tan's `unslop`, TypeScript practices, engineering principles and `/correct` | Everywhere |
| `ponytail-picks` | The simplest change that fully works: `/ponytail`, `/ponytail-review` | Everywhere |
| `expo-picks`, `rn-callstack-picks`, `rn-vercel-picks` | Expo and React Native skills | Expo apps |
| `vercel-react-picks`, `good-css-picks` | React web rules and modern CSS | React web apps |
| `vercel-deploy-picks` | Deploying to Vercel | Apps on Vercel |

## Install

From your project's folder:

```bash
curl -fsSL https://raw.githubusercontent.com/CWashington98/cstack/main/install.sh | bash
```

It installs `cstack`, `plain`, `verify`, `pstack-picks` and `ponytail-picks` for you in every project. Then it reads the project's `package.json` files and adds the Expo, web or Vercel group for this project only. Name groups yourself with `... | bash -s -- expo web`, or `all`. Run it again to update, then restart Claude Code. The comments at the top of [install.sh](install.sh) cover the details.

## Project settings

- `.claude/verify.json`: commands, protected branches, the guard's "never" list, and the gate's settings. Every field is in [plugins/verify/project-settings.md](plugins/verify/project-settings.md).
- `.claude/plain.json`: opts the repository into the plain hold. See `plugins/plain/skills/plain/glossary-format.md`.

## Names say what things do

Agents, skills, scripts and plugins are named by their job, never by a person or a joke: `claims-auditor` checks claims that work is done. Skills in a family share a prefix so they sort together (`verify-setup`, `verify-upkeep`). A test fails if an agent file's name doesn't match the name inside it.

## Changing cstack

- A new piece earns its place by the rule in [LATER.md](LATER.md): it shows up needed in a third project, or its named trigger fires. Something unused for a quarter leaves.
- `npm test` runs the tests. `npm run validate` runs Claude Code's manifest check on the catalog and each plugin.
- Only the guard, the plain hold and the hook files need the two independent review verdicts (`highRisk` in `.claude/verify.json`).

## License

[MIT](LICENSE). Borrowed material keeps its own license; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
