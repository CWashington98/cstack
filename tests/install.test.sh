#!/usr/bin/env bash
# Runs install.sh into throwaway folders and checks what it promises. Needs network access,
# because install.sh fetches the picks from GitHub.
set -euo pipefail

here=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export CLAUDE_CONFIG_DIR="$tmp/claude" CODEX_HOME="$tmp/codex"
mkdir -p "$CODEX_HOME"

failures=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; failures=$((failures + 1)); fi; }
install() { bash "$here/install.sh" >"$tmp/out.txt" 2>&1 || { cat "$tmp/out.txt"; exit 1; }; }

# Every skill cstack should install: its own folders plus every name in picks.txt.
expected=$(
  ls "$here/skills"
  grep -vE '^\s*(#|$)' "$here/picks.txt" | awk '{ for (i = 4; i <= NF; i++) print $i }'
)

# A skill the user added, and one that collides with a cstack name.
mkdir -p "$CLAUDE_CONFIG_DIR/skills/my-own" "$CLAUDE_CONFIG_DIR/skills/council"
echo "mine" >"$CLAUDE_CONFIG_DIR/skills/my-own/SKILL.md"
echo "old copy" >"$CLAUDE_CONFIG_DIR/skills/council/SKILL.md"

install

for target in "$CLAUDE_CONFIG_DIR/skills" "$CODEX_HOME/skills"; do
  for name in $expected; do
    check "$target/$name has a SKILL.md named $name" \
      "grep -qE '^name: *[\"'\'']?$name[\"'\'']?\s*$' '$target/$name/SKILL.md'"
  done
done
for name in $(grep -vE '^\s*(#|$)' "$here/picks.txt" | awk '{ for (i = 4; i <= NF; i++) print $i }'); do
  check "pick $name carries its source's license" "grep -q 'MIT License' '$CLAUDE_CONFIG_DIR/skills/$name/LICENSE'"
done
for f in "$here"/agents/*.md; do
  name=$(basename "$f" .md)
  check "agent $name installed with a matching name" "grep -q '^name: $name$' '$CLAUDE_CONFIG_DIR/agents/$name.md'"
done
check "the user's own skill is untouched" "[ \"\$(cat '$CLAUDE_CONFIG_DIR/skills/my-own/SKILL.md')\" = mine ]"
check "a replaced skill is backed up" "grep -rqx 'old copy' '$CLAUDE_CONFIG_DIR/skills/.cstack-backup'"

# A second run with nothing changed replaces nothing.
rm -rf "$CLAUDE_CONFIG_DIR/skills/.cstack-backup"
install
check "a second run changes nothing" "grep -q 'skills: 0 added, 0 updated, 0 removed' '$tmp/out.txt'"
check "a second run makes no backup" "[ ! -e '$CLAUDE_CONFIG_DIR/skills/.cstack-backup' ]"

# A skill an earlier run installed that cstack no longer lists is moved out.
echo "dropped-skill" >>"$CLAUDE_CONFIG_DIR/skills/.cstack-installed"
mkdir -p "$CLAUDE_CONFIG_DIR/skills/dropped-skill"
install
check "a dropped skill is removed" "[ ! -e '$CLAUDE_CONFIG_DIR/skills/dropped-skill' ]"
check "a dropped skill is backed up" "ls '$CLAUDE_CONFIG_DIR'/skills/.cstack-backup/*/dropped-skill >/dev/null"
check "the user's own skill survives every run" "[ -e '$CLAUDE_CONFIG_DIR/skills/my-own/SKILL.md' ]"

# With no Codex folder, skills go to Claude Code only.
export CODEX_HOME="$tmp/no-codex"
install
check "no Codex folder means no Codex install" "[ ! -e '$tmp/no-codex' ]"

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "All checks passed."
