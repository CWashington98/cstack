# feat(forms): ZIP code is one optional field the owner adds from the form builder, and every ZIP feeds quiet-hours timing (zip-field-in-builder)

<!--
  PR CONTRACT: one structure for every PR — plain English first, then BLUF,
  then proof, then how to verify it, then the details a reviewer opts into,
  then the review record. The plain-English section, the BLUF and the two
  <details> blocks are author-written. Proof chain and Reviews are
  GENERATED/maintained by tooling — scripts/pr-body.ts fills the
  proof:start/end markers from .preflight-logs/summary.json + git, and
  scripts/review-record maintains the reviews:start/end table on every
  recorded verdict. PrePRGate refuses `gh pr create` unless `## In plain
  English` (with Before and After lines), `## BLUF` and both marker pairs are
  present, so don't hand-edit them.
-->

## In plain English

**Before:** To ask customers for their ZIP code, an owner flipped a separate "Ask for ZIP code" switch, and the box always showed under the phone number. A ZIP field the owner added themselves didn't help send texts at the right time.

**After:** ZIP code is one field the owner adds from the form's field list, like any other, and it shows wherever they put it. It is always optional, never blocks a signup, and is never part of the consent boxes. Every ZIP a customer gives helps time texts for where they live. The builder always says "Always optional. It never blocks a signup.", and the privacy page mentions ZIP whenever any of the business's forms asks for it.

## BLUF

- OpenSpec change `zip-field-in-builder` (high zone), approved by the operator 2026-10-02; operator answers Q1-Q6 in `interview.md`; MODIFIES the living `forms/zip-field` spec (4 modified, 5 added, 1 removed requirement; 38 scenarios).
- Acceptance tests by the independent test author (fallback; Codex out of quota), `Acceptance-For: zip-field-in-builder` (91d4a6f60, de15a2d33); mandatory assertion audit (karen) READY. 42 tests, all green; untouched by the build.
- Backend: at-most-one, never-required ZIP on every save path incl. the AI form helper; submission (public + phone-verified) saves the ZIP field's answer to `contacts.zip` (5 digits) and the field, drops invalid silently, never touches consent; saves renumber field `order` (fixes a drag-order bug for every field); `/privacy` mentions ZIP when any active lead form has a ZIP field; idempotent migration `admin/migrations/zipFieldInBuilder.ts` (not run anywhere; PROD has 0 affected forms). `askZip` is no longer read or written (schema field stays, deprecated; delete in a follow-up).
- Frontend: LocationCard and the switch removed; ZIP is a field-list item with fixed words ("ZIP code (optional)" + help), an always-visible "Always optional" note and a read-only "What customers see" panel; leaves the add menu once added; preview shows every field and scrolls; renders where placed, outside consent; mistyped ZIP never blocks submit.
- Reviews: karen READY (build and fix batch); security-compliance-expert: 2 Medium (privacy sentence) fixed, Lows fixed; no High/Critical. Prototype and reference screenshots stripped.
- Follow-ups (not here): pin draft/archived/membership cases in the /privacy query test; explicit "Form not found" in updateLegalContent; delete the deprecated `askZip` schema field; test-lock handover rule for archived owner slugs (warn today) before the wall flips to enforce.

## Proof chain

