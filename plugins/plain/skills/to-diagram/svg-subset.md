# What the checker can read

The checker reads diagram files with a small reader that has no dependencies. It understands only the parts of the format listed here. Anything else is either held, so nobody ships a color the checker couldn't prove, or ignored, as listed below.

## Allowed

| Part | Notes |
|---|---|
| `<svg>` | Needs a `viewBox`. A `width` smaller than the viewBox shrinks the words, and the checker measures them after shrinking. A width in percent counts as no shrinking. |
| `<title>`, `<desc>` | Direct children of `<svg>`. Both must have words. |
| `<g>`, `<a>` | Groups. Colors, sizes and opacity set on a group pass down to what is inside. |
| `<rect>`, `<circle>`, `<ellipse>`, `<polygon>` | Shapes that can sit behind words. A rect may use `width="100%"` and `height="100%"`. Rounded corners are fine. |
| `<line>`, `<polyline>`, `<path>` | Lines and arrows. A filled path or polyline is treated as the polygon through its end points. Curves count only by their end points. |
| `<text>`, `<tspan>` | Real words. A tspan that sets `x`, `y`, `dx` or `dy` starts a new line. One without them is checked at the start of the line. |
| `<defs>`, `<marker>` | Arrowheads. The marker's colors must be in the palette, and they are checked against what is behind the end of the line. |
| Colors | Palette hex codes, short hex, hex with transparency, `rgb()` and `rgba()`, `none`, `transparent`, and `currentColor` (taken from the `color` setting). Colors must still match the palette exactly. |
| Opacity | `opacity`, `fill-opacity` and `stroke-opacity`. Allowed when the blended result still passes: the checker blends the color with what is behind it, as a browser does. |
| Font sizes | Plain numbers, `px`, `pt`, `em`, `rem` and `%`. |
| Moving | `transform="translate(x, y)"` only, one or several. |
| Legend | A `<g>` whose `id` or `class` contains the word `legend`. Words inside may be 12 pixels. |
| Settings | As attributes or in a `style=""` attribute. The style attribute wins, as in a browser. |

## Held

`<style>`, `<script>`, `<image>`, `<foreignObject>`, `<use>`, `<symbol>`, `<switch>`, `<textPath>`, `<filter>`, `<mask>`, `<clipPath>`, `<pattern>`, `<linearGradient>`, `<radialGradient>`, a fill or edge that points at a gradient or pattern, and any transform other than translate.

## Ignored

Comments, `font-family`, `stroke-dasharray`, rounded corners and arrowhead geometry. The checker doesn't see the font a browser picks, so it estimates text width from the font size: about 0.55 of the size per letter, 0.6 for bold.

## How "behind" is worked out

Shapes are painted in the order they appear in the file. For words, the checker looks at three points across the estimated width of each line, at mid-height. At each point it finds every filled shape painted earlier that covers the point, blends their colors in order starting from the palette background, and compares. The worst of the three points counts.

For a box with an edge, the box stands out if either its edge or its fill reaches 3 to 1 against what is around it. A filled shape with no edge and no words inside, such as a dot or a legend swatch, must reach 3 to 1 itself, unless its fill is one of the palette's surface colors. For lines, the checker looks at every corner and the middle of every segment.

All words need 4.5 to 1, even large ones. The accessibility rules allow 3 to 1 for very large words; we don't use that exception, to keep the rule simple.
