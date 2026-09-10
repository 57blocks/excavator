#!/usr/bin/env bash
# Excavator installer — Codex only.
#
# Symlinks every skills/<name>/ directory into ~/.agents/skills/<name>/ and
# links this checkout's root to ~/.excavator-plugin (the well-known root
# skill scripts and hooks search for). Run it from inside a clone of this
# repository; it operates in place — it does not clone anything itself.
#
# Usage:
#   ./install.sh              Install (create the symlinks)
#   ./install.sh --uninstall  Remove the symlinks this script created
#   ./install.sh --help
#
# Claude Code does not use this script — it installs via the marketplace
# (.claude-plugin/marketplace.json); see README.md.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SKILLS_ROOT="$SCRIPT_DIR/skills"
AGENTS_SKILLS_DIR="$HOME/.agents/skills"
PLUGIN_LINK="$HOME/.excavator-plugin"

list_skills() {
  if [[ ! -d "$SKILLS_ROOT" ]]; then
    printf 'Skills directory not found: %s\n' "$SKILLS_ROOT" >&2
    exit 1
  fi
  local d
  for d in "$SKILLS_ROOT"/*/; do
    [[ -d "$d" ]] || continue
    basename "$d"
  done
}

cmd_install() {
  mkdir -p "$AGENTS_SKILLS_DIR"
  printf -- '→ Linking skills into %s\n' "$AGENTS_SKILLS_DIR"
  local skill
  while IFS= read -r skill; do
    ln -sfn "$SKILLS_ROOT/$skill" "$AGENTS_SKILLS_DIR/$skill"
    printf '  ✓ %s → %s\n' "$AGENTS_SKILLS_DIR/$skill" "$SKILLS_ROOT/$skill"
  done < <(list_skills)

  printf -- '→ Linking plugin root\n'
  if [[ "$(cd "$PLUGIN_LINK" 2>/dev/null && pwd -P || true)" == "$SCRIPT_DIR" ]]; then
    printf '  • %s already resolves to this checkout, leaving as-is\n' "$PLUGIN_LINK"
  else
    ln -sfn "$SCRIPT_DIR" "$PLUGIN_LINK"
    printf '  ✓ %s → %s\n' "$PLUGIN_LINK" "$SCRIPT_DIR"
  fi

  printf '\n✓ Installed Excavator for Codex.\n'
  printf '  Restart Codex to pick up the skills.\n'
  printf '\n  Tip: Codex invokes skills with $ instead of / — type $excavator, not /excavator.\n'
}

cmd_uninstall() {
  printf -- '→ Removing skill links from %s\n' "$AGENTS_SKILLS_DIR"
  if [[ -d "$SKILLS_ROOT" ]]; then
    local skill
    while IFS= read -r skill; do
      [[ -L "$AGENTS_SKILLS_DIR/$skill" ]] && rm -f "$AGENTS_SKILLS_DIR/$skill"
    done < <(list_skills)
  fi

  if [[ -L "$PLUGIN_LINK" ]]; then
    rm -f "$PLUGIN_LINK"
    printf '  ✓ removed %s\n' "$PLUGIN_LINK"
  fi
  printf '\n✓ Uninstalled.\n'
}

usage() {
  cat <<USAGE
Excavator installer (Codex only)

Usage:
  install.sh              Install (symlink skills + plugin root)
  install.sh --uninstall  Remove the symlinks this script created
  install.sh --help
USAGE
}

main() {
  case "${1:-}" in
    -h|--help)
      usage
      ;;
    --uninstall)
      cmd_uninstall
      ;;
    "")
      cmd_install
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