<!-- proof:start -->
1. **Baseline:** `origin/dev` @ `f29a36e2b`
2. **Preflight** (`.preflight-logs/summary.json`, sha `02d3349c4`, passed, 883s):
   - ✅ Install (frozen lockfile) (1s)
   - ✅ Supply-chain age gate (new lockfile entries) (0s)
   - ✅ Test lock (acceptance tests, range) (14s)
   - ✅ Red-first (new acceptance tests fail on the merge base) (201s)
   - ✅ Coverage (touched changes) (1s)
   - ✅ Spec wall (warn, --at-merge) (6s)
   - ✅ Living spec coverage (pnpm change coverage --living) (1s)
   - ✅ PreMergeGate fixtures (stubbed gh, no network) (100s)
   - ✅ PrePRGate fixtures (stubbed preflight, no recursion) (4s)
   - ✅ Hook input fixtures (lib/hook-input.sh) (0s)
   - ✅ preflight-diff-scope.sh fixtures (11s)
   - ✅ with-gate-lock fixtures (8s)
   - ✅ repo-node fixtures (1s)
   - ✅ review-gate verdict fixtures (0s)
   - ✅ review-gate status poster fixtures (1s)
   - ✅ husky/pre-push fixtures (203s)
   - ✅ preflight.sh fixtures (self-test) (64s)
   - ✅ PR body contract fixtures (check-pr-body) (0s)
   - ✅ PR command classifier fixtures (is-pr-command) (1s)
   - ✅ TaskCompleted hook fixtures (verify-task.sh, stub pnpm) (1s)
   - ✅ Nightly verdict fixtures (health-verdict.sh) (0s)
   - ✅ Stryker scope config fixtures (1s)
   - ✅ Mutation gate fixtures (base + line ranges) (15s)
   - ✅ Format check (prettier, whole repo) (10s)
   - ✅ Lint (eslint, errors-only) (1s)
   - ✅ shadcn lint ratchet (oxlint, whole tree) (11s)
   - ✅ Typecheck (turbo) (20s)
   - ✅ Convex push validation (local anonymous backend) (7s)
   - ✅ Backend tests (vitest convex + utils + e2e + scripts) (147s)
   - ✅ Frontend tests (vitest dashboard/admin/marketing/business-pages) (42s)
   - ✅ Mutation gate (stryker ratchet, enrolled diffs) (1s)
   - ✅ Mutation directive lint (inert next-line above chained calls) (0s)
   - ✅ Type-level tests (narrow tsconfig.typetest.json) (2s)
   - ✅ Typecheck PR-contract scripts (scripts/pr-*.ts + tests) (0s)
   - ✅ Typecheck targeted-test selector + nightly audit + CI budget + UI evidence (1s)
   - ✅ Typecheck E2E webhook harness (scripts/e2e-webhook/**) (1s)
   - ✅ Typecheck eval harness (scripts/evals/**) (2s)
   - ⏭ Mutation report (broad detect tier, report-only) (opt-in — pass --mutation-report to run)
   - ✅ Production build (turbo run build) (2s)
   - ⏭ Coverage scoreboard + floor gate (opt-in — pass --coverage to run)
   - ⏭ E2E smoke (playwright) (opt-in — pass --e2e (needs a free :3047; Playwright boots its own dev server))
3. **Counts:**
   - Backend: `Test Files  1688 total` / `Tests  29762 passed | 22 skipped (29795 total)`
   - Frontend: `Test Files  599 total` / `Tests  9520 passed | 11 skipped (9531 total)`
4. Each commit builds alone: not verified by tooling
5. Reviews: see table below (records pinned to head SHA by scripts/review-record)
<!-- proof:end -->

## Verify it yourself

<!-- 2–3 commands a reviewer can run in a minute -->

<details><summary><b>What changed</b></summary>

```
02d3349c4 chore(forms): strip the zip-field-in-builder prototype and reference screenshots before merge (/change ship step)
db3fff53b chore(forms): drop ZIP_FIELD_LABEL/HELP duplicates; copy lives in business-page-ui zipCopy (karen review, zip-field-in-builder)
34791fb01 fix(forms): the ZIP sentence is applied inside updateLegalContent against the form's current fields (security review, zip-field-in-builder)
fbe1b40eb proto(forms): ZIP row note always visible, chevron shows what customers see
2c00d4035 fix(forms): a demoted second ZIP field gives up its required flag and pattern (security review, zip-field-in-builder)
1dcc706e2 feat(forms): ZIP row always shows its reassurance; chevron shows what customers see
9ae544ba0 fix(forms): style preview shows every field in order and scrolls, no ZIP special case
d9d488567 fix(forms): the /privacy page names ZIP whenever any active lead form has a ZIP field (security review, zip-field-in-builder)
31d09de24 fix(forms): a policy edit can never drop the ZIP sentence while the form has a ZIP field (security review, zip-field-in-builder)
16a79443e feat(forms): ZIP code is one field the owner adds from the builder's field list
ec1300271 feat(forms): builder previews and form renderers show the fixed ZIP code words
03f56334e feat(forms): public form renders the ZIP code field where the owner puts it, with fixed words, never blocking a signup
14ec5dc00 test(forms): colocated zip-field tests for the one-field model, internal paths, migration plan and writer enumeration
2325bb70d feat(forms): zip-field-in-builder migration (paged, idempotent, dryRun)
2f628ebb2 feat(forms): the ZIP field is the form's one zipcode field; rules on every save path, order follows the array, askZip retired
de15a2d33 test(forms): tighten zip-field-in-builder acceptance assertions (audit punch list: expanded-row editing, refusal class, scoped Location check)
888dd23b5 docs(openspec): zip-field-in-builder tasks.md records the acceptance-test commit
91d4a6f60 test(forms): acceptance tests for zip-field-in-builder, one per forms/zip-field scenario
e0c037892 docs(openspec): zip-field-in-builder approved for build (operator, high zone)
8d6d0fa0e Merge remote-tracking branch 'origin/dev' into t3code/zip-field-in-builder
31f5f87d6 docs(openspec): zip-field-in-builder, operator answers Q3-Q6 folded in
5eb8a1125 docs(openspec): zip-field-in-builder change, drafted for approval
0cfaa6ec6 proto(zip-field-in-builder): builder field list with ZIP as an ordinary field, one-ZIP limit, public form preview (throwaway, deleted before merge)
```

` 72 files changed, 4616 insertions(+), 1272 deletions(-)`

</details>

<details><summary><b>Deliberately excluded / known limits</b></summary>

</details>

## Reviews

<!-- reviews:start -->

| Reviewer | Verdict | SHA     | When (UTC)           | Summary                                                                                                                                                                                                                                                                                                      |
| -------- | ------- | ------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| karen    | READY   | 02d3349 | 2026-10-03T15:11:53Z | karen (Fable): assertion audit READY on the fallback-authored acceptance tests; build READY at 16a79443e; fix batch READY at 02d3349c4 (security Mediums fixed with red-first tests, operator rulings on note/preview/privacy applied, locked acceptance files untouched and green, approval/coverage/strip… |

<!-- reviews:end -->

## Decisions needed

<!-- for THIS PR, or "none"; decisions for later PRs go under known limits -->

🤖 Generated with [Claude Code](https://claude.com/claude-code)

