# Glossary and settings formats

## GLOSSARY.md (one per repository, committed)

Uses Matt Pocock's format (MIT license). Each project term gets a one- or two-sentence definition, and the words to avoid:

```markdown
**Recording**:
Audio of the heart captured at one listening spot on the chest.
_Avoid_: clip, sample, track
```

Only terms specific to this project go here, not general programming terms. Matt Pocock's skills read the same file. In onehearthealth, use `.claude/GLOSSARY.local.md` instead, which is personal and git-ignored.

## .claude/plain.json (shared, committed) and .claude/plain.local.json (personal, git-ignored)

Either file turns plain on for the repository. Personal values win over shared ones. Word lists from both are combined.

```json
{
  "commonWords": ["S3"],
  "neverPublish": { "BLUF": "Put the summary first; no heading needed." },
  "watchFolders": ["docs/superpowers/specs", "docs/superpowers/plans", "openspec/changes"],
  "readerModel": "sonnet"
}
```

| Field | Meaning | Default |
|---|---|---|
| `commonWords` | Extra acronyms this repository's readers know, added to the built-in list | none |
| `neverPublish` | Shorthand that must never appear, with what to write instead | none |
| `watchFolders` | Folders whose `.md` and `.html` files must pass before a commit | specs, plans and OpenSpec changes |
| `readerModel` | The model the cold reader uses | `sonnet` |

Add `**/.claude/plain.local.json` and `**/.claude/GLOSSARY.local.md` to your personal git ignore file (`~/.config/git/ignore`).
