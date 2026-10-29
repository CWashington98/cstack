import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export function fingerprint(cwd) {
  try { return createHash("sha256").update(readFileSync(join(cwd, ".claude", "verify.json"))).digest("hex"); }
  catch { return null; }
}

// One file per pull request and head commit. A rerun replaces it.
export function writeRecord(cwd, { pr, head, patchId = null, zone = null, call, reasons, now = new Date() }) {
  if (!/^[0-9a-f]{12,}$/.test(head ?? "")) throw new Error("no head commit to name the record by");
  const common = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd, encoding: "utf8" });
  if (common.status !== 0) throw new Error("not inside a git repository");
  const dir = join(resolve(cwd, common.stdout.trim()), "verify", "gate");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${pr}-${head.slice(0, 12)}.json`);
  const temp = join(dir, `.${pr}-${process.pid}.tmp`);
  const record = { pr, head, patchId, zone, call, reasons, settings: fingerprint(cwd), time: now.toISOString() };
  writeFileSync(temp, JSON.stringify(record, null, 2) + "\n");
  renameSync(temp, file);
  return file;
}
