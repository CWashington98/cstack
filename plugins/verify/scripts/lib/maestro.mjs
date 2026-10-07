// Reads Maestro flow files (a header, a "---" line, then commands) and checks that
// each flow drives the right app, acts, and checks the end state it caused.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { appHold } from "./app-skill.mjs";

const ACTIONS = new Set(["tapOn", "doubleTapOn", "longPressOn", "inputText", "inputRandomText", "inputRandomNumber",
  "inputRandomEmail", "inputRandomPersonName", "eraseText", "pasteText", "swipe", "scroll", "scrollUntilVisible",
  "pressKey", "back", "openLink", "setLocation", "travel", "addMedia"]);
const CHECKS = new Set(["assertVisible", "assertNotVisible", "assertTrue", "assertWithAI", "assertNoDefectsWithAI", "extendedWaitUntil"]);

export function parseFlow(raw) {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const sep = lines.findIndex((l) => l.trim() === "---");
  const header = sep === -1 ? lines : lines.slice(0, sep);
  const at = header.findIndex((l) => /^appId:/.test(l));
  const appId = at === -1 ? null : header[at].replace(/^appId:\s*/, "").replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "").trim();
  const commands = [];
  const points = [];
  if (sep !== -1) lines.slice(sep + 1).forEach((l, i) => {
    const line = sep + 2 + i;
    const m = l.match(/^- ([A-Za-z]+)/);
    if (m) commands.push({ name: m[1], line });
    if (/^\s*point:/.test(l)) points.push(line);
  });
  return { appId, appIdLine: at + 1, hasBody: sep !== -1, commands, points };
}

export function checkFlowFile(file, expected, source = "the app's config") {
  const flow = parseFlow(readFileSync(file, "utf8"));
  const out = [];
  const templated = flow.appId?.includes("${");
  if (flow.appId !== null && expected && !templated && flow.appId !== expected) {
    out.push(appHold(file, flow.appIdLine, `targets app ID "${flow.appId}", but the app's ID is "${expected}" (from ${source}). This flow drives a different app, or nothing.`));
  }
  if (/^config\.ya?ml$/.test(basename(file)) || !flow.hasBody) return out;
  if (flow.appId === null) out.push(appHold(file, 1, "has no appId, so Maestro cannot tell which app to drive."));
  const actions = flow.commands.filter((c) => ACTIONS.has(c.name));
  if (!actions.length) {
    out.push(appHold(file, flow.commands[0]?.line ?? 1, "never acts: no tap, typing, swipe or key press, so it proves only that a screen rendered. Add the trigger, then wait for the end state."));
  } else {
    const last = actions.at(-1);
    if (!flow.commands.some((c) => c.line > last.line && CHECKS.has(c.name))) {
      out.push(appHold(file, last.line, "checks nothing after its last action. Add an assertVisible or extendedWaitUntil for the end state the action causes."));
    }
  }
  for (const line of flow.points) out.push(appHold(file, line, "taps a screen position (point:). Use the visible text or a test ID."));
  return out;
}
