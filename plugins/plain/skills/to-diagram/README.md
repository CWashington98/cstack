# to-diagram: how it is maintained

The to-diagram skill draws a diagram in plain English, always dark, with colors that pass accessibility contrast rules. A checker proves each diagram before anyone sees it. `SKILL.md` says how to use it. This file is for whoever changes it.

## Files

| File | What it is |
|---|---|
| `SKILL.md` | The steps for drawing a diagram |
| `palette.json` | The only colors a diagram may use, and the smallest font sizes |
| `svg-subset.md` | The parts of the image format the checker can read |
| `templates/` | Starting files: a flow, a timeline, boxes in groups, before and after, and a page |
| `evals/evals.json` | Three test requests, with what a good answer looks like |
| `evals/runs/` | What a fresh agent drew for each request, with the skill and without it |
| `evals/results/` | The checker's scores for those drawings |

The checker is `scripts/diagram-check.mjs` in the plugin, with its helpers in `scripts/lib/svg.mjs` (reads the file) and `scripts/lib/color.mjs` (contrast, blending and color blindness). It reuses the plain checker's writing rules and settings, so a repository's `.claude/plain.json` and glossary apply to diagram labels too.

The tests are in the plugin's `tests` folder:

- `palette.test.mjs` works out the contrast of every allowed pairing and fails if any falls short.
- `diagram-check.test.mjs` runs the checker on every file in `tests/fixtures/diagram/` and on every template. A fixture's name says what it must produce: `pass-…`, `hold-<rule>-…` or `advice-<rule>-…`.
- `diagram-gaps.test.mjs` covers the bad diagrams a review found passing, and pins the contrast limits at their exact edges. Breaking each checked behavior in the code makes one of these tests fail.

## The palette

All colors are dark mode. The contrast rules come from the Web Content Accessibility Guidelines, version 2.2: words need 4.5 to 1 against what is behind them, and lines, edges and marks need 3 to 1.

| Color | Hex | Kind | Lowest contrast on any surface |
|---|---|---|---|
| background | `#0b0f17` | surface | |
| surface | `#151b26` | surface | |
| raised | `#202837` | surface | |
| text | `#f2f5f9` | words | 13.52 to 1, on raised |
| muted | `#9aa5b6` | words | 5.94 to 1, on raised |
| border | `#6c788c` | lines | 3.31 to 1, on raised |
| blue | `#5ea8ff` | accent, words allowed | 6.00 to 1, on raised |
| orange | `#f2994a` | accent, words allowed | 6.64 to 1, on raised |
| green | `#4cc76a` | accent, words allowed | 6.82 to 1, on raised |
| red | `#ff7a7a` | accent, words allowed | 5.86 to 1, on raised |
| purple | `#c49bff` | accent, words allowed | 6.68 to 1, on raised |
| teal | `#3ccbd3` | accent, words allowed | 7.52 to 1, on raised |

Blue and orange are the pair for good and bad. We simulated the two common kinds of red-green color blindness. Under both, blue and orange stay far apart: a color distance of 98.6 and 116.7, where 40 is obvious. Red and green fall to 3.2 for the most common kind, which is nearly the same color. That is why the skill says to use red and green only with a word that says what they mean.

To change a color: edit `palette.json`, run `npm test` from the repository root, and update the table above. The palette test fails if any pairing drops below its limit.

## Rulings

Choices made while building this, and what it costs if one is wrong.

