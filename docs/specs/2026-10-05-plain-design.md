# plain: a check that keeps everything we publish readable

Status: draft for review, third version, 2026-10-06. Adds: the cold reader as its own calibrated skill with a test set.

Changes from the first version:
- the reader is now a junior developer or a product manager
- the glossary uses Matt Pocock's `GLOSSARY.md` format
- pull request descriptions get a fixed layout
- specs and plans are checked too
- a monthly review keeps improving the checks

## 1. Why

Our specs, pull requests, issues and pages are hard to read for anyone who wasn't in the room. We scanned the owner's last 25 pull requests in each repository:

| Repository | Pull requests with unexplained acronyms or planning codes | Most common problems | Longest sentences (top 10%) |
|---|---|---|---|
| smsMarketing | 25 of 25 | `BLUF` used as a heading 73 times, `SHA`, `ADR`, question numbers like `Q12` and `Q21`, decision numbers like `D12` | 59 words or more |
| onehearthealth | 20 of 25 | Decision numbers like `D14` and `D3c`, `G4`, `K34`, `IAM`, `ADR` | 34 words or more |
| precordia | 17 of 25 | `VSD`, `AS`, `MR`, `EDT`, `A13`, `R4b` | 28 words or more |

Three patterns cause most of it:

- **Planning codes leak out.** Plans number their questions and decisions (`Q21`, `D3c`). Pull requests then cite those numbers, which mean nothing to someone who never read the plan.
- **Acronyms go unexplained.** Some are project terms (`VSD`), some are borrowed jargon (`BLUF`, military shorthand for `bottom line up front`).
- **Capital letters are used for emphasis** (`READY`, `NOT`, `CLEAN`), which makes text harder to scan.

The owner described this as a problem in everything built so far, including their own pull requests and specs.

## 2. Who we write for

**A junior developer or a product manager.** They are smart and have some technical background. They know what a pull request, a test, a database, an app screen and a deploy are. They know nothing about this project: its plans, its internal names, its medical or business terms, or the conversation that produced the change.

Two promises to this reader:

- **Everything needed to understand the text is in the text.** Nobody should have to open another document or search for a term to follow it. Links are welcome as extras, never as required reading.
- **No term goes unexplained** unless a junior developer would know it without looking it up.

This applies to every section, including technical detail.

## 3. Goals

| Goal | How we measure it |
|---|---|
| Nothing reaches GitHub, a published page, or a committed spec or plan with an unexplained acronym or planning code | The hold (section 6.5) makes this true by construction; overrides are logged and counted |
| A reader with no context understands each text on the first or second try | The cold reader (section 6.3) reports zero unclear terms within two rewrites on at least 90% of texts |
| The owner stops having to ask "what does this mean?" | Fewer of those questions in the weekly usage report |
| Checking costs little | Under 30 seconds per text, and one small model call |

## 4. What this does not cover

- Code comments and variable names. Those follow each repository's code conventions.
- Rewriting old pull requests automatically. The `/plain` command can fix one when asked.
- Polished prose style. The goal is clear, not elegant.
- Slack, Notion and email. These could come later.

## 5. The writing rules

These go in `rules.md`, which the skill loads before writing anything.

1. **Start with the point.** The first sentence says what happened or what changed. The second says what you need from the reader, if anything.
2. **Attach the context.** Never rely on things the reader can't see: `as discussed`, `per the plan`, `like last time`, question or decision numbers, or section numbers of other documents. Put the needed facts in the text itself. A link can point to more detail, but the text must make sense without it.
3. **Spell out acronyms.** Use an acronym only if it's on the common list, or if you spell it out the first time: "ventricular septal defect (VSD)". Never invent new ones.
4. **Introduce internal names once.** "Karen, our automated code reviewer". "Atlas, the zoomable map of the system".
5. **Explain domain terms once,** using the wording in the repository's `GLOSSARY.md`: "aortic stenosis (a narrowing of the heart's main valve)".
6. **Use the glossary's preferred word.** If the glossary says to call it an "order" and to avoid "purchase", write "order".
7. **Keep sentences short.** Aim for under 20 words. Split anything over 30.
8. **Use everyday words and active voice.** "Use", not "utilize". "We removed the check", not "the check was removed".
9. **No capital letters for emphasis.** Use bold sparingly instead.
10. **Numbers say what they mean.** "4.4% of all usage", not "4.4%".
11. **Technical detail goes last,** in its own section. It is written for a junior developer: standard terms are fine, anything else is explained.

