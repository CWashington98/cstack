// Color math for the diagram checker: reading colors, the contrast ratio
// from the Web Content Accessibility Guidelines, blending see-through colors
// and simulating the two common kinds of red-green color blindness.

const channel = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const unchannel = (l) => {
  const s = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, s)) * 255);
};
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};
const toHex = (parts) => "#" + parts.map((p) => Math.round(p).toString(16).padStart(2, "0")).join("");

// Returns { hex, alpha }, "none" for no paint, or null for anything else.
export function parseColor(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "none" || v === "transparent") return "none";
  let m = v.match(/^#([0-9a-f]{3,4})$/);
  if (m) {
    const [r, g, b, a] = [...m[1]].map((d) => d + d);
    return { hex: `#${r}${g}${b}`, alpha: a ? parseInt(a, 16) / 255 : 1 };
  }
  m = v.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/);
  if (m) return { hex: `#${m[1]}`, alpha: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+%?)\s*)?\)$/);
  if (m) {
    const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { hex: toHex([m[1], m[2], m[3]].map(Number)), alpha };
  }
  return null;
}

export function luminance(hex) {
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// The color you see when `fg` at `alpha` sits on `bg`, as browsers blend it.
export function blend(fg, alpha, bg) {
  if (alpha >= 1) return fg;
  const f = rgb(fg);
  const b = rgb(bg);
  return toHex(f.map((c, i) => c * alpha + b[i] * (1 - alpha)));
}

// Viénot, Brettel and Mollon (1999), in linear light.
const SIM = {
  protanopia: [[0.11238, 0.88762, 0], [0.11238, 0.88762, 0], [0.00401, -0.00401, 1]],
  deuteranopia: [[0.29275, 0.70725, 0], [0.29275, 0.70725, 0], [-0.02234, 0.02234, 1]],
};

export function simulate(hex, kind) {
  const lin = rgb(hex).map(channel);
  return toHex(SIM[kind].map((row) => unchannel(row.reduce((s, k, i) => s + k * lin[i], 0))));
}

function lab(hex) {
  const [r, g, b] = rgb(hex).map(channel);
  const xyz = [
    (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047,
    0.2126 * r + 0.7152 * g + 0.0722 * b,
    (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883,
  ].map((t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116));
  return [116 * xyz[1] - 16, 500 * (xyz[0] - xyz[1]), 200 * (xyz[1] - xyz[2])];
}

// How different two colors look, as the straight-line distance in the
// CIE Lab color space (1976). About 2 is barely visible; 40 is obvious.
export function deltaE(a, b) {
  const [x, y] = [lab(a), lab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
