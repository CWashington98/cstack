# cstack

The agent skills Crishon uses every day, in every project. They work in Claude Code and Codex.

cstack is a list of skills and nothing else. A few are written here. The rest come from other people's stacks and are installed from their repositories at a pinned commit.

## Skills

### Written here

| Skill | Say | What it does |
|---|---|---|
| `plain` | "plain" | Rewrites text so a junior developer or product manager understands it with no outside context. |
| `verify` | "prove it" | The proof standard: plan the proof before building, then show evidence a person can check. |

### Agents

| Agent | What it does |
|---|---|
| `claims-auditor` | Checks whether work claimed as done is really done. It re-runs the tests itself, checks the scope and says ready or not ready. |
| `runner` | Runs tests, builds and searches on a small model and reports only what matters. |

### Picked from other stacks

Listed in [picks.txt](picks.txt), each pinned to a commit.

| From | Skills |
|---|---|
| [tstack](https://github.com/t3dotgg/tstack) (Theo Browne) | `full-send`, `full-stop`, `council`, `sol-loop`, `file-pr`, `takeover`, `babysit-pr`, `modernize`, `leaving-pr-comments` |
| [pstack](https://github.com/cursor/plugins/tree/main/pstack) (Lauren Tan) | `unslop`, `typescript-best-practices`, `show-me-your-work` |
| [cursor-team-kit](https://github.com/cursor/plugins/tree/main/cursor-team-kit) (Cursor) | `verify-this` |
| [mattpocock/skills](https://github.com/mattpocock/skills) (Matt Pocock) | `tdd`, `grill-with-docs`, `improve-codebase-architecture` |

Some picks call each other. `full-send` uses `sol-loop`, `file-pr` and `babysit-pr`, so they are picked together.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/CWashington98/cstack/main/install.sh | bash
```

Or from a clone: `bash install.sh`. Run it again to update.

It copies the skills into `~/.claude/skills` and `~/.codex/skills`, and the agents into `~/.claude/agents`. It honors `CLAUDE_CONFIG_DIR` and `CODEX_HOME`. Before it replaces a skill that differs, it saves the old copy in `.cstack-backup/` in the same folder. Skills you added yourself under other names are never touched.

`babysit-pr` needs `python3`, and `council` and `sol-loop` need models from other providers (see tstack's README).

### Coming from the old plugin version

cstack used to be a Claude Code plugin marketplace. Remove it once:

```bash
claude plugin marketplace remove cstack
```

Then delete any `@cstack` entries under `enabledPlugins` and the `cstack` entry under `extraKnownMarketplaces` in each project's `.claude/settings.json`. The old version is kept at the git tag `archive/plugins-v4`.

## Changing cstack

- **Add a pick:** add a line to `picks.txt`. Check that the source has a license file first.
- **Update a pick:** change its commit in `picks.txt`, read what changed upstream, then run `bash tests/install.test.sh`.
- **Add our own skill:** a folder in `skills/` with a `SKILL.md`, written as plain instructions. If a skill needs a script to work, it probably belongs in a project, not here.
- **Project-specific skills** stay in that project's `.claude/skills/`.

## License

[MIT](LICENSE). Picked skills keep their own license, which the installer copies into each skill's folder. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