- **Box labels: advice over 6 words, hold over 12.** A hard stop at 7 would block ordinary labels like "Spec written and agreed by the owner". If wrong, some crowded boxes ship; the advice still flags them.
- **A box's word count includes its second line.** Readers see both lines as one label. If wrong, two-line boxes get advice a little early.
- **12-pixel words only inside a legend,** marked by a group whose `id` is `legend` or whose class list has `legend` as a whole word. If wrong, a legend without that marker is held until someone adds it.
- **All words need 4.5 to 1, even large ones.** The guidelines allow 3 to 1 for very large words; we skip that exception to keep one simple rule. If wrong, some large accent headings are held that would be legal.
- **A box stands out if its edge or its fill reaches 3 to 1** against what is around it. A filled shape with no edge and no words must reach 3 to 1 itself, unless it is a palette surface color. If wrong, a faint panel with no edge could pass; a panel only frames other boxes, so the loss is small.
- **Font sizes are measured after shrinking by the diagram's width or height,** from its attributes or its own style. A width in percent is held, because the checker can't know the final size. If wrong, a diagram meant to stretch to its page is held; give it a pixel width.
- **Only listed elements are allowed; everything else is held.** That covers style sheets, embedded images, gradients, animation, nested diagrams, filters and rotation, because the checker can't prove what they draw. If wrong, a diagram that needs one of these can't pass; draw it another way.
- **On a page, page styles must stay out of the diagram.** A rule for the diagram's parts may set only display and margins. Opacity, filters, transforms, zoom, fill and stroke are held anywhere on the page, because they can reach the diagram through a parent. Linked style sheets are held. If wrong, an ordinary page effect elsewhere on the page, such as a hover transform, blocks the diagram page.
- **No more than a third of the picture may be lighter than the surface colors.** The checker adds up each shape's real light area: rects and ellipses exactly (only the part inside the canvas), other filled shapes by their bounding box, and lines and edges as length times width. Overlaps count twice, which only makes it stricter. No sampling is used, so thin stripes can't slip between sample points. If wrong, a diagram with many accent-filled boxes is held; use surface boxes with accent edges.
- **The background rect must use plain numbers.** Some image tools draw a percent-sized rect as white. If wrong, nothing is lost: numbers work everywhere.
- **Words may not be outlined:** no stroke and no empty fill. If wrong, an outlined heading style can't be used.
- **Lines and edges behind words count; lines meeting other lines don't.** Words are measured against fills and against any line drawn across them. Lines and marks are measured against fills only, since a line touching a box edge is a join. If wrong, a line drawn along another line of the same color passes.
- **Capital-letter words are held in diagrams even when plain's common list allows them** (API, ID, AI and so on). One passes if the glossary has it or the diagram's visible words spell it out anywhere. Plain's prose checker is unchanged. If wrong, a diagram for a technical reader has to spell out words that reader knows.
- **Acronyms spelled out only in the hidden description still hold on the label.** Most readers never see the description. If wrong, a label holds that a screen reader user would have understood.
- **Text width is estimated** at 0.55 of the font size per letter (0.6 for bold). Words wider than their box or past the edge are advice, not a hold, because the estimate can be off by a few letters. If wrong, a cut-off label ships; step 8 in `SKILL.md` asks for a look in a browser.
- **"Meaning shown by color alone" is a guess:** two or more accent colors on shapes and no legend. It can't tell whether the labels already say the meaning, so it is advice. If wrong, a diagram gets a needless nudge.
- **The checker guards against honest mistakes, not a determined attacker.** Deliberate tricks are closed by simple limits on the allowed subset: lines and edges at most 12 wide, arrowheads at most 12, words at most 48 pixels, no block or shape characters in words. If wrong, a diagram that needs a thicker line or a huge heading is held; neither has come up.
- **A filled path counts as its whole bounding box,** control points and arc radii included, both for light area and for what is behind words. If wrong, words beside a curved shape are measured against its fill and may be held; move them clear.
- **A stroke's light area is the smaller of two measures:** its box grown by half its width, and its length plus two widths, times its width. The first alone would count the inside of every bordered box. If wrong, a few very wide strokes on tiny shapes count slightly less than they cover.
- **Words sitting on top of a line are not detected.** Curves are reduced to their end points, so the check would miss most cases. `SKILL.md` asks for labels beside lines instead. If wrong, an overlapping label ships unless someone looks.

## Test results

Each request in `evals/evals.json` was given to a fresh agent (Sonnet) with the skill and without it. Each prompt carries the facts it needs, because a fresh agent knows nothing about the project. Every drawing was scored with the checker as it stands after the review fixes. The drawings and captions are in `evals/runs/`, and the details in `evals/results/2026-10-07-after-review.json`.

The three runs with the skill were redone after the review, as was the router run without it, whose prompt changed to carry the real facts. The other two runs without the skill are from the first round; their prompts did not change. The first round's scores are in `evals/results/2026-10-07.json`.

| Request | With the skill | Without it |
|---|---|---|
| Pull request flow | Passes, 4 pieces of advice (labels of 7 to 10 words) | Held: 23 problems |
| Two backends kept apart | Passes, 1 piece of advice (a 7-word label) | Held: 62 problems |
| Before and after of the account router | Passes | Held: 60 problems |
| **Pass rate** | **3 of 3** | **0 of 3** |

Without the skill, every drawing had a white background, colors outside the palette, and words of 12 or 13 pixels. Some also left out the title or description that screen readers need, or used capital-letter abbreviations. Leaving aside the palette rule, which only this skill knows about, they would still all be held for the light background and the small words.

With the skill, no drawing used a capital-letter abbreviation: "a second automated reviewer", not the two-letter short form. The router drawing shows the real rule: skip a locked account, skip one near its 5-hour limit, treat meter readings over 12 hours old as unknown, then pick the soonest weekly reset.

Runs with the skill took 58 to 69 seconds against 27 to 35 without, and used about 17% more tokens. The skill's drawings were checked and fixed before they were handed back.

To run the test again, give each prompt to a fresh agent with the skill and without it. Save the drawing as `diagram.svg` and the caption as `caption.md` under `evals/runs/<name>/<with_skill or without_skill>/`. Then run the checker on each drawing.
