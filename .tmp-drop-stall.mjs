import fs from 'node:fs';
const edit = (file, pairs) => {
  let s = fs.readFileSync(file, 'utf8');
  for (const [a, b] of pairs) {
    const n = s.split(a).length - 1;
    if (n !== 1) throw new Error(`${file}: expected 1 match, got ${n}: ${a.slice(0, 80)}`);
    s = s.replace(a, b);
  }
  fs.writeFileSync(file, s);
};
edit('plugins/core/scripts/guard.mjs', [
  [`    // Claude Code asks a person about these, even when it is told not to ask.
    // Scripts the command runs are not shown to it, so only the command itself counts.
    if (!ctx.indirect) {
      const why = paths.some((p) => /[$\`*?[]/.test(p)) ? "its path comes from a variable, a command substitution or a wildcard" : ctx.chained ? "it is chained with other commands" : null;
      if (why) this.refuse("stall", \`This recursive rm would stop and wait for a person to approve it, because \${why}. Unattended workers can sit on that prompt for hours. Run the delete as its own Bash call with the literal path written out, for example: rm -rf /tmp/my-scratch/tree . Then run the rest of the commands in a separate call.\`);
    }
`, ''],
  [`  // Nothing here is the owner's to run: the agent only has to send the same delete another way.
  if (refusals.length > 0 && refusals.every((r) => r.rule === "stall")) return ["The cstack guard refused this command, because it would stall on a permission prompt.", ...refusals.map((r) => \`- \${r.reason}\`)].join("\\n");
`, ''],
]);
const T = 'plugins/core/tests/guard-stall-and-deep.test.mjs';
let s = fs.readFileSync(T, 'utf8');
const start = s.indexOf('// ---- Change 1: recursive rm that would stall on a permission prompt ----');
const end = s.indexOf('// ---- Change 2:');
if (start < 0 || end < 0) throw new Error('markers not found');
s = s.slice(0, start) + `// ---- Change 1: recursive rm with a variable, a wildcard or other commands ----
// The owner dropped the rule that refused these (2026-11-08). Only where the delete points matters.

test("a recursive rm on a variable, a wildcard or chained with other commands is judged only by where it points", () => {
  const dir = repo();
  for (const c of ['S=/tmp/x && rm -rf "$S"', "rm -rf /tmp/foo-*", "rm -rf /tmp/foo-?", "rm -rf /tmp/foo-[ab]", "cd /tmp && rm -r build", "rm -rf build; echo done", "echo a | rm -rf build", "if true; then rm -rf build; fi", "for i in 1; do rm -rf /tmp/scratch; done", "{ rm -rf /tmp/scratch; }", 'S=/tmp/x && rm -rf "$S" && mkdir -p "$S"']) allowed(dir, c);
  for (const c of ['rm -rf "$(cat f)"', "rm -rf \`cat f\`", "rm -r $HOME_NOT_SET/x"]) refused(dir, c, /can't tell where/);
});

test("commands that only look like a recursive delete are left alone", () => {
  const dir = repo();
  for (const c of ["rm -f a && echo ok", "rm a b; ls", "git rm -r --cached foo && git commit -m x", 'grep -rn "rm -rf" scripts/', "echo rm -rf stuff", 'git commit -m "never rm -rf $HOME"']) allowed(dir, c);
});

test("a chained delete of the repository's history is still refused", () => {
  const dir = repo();
  refused(dir, \`cd /tmp && rm -rf \${dir}/.git\`, /history/);
  refused(dir, \`S=\${dir} && rm -rf "$S"\`, /whole repository/);
});

` + s.slice(end);
fs.writeFileSync(T, s);
console.log('edited');
