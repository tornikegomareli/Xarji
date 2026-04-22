#!/usr/bin/env bash
# Unsigned local build of the full Xarji stack — produces a runnable
# .app and a DMG without needing an Apple Developer account or
# notarization credentials. Useful for:
#
#   * Contributors who just want to run the app from source.
#   * Locally verifying end-to-end packaging before running the
#     signed release/build.sh.
#   * Iterating on the Swift menu-bar code without waiting on Apple's
#     notary service.
#
# The produced .app is ad-hoc signed. macOS Gatekeeper will refuse to
# launch it from the Finder with the standard "unidentified developer"
# warning — right-click the .app → Open the first time to bypass.
# Users who get a signed DMG from a Release never see this.
#
# Usage:
#   ./scripts/build-dev.sh
#
# Outputs:
#   dist/dev/Xarji.app                unsigned bundle
#   dist/dev/Xarji-dev.dmg            drag-to-Applications DMG
set -euo pipefail

log() { printf "\n==> %s\n" "$*"; }
fail() { printf "ERROR: %s\n" "$*" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

for tool in bun swift hdiutil; do
  command -v "$tool" >/dev/null || fail "missing tool: $tool"
done

DEV_DIR="$REPO_ROOT/dist/dev"
mkdir -p "$DEV_DIR"

log "Building client"
(cd client && bun install --frozen-lockfile && bun run build)

log "Embedding client assets"
bun run "$REPO_ROOT/scripts/embed-assets.ts"

log "Compiling xarji-core"
(cd service && bun install --frozen-lockfile && bun run build:binary)

log "Packaging Xarji.app (ad-hoc signed)"
(cd app-menubar && \
  SIGNING_MODE="adhoc" \
  XARJI_CORE_BINARY="$REPO_ROOT/service/dist/xarji" \
  ./Scripts/package_app.sh release)

cp -R "$REPO_ROOT/app-menubar/dist/Xarji.app" "$DEV_DIR/Xarji.app"

log "Building DMG"
DMG="$DEV_DIR/Xarji-dev.dmg"
DMG_STAGE=$(mktemp -d -t xarji-dev-dmg-XXXXXX)
trap 'rm -rf "$DMG_STAGE"' EXIT
cp -R "$DEV_DIR/Xarji.app" "$DMG_STAGE/Xarji.app"
ln -s /Applications "$DMG_STAGE/Applications"

rm -f "$DMG"
hdiutil create \
  -volname "Xarji (dev)" \
  -srcfolder "$DMG_STAGE" \
  -ov \
  -format UDZO \
  "$DMG"

log "Done."
printf "\n  .app:  %s\n" "$DEV_DIR/Xarji.app"
printf "  DMG:   %s\n" "$DMG"
printf "\nThe .app is ad-hoc signed — Gatekeeper will prompt on first\n"
printf "launch. Right-click the .app and choose Open to bypass.\n\n"
