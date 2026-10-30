---
name: pr-review
description: Review a pull request with two independent verdicts, from the claims auditor (Claude) and Codex (OpenAI), tied to the exact commit. It posts them as one plain-English comment a person can read in two minutes. Every finding must be reproduced by a separate check, or it is dropped. Use it before opening any pull request, again on its final commit before merge, and when asked to review a teammate's pull request.
---

# Reviewing a pull request

Get two independent verdicts on the exact commit, one from the claims auditor and one from Codex, and turn them into one comment the owner can read in two minutes. Scale the review to the change: a small low-risk change needs the two verdicts and little else; say in the comment what you skipped.

`<plugin>` below means this skill's folder followed by `/../..`.

## Hard rules

- Two verdicts, from models of different companies: the claims auditor (`cstack:claims-auditor`, most capable model) and Codex. If Codex stops with a usage limit, a Claude reviewer on a different model stands in, recorded as `claude-fallback` with Codex's error as the note. A fallback never overrules a Codex "not ready" for the same change.
- Reviewers never see the author's reasoning. Build what they see with `node <plugin>/scripts/review-prep.mjs --base <base> --out "$OUT"` (add `--spec` and `--pr-body`); each gets its own private copy of the code. If this branch has a verdict for an earlier commit, run `review-prep.mjs` with `--since` that commit, so the review starts from the open findings and the new diff.
- Run the cheap script checks (`verify-plan.mjs`, `plain-check`, `evidence.mjs check`) before any model review.
- Correctness only. Every finding is reproduced by a separate check, or it is dropped (`verdict.mjs merge` with a validator's answer, using `validator-brief.md`). Only reproduced blocking findings make a verdict "not ready"; "decide" findings become questions for the owner.
- For a change with an OpenSpec folder on the normal or high-risk lane, a spec-match reviewer also runs, with `spec-match-brief.md` and never the description. A finding that the spec looks wrong goes back to the spec approval step for the owner, never to the build.
- Record each verdict on the commit the reviewers saw:

```sh
node <plugin>/scripts/verdict.mjs write --reviewer claims-auditor --report "$OUT/claims-auditor.final.json" --meta "$OUT/meta.json"
node <plugin>/scripts/verdict.mjs write --reviewer codex --report "$OUT/codex.final.json" --meta "$OUT/meta.json"
```

- A new commit clears the verdicts, unless the change is identical. Run `verdict.mjs check --base <base>` on the final commit before merge.
- The comment is built by `verdict.mjs review` from the verdicts and a writer's text (`writer-brief.md`), and must pass `plain-check` before anyone sees it. Post it on the owner's own pull requests; for a teammate's, show the owner the draft first and never add reviewers they didn't ask for.

The briefs in this folder (`claims-auditor-brief.md`, `codex-prompt.md`, `codex-schema.json`, `spec-match-brief.md`, `validator-brief.md`, `writer-brief.md`) say what each reviewer gets and returns. Clean up with `review-prep.mjs --remove "$OUT"`. When a bug gets past review, add it to `evals/evals.json`.
