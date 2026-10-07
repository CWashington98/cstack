import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { makeRepo } from "../../../tests/helpers.mjs";
import { parseFlow, checkFlowFile } from "../scripts/lib/maestro.mjs";
import { checkPlaywrightFile } from "../scripts/lib/playwright.mjs";

const ID = "com.example.app";
const flow = (body, appId = ID) => `# a flow\nappId: ${appId}\n---\n${body}`;
const check = (name, raw) => {
  const root = makeRepo({ [name]: raw });
  return checkFlowFile(join(root, name), ID, "app.json").map((f) => f.message).join("\n");
};

test("parseFlow reads the app ID and top-level commands with line numbers", () => {
  const f = parseFlow(flow('- launchApp\n- tapOn: "Start"\n- extendedWaitUntil:\n    visible: "Done"\n    timeout: 5000\n'));
  assert.equal(f.appId, ID);
  assert.equal(f.appIdLine, 2);
  assert.deepEqual(f.commands.map((c) => [c.name, c.line]), [["launchApp", 4], ["tapOn", 5], ["extendedWaitUntil", 6]]);
});

test("a flow that acts and then checks the end state passes", () => {
  assert.equal(check("good.yaml", flow('- tapOn: "Start"\n- extendedWaitUntil:\n    visible: "Done"\n')), "");
});

test("a flow targeting the wrong app ID is held, naming both IDs", () => {
  const msg = check("old.yaml", flow('- tapOn: "Start"\n- assertVisible: "Done"\n', "com.example.old"));
  assert.match(msg, /targets app ID "com\.example\.old", but the app's ID is "com\.example\.app" \(from app\.json\)/);
});

test("a flow that never acts is held", () => {
  const msg = check("look.yaml", flow('- assertVisible: "Recording"\n- assertVisible: "Start Recording"\n- takeScreenshot: before\n'));
  assert.match(msg, /never acts/);
});

test("a flow that acts but checks nothing afterwards is held", () => {
  assert.match(check("blind.yaml", flow('- assertVisible: "Home"\n- tapOn: "Start"\n- takeScreenshot: after\n')), /checks nothing after its last action/);
});

test("tapping a screen position is held", () => {
  assert.match(check("pos.yaml", flow('- tapOn:\n    point: "50%,80%"\n- assertVisible: "Done"\n')), /screen position/);
});

test("no false holds: subflows, templated IDs, runFlow last, and the workspace config", () => {
  assert.equal(check("sub.yaml", '- tapOn: "Allow"\n'), "");
  assert.equal(check("tmpl.yaml", flow('- tapOn: "Go"\n- assertVisible: "Done"\n', "${APP_ID}")), "");
  assert.equal(check("rf.yaml", flow('- tapOn: "Go"\n- assertVisible: "Done"\n- runFlow:\n    when:\n      visible: "Modal"\n    commands:\n      - tapOn: "OK"\n')), "");
  assert.equal(check("config.yaml", `appId: ${ID}\nenv:\n  KIT: "X"\n`), "");
  assert.match(check("config.yaml", "appId: com.example.old\n"), /targets app ID "com\.example\.old"/);
});

test("browser tests: fixed pauses and position clicks are held, comments are not", () => {
  const root = makeRepo({ "a.spec.ts": "// page.waitForTimeout(1) is banned\nawait page.waitForTimeout(6_000);\nawait page.mouse.click(100, 200);\n" });
  const msgs = checkPlaywrightFile(join(root, "a.spec.ts"));
  assert.deepEqual(msgs.map((m) => m.line), [2, 3]);
  assert.match(msgs[0].message, /waits a fixed time/);
});
