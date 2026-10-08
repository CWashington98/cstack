# What the checker can read

The checker reads diagram files with a small reader that has no dependencies. It understands only the parts of the format listed here. Anything else is either held, so nobody ships a color the checker couldn't prove, or ignored, as listed below.

## What this checker is for

It catches the mistakes an agent makes while drawing an honest diagram: a light background, a color outside the palette, faint words, tiny words, a missing title, an unexplained abbreviation. The allowed subset is deliberately small, so that every allowed shape can be measured. It is not a security boundary. Someone set on fooling it can still find a way, and closing every such way would need a full renderer. When a new way around it turns up, the fix is a tighter limit on the subset, not more geometry.

## Limits

- Lines and edges: `stroke-width` at most 12.
- Arrowheads: `markerWidth` and `markerHeight` at most 12.
- Words: at most 48 pixels. No block or shape characters (Unicode block elements and geometric shapes, such as █ or ▶); draw shapes with shape elements.
- Light area: no more than a third of the picture lighter than the surface colors. Fills count their area inside the canvas: rects and ellipses exactly, paths and polygons by their bounding box. A path's box includes its curve control points (reflected ones too) and its arc radii, enlarged as browsers do when they are too small to reach the end point. A stroke counts the smaller of its box grown by half its width on every side, and its length plus two widths, times its width. Both count only what lies on the canvas. An arrowhead counts its width times its height, times the line's stroke width.

- A light line whose center sits just outside the canvas still shades a strip inside it, up to half its width. Lines are capped at 12 wide, so that strip is at most 6 pixels deep. It isn't counted toward light area. On a real-size diagram this can't change the result.

## Allowed

| Part | Notes |
|---|---|
| `<svg>` | Needs a `viewBox`. A `width` or `height`, as an attribute or in its `style`, shrinks the words, and the checker measures them after shrinking. Both must be pixels or left out; a percent is held. Only the outer `<svg>`: a diagram inside the diagram is held. |
| `<title>`, `<desc>` | Direct children of `<svg>`. Both must have words. |
| `<g>`, `<a>` | Groups. Colors, sizes and opacity set on a group pass down to what is inside. |
| `<rect>`, `<circle>`, `<ellipse>`, `<polygon>` | Shapes that can sit behind words. Size the background rect in plain numbers, not percents. Rounded corners are fine. |
| `<line>`, `<polyline>`, `<path>` | Lines and arrows. A filled polyline is treated as the polygon through its points. A filled path is treated as its bounding box, which includes curve control points and arc radii. |
| `<text>`, `<tspan>` | Real words with a solid palette fill and no stroke. A tspan that sets `x`, `y`, `dx` or `dy` starts a new line. Every tspan is measured on its own, against every point across its line. |
| `<defs>`, `<marker>` | Arrowheads. The marker's colors must be in the palette, and they are checked against what is behind the end of the line. |
| Colors | Palette hex codes, short hex, hex with transparency, `rgb()` and `rgba()`, `none`, `transparent`, and `currentColor` (taken from the `color` setting). Colors must still match the palette exactly. |
| Opacity | `opacity`, `fill-opacity` and `stroke-opacity`, as a number or a percent. Allowed when the blended result still passes: the checker blends the color with what is behind it, as a browser does. |
| Font sizes | Plain numbers, `px`, `pt`, `em`, `rem` and `%`. |
| Moving | `transform="translate(x, y)"` only, one or several. |
| Legend | A `<g>` whose `id` is `legend` or whose `class` list includes `legend` as a whole word (`not-legend` doesn't count). Words inside may be 12 pixels. |
| Settings | As attributes or in a `style=""` attribute. The style attribute wins, as in a browser. |

## Held

Any element not in the table above, such as `<style>`, `<script>`, `<image>`, `<use>`, `<set>`, `<animate>`, a nested `<svg>` or a gradient. Also a fill or edge that points at a gradient or pattern, `filter`, `mask`, `clip-path`, `mix-blend-mode`, `textLength` and `lengthAdjust`, and any transform other than translate. `context-fill` and `context-stroke` are allowed only inside an arrowhead marker.

On a page, the checker also reads the page's styles. It holds a linked or imported style sheet. It holds a rule for the diagram or its parts that sets anything but `display` or margins. It holds any page style that sets opacity, filters, transforms, zoom, fill or stroke. On a page, words must have a font size set inside the diagram.

## Ignored

Comments, `font-family`, `stroke-dasharray`, rounded corners and arrowhead geometry. The checker doesn't see the font a browser picks, so it estimates text width from the font size: about 0.55 of the size per letter, 0.6 for bold.

## How "behind" is worked out

Shapes are painted in the order they appear in the file. For words, the checker looks at three points across the estimated width of each line, at mid-height. At each point it finds every filled shape painted earlier that covers the point, and every edge or line drawn across it at its width. It blends their colors in order, starting from the palette background, and compares. The worst of the three points counts. Lines and marks are measured against fills only, because a line meeting a box edge is a join, not a background.

For a box with an edge, the box stands out if either its edge or its fill reaches 3 to 1 against what is around it. A filled shape with no edge and no words inside, such as a dot or a legend swatch, must reach 3 to 1 itself, unless its fill is one of the palette's surface colors. For lines, the checker looks at every corner and the middle of every segment.

All words need 4.5 to 1, even large ones. The accessibility rules allow 3 to 1 for very large words; we don't use that exception, to keep the rule simple.
