# Third-party notices

Outside material appears in this repository in two ways, on purpose:

- **Pinned pointer.** The marketplace file lists the outside repository's address and an exact commit. Nothing is copied here; Claude Code fetches the skill from its source. This is the default for anything outside, and the only option when the source has no license.
- **Adapted copy.** The file lives in this repository and we have changed it. We do this only for MIT or Apache material we have rewritten for our own needs, and each file names where it came from.

## Our own skills, and where each one started

| Skill or agent | Plugin | Where it started |
|---|---|---|
| `bootstrap-agents`, `upkeep` | core | Written here |
| `plain`, `cold-reader`, `to-diagram` | plain | Written here |
| `verify`, `drive-web`, `drive-expo`, `pr-review` | verify | Written here |
| `verify-setup`, `verify-upkeep` | verify | Adapted from Lauren Tan's `create-verification-skill` and `maintain-verification-skill` (pstack, MIT). See `plugins/verify/THIRD_PARTY.md`. |
| `claims-auditor` agent | core | The idea comes from the Karen agent in [darcyegb/ClaudeCodeAgents](https://github.com/darcyegb/ClaudeCodeAgents) (MIT), and ours was called karen until we renamed it for what it does. Ours is rewritten: it re-runs the tests itself, checks scope and returns a ready or not ready verdict. |
| `write-a-skill` | core | Copied word for word from an earlier version of [Matt Pocock's skills](https://github.com/mattpocock/skills) (MIT), which no longer ships it. We added two lines that read the project's notes. His copyright and license travel with it in `plugins/core/skills/write-a-skill/LICENSE`. |
| `deslop` | core | Copied from a project's local skills folder in July 2026; its first source is unknown. |

Everything written or rewritten here is © Crishon Washington, MIT (see the license file). Copied material keeps its original license; this table and the comments in each file are the attribution those licenses ask for.

## Pinned pointers (never copied)

| Source | License | cstack entry |
|---|---|---|
| [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) | Apache 2.0 | `agent-browser` |
| [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | MIT | `ui-ux-pro-max` |
| [cursor/plugins, pstack folder](https://github.com/cursor/plugins/tree/main/pstack) (Lauren Tan) | MIT | `pstack-picks`: TypeScript best practices, her engineering principles, and her review, design and system-building skills |
| [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) | MIT | `ponytail-picks`: its six skills, without its always-on hooks |
| [callstackincubator/agent-skills](https://github.com/callstackincubator/agent-skills) (Callstack) | MIT | `rn-callstack-picks`: three React Native skills |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | MIT in its readme and in some skills (none of the deploy skills), but no license file | `rn-vercel-picks`, `vercel-react-picks` and `vercel-deploy-picks`. **Never copied until a license file exists.** Its writing guide is left out on purpose: `plain` is our writing standard, and two would conflict. |
| [expo/skills](https://github.com/expo/skills) (Expo) | MIT | `expo-picks`: Expo's own skills, except the feedback skill, whose command breaks when picked by folder |
| [vojtaholik/good-css](https://github.com/vojtaholik/good-css) | MIT | `good-css-picks` |
| [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) | Apache 2.0 | `caveman-picks`: caveman and its two stronger modes. cstack used to carry an older copy of this skill, wrongly listed here as our own. |

Licenses were checked through GitHub's license information on 2026-10-09. Check again before copying anything new.
