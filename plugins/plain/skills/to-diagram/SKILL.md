---
name: to-diagram
description: Draw a diagram that shows how something works, in plain English. It is always dark, and its colors pass accessibility contrast rules. It builds an image file from a fixed palette and templates, then proves it with a checker. Use it whenever the user says diagram, draw, visualize, picture, sketch, flow, map or architecture. Use it for "show me how X works", "what talks to what", before and after, or a timeline. Use it too when you are about to explain steps, parts or a change in a long paragraph and a picture would be clearer, even if nobody asked for one.
---

# to-diagram

Turns an explanation into a picture a junior developer or product manager can follow with no outside context. Every diagram is dark, uses only the palette's colors, and uses short labels in plain English. A checker proves the colors, sizes and words before anyone sees it.

The diagram is a Scalable Vector Graphics (SVG) file: an image made of shapes and real text. It stays sharp at any size, and screen readers can read it.

Files in this folder:

- `palette.json`: the only colors you may use, with what each is for.
- `templates/`: a starting file for each kind of diagram, plus `page.html` for showing one on a page.
- `svg-subset.md`: the parts of the format the checker can read. Read it before drawing anything a template doesn't already show.

The checker is in the plugin's `scripts` folder, two levels above this file. Below, `SCRIPTS` means `<this skill's folder>/../../scripts`.

## Steps

1. **Name the one question the diagram answers.** Write it as a sentence, such as "Where does an order go after checkout?" If you have two questions, make two diagrams. This sentence becomes the diagram's title, or close to it.

2. **Pick the kind of diagram** and copy its template:

   | The question is about | Kind | Template |
   |---|---|---|
   | What happens, in order | Flow | `templates/flow.svg` |
   | When things happen | Steps over time | `templates/timeline.svg` |
   | What belongs together and what is kept apart | Boxes in groups | `templates/groups.svg` |
   | What changed | Before and after | `templates/before-after.svg` |
   | How two options differ | Comparison | `templates/before-after.svg`, with the headings renamed |

3. **Write the labels in plain English.** Follow the writing rules in `../plain/rules.md`. In short:
   - Six words or fewer per box. Detail goes in the caption, not the box.
   - No capital-letter abbreviations, even common ones like API, ID or AI. Write the words instead: "Every request", "account number", "second automated reviewer". Diagrams have no room to explain, so the checker holds these even where plain prose would allow them.
   - If one must appear, spell it out in visible words in the same diagram, as in "Billing (RCM) queue", or add it to the repository's glossary.
   - No internal code names or plan numbers.
   - Name things by what they do: "Orders database", not a server name.
   - Say what an arrow means when it isn't obvious: "sends each order".
   - Put an arrow's label beside the line, never on top of it.

4. **Build it from the template and the palette.** Keep the template's background rect, sizes and spacing. The background rect uses plain numbers for its size, never percents, because some image tools draw a percent-sized rect as white. Use only colors from `palette.json`, written as their hex codes. Never invent a color, a gradient or a shadow: the checker can only prove contrast for the palette's colors.
   - Boxes: `surface` fill with a `border` edge. Use `raised` for a group panel or a box that should stand out.
   - Words: `text` for labels, `muted` for second lines and notes. Accent colors may color words too.
   - Accents (blue, orange, green, red, purple, teal) mark a path, a group or a status. For good and bad, use blue and orange: people with red-green color blindness can tell them apart. Use green and red only with a word that says what they mean.
   - If color carries meaning, add a legend (a group with `class="legend"`) or say the meaning in the labels.
   - Words are at least 14 pixels, or 12 inside a legend. Titles are 24, box labels 17 or 18, second lines 15.
   - Keep the `<title>` and `<desc>`: a short name, and one or two sentences that say what the picture shows. Screen readers read these in place of the picture.

5. **Run the checker:** `node SCRIPTS/diagram-check.mjs <file.svg>`. It exits 0 when the diagram passes, 1 when it is held, and 2 when the file is missing. Run it on a page too: `node SCRIPTS/diagram-check.mjs <page.html>` checks every diagram in the page and the words around them.

6. **Fix every "hold" line, then run it again.** Consider each "advice" line. Repeat until it passes. Don't argue with a contrast number: change the color.

7. **Write a caption of one short paragraph** that says what to notice: "Notice that the checkout is the only link between the two halves." Put it under the diagram, in the message or page that shows it. The caption follows the plain rules too.

8. **Look at it if you can.** If a browser is available, open the file and check that nothing overlaps or runs off the edge. The checker estimates text width; it can't see the drawing.

## Showing a diagram

- **In a file or pull request:** save the `.svg` file and link to it, with the caption beside the link.
- **On a page:** start from `templates/page.html`. It keeps the page dark and keeps the diagram at its own width, scrolling sideways in a narrow window. Shrinking a diagram to fit a phone would shrink its words below the checked size. Page styles must not reach into the diagram: no rules for the diagram's parts beyond display and margins, and no opacity, filters, transforms or fill anywhere on the page. Set the font size inside the diagram, or its words take the page's size.
- **In chat:** give the file path and the caption.

## What the checker holds and advises

Holds (must fix):

- The background is missing, isn't the palette's dark background, is sized in percent, or doesn't cover the whole picture.
- More than a third of the picture is lighter than the surface colors, counting fills and wide lines together.
- A color isn't in the palette, a shape has no fill (so it draws black), or a fill uses a gradient or pattern.
- Words are under 4.5 to 1 contrast against what is behind them, including lines drawn behind them. Each tspan is measured on its own.
- Words are outlined: a stroke on them, or no fill.
- A line, arrow, box edge or small mark is under 3 to 1 against what is behind it.
- Words are under 14 pixels (12 inside a legend), after any shrinking from the diagram's width or height. On a page, words with no font size set inside the diagram.
- The `<title>` or `<desc>` is missing.
- A label breaks the plain rules: a capital-letter abbreviation not spelled out in the diagram or the glossary, a planning code, or a word the repository's `.claude/plain.json` says never to publish.
- A box holds more than 12 words.
- The file uses something the checker can't read: a filter, a rotated group, or any element not on the allowed list. Examples are a style sheet, an embedded image, animation, or a diagram inside the diagram.
- On a page, a style sheet or style attribute that could change the diagram.

Advice (consider it):

- A box holds 7 to 12 words.
- Words may be wider than their box, or run past the edge.
- More than 12 labeled boxes: split it into two diagrams.
- Two or more accent colors and no legend.
- The `<svg>` lacks `role="img"` and `aria-labelledby`.
