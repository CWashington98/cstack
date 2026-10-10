#!/usr/bin/env bash
# Installs or updates the cstack plugins in one step.
#
#   bash install.sh             the everyday set, plus whatever this project uses (detected)
#   bash install.sh expo web    the everyday set, plus the named groups
#   bash install.sh all         everything
#
# Or without a copy of cstack, from the project's folder:
#   curl -fsSL https://raw.githubusercontent.com/CWashington98/cstack/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/CWashington98/cstack/main/install.sh | bash -s -- expo
#
# The everyday set is installed for you, in every project. The groups are installed for this
# project only, so an Expo app's skills don't load in a web project.

# Everything is inside main, which runs on the last line. When this file is piped into bash,
# a half-downloaded copy then runs nothing, and nothing below can be eaten as input.
main() {
  set -euo pipefail
  local SOURCE="CWashington98/cstack"

  # Each group names plugins from .claude-plugin/marketplace.json. A test checks every name is there.
  local GROUP_EVERYDAY="cstack plain verify pstack-picks ponytail-picks caveman-picks"
  local GROUP_WEB="vercel-react-picks good-css-picks"
  local GROUP_VERCEL="vercel-deploy-picks"
  local GROUP_EXPO="expo-picks rn-callstack-picks rn-vercel-picks"

  local groups=() g
  if [ "$#" -eq 0 ]; then
    detect_groups
  else
    for g in "$@"; do
      case "$g" in
        web|vercel|expo) groups+=("$g") ;;
        all) groups+=(web vercel expo) ;;
        -h|--help) usage; return 0 ;;
        *) echo "Unknown group: $g" >&2; usage; return 2 ;;
      esac
    done
  fi

  local here
  here=$(pwd -P)

  # Refresh the catalog if it's already added. If it isn't, the first install adds it.
  claude plugin marketplace update cstack </dev/null >/dev/null 2>&1 || true
  local installed
  installed=$(claude plugin list --json </dev/null 2>/dev/null || echo "[]")

  local failed=() p
  for p in $GROUP_EVERYDAY; do
    install_or_update "$p" user || failed+=("$p")
  done
  for g in "${groups[@]+"${groups[@]}"}"; do
    local list=""
    case "$g" in
      web) list="$GROUP_WEB" ;;
      vercel) list="$GROUP_VERCEL" ;;
      expo) list="$GROUP_EXPO" ;;
    esac
    for p in $list; do
      install_or_update "$p" local || failed+=("$p")
    done
  done

  if [ "${#failed[@]}" -gt 0 ]; then
    echo "These didn't install or update: ${failed[*]}" >&2
    return 1
  fi
  echo "Done. Restart Claude Code to load the changes."
}

usage() {
  echo "Usage: install.sh [web] [vercel] [expo] [all]" >&2
  echo "  With no group, it detects what the current project uses." >&2
}

# Sets `groups` from the project's package.json files and Vercel settings.
# Installed packages and hidden folders, such as old worktree copies, are skipped.
detect_groups() {
  local expo=0 web=0 f
  while IFS= read -r -d '' f; do
    # Only a dependency entry counts, not the word in a description or keyword list.
    # An Expo app often lists react-dom for Expo's own web support, so it counts only as Expo.
    if grep -qE '"expo"[[:space:]]*:' "$f"; then expo=1
    elif grep -qE '"(react-dom|next)"[[:space:]]*:' "$f"; then web=1
    fi
  done < <(find . -maxdepth 4 -name package.json -not -path "*/node_modules/*" -not -path "*/.*/*" -print0 2>/dev/null)
  if [ "$expo" = 1 ]; then groups+=(expo); fi
  if [ "$web" = 1 ]; then groups+=(web); fi
  if [ -n "$(find . -maxdepth 3 \( -name vercel.json -o -name .vercel \) -not -path "*/node_modules/*" -not -path "*/.*/*" 2>/dev/null)" ]; then groups+=(vercel); fi
  echo "Detected for this project: ${groups[*]:-nothing extra}"
}

# Prints the scope this plugin is installed at for this project: "user" (everywhere),
# "local" or "project" (this folder only), or nothing. An install in another project doesn't count.
installed_scope() {
  local id="$1"
  local reader='
    const [list, id, here] = process.argv.slice(1);
    const rows = JSON.parse(list || "[]").filter((r) => r.id === id);
    const mine = rows.find((r) => r.scope === "user") ?? rows.find((r) => (r.scope === "local" || r.scope === "project") && r.projectPath === here);
    process.stdout.write(mine ? mine.scope : "");'
  if command -v node >/dev/null 2>&1; then
    node -e "$reader" "$installed" "$id" "$here" </dev/null 2>/dev/null || true
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c '
import json, sys
rows = [r for r in json.loads(sys.argv[1] or "[]") if r.get("id") == sys.argv[2]]
mine = next((r for r in rows if r.get("scope") == "user"), None) or next((r for r in rows if r.get("scope") in ("local", "project") and r.get("projectPath") == sys.argv[3]), None)
sys.stdout.write(mine["scope"] if mine else "")' "$installed" "$id" "$here" </dev/null 2>/dev/null || true
  fi
}

install_or_update() {
  local p="$1" scope="$2" have
  have=$(installed_scope "$p@cstack")
  if [ -n "$have" ]; then
    echo "Updating $p ($have)"
    claude plugin update "$p@cstack" --scope "$have" </dev/null
  else
    echo "Installing $p ($scope)"
    claude plugin install "$p" --marketplace "CWashington98/cstack" --scope "$scope" </dev/null
  fi
}

main "$@"
