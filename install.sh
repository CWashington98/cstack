#!/usr/bin/env bash
# Installs or updates cstack for Claude Code and Codex: the skills and agents in this repository,
# plus the skills listed in picks.txt, fetched at their pinned commits.
#
#   bash install.sh
#   curl -fsSL https://raw.githubusercontent.com/CWashington98/cstack/main/install.sh | bash
#
# Where things go:
#   skills  $CLAUDE_CONFIG_DIR/skills (default ~/.claude/skills)
#           $CODEX_HOME/skills (default ~/.codex/skills), only if that Codex folder exists
#   agents  $CLAUDE_CONFIG_DIR/agents
#
# What it changes:
#   - A skill or agent that already exists and differs is moved to <target>/.cstack-backup/<time>/
#     before the new copy goes in. Identical ones are left alone.
#   - One that an earlier run installed and cstack no longer lists is moved to the backup too.
#   - Skills and agents you added yourself are never touched.
#   - Everything is fetched before anything is installed, so a failed download changes nothing.

# Everything is inside main, which runs on the last line. When this file is piped into bash,
# a half-downloaded copy then runs nothing.
main() {
  set -euo pipefail

  local repo="CWashington98/cstack"
  local claude="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  local codex="${CODEX_HOME:-$HOME/.codex}"
  local stamp work src
  stamp=$(date +%Y%m%d-%H%M%S)
  work=$(mktemp -d)
  # Expanded now, because $work is gone by the time the shell exits.
  trap "rm -rf '$work'" EXIT

  # Use the clone this script sits in. Piped from curl, there is none, so fetch one.
  src=$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" && pwd)
  if [ ! -f "$src/picks.txt" ]; then
    git clone -q --depth 1 "https://github.com/$repo.git" "$work/cstack" </dev/null
    src="$work/cstack"
  fi

  mkdir -p "$work/skills" "$work/agents"

  # 1. Stage cstack's own skills and agents.
  local path
  for path in "$src"/skills/*/; do
    stage_skill "$path" "$work/skills"
  done
  cp "$src"/agents/*.md "$work/agents/"

  # 2. Stage the picks, each at its pinned commit.
  local gh sha folder names dir name license
  while read -r gh sha folder names; do
    case "$gh" in '' | \#*) continue ;; esac
    dir="$work/src/${gh//\//_}-$sha"
    if [ ! -d "$dir" ]; then
      echo "Fetching $gh at ${sha:0:12}"
      git init -q "$dir"
      git -C "$dir" fetch -q --depth 1 "https://github.com/$gh.git" "$sha" </dev/null
      git -C "$dir" -c advice.detachedHead=false checkout -q FETCH_HEAD </dev/null
    fi
    license=$(license_for "$dir" "$folder") || fail "picks.txt: $gh has no license file above $folder"
    for name in $names; do
      [ -f "$dir/$folder/$name/SKILL.md" ] || fail "picks.txt: $gh has no $folder/$name at $sha"
      stage_skill "$dir/$folder/$name" "$work/skills"
      [ -e "$work/skills/$name/LICENSE" ] || cp "$license" "$work/skills/$name/LICENSE"
    done
  done <"$src/picks.txt"

  # 3. Install.
  place "$work/skills" "$claude/skills"
  if [ -d "$codex" ]; then
    place "$work/skills" "$codex/skills"
  else
    echo "Codex folder $codex not found, so skills were installed for Claude Code only."
  fi
  place "$work/agents" "$claude/agents"

  echo "Done. Restart Claude Code and Codex to load the changes."
}

fail() {
  echo "cstack install: $*" >&2
  exit 1
}

# Copies one skill folder into the staging folder. Two skills with one name would overwrite
# each other, so that stops the install.
stage_skill() {
  local from="${1%/}" to="$2" name
  name=$(basename "$from")
  [ ! -e "$to/$name" ] || fail "two skills are named $name"
  cp -R "$from" "$to/$name"
}

# Prints the nearest license file at or above <repo>/<folder>.
license_for() {
  local root="$1" d="$1/$2" f
  while :; do
    for f in "$d"/LICENSE*; do
      [ -f "$f" ] && { echo "$f"; return 0; }
    done
    [ "$d" = "$root" ] && return 1
    d=$(dirname "$d")
  done
}

# Installs every entry of a staging folder into a target folder. <target>/.cstack-installed
# lists what cstack put there, so a later run can tell its own entries from yours.
place() {
  local staged="$1" target="$2"
  local manifest="$target/.cstack-installed" backup="$target/.cstack-backup/$stamp"
  local name path added=0 updated=0 removed=0
  mkdir -p "$target"

  if [ -f "$manifest" ]; then
    while read -r name; do
      [ -n "$name" ] || continue
      if [ ! -e "$staged/$name" ] && { [ -e "$target/$name" ] || [ -L "$target/$name" ]; }; then
        mkdir -p "$backup"
        mv "$target/$name" "$backup/"
        removed=$((removed + 1))
      fi
    done <"$manifest"
  fi

  : >"$manifest.new"
  for path in "$staged"/*; do
    name=$(basename "$path")
    echo "$name" >>"$manifest.new"
    if [ -e "$target/$name" ] || [ -L "$target/$name" ]; then
      diff -rq "$path" "$target/$name" >/dev/null 2>&1 && continue
      mkdir -p "$backup"
      mv "$target/$name" "$backup/"
      updated=$((updated + 1))
    else
      added=$((added + 1))
    fi
    cp -R "$path" "$target/$name"
  done
  mv "$manifest.new" "$manifest"

  echo "$target: $added added, $updated updated, $removed removed."
  if [ -d "$backup" ]; then echo "  Replaced copies were saved in $backup"; fi
}

main "$@"
