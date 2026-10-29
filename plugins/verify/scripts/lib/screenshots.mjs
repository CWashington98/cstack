// The screenshot check: a pull request that changes what users see needs screenshots
// in its description. Which paths users see, and whose pull requests must carry
// screenshots, come from the project's .claude/verify.json. Without them it does nothing.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { proseLines } from "./markdown.mjs";
import { matchesAny, gitOk } from "./compliance.mjs";
import { screenshotSettingsProblems } from "./app-skill.mjs";

const SETTINGS = join(".claude", "verify.json");

// Button images bots add to every pull request description. Left in, they would
// pass every pull request.
const BOT_IMAGE_HOSTS = ["blacksmith.sh"];

// The project's settings. A worktree without its own settings file uses the main checkout's.
export function screenshotSettings(root) {
  let file = join(root, SETTINGS);
  if (!existsSync(file)) {
    const common = gitOk(root, "rev-parse", "--path-format=absolute", "--git-common-dir")?.trim();
    if (common && existsSync(join(dirname(common), SETTINGS))) file = join(dirname(common), SETTINGS);
  }
  if (!existsSync(file)) return { userVisible: [], requiredFor: [], problems: [] };
  let s;
  try { s = JSON.parse(readFileSync(file, "utf8")); } catch (e) { return { userVisible: [], requiredFor: [], problems: [`${file} is not valid JSON: ${e.message}`] }; }
  return { userVisible: s.userVisible ?? [], requiredFor: s.screenshotsRequiredFor ?? [], problems: screenshotSettingsProblems(s) };
}

// The paths users can see: those matching a pattern, minus those matching a "!" pattern.
export function userVisibleFiles(paths, patterns) {
  const keep = patterns.filter((p) => !p.startsWith("!"));
  const drop = patterns.filter((p) => p.startsWith("!")).map((p) => p.slice(1));
  return paths.filter((p) => matchesAny(p, keep) && !matchesAny(p, drop));
}

// "Screenshots: not applicable — <reason>", in any capitals, with Markdown emphasis
// or a list marker around it. The reason is required.
const line = (words) => new RegExp(`^[\\s>*_-]*screenshots?[\\s*_]*:[\\s*_]*${words}\\b[\\s*_]*[—–:-]*\\s*\\w`, "im");
const NOT_APPLICABLE = line("not applicable");
const NOT_TAKEN = line("not taken");

// The description's own text: no HTML comments, code blocks, inline code or bot buttons,
// so a template's hints or a description that only quotes the rule never count.
function ownText(body) {
  const bot = BOT_IMAGE_HOSTS.map((h) => h.replace(/\./g, "\\.")).join("|");
  const prose = proseLines(String(body ?? "").replace(/<!--[\s\S]*?-->/g, "")).map((l) => l.text).join("\n");
  return prose
    .replace(/`[^`\n]*`/g, "")
    .replace(new RegExp(`<img\\b[^>]*(?:${bot})[^>]*>`, "gi"), "")
    .replace(new RegExp(`!\\[(?:[^\\][\\n]|\\[[^\\]\\n]*\\])*\\]\\([^)]*(?:${bot})[^)]*\\)`, "gi"), "");
}

// What a description offers as proof: "images" (a Markdown image, an <img> tag or a
// pr-assets/ link), "not-applicable" (the line above, with a reason), or null.
export function screenshotProof(body) {
  const text = ownText(body);
  if (/!\[|<img\b|\/pr-assets\//i.test(text)) return "images";
  if (NOT_APPLICABLE.test(text)) return "not-applicable";
  return null;
}

// The verdict: "skip" (nothing to check), "pass", "note" (worth doing, never blocks)
// or "hold" (goes back to the author).
export function screenshotVerdict({ visible, body, author, requiredFor = [] }) {
  if (!visible.length) return { status: "skip", message: "No changed file matches the userVisible patterns, so no screenshots are needed." };
  const files = `${visible.length} changed file(s) change what users see (${visible.slice(0, 4).join(", ")}${visible.length > 4 ? ", ..." : ""})`;
  const proof = screenshotProof(body);
  if (proof === "images") return { status: "pass", message: `${files}, and the description has screenshots.` };
  if (proof === "not-applicable") return { status: "pass", message: `${files}, and the description says screenshots are not applicable, with a reason.` };
  const required = requiredFor.some((a) => a.toLowerCase() === String(author ?? "").toLowerCase());
  const takenLine = NOT_TAKEN.test(ownText(body));
  if (!required && takenLine) return { status: "pass", message: `${files}, and the description says screenshots were not taken, with a reason. The reviewer can take them.` };
  const add = `Add screenshots of the running app to the description, or a line "Screenshots: not applicable — <reason>" if nothing users see changed.`;
  if (required) {
    const notTaken = takenLine ? ` A "Screenshots: not taken" line doesn't count for ${author}.` : "";
    return { status: "hold", message: `${files}, but the description has no screenshots. They are required for pull requests by ${author}.${notTaken} ${add}` };
  }
  const who = requiredFor.length ? `They are required only for ${requiredFor.join(", ")}.` : "They are recommended, not required.";
  return { status: "note", message: `${files}, and the description has no screenshots. Worth adding. ${who} ${add} If you can't run the app, a line "Screenshots: not taken — <reason>" is enough.` };
}
