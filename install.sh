#!/usr/bin/env bash
# Installs or updates the cstack plugins in one step.
#
#   bash install.sh             the everyday set, plus whatever this project uses (detected)
#   bash install.sh expo web    the everyday set, plus the named groups
#   bash install.sh all         everything
#
# Or without a copy of cstack:
#   curl -fsSL https://raw.githubusercontent.com/CWashington98/cstack/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/CWashington98/cstack/main/install.sh | bash -s -- expo
set -euo pipefail

SOURCE="CWashington98/cstack"

# Each group names plugins from .claude-plugin/marketplace.json. A test checks every name is there.
GROUP_EVERYDAY="cstack plain verify pstack-picks ponytail-picks caveman-picks"
GROUP_WEB="vercel-react-picks good-css-picks"
GROUP_VERCEL="vercel-deploy-picks"
GROUP_EXPO="expo-picks rn-callstack-picks rn-vercel-picks"

usage() {
  echo "Usage: install.sh [web] [vercel] [expo] [all]" >&2
  echo "  With no group, it detects what the current project uses." >&2
}

groups=()
if [ "$#" -eq 0 ]; then
  # Detect from this project's package.json files, skipping installed packages.
  pkgs=$(find . -maxdepth 4 -name package.json -not -path "*/node_modules/*" 2>/dev/null || true)
  if [ -n "$pkgs" ]; then
    if grep -l '"expo"' $pkgs >/dev/null 2>&1; then groups+=(expo); fi
    if grep -lE '"(react-dom|next)"' $pkgs >/dev/null 2>&1; then groups+=(web); fi
  fi
  if [ -n "$(find . -maxdepth 3 \( -name vercel.json -o -name .vercel \) -not -path "*/node_modules/*" 2>/dev/null)" ]; then groups+=(vercel); fi
  echo "Detected for this project: ${groups[*]:-nothing extra}"
else
  for g in "$@"; do
    case "$g" in
      web|vercel|expo) groups+=("$g") ;;
      all) groups+=(web vercel expo) ;;
      -h|--help) usage; exit 0 ;;
      *) echo "Unknown group: $g" >&2; usage; exit 2 ;;
    esac
  done
fi

plugins="$GROUP_EVERYDAY"
for g in "${groups[@]+"${groups[@]}"}"; do
  case "$g" in
    web) plugins="$plugins $GROUP_WEB" ;;
    vercel) plugins="$plugins $GROUP_VERCEL" ;;
    expo) plugins="$plugins $GROUP_EXPO" ;;
  esac
done

# Refresh the catalog if it's already added. If it isn't, the first install adds it.
claude plugin marketplace update cstack >/dev/null 2>&1 || true
installed=$(claude plugin list --json 2>/dev/null || echo "[]")

failed=()
for p in $plugins; do
  if printf '%s' "$installed" | grep -q "\"$p@cstack\""; then
    echo "Updating $p"
    claude plugin update "$p@cstack" || failed+=("$p")
  else
    echo "Installing $p"
    claude plugin install "$p" --marketplace "$SOURCE" || failed+=("$p")
  fi
done

if [ "${#failed[@]}" -gt 0 ]; then
  echo "These didn't install or update: ${failed[*]}" >&2
  exit 1
fi
echo "Done. Restart Claude Code to load the changes."
