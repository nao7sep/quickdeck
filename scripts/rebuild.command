#!/usr/bin/env bash
set -euo pipefail

# rebuild: produce a fresh PRODUCTION build (Tauri debug binary, --no-bundle) and
# launch it. Slow — run this after changing source. The build runs the frontend's
# production type check and bundle (via beforeBuildCommand) and compiles the Rust
# binary, so type, import, CSP, and packaged-layout errors that `run-dev` hides
# surface here. `run-built` is the fast, no-build launcher for everything after
# this.

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
    echo "quickdeck rebuild failed with exit code $status."
    read -r -p "Press Enter to close..."
  fi
}

trap 'pause_on_failure $?' EXIT

require_command node
require_command npm
require_command cargo
require_command rustc

cd "$REPO_DIR"

log_step "Installing dependencies"
npm install

# Remove stale frontend output so a build that fails to emit a file can't be
# masked by a leftover artifact from a previous run. Only the frontend output is
# cleaned: cargo is incremental, and cleaning src-tauri/target would force a
# multi-minute recompile of the Rust binary.
log_step "Cleaning previous frontend build"
rm -rf dist

# tauri build --debug triggers beforeBuildCommand (the frontend `tsc && vite
# build`) and then compiles the Rust debug binary; --no-bundle skips the dmg/nsis
# packaging we don't want here.
log_step "Building production frontend and debug binary"
node_modules/.bin/tauri build --debug --no-bundle

# Launching the built binary directly loads the production frontend with the
# tauri.conf CSP, which `tauri dev` does not.
log_step "Launching the built binary"
./src-tauri/target/debug/quickdeck