Sources:
- the US Federal Plain Language Guidelines (public domain)
- ideas from Simplified Technical English, a writing standard from the aerospace industry (Matt Pocock's `wait-what` skill uses it)
- the AI-writing patterns in poteto's `unslop` skill (MIT license)
- Matt Pocock's glossary format (MIT license)

Rules are rewritten in our words, with credit.

## 6. Components

### 6.1 The skill: `/plain`

Three ways to use it:

- **Write:** given a draft, a file, a spec or a pull request number, apply the rules. Run the checker and the cold reader, and fix and repeat until both pass. Then record a pass stamp (section 6.4) and show the before and after.
- **Fix an existing post:** `/plain 123` rewrites pull request 123's description in the layout from section 6.8, and posts it.
- **Explain:** when the owner says a message didn't make sense, re-explain it following the rules.

### 6.2 The checker: `plain-check.mjs`

A Node script with no dependencies, so it runs in every repository and for every teammate. The same text always gets the same answer.

It skips code blocks, inline code, links, quoted logs and diagrams. It checks everything else against the repository's glossary and settings (section 6.7).

| Finding | Example | Level |
|---|---|---|
| Acronym not on the common list and not spelled out at first use | `BLUF`, `VSD` | Hold |
| Planning code | `Q21`, `D3c`, `A1`, `R4b`, a section sign followed by a number | Hold |
| Word in capitals for emphasis | `READY`, `NOT` | Hold |
| Reference to unseen context | `as discussed`, `per the plan`, `see above` in a standalone post | Hold |
| Sentence over 35 words | | Hold |
| A word the glossary says to avoid | "purchase" when the glossary prefers "order" | Advice |
| Sentence of 25 to 35 words | | Advice |
| AI filler words | "leverage", "robust", "seamless", "delve" | Advice |

Output is a list of findings with line numbers, as text for people and JSON for scripts. Exit code 0 means pass, 1 means held.

### 6.3 The cold reader: its own skill, `cold-reader`

A model reads the text knowing nothing else, and reports what it couldn't follow. This is the only way to test "makes sense with no outside context" directly. It's a separate skill that `plain` calls, so it can be tuned and maintained on its own.

**How it stays blank (tested: a live probe confirmed it didn't know Karen, Atlas or Hermes).** A normal subagent loads the project's CLAUDE.md and memory, so it would already know what "Karen" means. Instead, the cold reader runs as a separate `claude -p` call:

- started from an empty temporary folder, so there are no project files and no project memory
- with `--setting-sources local`, so no user settings or plugins load
- with no tools, so it can't go looking for answers
- with a fixed system prompt that describes the reader from section 2

It returns the terms it couldn't understand, the context it needed but couldn't see, a two-sentence restatement, and what it thinks the reader is asked to do.

**Calibration.** First real use, on three past pull requests, showed the reader understood every change correctly but flagged a mix of fair problems and noise. It now reports only:

| Flag | Reported? |
|---|---|
| A term the text never explains | Yes |
| Context needed to follow the change that the text doesn't give | Yes |
| A term the text already explains | No |
| Code names in the technical detail section | No |
| More detail a curious reader might like | No |

**How strict, by kind of text:** pull requests, issues, comments and pages must pass. Long specs and plans get the reader's flags as advice, and must still pass the checker.

**Maintained like code:**

- **Its own files:** the reader's instructions, the calibration rules above, and its own version number. A new version makes old pass stamps stop counting.
- **A test set** of real texts with every flag labeled fair or noise. It starts with the three examples from first real use (precordia 199, onehearthealth 868, smsMarketing 1630), and grows from the other projects too. Any change to the reader is scored against the set before it ships: it must still catch the fair flags and drop the noise.
- **Monthly review:** flags the owner disagrees with become new test cases.

The writer still compares the restatement with what they meant, and rewrites when they differ. After two failed rewrites, the text is held and brought to the owner with the reader's notes. The reader's model is Sonnet by default, and each repository can change that.

### 6.4 The pass stamp

When a text passes both the checker and the cold reader, the skill records a stamp. A stamp is a small file holding a fingerprint of the exact text, the checker version and the reader's verdict. Stamps are stored in the repository's git folder (`.git/plain/stamps/`), so they're never committed, and every worktree of the repository shares them.

The stamp lets the hold (section 6.5) confirm quickly that this exact text already passed, without calling the model again.

### 6.5 The hold

A hook runs before Claude posts or commits. A hook is a script Claude Code runs automatically at set moments.

**What it watches:**

| What | How it's checked |
|---|---|
| GitHub posts through `gh`: pull request create, edit, comment and review; issue create, edit and comment; `gh api` calls that write to pull requests, issues or comments | Checker and stamp |
| Published HTML pages, including spec review pages | Checker and stamp |
| Spec and plan files in a commit (for example `docs/superpowers/specs/`, `docs/superpowers/plans/`, `openspec/changes/`; each repository lists its own folders) | Checker and stamp, for each changed spec or plan file |
| Commit messages | Checker only. The first line is held for acronyms and codes; the rest is advice |

**What it does:**

1. **Posted text must come from a file** (`--body-file`, `-F body=@file`, or the page file). If the text is inline in the command, the post is held with an instruction to move it into a file. Reading a file is reliable; picking text out of a shell command is not.
2. The checker runs on the file. Any hold-level finding holds it and lists what to fix.
3. If there is no stamp for this exact text, it's held with: "Run /plain on this text first."
4. Otherwise it goes ahead.

**Overrides:** prefix the command with `PLAIN_OVERRIDE="reason"`. The reason is required and gets logged to `.git/plain/overrides.log`, which the weekly report counts.

### 6.6 Chat replies

A "Plain English" output style tells Claude to follow the writing rules in conversation. An output style is a saved instruction that shapes how Claude writes its replies. It's set once in the shared settings so both accounts use it.

onehearthealth has an uncommitted local setting for a "Concise" style, which would win over the shared one there. The plan replaces it with "Plain English", which is also concise.

Chat replies aren't held or checked by the model. They follow the style, and the owner can say "plain" to get a re-explanation.

### 6.7 The glossary and settings

**`GLOSSARY.md`, one per repository, in Matt Pocock's format.** Each project term gets a one- or two-sentence definition and a list of words to avoid:

```markdown
**Recording**:
Audio of the heart captured at one listening spot on the chest.
_Avoid_: clip, sample, track
```

Only terms specific to the project go in it, not general programming terms. Matt's skills (`grill-with-docs`, `tdd`, `code-review`, `pr` and others) already read this file, so one glossary serves both his skills and `plain`. The grill step in our spec process (a separate spec) adds terms as they come up, so the glossary grows as a side effect of writing specs.

**`.claude/plain.json`** holds what `GLOSSARY.md` doesn't:

- extra common words for this repository (the default list ships with `plain`)
- codes never to publish, with what to say instead (`BLUF: put the summary first, no heading needed`)
- the spec and plan folders the hold watches
- the cold reader's model

`cstack init` seeds both by scanning the last 50 pull requests, the docs folder and any existing plans. It proposes entries, and the owner approves them.

### 6.8 The pull request layout

Every pull request description uses one layout. It combines Matt Pocock's `/pr` skill with our rules. His version starts with a diagram and uses terms like "one-way door" and "blast radius"; ours starts with plain words and replaces those terms.

```markdown
## What changed and why
Two to four plain sentences: what is different for users or developers, and why.

## How it works
One small picture: a short list of steps, a before-and-after sketch,
a file list, or a diagram. Names in it are explained in the text above.

## Proof it works
Before: screenshot, failing test or old output.
After: screenshot, passing test or new output.
For screen changes, screenshots sit next to the approved prototype.

## Risk
Easy to undo? Yes or no, and why.
What it could affect: screens, data, other code, other teams.

## Technical detail (optional)
For the reviewer: written for a junior developer.
```

Screenshots are the best proof when the change is visual. Test results come next. The proof section is filled from the output of `verify`, our verification check (a separate spec).

Credit: the layout's ideas come from Matt Pocock's `/pr` (MIT license), which credits Dex Horthy's `show-me` skill for the menu of diagrams. The license for `show-me` is unclear, so we use its ideas, not its text.

### 6.9 Monthly review

Once a month, the owner runs a review on a sample of recent sessions, borrowing Matt Pocock's `/retro` skill. He warns that running it automatically on every session finds false problems, so it runs on a sample, by hand. The review looks at:

- terms the cold reader flagged more than once, which become `GLOSSARY.md` entries
- overrides, and whether each was a real exception or a missing rule
- problems the cold reader caught that follow a fixed pattern, which become new checker rules

The last point follows a rule from `/retro`: a problem with a fixed pattern gets an automatic check, not a written instruction. Written guidance is only for judgment calls.

### 6.10 Where the files live

| Location | What |
|---|---|
| cstack, `plugins/plain/` | The main copy: `rules.md`, `reader-prompt.md`, `plain-check.mjs`, the skill, the pull request layout, and tests |
| precordia and smsMarketing, `.claude/settings.json` | The `plain` plugin declared, so teammates are offered it (to be confirmed by a one-minute test; if it fails, generated copies marked "do not edit" go in the repository instead) |
| precordia and smsMarketing, `GLOSSARY.md` and `.claude/plain.json` | The glossary and settings, committed |
| onehearthealth, `.claude/plain.local.json` and a git-ignored glossary draft | Personal settings only. Nothing that changes teammates' work is committed there. |

**Teammates.** In precordia and smsMarketing, teammates who accept the plugin also get the hold. Posts they make by hand, outside Claude, aren't affected. In onehearthealth the hold applies only to the owner's own sessions.

## 7. How we know it works

1. **Checker tests**, using fixtures from the real pull request text in section 1:
   - `BLUF`, `Q21`, `D3c` and `READY` are held
   - `ventricular septal defect (VSD)` followed later by `VSD` passes
   - code blocks, links and diagrams are ignored
   - a glossary term used with its preferred word passes; an avoided word gets advice
2. **Cold reader tests:**
   - text that names "Karen" without explaining it must be flagged
   - the same text with the explanation must pass
   - a probe asks the reader what Karen, Atlas and Hermes are, and it must say it doesn't know; this proves it really is blank
3. **Hook tests**, feeding the hook the same input Claude Code would:
   - an inline body is held
   - a file that fails the checker is held
   - a file with no stamp is held
   - a stamped file goes ahead
   - an override goes ahead and is logged
   - all three `gh api` forms we use are recognized
   - a commit that changes a spec file without a stamp is held
4. **Real use:**
   - our own design documents (the orchestrate kit, this one, and the one-plan overview) are rewritten through `/plain` first; the orchestrate document still uses planning codes like the ones in section 1
   - the owner's next ten pull requests go through it, and we compare them with the scan in section 1

## 8. Rollout

| Step | What happens | Done when |
|---|---|---|
| 1. Get ready | Update Matt Pocock's skills from version 1.2.3 to 1.3.1 in both accounts. Confirm the cold reader starts blank, output styles can be shared across both accounts, and the hook sees `gh api` posts, page publishes and commits | All confirmed, or a fallback chosen for each |
| 2. Checker, glossary and the `/plain` command | Build the checker and the skill. Seed `GLOSSARY.md` and `.claude/plain.json` in all three repositories. Usable by hand, nothing held yet | Checker tests pass; owner approves the three glossaries |
| 3. First real use | Rewrite our design documents through `/plain` | All three pass; owner confirms they read clearly |
| 4. Hold in precordia and smsMarketing | Turn on the hook where the owner works most | Ten real posts go through; no false holds the glossary can't fix |
| 5. onehearthealth | The owner's own sessions only, through git-ignored local settings | Hold works for the owner; nothing committed |
| 6. Chat style, commit messages, monthly review | Turn on the output style and the commit message check; schedule the first monthly review | Owner says replies read clearly; first review done |

## 9. Risks

| Risk | What we do about it |
|---|---|
| False alarms on terms that are fine | Glossary entries fix them for good; advice-level findings never hold; overrides exist and are counted |
| The cold reader is slow or costly | It runs once per text, not per edit. The stamp means it never runs twice on the same text. About 10 to 20 seconds and one small model call |
| The cold reader is too picky about normal words | Its system prompt describes a junior developer or product manager, and it reads the common list |
| The hook misses a way of posting | Every post must come from a file, and the hook tests cover each `gh` form we use |
| Teammates find the hold annoying | Holds explain exactly what to fix; `/plain` fixes it in one step; onehearthealth gets a heads-up first |
| Matt Pocock's skills change again | We use his glossary format and ideas, not his files; an update can't break `plain` |

## 10. Open questions

- Should commit message bodies be held, not just advised? We'll start with advice and decide after two weeks.
- Should Notion pages and Slack messages be checked later? Out of scope for now.
