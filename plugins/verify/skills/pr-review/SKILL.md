---
name: pr-review
description: Review a pull request with two independent verdicts, from Karen (Claude) and Codex (OpenAI), tied to the exact commit. Every finding must be reproduced by a separate check, or it is dropped. Use it before opening any pull request, again on its final commit before merge, and when asked to review a teammate's pull request.
---

# Reviewing a pull request

Every pull request gets two verdicts: one from Karen, our independent reviewer agent on Claude, and one from Codex, OpenAI's coding agent. Models from different companies catch different mistakes. Both verdicts are required.

Below, `<plugin>` means this skill's folder followed by `/../..`, which is the plugin's root folder.

## 1. The rules

- Reviewers see only the change since the branch point, the spec and the pull request description. Never the author's reasoning: a reviewer who sees the argument tends to accept it.
- Each reviewer works in its own private copy of the code, so a review can never touch the author's working folder.
- Cheap checks run first. Scripts are fast and certain; model reviews are slow.
- Correctness only: no style comments, nothing that existed before the change, nothing a linter catches.
- Every finding is reproduced by a separate check, or it is dropped.
- Verdicts carry the commit ID, and a new commit clears them. After a rebase, a verdict carries over only when the change itself is identical.
- Review before the pull request opens, and again on the final commit before merge.

## 2. Pick the base and the risk

The base is `origin/<integrationBranch>`, taking the branch name from `.claude/verify.json`. For an existing pull request, use its base branch. The risk is high when any changed file matches a `highRisk` pattern in the same settings file.

## 3. Cheap checks first

Each is a script. A failure stops the review and goes back to the author.

- For each plan or spec the change adds or edits: `node <plugin>/scripts/verify-plan.mjs <file>`.
- The `plain` checker on the pull request description file.
- For a change users can see: `node <plugin>/scripts/evidence.mjs check <run> --full-run --head HEAD` for each evidence run the description cites. A change users can see with no live evidence fails here.

## 4. Prepare what the reviewers see

Make `OUT` a new, empty folder in the scratch directory, then:

```sh
node <plugin>/scripts/review-prep.mjs --base <base> --spec <spec file> --pr-body <description file> --out "$OUT"
```

It writes the change, the file list, the spec and the description into `OUT`, and one private copy of the code each for Karen, Codex and the validator. Each copy has only two commits, "base" and "change under review", so no commit message from the author travels with it. It prints `meta.json`, which holds the head commit.

## 5. Run the two reviewers at the same time

- **Karen:** use the Agent tool with `subagent_type` set to `karen` (or `cstack:karen` when it comes from the plugin), on the most capable model. Give her `karen-brief.md` from this folder, with its values filled in. She writes `OUT/karen.json`.
- **Codex:** fill in `codex-prompt.md` and save it as `OUT/codex-prompt.md`. Keep the skeptic angle always. Add the architect angle for changes over about 100 lines, the minimalist angle for changes over about 300 lines, and the security angle when the risk is high. Then run, in the background:

```sh
codex exec -s read-only -C "$OUT/codex/repo" --ephemeral --output-schema <this skill's folder>/codex-schema.json -o "$OUT/codex.json" - < "$OUT/codex-prompt.md"
```

Confirm the flags with `codex exec --help` first. If it doesn't read the prompt from standard input with `-`, pass the prompt file's contents as the argument instead.

- **When Codex can't run:** if Codex stops with a usage limit or quota message, run a Claude reviewer in its place. Use the Agent tool with `subagent_type` set to `general-purpose` and `model` set to a model other than Karen's, such as `sonnet`. Give it the same prompt, and have it write `OUT/fallback.json`. Its verdict is recorded as `claude-fallback`, with a note quoting Codex's error. Never skip the second verdict.

## 6. Reproduce every finding

Combine the findings from both answers into `OUT/findings.json`, keeping only `id`, `claim`, `file`, `line`, `trigger` and `how_to_reproduce`. Give that file to the validator: a fresh agent (the Agent tool, `subagent_type` set to `general-purpose`) with `validator-brief.md` filled in. It writes `OUT/validation.json`.

Then merge its results into each answer:

```sh
node <plugin>/scripts/verdict.mjs merge --report "$OUT/karen.json" --validation "$OUT/validation.json" --out "$OUT/karen.final.json"
node <plugin>/scripts/verdict.mjs merge --report "$OUT/codex.json" --validation "$OUT/validation.json" --out "$OUT/codex.final.json"
```

Only reproduced blocking findings can make a verdict "not ready". The rest are dropped, and the comment says so.

## 7. Record the verdicts

```sh
node <plugin>/scripts/verdict.mjs write --reviewer karen --report "$OUT/karen.final.json" --meta "$OUT/meta.json"
node <plugin>/scripts/verdict.mjs write --reviewer codex --report "$OUT/codex.final.json" --meta "$OUT/meta.json"
node <plugin>/scripts/verdict.mjs check --base <base> --head "$(node -p "require('$OUT/meta.json').head")"
```

Each verdict lands on the commit in `meta.json`, the one the reviewers actually saw, even if someone commits while the review runs. `write` refuses a `--head` or `--base` that doesn't match it.

For a fallback reviewer, write `--reviewer claude-fallback --note "<Codex's error>" --model <model>`. Verdicts are stored in the repository's git folder, keyed by commit. They are never committed.

## 8. Report

- Both say ready: say so, with the commit ID.
- Either says not ready: list the reproduced blocking findings for the author to fix. Review again on the new commit.
- They disagree: show both verdicts to the owner. The owner decides.

## 9. Post

For the owner's own pull requests, turn each verdict into a comment and check it:

```sh
node <plugin>/scripts/verdict.mjs comment <verdict file> > "$OUT/<reviewer>-comment.md"
node <the plain plugin>/scripts/plain-check.mjs "$OUT/<reviewer>-comment.md"
gh api repos/{owner}/{repo}/issues/<number>/comments -F body=@"$OUT/<reviewer>-comment.md"
```

Before the pull request exists, keep the verdict files, and post them when it opens.

## 10. Before merge

Run `node <plugin>/scripts/verdict.mjs check --base <base>` on the final commit. If it fails because the head moved, review again. A verdict from an earlier commit carries over only when the change is identical.

## 11. Teammates' pull requests

Fetch the head with `git fetch origin pull/<number>/head:review/<number>`, and use `review/<number>` as the head. On top of the rules above:

- Prove each fix by watching its test fail without the fix and pass with it, in Karen's copy.
- Check that mirror pull requests are byte-identical, by comparing `verdict.mjs patch-id` for each.
- Draft the review in plain English and show it to the owner. Post it only after they approve.
- Never add reviewers the owner didn't ask for.

## 12. Clean up

```sh
node <plugin>/scripts/review-prep.mjs --remove "$OUT"
```

Verdict files stay in the repository's git folder.

## 13. Learning loop

When a finding keeps coming back, propose an automatic check for it. When a bug gets past review, add it to this skill's `evals/evals.json` as a new case.
