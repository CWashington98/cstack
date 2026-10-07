// Rules for browser tests an app skill relies on: wait for real end states, and
// never click screen positions.
import { readFileSync } from "node:fs";
import { appHold } from "./app-skill.mjs";

export function checkPlaywrightFile(file) {
  return readFileSync(file, "utf8").split(/\r?\n/).flatMap((t, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(t)) return [];
    if (/\.waitForTimeout\(/.test(t)) return [appHold(file, i + 1, "waits a fixed time. Wait for the real end state instead: a visible element, a finished request, or a URL.")];
    if (/mouse\.click\(\s*\d/.test(t)) return [appHold(file, i + 1, "clicks a screen position. Use a role, label or test ID.")];
    return [];
  });
}
