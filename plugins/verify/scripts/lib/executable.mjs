// Executable specs, an opt-in: every step line of a scenario is bound to test code,
// and every binding for a THEN line asserts something. A binding is a step call in
// the files the settings point to, such as Then("exact step text", fn). Nothing here
// names a tool: the project's settings name the tool and how to run it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BINDING = /@?\b(given|when|then|and|but)\s*\(\s*(["'`])((?:\\.|(?!\2).)*)\2\s*,/gi;

// A binding asserts when its code calls assert, expect or should, or throws or raises.
// A project may add its own pattern with executableSpecs.assertion.
const ASSERTS = /\b(assert\w*|expect\w*|should|throws?|raise|fail)\b/;

export function bindingsIn(text) {
  const found = [...text.matchAll(BINDING)].map((m) => ({
    keyword: m[1].toLowerCase(), text: m[3].replace(/\\(["'`\\])/g, "$1"), start: m.index, end: m.index + m[0].length,
    line: text.slice(0, m.index).split("\n").length,
  }));
  return found.map((b, i) => ({ ...b, body: text.slice(b.end, found[i + 1]?.start ?? text.length) }));
}

const stripComments = (code) => code.split("\n").filter((l) => !/^\s*(\/\/|#|\*|\/\*)/.test(l)).join("\n");

export function asserts(body, settings) {
  const code = stripComments(body);
  if (ASSERTS.test(code)) return true;
  const own = settings.executableSpecs?.assertion;
  return own ? new RegExp(own).test(code) : false;
}

// Marks which steps are THEN lines: a THEN, or an AND that follows one.
export function thenSteps(scenario) {
  let last = "";
  return scenario.steps.map((s) => {
    if (s.kind !== "AND") last = s.kind;
    return { ...s, isThen: last === "THEN" };
  });
}

// files: the files that may hold bindings, read from the working folder.
export function checkExecutable({ root, files, scenarios, settings, check }) {
  const bindings = files.filter((f) => existsSync(join(root, f))).flatMap((file) => {
    let text;
    try { text = readFileSync(join(root, file), "utf8"); } catch { return []; }
    return bindingsIn(text).map((b) => ({ ...b, file }));
  });
  const holds = [];
  const byScenario = new Map();
  for (const sc of scenarios) {
    const used = [];
    for (const step of thenSteps(sc)) {
      const mine = bindings.filter((b) => b.text === step.text);
      if (!mine.length) {
        holds.push({ check, scenario: sc.id, step: step.text, why: `The step "${step.text}" of scenario ${sc.id} has no binding. Add a step call whose text is exactly that, in a file matching tests.acceptance.` });
        continue;
      }
      used.push(...mine);
      if (!step.isThen) continue;
      for (const b of mine.filter((x) => !asserts(x.body, settings))) {
        holds.push({ check, scenario: sc.id, step: step.text, file: b.file, line: b.line, why: `The binding for "${step.text}" (${b.file}:${b.line}) contains no assertion, so scenario ${sc.id} cannot fail on its THEN line. Add an assert, an expect or a should call.` });
      }
    }
    byScenario.set(sc.id, used);
  }
  return { holds, byScenario };
}
