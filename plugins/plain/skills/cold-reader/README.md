# cold-reader: how it is maintained

The cold reader checks that a text makes sense to someone with no context. It is a separate Claude call that starts with no project files, memory, settings or tools. It reads a text and reports what it couldn't follow. `SKILL.md` says how to use it. This file is for whoever changes it.

## Files

| File | What it is |
|---|---|
| `SKILL.md` | How to run the reader and read its verdict |
| `reader-prompt.md` | The reader's instructions, sent as its system prompt |
| `scripts/cold-read.mjs` | Runs the reader and checks its reply |
| `scripts/version.mjs` | The reader's version number |
| `scripts/score.mjs` | Scores the reader against the test set |
| `evals/evals.json` | The test set: texts, and the flags the reader should and shouldn't raise |
| `evals/files/` | The texts in the test set |
| `evals/first-use-verdicts/` | What the first, stricter reader said about the three rewrites |
| `evals/results/` | Saved scoring runs, with every reply from the reader |

The unit tests are in the plugin's `tests` folder, in `cold-reader.test.mjs` and `score.test.mjs`. They never call the model.

## Why it lives inside the plain plugin

The reader has its own skill folder, instructions, version and test set, so it can be changed on its own. It stays in the `plain` plugin because `plain` is its only caller today. The pass stamp in `plain` must also know the reader's version. A separate plugin would mean installing two plugins that only work together. If another plugin needs the reader later, move this folder out. It uses only two small helpers from `plain`: one reads HTML as text, and one reads the reader model setting.

## What the reader reports

It reports only:

| Flag | Reported? |
|---|---|
| A term the text never explains | Yes |
| Context needed to follow the change that the text doesn't give | Yes |
| A term the text already explains | No |
| Code names in the technical detail section | No |
| More detail a curious reader might like | No |

Pull requests, issues, comments and pages must pass. For a spec or plan in a watched folder, the flags are advice. The plain stamp command accepts a failing verdict for those, as long as the reader ran. It marks that stamp as advice only. The hold accepts it for committing the spec, never for a post or page with the same text.

## The test set

Each case in `evals/evals.json` has a text and labels. A label is a flag the reader might raise, marked fair (it should raise it) or noise (it shouldn't), with patterns that recognize it. The scorer gives each reader flag to the first label whose pattern matches, so narrower labels come before broader ones. A flag that matches no label is "unlabeled": not counted either way, but listed so a person can label it.

| Case | Source | Should it pass? |
|---|---|---|
| `precordia-199-rewrite`, `onehearthealth-868-rewrite`, `smsmarketing-1630-rewrite` | The owner's three pull requests, rewritten in plain English on 6 October 2026. Labels follow the owner's review of the reader's flags that day | No: each still has a few fair flags |
| `precordia-199-original`, `onehearthealth-868-original`, `smsmarketing-1630-original` | The same pull requests as first posted. A private link and a third-party footer were removed | No |
| `karen-unexplained` | Names Karen and never says who that is | No |
| `karen-explained` | The same text, saying Karen is our automated code reviewer | Yes |
| `blank-probe` | Asks what Karen, Atlas and Hermes are. The reader must say it doesn't know, which proves it starts blank | No |
| `code-names-in-technical-detail` | A clear text whose code names sit in a technical detail section | Yes |
| `unseen-meeting` | Depends on "Tuesday's meeting" and "option B" | No |

## Scoring a change

1. Change `reader-prompt.md` and raise the number in `scripts/version.mjs`.
2. Run `PLAIN_LIVE=1 node scripts/score.mjs` from this folder. It calls the model once per case, about five minutes in all. Add `--only name,name` to run some cases, or `--json results.json` to keep the details.
3. Compare with the scores below. A change ships only if it still catches the fair flags and raises no more noise.
4. Record the new scores below.

When the owner disagrees with a flag in real use, add the text as a case and label that flag.

## Scores

All runs used Sonnet on 7 October 2026. "Fair caught" counts fair labels the reader raised. "Noise raised" counts noise labels it raised, so lower is better. Unlabeled flags are not scored.

| Reader | Cases | Fair caught | Noise raised | Verdicts right | Restatements | Unlabeled flags |
|---|---|---|---|---|---|---|
| First reader, before calibration (its saved verdicts on the three rewrites, scored offline) | 3 | 11 of 11 | 15 of 15 | 3 of 3 | 3 of 3 | 30 |
| Version 2 | 11 | 27 of 32 | 6 of 17 | 11 of 11 | 11 of 11 | 56 |
| Version 2, second run of five cases | 5 | 18 of 23 | 8 of 15 | 5 of 5 | 5 of 5 | 43 |
| **Version 3, the current reader** | 11 | 28 of 32 | 3 of 17 | 11 of 11 | 11 of 11 | 60 |

On the three rewrites alone, version 3 caught 9 of 11 fair flags and raised 3 of 15 noise flags. The first reader caught all 11 fair flags, but it also raised all 15 noise flags. It failed every text for the wrong reasons.

Two label patterns were fixed after the first version 2 run. The murmur label now matches the single word "murmur", and `D3` is matched before `option C`. That changes at most two fair counts in the first version 2 row.

Version 3 added three things to version 2's instructions:

- a last pass that removes any item the text explains or the reader doesn't need
- a rule that a word for a kind of person, such as "owner", counts when it could mean more than one kind of person
- model and version names in the list of code names to leave out

What version 3 still gets wrong, in this run:

- **Missed fair flags:**
  - murmur probability versus confidence, in the onehearthealth 868 rewrite
  - how a customer's postal code decides when texts are sent, in the smsMarketing 1630 rewrite
  - Crishon, in the onehearthealth 868 original
  - `BLUF`, in the smsMarketing 1630 original
- **Noise raised:**
  - "heart-sound scoring service", which the owner judged clear enough as written
  - how 42 tests relate to 38 scenarios
  - what the security reviewer's two findings were
- **Results vary between runs.** In one version 2 run, the reader caught `BLUF` and missed `Q1-Q6`. In the next, it did the reverse. Compare totals over the whole set, not single flags, and run twice before trusting a small difference.

The full results of the version 3 run, with every reply from the reader, are in `evals/results/reader-v3-2026-10-07.json`. Many unlabeled flags look fair, such as "sync-v2" and "guardrails" in the onehearthealth rewrite. Labeling them is the next step for the test set.
