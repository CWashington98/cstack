// Parses "--name value" pairs and bare flags. A name listed in `lists` takes every
// value up to the next "--" option, and may repeat, so shell wildcards work.
export class UsageError extends Error {}

export function parseArgs(argv, { flags = [], lists = [] } = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const name = a.slice(2);
    if (flags.includes(name)) { out[name] = true; continue; }
    if (lists.includes(name)) {
      const values = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) values.push(argv[++i]);
      if (!values.length) throw new UsageError(`--${name} needs a value`);
      (out[name] ??= []).push(...values);
      continue;
    }
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) throw new UsageError(`--${name} needs a value`);
    out[name] = value;
  }
  return out;
}
