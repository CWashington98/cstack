# Third-party notices

Two ways external material appears in this repo, deliberately different:

- **Pinned pointer** — cataloged in `marketplace.json` by upstream URL + commit SHA.
  Nothing is redistributed here; the plugin system fetches from the source. This is
  the DEFAULT for anything external (and the only option when upstream has no
  license).
- **Vendored copy** — the file lives in `plugins/core/skills/`, adapted, with a
  provenance comment naming its origin. Done only for permissively-licensed
  (MIT/Apache) material, for SHA-stability and the two-command install.

## Vendored (copies in `plugins/core/skills/`, per-file provenance comments)

| Upstream                                                                                        | License | Skills derived from it                                                                            |
| ----------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| [mattpocock/skills](https://github.com/mattpocock/skills) (skills.sh)                           | MIT     | tdd, diagnose, triage, to-prd, to-issues, grill-with-docs, handoff, improve-codebase-architecture |
| [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) | MIT     | web-design-guidelines                                                                             |

`grill-me` and `prototype` carry no upstream attribution in their provenance
comments but sit adjacent to the mattpocock/skills family — treated as MIT-covered
either way (same license in both directions).

Vendored copies retain their upstream MIT terms; this notice + the per-file
provenance comments serve as the attribution and license preservation MIT requires.
Original skills (caveman, deslop, write-a-skill, bootstrap-agents, the karen agent,
recipes, templates) are © Crishon Washington, MIT (see LICENSE).

## Pinned pointers (never vendored)

| External                                                                                        | License     | Why pointer-only                             |
| ----------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------- |
| [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)                       | Apache-2.0  | No need to copy; pin gives stability         |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills)                         | none stated | **No license file — must never be vendored** |
| [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | MIT         | No need to copy; pin gives stability         |

License spot-check performed 2026-08-13 via the GitHub license API. Re-verify before
vendoring anything new.
