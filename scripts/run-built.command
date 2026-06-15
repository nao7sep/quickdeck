#!/usr/bin/env bash
set -euo pipefail

# run-built: launch the EXISTING built binary without rebuilding, so it starts
# instantly. This is the daily-use launcher and the one that surfaces
# production-only failures (strict CSP, file:// paths, packaged layout). It never
# builds — if you changed source, run rebuild first.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

log_step() {
  printf '\n==> %s\n' "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

pause_on_failure() {
  local status="$1"
  if [[ "$status" -ne 0 && "$status" -ne 130 ]]; then
    echo
    echo "quickdeck run-built failed with exit code $status."
    read -r -p "Press Enter to close..."
  fi
}

trap 'pause_on_failure $?' EXIT

cd "$REPO_DIR"

# No build, no dependency install here: this launcher must start instantly. If
# there is no usable build yet, stop and point at rebuild rather than launching
# something stale or empty.
if [[ ! -x src-tauri/target/debug/quickdeck ]]; then
  echo "No build found — run rebuild first."
  exit 1
fi

built_at="$(stat -f '%Sm' -t '%Y-%m-%d %H:%M:%S %Z' src-tauri/target/debug/quickdeck 2>/dev/null || echo 'unknown')"
log_step "Launching the existing built binary (built: $built_at)"
echo "If you changed source since then, run rebuild instead."

./src-tauri/target/debug/quickdeck
